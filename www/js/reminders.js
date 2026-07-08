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

// Upcoming firings for one task: anchored to startAt ?? due ?? createdAt,
// spaced intervalMin apart, only future, only inside the window, quiet
// hours skipped.
export function occurrencesFor(task, now, settings = {}) {
  if (!task.reminder || task.completedAt) return [];
  const interval = task.reminder.intervalMin * MIN;
  if (interval <= 0) return [];
  const anchor = task.reminder.startAt ?? task.due ?? task.createdAt ?? now;

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

// Global plan across all tasks, earliest-first, capped.
export function planAll(tasks, now, settings = {}) {
  const all = [];
  for (const t of tasks) all.push(...occurrencesFor(t, now, settings));
  all.sort((a, b) => a.ts - b.ts);
  return all.slice(0, MAX_TOTAL);
}

// ---------------------------------------------------------------------
// Plugin glue (no-ops in web preview)
// ---------------------------------------------------------------------

import { LocalNotifications, notificationsSupported } from './native.js';
import { allTasks, getTask, setCompleted, updateTask, settings as getSettings } from './model.js';

export function fmtInterval(intervalMin) {
  if (intervalMin % 60 === 0) {
    const h = intervalMin / 60;
    return h === 1 ? 'hour' : `${h} hours`;
  }
  return `${intervalMin} min`;
}

export async function ensurePermission() {
  if (!notificationsSupported) return false;
  let { display } = await LocalNotifications.checkPermissions();
  if (display === 'prompt' || display === 'prompt-with-rationale') {
    ({ display } = await LocalNotifications.requestPermissions());
  }
  return display === 'granted';
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
    types: [{
      id: 'nag',
      actions: [
        { id: 'done', title: '✓ Done' },
        { id: 'snooze', title: 'Snooze 1h' },
      ],
    }],
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

let reconciling = false;

// Cancel-everything-then-reschedule: simplest idempotent sync between
// the task list and Android's pending alarms.
export async function reconcile(now = Date.now()) {
  if (!notificationsSupported || reconciling) return;
  reconciling = true;
  try {
    const { display } = await LocalNotifications.checkPermissions();
    if (display !== 'granted') return;

    const pending = await LocalNotifications.getPending();
    if (pending.notifications.length) {
      await LocalNotifications.cancel({
        notifications: pending.notifications.map(n => ({ id: n.id })),
      });
    }

    const plan = planAll(allTasks(), now, getSettings());
    if (!plan.length) return;

    const byId = new Map(allTasks().map(t => [t.id, t]));
    await LocalNotifications.schedule({
      notifications: plan.map(o => {
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
      }),
    });
  } finally {
    reconciling = false;
  }
}
