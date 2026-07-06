// Tasks view: the full list, grouped, with tag/effort filter chips.

import { allTasks, currentEnergy, setCompleted } from '../model.js';
import { isOverdue, isDueToday, daysBetween } from '../focus.js';
import { taskCard, toast, esc } from './components.js';
import { openEditSheet } from './editor.js';

let activeFilter = null; // { kind: 'tag'|'effort', value }

export function renderTasks(view, rerender) {
  const now = Date.now();
  const energy = currentEnergy(now);
  let tasks = allTasks();

  const tagSet = [...new Set(tasks.flatMap(t => t.tags))].sort();
  const hasEfforts = tasks.some(t => t.effort);

  if (activeFilter?.kind === 'tag') tasks = tasks.filter(t => t.tags.includes(activeFilter.value));
  if (activeFilter?.kind === 'effort') tasks = tasks.filter(t => t.effort === activeFilter.value);

  const open = tasks.filter(t => !t.completedAt);
  const done = tasks.filter(t => t.completedAt).sort((a, b) => b.completedAt - a.completedAt);

  const groups = [
    { label: 'Overdue', items: open.filter(t => isOverdue(t, now)) },
    { label: 'Today', items: open.filter(t => isDueToday(t, now)) },
    { label: 'Upcoming', items: open.filter(t => t.due != null && !isOverdue(t, now) && !isDueToday(t, now)) },
    { label: 'Someday', items: open.filter(t => t.due == null) },
  ];
  groups[2].items.sort((a, b) => a.due - b.due);

  const filterChip = (kind, value, label) => {
    const active = activeFilter?.kind === kind && activeFilter?.value === value;
    return `<button class="chip ${active ? 'energy-match' : ''}" data-kind="${kind}" data-value="${esc(value)}" style="cursor:pointer">${esc(label)}</button>`;
  };

  view.innerHTML = `
    <h1 class="screen-title">Tasks</h1>
    <p class="screen-sub">${open.length} open · ${done.length} done</p>
    ${(tagSet.length || hasEfforts) ? `
      <div class="task-meta" id="filters" style="margin-top:12px">
        ${hasEfforts ? filterChip('effort', 'quick', '⚡ quick wins') + filterChip('effort', 'deep', '🧠 deep focus') : ''}
        ${tagSet.map(t => filterChip('tag', t, '#' + t)).join('')}
      </div>` : ''}
    <div id="groups"></div>
  `;

  view.querySelector('#filters')?.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-kind]');
    if (!chip) return;
    const next = { kind: chip.dataset.kind, value: chip.dataset.value };
    activeFilter = (activeFilter?.kind === next.kind && activeFilter?.value === next.value) ? null : next;
    rerender();
  });

  const groupsEl = view.querySelector('#groups');
  const onComplete = (task, doneNow) => {
    if (doneNow) {
      toast(`Done ✓`, {
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

  let rendered = 0;
  for (const g of groups) {
    if (!g.items.length) continue;
    groupsEl.insertAdjacentHTML('beforeend', `<div class="section-label">${g.label}</div>`);
    const holder = document.createElement('div');
    holder.className = 'stagger';
    g.items.forEach((t, i) => holder.appendChild(taskCard(t, opts(i))));
    groupsEl.appendChild(holder);
    rendered += g.items.length;
  }

  if (!rendered && !done.length) {
    groupsEl.innerHTML = `<div class="empty"><div class="big">📋</div><p>${activeFilter ? 'Nothing matches this filter.' : 'No tasks yet.<br>Tap <strong>+</strong> to add your first one.'}</p></div>`;
  }

  if (done.length) {
    const recent = done.slice(0, 20);
    groupsEl.insertAdjacentHTML('beforeend', `
      <details style="margin-top:18px">
        <summary class="section-label" style="cursor:pointer; list-style:none">Done (${done.length}) ▾</summary>
        <div id="done-list"></div>
      </details>`);
    const doneEl = groupsEl.querySelector('#done-list');
    recent.forEach((t, i) => doneEl.appendChild(taskCard(t, opts(i))));
  }
}
