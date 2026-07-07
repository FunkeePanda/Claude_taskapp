// Shared UI pieces: toast, bottom sheet, confirm, task cards, formatting.

import { setCompleted, completeWithDescendants } from '../model.js';
import { matchesEnergy } from '../focus.js';
import { fmtInterval } from '../reminders.js';

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
export function openSheet(html) {
  const root = document.getElementById('sheet-root');
  root.innerHTML = `
    <div class="sheet-scrim"></div>
    <div class="sheet" role="dialog" aria-modal="true">
      <div class="grabber"></div>
      ${html}
    </div>`;
  const scrim = root.querySelector('.sheet-scrim');
  const sheet = root.querySelector('.sheet');
  requestAnimationFrame(() => {
    scrim.classList.add('open');
    sheet.classList.add('open');
  });
  scrim.addEventListener('click', closeSheet);
  return sheet;
}

export function closeSheet() {
  const root = document.getElementById('sheet-root');
  const scrim = root.querySelector('.sheet-scrim');
  const sheet = root.querySelector('.sheet');
  if (!sheet) return;
  scrim.classList.remove('open');
  sheet.classList.remove('open');
  setTimeout(() => { root.innerHTML = ''; }, 340);
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

export function taskChipsHtml(task, energy, now = Date.now()) {
  const chips = [];
  const due = fmtDue(task, now);
  if (due) chips.push(`<span class="chip due ${due.cls}">${esc(due.text)}</span>`);
  if (task.priority === 2) chips.push('<span class="chip prio-high">high</span>');
  if (task.effort) chips.push(`<span class="chip effort">${task.effort === 'quick' ? '⚡ quick win' : '🧠 deep focus'}</span>`);
  if (task.reminder) chips.push(`<span class="chip nag">🔔 every ${esc(fmtInterval(task.reminder.intervalMin))}</span>`);
  for (const t of task.tags) chips.push(`<span class="chip tag">#${esc(t)}</span>`);
  if (matchesEnergy(task, energy)) chips.push('<span class="chip energy-match">good for now</span>');
  return chips.join('');
}

// ---------- Task card ----------
// onComplete(task, done, flippedIds) runs after the completion animation;
// onOpen(task) on tap. Subtask extras: parentLabel (context line above the
// title), progress ({done,total} chip), hasChildren/collapsed/onToggleCollapse
// (chevron), depth (tree indent).
export function taskCard(task, {
  energy = null, onComplete, onOpen, index = 0, now = Date.now(),
  parentLabel = null, progress = null, hasChildren = false,
  collapsed = false, onToggleCollapse = null, depth = 0,
} = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'collapse-wrap';
  wrap.style.setProperty('--i', index);
  if (depth) wrap.style.marginLeft = Math.min(depth, 3) * 22 + 'px';
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
          <div class="task-meta">${progressChip}${taskChipsHtml(task, energy, now)}</div>
        </div>
        ${hasChildren ? `
        <button class="chevron ${collapsed ? 'closed' : ''}" aria-label="${collapsed ? 'Expand' : 'Collapse'} subtasks">
          <svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>` : ''}
      </div>
    </div>`;

  const card = wrap.querySelector('.task-card');
  const check = wrap.querySelector('.check');

  wrap.querySelector('.chevron')?.addEventListener('click', (e) => {
    e.stopPropagation();
    onToggleCollapse?.(task);
  });

  check.addEventListener('click', (e) => {
    e.stopPropagation();
    completeWithAnimation(task, wrap, check, onComplete);
  });

  card.addEventListener('click', () => onOpen?.(task));

  // swipe right to complete
  let startX = null, dx = 0;
  card.addEventListener('touchstart', (e) => { startX = e.touches[0].clientX; dx = 0; }, { passive: true });
  card.addEventListener('touchmove', (e) => {
    if (startX == null) return;
    dx = e.touches[0].clientX - startX;
    if (dx > 0) card.style.transform = `translateX(${Math.min(dx, 120)}px)`;
  }, { passive: true });
  card.addEventListener('touchend', () => {
    card.style.transform = '';
    if (dx > 90 && !task.completedAt) completeWithAnimation(task, wrap, check, onComplete);
    startX = null;
  });

  return wrap;
}

const REDUCED_MOTION = typeof matchMedia !== 'undefined'
  && matchMedia('(prefers-reduced-motion: reduce)').matches;
const BUBBLE_COLORS = ['#a63446', '#c4576a', '#7c2434'];

function spawnBubbles(check, dir) {
  if (REDUCED_MOTION) return;
  const n = 7;
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
    const flipped = completing ? completeWithDescendants(task.id) : [task.id];
    if (!completing) setCompleted(task.id, false);
    delete check.dataset.busy;
    onComplete?.(task, completing, flipped);
    return;
  }

  if (completing) {
    spawnBubbles(check, 'in');
    setTimeout(() => check.classList.add('filling'), 160);
    setTimeout(() => {
      check.classList.remove('filling');
      check.classList.add('filled', 'checkpop');
    }, 400);
    setTimeout(() => {
      check.classList.remove('checkpop');
      card.classList.add('completing');
    }, 620);
    setTimeout(() => wrap.classList.add('collapsed'), 900);
    setTimeout(() => {
      delete check.dataset.busy;
      const flipped = completeWithDescendants(task.id);
      onComplete?.(task, true, flipped);
    }, 1140);
  } else {
    check.classList.add('checkout');
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
