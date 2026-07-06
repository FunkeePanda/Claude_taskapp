// Today view: greeting, energy toggle, the focused list.

import { allTasks, settings, currentEnergy, setEnergy, setCompleted } from '../model.js';
import { todayList, isOverdue } from '../focus.js';
import { taskCard, toast, esc } from './components.js';
import { openEditSheet } from './editor.js';

export function renderToday(view, rerender) {
  const now = Date.now();
  const d = new Date(now);
  const greet = d.getHours() < 12 ? 'Good morning' : d.getHours() < 18 ? 'Good afternoon' : 'Good evening';
  const energy = currentEnergy(now);
  const tasks = allTasks();
  const list = todayList(tasks, now, settings().focusLimit, energy);
  const overdue = list.filter(t => isOverdue(t, now));
  const focus = list.filter(t => !isOverdue(t, now));
  const openCount = tasks.filter(t => !t.completedAt).length;
  const doneToday = tasks.filter(t => t.completedAt && new Date(t.completedAt).toDateString() === d.toDateString()).length;

  view.innerHTML = `
    <h1 class="screen-title">${greet} 👋</h1>
    <p class="screen-sub">${d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}${doneToday ? ` · ${doneToday} done today 🎉` : ''}</p>
    <div class="energy-bar">
      <button class="energy-pill ${energy === 'high' ? 'active' : ''}" data-energy="high">⚡ Energized</button>
      <button class="energy-pill ${energy === 'low' ? 'active' : ''}" data-energy="low">🪫 Running low</button>
    </div>
    ${overdue.length ? '<div class="section-label">Overdue</div><div id="overdue-list" class="stagger"></div>' : ''}
    <div class="section-label">${overdue.length ? 'Also today' : 'Your focus'}</div>
    <div id="focus-list" class="stagger"></div>
  `;

  view.querySelector('.energy-bar').addEventListener('click', (e) => {
    const pill = e.target.closest('.energy-pill');
    if (!pill) return;
    const level = pill.dataset.energy;
    const newLevel = currentEnergy() === level ? null : level;
    setEnergy(newLevel);
    if (newLevel) toast(newLevel === 'low' ? 'Quick wins bumped up ⚡' : 'Deep-focus work bumped up 🧠');
    rerender();
  });

  const onComplete = (task, done) => {
    if (done) {
      toast(`Nice — “${task.title.slice(0, 30)}” done`, {
        actionLabel: 'Undo',
        onAction: () => { setCompleted(task.id, false); rerender(); },
      });
    }
    rerender();
  };
  const opts = (i) => ({
    energy, index: i, now,
    onComplete,
    onOpen: (t) => openEditSheet(t.id, rerender),
  });

  const overdueEl = view.querySelector('#overdue-list');
  overdue.forEach((t, i) => overdueEl.appendChild(taskCard(t, opts(i))));

  const focusEl = view.querySelector('#focus-list');
  if (!focus.length && !overdue.length) {
    focusEl.outerHTML = openCount
      ? `<div class="empty"><div class="big">🌤️</div><p>Nothing pressing today.<br>Check the Tasks tab or add something new.</p></div>`
      : `<div class="empty"><div class="big">🎉</div><p>All clear!<br>Tap <strong>+</strong> to capture your first task.<br><span style="font-size:0.8rem;color:var(--text-faint)">Try: “pay rent friday 5pm every 2h”</span></p></div>`;
  } else {
    focus.forEach((t, i) => focusEl.appendChild(taskCard(t, opts(overdue.length + i))));
  }
}
