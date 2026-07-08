// Calendar view: month grid with dots on days that have open tasks;
// tapping a day lists its tasks below.

import { allTasks, setCompleted, getTask } from '../model.js';
import { monthGrid, tasksByDay, sameDay } from '../dates.js';
import { taskCard, toast } from './components.js';
import { openEditSheet, openAddSheet } from './editor.js';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

// view state survives tab switches within a session
let cursor = null;       // { year, month }
let selected = null;     // ms timestamp of selected day

export function renderCalendar(view, rerender) {
  const now = new Date();
  if (!cursor) cursor = { year: now.getFullYear(), month: now.getMonth() };
  if (selected == null) selected = now.getTime();

  const tasks = allTasks();
  const byDay = tasksByDay(tasks, cursor.year, cursor.month);
  const cells = monthGrid(cursor.year, cursor.month);
  const monthName = new Date(cursor.year, cursor.month, 1)
    .toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  view.innerHTML = `
    <h1 class="screen-title">Calendar</h1>
    <div class="cal-nav">
      <button id="cal-prev" aria-label="Previous month">‹</button>
      <span class="month">${monthName}</span>
      <div style="display:flex; gap:6px">
        <button class="today-jump" id="cal-today">Today</button>
        <button id="cal-next" aria-label="Next month">›</button>
      </div>
    </div>
    <div class="cal-grid">
      ${WEEKDAYS.map(w => `<div class="cal-wd">${w}</div>`).join('')}
      ${cells.map(d => {
        if (!d) return '<button class="cal-day" disabled></button>';
        const counts = byDay.get(d.getDate());
        const isToday = sameDay(d, now);
        const isSel = selected != null && sameDay(d, selected);
        return `<button class="cal-day ${isToday ? 'today' : ''} ${isSel ? 'selected' : ''}" data-ts="${d.getTime()}">
          ${d.getDate()}
          <span class="dot ${counts?.open ? '' : 'none'}"></span>
        </button>`;
      }).join('')}
    </div>
    <div class="section-label" id="cal-day-label"></div>
    <div id="cal-tasks" class="stagger"></div>
  `;

  const shiftMonth = (delta) => {
    const d = new Date(cursor.year, cursor.month + delta, 1);
    cursor = { year: d.getFullYear(), month: d.getMonth() };
    rerender();
  };
  view.querySelector('#cal-prev').addEventListener('click', () => shiftMonth(-1));
  view.querySelector('#cal-next').addEventListener('click', () => shiftMonth(1));
  view.querySelector('#cal-today').addEventListener('click', () => {
    cursor = { year: now.getFullYear(), month: now.getMonth() };
    selected = now.getTime();
    rerender();
  });

  view.querySelector('.cal-grid').addEventListener('click', (e) => {
    const day = e.target.closest('.cal-day[data-ts]');
    if (!day) return;
    selected = parseInt(day.dataset.ts, 10);
    rerender();
  });

  // ---------- selected day's tasks ----------
  const label = view.querySelector('#cal-day-label');
  const holder = view.querySelector('#cal-tasks');
  const sel = new Date(selected);
  const inMonth = sel.getFullYear() === cursor.year && sel.getMonth() === cursor.month;
  if (!inMonth) {
    label.textContent = '';
    return;
  }

  const dayTasks = tasks
    .filter(t => t.due != null && !t.archived && sameDay(t.due, selected))
    .sort((a, b) => (a.completedAt ? 1 : 0) - (b.completedAt ? 1 : 0) || a.due - b.due);

  label.textContent = sel.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  if (!dayTasks.length) {
    holder.innerHTML = `<div class="empty" style="padding:22px"><p>Nothing due this day.</p></div>`;
    return;
  }

  dayTasks.forEach((t, i) => holder.appendChild(taskCard(t, {
    index: i,
    parentLabel: t.parentId ? getTask(t.parentId)?.title : null,
    onComplete: (task, done, flipped) => {
      if (done) {
        toast('Done', {
          actionLabel: 'Undo',
          onAction: () => { flipped.forEach(id => setCompleted(id, false)); rerender(); },
        });
      }
      rerender();
    },
    onOpen: (task) => openEditSheet(task.id, rerender),
    onAddSubtask: (task) => openAddSheet(rerender, { parentId: task.id }),
    onArchived: () => { toast('Moved to Done'); rerender(); },
    onSession: () => rerender(),
  })));
}
