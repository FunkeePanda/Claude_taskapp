// Today view: greeting and the focused list. Completed tasks stay in
// place (greyed) until the user swipes them left into Done.

import { allTasks, settings, setCompleted, getTask } from '../model.js';
import { todayList, isOverdue } from '../focus.js';
import { taskCard, toast } from './components.js';
import { openEditSheet, openAddSheet } from './editor.js';

export function renderToday(view, rerender) {
  const now = Date.now();
  const d = new Date(now);
  const greet = d.getHours() < 12 ? 'Good morning' : d.getHours() < 18 ? 'Good afternoon' : 'Good evening';
  const tasks = allTasks();

  // completed-but-not-archived tasks keep their spot: rank them as if
  // they were still open, then render the real (greyed) task
  const candidates = tasks
    .filter(t => !t.archived)
    .map(t => t.completedAt ? { ...t, completedAt: null } : t);
  const byId = new Map(tasks.map(t => [t.id, t]));
  const list = todayList(candidates, now, settings().focusLimit).map(c => byId.get(c.id));
  const listedIds = new Set(list.map(t => t.id));
  const overdue = list.filter(t => isOverdue({ ...t, completedAt: null }, now) && !t.completedAt);
  const focus = list.filter(t => !overdue.includes(t));

  const openCount = tasks.filter(t => !t.completedAt).length;
  const doneToday = tasks.filter(t => t.completedAt && new Date(t.completedAt).toDateString() === d.toDateString()).length;

  view.innerHTML = `
    <h1 class="screen-title">${greet}</h1>
    <p class="screen-sub">${d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}${doneToday ? ` · ${doneToday} done today` : ''}</p>
    ${overdue.length ? '<div class="section-label">Overdue</div><div id="overdue-list" class="stagger"></div>' : ''}
    <div class="section-label">${overdue.length ? 'Also today' : 'Your focus'}</div>
    <div id="focus-list" class="stagger"></div>
  `;

  const onComplete = (task, done, flipped) => {
    if (done) {
      const extra = flipped.length > 1 ? ` (+${flipped.length - 1} subtasks)` : '';
      toast(`Nice — “${task.title.slice(0, 30)}” done${extra}`, {
        actionLabel: 'Undo',
        onAction: () => { flipped.forEach(id => setCompleted(id, false)); rerender(); },
      });
    }
    rerender();
  };
  const opts = (i, task) => ({
    index: i, now,
    onComplete,
    onOpen: (t) => openEditSheet(t.id, rerender),
    onAddSubtask: (t) => openAddSheet(rerender, { parentId: t.id }),
    onArchived: () => { toast('Moved to Done'); rerender(); },
    parentLabel: task.parentId ? getTask(task.parentId)?.title : null,
  });

  const overdueEl = view.querySelector('#overdue-list');
  overdue.forEach((t, i) => overdueEl.appendChild(taskCard(t, opts(i, t))));

  const focusEl = view.querySelector('#focus-list');
  if (!focus.length && !overdue.length) {
    focusEl.outerHTML = openCount
      ? `<div class="empty"><p>Nothing pressing today.<br>Check the Tasks tab or add something new.</p></div>`
      : `<div class="empty"><p>All clear.<br>Tap <strong>+</strong> to capture your first task.<br><span style="font-size:0.8rem;color:var(--text-faint)">Try: “pay rent friday 5pm every 2h”</span></p></div>`;
  } else {
    focus.forEach((t, i) => focusEl.appendChild(taskCard(t, opts(overdue.length + i, t))));
  }
}
