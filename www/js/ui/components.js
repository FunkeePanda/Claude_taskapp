// Shared UI pieces: toast, bottom sheet, confirm, task cards, formatting.

import { setCompleted, completeWithDescendants, setArchived } from '../model.js';
import { fmtInterval, startSession, stopSession, sessionActive, sessionEndsAt } from '../reminders.js';

export function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ---------- Toast ----------
let toastTimer;
export function toast(msg, { actionLabel, onAction, duration = 3200 } = {}) {
  const root = document.getElementById('toast-root');
  root.innerHTML = `<div class="toast">${esc(msg)}${actionLabel ? `<button>${esc(actionLabel)}</button>` : ''}</div>`;
  const el = root.firstElementChild;
  if (actionLabel) {
    el.querySelector('button').addEventListener('click', () => {
      el.classList.remove('show');
      onAction?.();
    });
  }
  requestAnimationFrame(() => el.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), duration);
}

// ---------- Bottom sheet ----------
// Three ways out, always: tap the scrim, tap ✕, or drag the sheet down.
export function openSheet(html) {
  const root = document.getElementById('sheet-root');
  root.innerHTML = `
    <div class="sheet-scrim"></div>
    <div class="sheet" role="dialog" aria-modal="true">
      <div class="grabber"></div>
      <button class="sheet-close" aria-label="Close">✕</button>
      ${html}
    </div>`;
  const scrim = root.querySelector('.sheet-scrim');
  const sheet = root.querySelector('.sheet');
  requestAnimationFrame(() => {
    scrim.classList.add('open');
    sheet.classList.add('open');
  });
  scrim.addEventListener('click', closeSheet);
  sheet.querySelector('.sheet-close').addEventListener('click', closeSheet);

  // swipe-down to dismiss (only when the sheet isn't scrolled). A touch
  // that starts on a control with its own gesture — the time wheels,
  // text/date inputs — belongs to that control alone and never drags
  // the sheet.
  let startY = null, dy = 0;
  sheet.addEventListener('touchstart', (e) => {
    if (sheet.scrollTop > 0) return;
    if (e.target.closest('.opt-panel, .wheel-row, .wheel, input, textarea, select, .switch, .segment')) return;
    startY = e.touches[0].clientY;
    dy = 0;
  }, { passive: true });
  sheet.addEventListener('touchmove', (e) => {
    if (startY == null) return;
    dy = e.touches[0].clientY - startY;
    if (dy > 0) {
      sheet.style.transition = 'none';
      sheet.style.transform = `translateY(${dy}px)`;
    }
  }, { passive: true });
  sheet.addEventListener('touchend', () => {
    sheet.style.transition = '';
    if (dy > 110) closeSheet();
    else sheet.style.transform = '';
    startY = null;
  });

  return sheet;
}

export function closeSheet() {
  const root = document.getElementById('sheet-root');
  const scrim = root.querySelector('.sheet-scrim');
  const sheet = root.querySelector('.sheet');
  if (!sheet) return;
  scrim.classList.remove('open');
  sheet.classList.remove('open');
  sheet.style.transform = 'translateY(105%)'; // wins over any drag offset
  // only clear the root if THIS sheet is still the one in it — a new
  // sheet (e.g. the delete confirmation) may have replaced it meanwhile
  setTimeout(() => {
    if (root.querySelector('.sheet') === sheet) root.innerHTML = '';
  }, 340);
}

export function confirmSheet(message, confirmLabel = 'Delete') {
  return new Promise((resolve) => {
    const sheet = openSheet(`
      <h2>${esc(message)}</h2>
      <div style="display:flex; gap:10px; margin-top:8px">
        <button class="btn secondary" style="flex:1" data-act="no">Cancel</button>
        <button class="btn danger" style="flex:1" data-act="yes">${esc(confirmLabel)}</button>
      </div>`);
    sheet.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (!act) return;
      closeSheet();
      resolve(act === 'yes');
    });
  });
}

// ---------- Formatting ----------
const DAY = 86400000;

export function fmtDue(task, now = Date.now()) {
  if (task.due == null) return null;
  const due = new Date(task.due);
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const dueDay = new Date(task.due); dueDay.setHours(0, 0, 0, 0);
  const dayDiff = Math.round((dueDay - today) / DAY);
  const time = task.allDay ? '' : ' ' + due.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

  if (task.due < now && !task.completedAt) {
    const h = Math.round((now - task.due) / 3600000);
    if (h < 1) return { text: 'Overdue', cls: 'overdue' };
    if (h < 24) return { text: `Overdue ${h}h`, cls: 'overdue' };
    return { text: `Overdue ${Math.round(h / 24)}d`, cls: 'overdue' };
  }
  if (dayDiff <= 0) return { text: ('Today' + time).trim(), cls: 'today' };
  if (dayDiff === 1) return { text: ('Tomorrow' + time).trim(), cls: '' };
  if (dayDiff < 7) return { text: (due.toLocaleDateString(undefined, { weekday: 'short' }) + time).trim(), cls: '' };
  return { text: (due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + time).trim(), cls: '' };
}

function fmtMin(min) {
  if (min >= 60) {
    const h = Math.floor(min / 60), m = min % 60;
    return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
  }
  return `${min}m`;
}

export function taskChipsHtml(task, now = Date.now()) {
  const chips = [];
  if (task.color) {
    chips.push(`<span class="chip cat" style="--c:${esc(task.color)}; background:color-mix(in srgb, ${esc(task.color)} 20%, transparent)"><span class="dot"></span></span>`);
  }
  const due = fmtDue(task, now);
  if (due) chips.push(`<span class="chip due ${due.cls}">${esc(due.text)}</span>`);
  if (sessionActive(task, now)) {
    const ends = sessionEndsAt(task);
    if (ends != null && task.timer) {
      // counts down the whole session (breaks included) against the plan
      const total = Math.round((ends - task.session.startedAt) / 60000);
      const left = Math.max(0, Math.ceil((ends - now) / 60000));
      chips.push(`<span class="chip nag">⏱ ${esc(fmtMin(left))} left of ${esc(fmtMin(total))}</span>`);
    } else {
      const elapsed = Math.max(0, Math.floor((now - task.session.startedAt) / 60000));
      chips.push(`<span class="chip nag">⏱ ${esc(fmtMin(elapsed))} in</span>`);
    }
  } else if (task.timer && !task.completedAt) {
    chips.push(`<span class="chip">⏱ ${esc(fmtMin(task.timer.durationMin))}</span>`);
  }
  if (task.priority === 2) chips.push('<span class="chip prio-high">high</span>');
  if (task.reminder && !task.completedAt) {
    // same anchor math as occurrencesFor(): when is the next nag?
    const interval = task.reminder.intervalMin * 60000;
    const anchor = task.reminder.startAt ?? task.createdAt ?? now;
    let k = anchor > now ? 0 : Math.ceil((now - anchor) / interval);
    if (anchor + k * interval <= now) k += 1;
    const inMin = Math.max(1, Math.ceil((anchor + k * interval - now) / 60000));
    chips.push(`<span class="chip nag">every ${esc(fmtInterval(task.reminder.intervalMin))} · next in ${esc(fmtMin(inMin))}</span>`);
  } else if (task.reminder) {
    chips.push(`<span class="chip nag">every ${esc(fmtInterval(task.reminder.intervalMin))}</span>`);
  }
  for (const t of task.tags) chips.push(`<span class="chip tag">#${esc(t)}</span>`);
  return chips.join('');
}

// ---------- Task card ----------
// onComplete(task, done, flippedIds) runs after the completion animation;
// onOpen(task) on tap. Subtask extras: parentLabel (context line above the
// title), progress ({done,total} chip), hasChildren/collapsed/onToggleCollapse
// (chevron), depth (tree indent).
export function taskCard(task, {
  onComplete, onOpen, index = 0, now = Date.now(),
  parentLabel = null, progress = null, hasChildren = false,
  collapsed = false, onToggleCollapse = null, depth = 0,
  onAddSubtask = null, onArchived = null, onSession = null,
} = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'collapse-wrap';
  wrap.style.setProperty('--i', index);
  const progressChip = progress && progress.total
    ? `<span class="chip progress">${progress.done}/${progress.total}</span>` : '';
  wrap.innerHTML = `
    <div>
      <div class="task-card ${task.completedAt ? 'done' : ''}" data-id="${task.id}">
        <button class="check prio-${task.priority} ${task.completedAt ? 'filled' : ''}" aria-label="Complete">
          <span class="fill"></span>
          <svg viewBox="0 0 24 24"><path d="M5 13l4 4 10-11"/></svg>
        </button>
        <div>
          ${parentLabel ? `<div class="parent-label">${esc(parentLabel)} ›</div>` : ''}
          <div class="title">${esc(task.title)}</div>
          <div class="task-meta">${progressChip}${taskChipsHtml(task, now)}</div>
        </div>
        <div style="display:flex; align-items:center; gap:2px">
          ${(task.timer || task.breaks) && !task.completedAt ? `
          <button class="play-btn ${task.session ? 'running' : ''}" aria-label="${task.session ? 'Stop session' : 'Start session'}">
            ${task.session
              ? '<svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>'
              : '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z"/></svg>'}
          </button>` : ''}
          ${hasChildren ? `
          <button class="chevron ${collapsed ? 'closed' : ''}" aria-label="${collapsed ? 'Expand' : 'Collapse'} subtasks">
            <svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>` : ''}
        </div>
      </div>
    </div>`;

  const card = wrap.querySelector('.task-card');
  const check = wrap.querySelector('.check');

  wrap.querySelector('.chevron')?.addEventListener('click', (e) => {
    e.stopPropagation();
    onToggleCollapse?.(task);
  });

  wrap.querySelector('.play-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (task.session) {
      stopSession(task.id);
      toast('Session stopped');
    } else {
      startSession(task.id);
      toast(task.breaks ? 'Session started — first break coming up' : 'Timer started');
    }
    onSession?.(task);
  });

  check.addEventListener('click', (e) => {
    e.stopPropagation();
    completeWithAnimation(task, wrap, check, onComplete);
  });

  let armed = false;
  card.addEventListener('click', () => {
    if (armed) { armed = false; return; } // the hold gesture consumed this tap
    onOpen?.(task);
  });

  // swipe right → add a subtask; swipe left on a completed task → move
  // it to Done. Hold half a second → haptic tick arms the card; THEN
  // swiping down while still holding toggles the subtasks. Releasing
  // without swiping does nothing (reserved for future hold options).
  let startX = null, startY = null, dx = 0, moved = false, lpTimer = null, holdToggled = false;
  card.addEventListener('touchstart', (e) => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    dx = 0;
    moved = false;
    armed = false;
    holdToggled = false;
    clearTimeout(lpTimer);
    lpTimer = setTimeout(() => {
      if (moved) return;
      armed = true;
      navigator.vibrate?.(15);
    }, 500);
  }, { passive: true });
  card.addEventListener('touchmove', (e) => {
    if (startX == null) return;
    dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;
    if (armed) {
      // holding: a downward swipe (still pressed) toggles the subtasks
      if (!holdToggled && dy > 40 && hasChildren) {
        holdToggled = true;
        navigator.vibrate?.(10);
        onToggleCollapse?.(task);
      }
      return; // no horizontal card slide while armed
    }
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
      moved = true;
      clearTimeout(lpTimer);
    }
    card.style.transform = `translateX(${Math.max(-120, Math.min(dx, 120))}px)`;
  }, { passive: true });
  card.addEventListener('touchend', () => {
    clearTimeout(lpTimer);
    card.style.transform = '';
    if (!armed) {
      if (dx > 90) {
        onAddSubtask?.(task);
      } else if (dx < -90 && task.completedAt && !task.archived) {
        setArchived(task.id, true);
        onArchived?.(task);
      }
    }
    startX = null;
  });

  return wrap;
}

const REDUCED_MOTION = typeof matchMedia !== 'undefined'
  && matchMedia('(prefers-reduced-motion: reduce)').matches;
const BUBBLE_COLORS = ['#a63446', '#c4576a', '#7c2434'];

function spawnBubbles(check, dir) {
  if (REDUCED_MOTION) return;
  const n = 12; // same count in and out so the two directions mirror
  for (let i = 0; i < n; i++) {
    const b = document.createElement('span');
    b.className = 'bubble ' + dir;
    const ang = (i / n) * Math.PI * 2 + (dir === 'in' ? 0.4 : 0.9);
    const dist = 26 + (i % 3) * 6;
    b.style.setProperty('--x', Math.cos(ang) * dist + 'px');
    b.style.setProperty('--y', Math.sin(ang) * dist + 'px');
    b.style.setProperty('--s', (6 + (i % 3) * 2) + 'px');
    b.style.setProperty('--c', BUBBLE_COLORS[i % 3]);
    b.style.setProperty('--t', (0.3 + (i % 4) * 0.05) + 's');
    b.style.setProperty('--d', (dir === 'in' ? (i % 4) * 40 : (i % 4) * 25) + 'ms');
    check.appendChild(b);
    b.addEventListener('animationend', () => b.remove());
  }
}

// Complete: bubbles converge → maroon fill grows from center → white check
// pops → card collapses. Uncheck: check out → fill shrinks → bubbles burst.
function completeWithAnimation(task, wrap, check, onComplete) {
  if (check.dataset.busy) return;
  check.dataset.busy = '1';
  const card = wrap.querySelector('.task-card');
  const completing = !task.completedAt;

  if (REDUCED_MOTION) {
    check.classList.toggle('filled', completing);
    card.classList.toggle('done', completing);
    const flipped = completing ? completeWithDescendants(task.id) : [task.id];
    if (!completing) setCompleted(task.id, false);
    delete check.dataset.busy;
    onComplete?.(task, completing, flipped);
    return;
  }

  if (completing) {
    // the card stays where it is and just greys out — moving it to Done
    // is the user's call (swipe left)
    spawnBubbles(check, 'in');
    setTimeout(() => check.classList.add('filling'), 160);
    setTimeout(() => {
      check.classList.remove('filling');
      check.classList.add('filled', 'checkpop');
      card.classList.add('done');
    }, 400);
    setTimeout(() => {
      check.classList.remove('checkpop');
      delete check.dataset.busy;
      const flipped = completeWithDescendants(task.id);
      onComplete?.(task, true, flipped);
    }, 680);
  } else {
    check.classList.add('checkout');
    card.classList.remove('done');
    setTimeout(() => {
      check.classList.remove('checkpop', 'checkout', 'filled');
      check.classList.add('unfilling');
    }, 140);
    setTimeout(() => {
      check.classList.remove('unfilling');
      spawnBubbles(check, 'out');
    }, 340);
    setTimeout(() => {
      delete check.dataset.busy;
      setCompleted(task.id, false);
      onComplete?.(task, false, [task.id]);
    }, 640);
  }
}
