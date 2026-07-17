// Nag-reminder engine.
//
// Pure core (occurrence math, quiet hours, global planning) is exported
// for unit tests. The glue at the bottom talks to the LocalNotifications
// plugin and is a no-op in the web preview.
//
// Strategy: Android's local-notifications plugin can't do "every 45 min"
// natively, so each task gets a rolling window of individual exact
// alarms covering the next ~12 h. reconcile() — called on app launch,
// resume, and any task change — cancels everything pending and
// reschedules the current truth. Fully idempotent, self-healing.

const MIN = 60 * 1000;
const WINDOW_MS = 12 * 60 * 60 * 1000;
const MAX_PER_TASK = 24;
const MAX_TOTAL = 180;          // stay well under Android's 500-alarm cap
const SLOTS_PER_TASK = 100;     // nid = taskId*100 + slot

export function nidFor(taskId, slot) {
  return taskId * SLOTS_PER_TASK + slot;
}

export function taskIdFromNid(nid) {
  return Math.floor(nid / SLOTS_PER_TASK);
}

// "22:00".."08:00" (may cross midnight). Equal start/end = no quiet hours.
export function isQuietTime(ts, quietStart, quietEnd) {
  if (!quietStart || !quietEnd || quietStart === quietEnd) return false;
  const d = new Date(ts);
  const mins = d.getHours() * 60 + d.getMinutes();
  const [qsH, qsM] = quietStart.split(':').map(Number);
  const [qeH, qeM] = quietEnd.split(':').map(Number);
  const qs = qsH * 60 + qsM;
  const qe = qeH * 60 + qeM;
  return qs < qe ? (mins >= qs && mins < qe) : (mins >= qs || mins < qe);
}

// Upcoming firings for one task: anchored to startAt (snooze) or the
// task's creation — NOT the due date. Once the switch is on, intervals
// fire persistently until the task is done or the user turns them off;
// only snooze and quiet hours pause them.
export function occurrencesFor(task, now, settings = {}) {
  if (!task.reminder || task.completedAt) return [];
  const interval = task.reminder.intervalMin * MIN;
  if (interval <= 0) return [];
  const anchor = task.reminder.startAt ?? task.createdAt ?? now;

  let k = anchor > now ? 0 : Math.ceil((now - anchor) / interval);
  if (anchor + k * interval <= now) k += 1;

  const out = [];
  let slot = 0;
  while (out.length < MAX_PER_TASK && slot < SLOTS_PER_TASK) {
    const ts = anchor + k * interval;
    if (ts > now + WINDOW_MS) break;
    if (!isQuietTime(ts, settings.quietStart, settings.quietEnd)) {
      out.push({ nid: nidFor(task.id, out.length), ts, taskId: task.id });
    }
    k += 1;
    slot += 1;
  }
  return out;
}

// One-shot notification at the task's chosen due moment. Fires exactly
// when the user picked — deliberately NOT filtered by quiet hours, since
// the time was chosen explicitly. Date-only (all-day) tasks notify at
// 9:00 that morning instead of the internal 23:59 end-of-day stamp.
const DUE_SLOT = 70; // nags use slots 0..23, sessions 80..99

export function dueNotification(task, now) {
  if (task.due == null || task.completedAt) return [];
  let ts = task.due;
  let body = 'Due now';
  if (task.allDay) {
    const d = new Date(task.due);
    d.setHours(9, 0, 0, 0);
    ts = d.getTime();
    body = 'Due today';
  }
  if (ts <= now) return [];
  return [{ nid: nidFor(task.id, DUE_SLOT), ts, taskId: task.id, title: task.title, body }];
}

// Global plan across all tasks, earliest-first, capped. Interval nags
// are skipped for tasks whose running session asks for silence.
export function planAll(tasks, now, settings = {}) {
  const all = [];
  for (const t of tasks) {
    if (t.session && t.muteDuringSession !== false && sessionActive(t, now)) continue;
    all.push(...occurrencesFor(t, now, settings));
  }
  all.sort((a, b) => a.ts - b.ts);
  return all.slice(0, MAX_TOTAL);
}

// ---------------------------------------------------------------------
// Focus sessions (task timer / break cycles) — pure math
// ---------------------------------------------------------------------

const SESSION_SLOT_BASE = 80;   // nids taskId*100+80..99; nags use 0..23
const MAX_SESSION_EVENTS = 16;

// When does a session end on its own? Only when a task timer caps the
// total work time; break-only sessions run until stopped.
export function sessionEndsAt(task) {
  if (!task.session || !task.timer) return null;
  const target = task.timer.durationMin * MIN;
  if (!task.breaks) return task.session.startedAt + target;
  const { workMin, breakMin } = task.breaks;
  const fullCycles = Math.ceil(task.timer.durationMin / workMin) - 1;
  return task.session.startedAt + target + Math.max(0, fullCycles) * breakMin * MIN;
}

export function sessionActive(task, now) {
  if (!task.session || task.completedAt) return false;
  const ends = sessionEndsAt(task);
  return ends == null || now < ends;
}

// Notification boundaries for a running session: alternating break /
// back-to-work marks (if breaks configured) and a final time's-up (if a
// task timer is set). Future events only, capped.
export function sessionNotifications(task, now) {
  if (!sessionActive(task, now)) return [];
  const out = [];
  const push = (ts, title, body) => {
    if (ts > now && out.length < MAX_SESSION_EVENTS && ts <= now + WINDOW_MS) {
      out.push({ nid: task.id * SLOTS_PER_TASK + SESSION_SLOT_BASE + out.length, ts, title, body, taskId: task.id });
    }
  };
  const target = task.timer ? task.timer.durationMin * MIN : Infinity;

  if (!task.breaks) {
    if (task.timer) {
      push(task.session.startedAt + target, 'Time’s up',
        `Your ${fmtInterval(task.timer.durationMin)} for “${task.title}” is done`);
    }
    return out;
  }

  const work = task.breaks.workMin * MIN;
  const brk = task.breaks.breakMin * MIN;
  let t = task.session.startedAt;
  let workDone = 0;
  while (out.length < MAX_SESSION_EVENTS && t <= now + WINDOW_MS) {
    const chunk = Math.min(work, target - workDone);
    t += chunk;
    workDone += chunk;
    if (workDone >= target) {
      push(t, 'Time’s up', `Your ${fmtInterval(task.timer.durationMin)} for “${task.title}” is done`);
      break;
    }
    push(t, 'Break time', `Take ${task.breaks.breakMin} min — you earned it`);
    t += brk;
    push(t, 'Back to work', `“${task.title}” — next stretch: ${fmtInterval(task.breaks.workMin)}`);
  }
  return out;
}

// ---------------------------------------------------------------------
// Plugin glue (no-ops in web preview)
// ---------------------------------------------------------------------

import { LocalNotifications, notificationsSupported } from './native.js';
import { allTasks, getTask, setCompleted, updateTask, settings as getSettings } from './model.js';
import { webPushSupported, webPushPermission, ensureWebPushSubscription, syncWebPush } from './webpush.js';

export function fmtInterval(intervalMin) {
  if (intervalMin % 60 === 0) {
    const h = intervalMin / 60;
    return h === 1 ? 'hour' : `${h} hours`;
  }
  return `${intervalMin} min`;
}

export async function ensurePermission() {
  if (notificationsSupported) {
    let { display } = await LocalNotifications.checkPermissions();
    if (display === 'prompt' || display === 'prompt-with-rationale') {
      ({ display } = await LocalNotifications.requestPermissions());
    }
    return display === 'granted';
  }
  if (webPushSupported) return ensureWebPushSubscription();
  return false;
}

// Unified permission read across platforms, for Settings to render one
// status pill regardless of which delivery path is active.
export async function permissionStatus() {
  if (notificationsSupported) {
    const { display } = await LocalNotifications.checkPermissions();
    if (display === 'granted') return 'granted';
    if (display === 'denied') return 'denied';
    return 'prompt';
  }
  if (webPushSupported) {
    const perm = await webPushPermission();
    if (perm === 'granted') return 'granted';
    if (perm === 'denied') return 'denied';
    return 'prompt';
  }
  return 'unsupported';
}

let initialized = false;

export async function initNotifications(onDataChanged) {
  if (!notificationsSupported || initialized) return;
  initialized = true;

  await LocalNotifications.createChannel({
    id: 'reminders',
    name: 'Task reminders',
    description: 'Nagging reminders for tasks',
    importance: 5,
    visibility: 1,
    vibration: true,
  });

  await LocalNotifications.registerActionTypes({
    types: [
      {
        id: 'nag',
        actions: [
          { id: 'done', title: '✓ Done' },
          { id: 'snooze', title: 'Snooze 1h' },
        ],
      },
      {
        // due-time alert: snooze would need an interval reminder to hang
        // its startAt on, so it only offers Done
        id: 'due',
        actions: [{ id: 'done', title: '✓ Done' }],
      },
    ],
  });

  await LocalNotifications.addListener('localNotificationActionPerformed', async (event) => {
    const taskId = event.notification?.extra?.taskId ?? taskIdFromNid(event.notification?.id ?? 0);
    const task = getTask(taskId);
    if (!task) return;
    if (event.actionId === 'done') {
      setCompleted(taskId, true);
    } else if (event.actionId === 'snooze') {
      updateTask(taskId, { reminder: { ...task.reminder, startAt: Date.now() + 60 * MIN } });
    }
    await reconcile();
    if (onDataChanged) onDataChanged(event.actionId, taskId);
  });
}

// Start/stop a focus session (task timer / break cycle) on a task.
export async function startSession(id) {
  updateTask(id, { session: { startedAt: Date.now() } });
  await reconcile();
}

export async function stopSession(id) {
  updateTask(id, { session: null });
  await reconcile();
}

let reconciling = false;

// Cancel-everything-then-reschedule: simplest idempotent sync between
// the task list and this platform's delivery backend (Android's local
// alarms, or the Worker's D1 table for Web Push on iOS).
export async function reconcile(now = Date.now()) {
  // sessions that ran out (task timer elapsed) end themselves, so
  // muting/play-state don't linger — do this even in the web preview
  for (const t of allTasks()) {
    if (t.session && !sessionActive(t, now)) updateTask(t.id, { session: null });
  }

  if (reconciling) return;
  reconciling = true;
  try {
    if (notificationsSupported) await reconcileNative(now);
    else if (webPushSupported) await reconcileWebPush(now);
  } finally {
    reconciling = false;
  }
}

async function reconcileNative(now) {
  try {
    const { display } = await LocalNotifications.checkPermissions();
    if (display !== 'granted') return;

    const pending = await LocalNotifications.getPending();
    if (pending.notifications.length) {
      await LocalNotifications.cancel({
        notifications: pending.notifications.map(n => ({ id: n.id })),
      });
    }

    const byId = new Map(allTasks().map(t => [t.id, t]));
    const nags = planAll(allTasks(), now, getSettings()).map(o => {
      const task = byId.get(o.taskId);
      return {
        id: o.nid,
        channelId: 'reminders',
        title: task.title,
        body: `Repeats every ${fmtInterval(task.reminder.intervalMin)} — tap ✓ Done to stop`,
        schedule: { at: new Date(o.ts), allowWhileIdle: true },
        actionTypeId: 'nag',
        extra: { taskId: task.id },
        smallIcon: 'ic_stat_notify',
        autoCancel: true,
      };
    });

    const dues = allTasks()
      .flatMap(t => dueNotification(t, now))
      .map(o => ({
        id: o.nid,
        channelId: 'reminders',
        title: o.title,
        body: o.body,
        schedule: { at: new Date(o.ts), allowWhileIdle: true },
        actionTypeId: 'due',
        extra: { taskId: o.taskId },
        smallIcon: 'ic_stat_notify',
        autoCancel: true,
      }));

    const sessions = allTasks()
      .filter(t => sessionActive(t, now))
      .flatMap(t => sessionNotifications(t, now))
      .map(o => ({
        id: o.nid,
        channelId: 'reminders',
        title: o.title,
        body: o.body,
        schedule: { at: new Date(o.ts), allowWhileIdle: true },
        extra: { taskId: o.taskId },
        smallIcon: 'ic_stat_notify',
        autoCancel: true,
      }));

    const all = [...nags, ...dues, ...sessions];
    if (all.length) await LocalNotifications.schedule({ notifications: all });
  } catch { /* transient plugin error — next reconcile() retries */ }
}

// Same planning output as reconcileNative, shaped for the Worker's
// /sync route instead of Android's schedule() call.
async function reconcileWebPush(now) {
  const perm = await webPushPermission();
  if (perm !== 'granted') return;

  const byId = new Map(allTasks().map(t => [t.id, t]));
  const nags = planAll(allTasks(), now, getSettings()).map(o => {
    const task = byId.get(o.taskId);
    return {
      nid: o.nid,
      ts: o.ts,
      title: task.title,
      body: `Repeats every ${fmtInterval(task.reminder.intervalMin)} — tap to open Focus`,
    };
  });

  const dues = allTasks()
    .flatMap(t => dueNotification(t, now))
    .map(o => ({ nid: o.nid, ts: o.ts, title: o.title, body: o.body }));

  const sessions = allTasks()
    .filter(t => sessionActive(t, now))
    .flatMap(t => sessionNotifications(t, now))
    .map(o => ({ nid: o.nid, ts: o.ts, title: o.title, body: o.body }));

  await syncWebPush([...nags, ...dues, ...sessions]);
}
