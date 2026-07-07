// Tasks view: the full list as a collapsible tree, grouped, with
// tag/effort filter chips (filters show flat matches).

import { allTasks, currentEnergy, setCompleted, updateTask, childrenOf, progressOf, getTask } from '../model.js';
import { isOverdue, isDueToday } from '../focus.js';
import { taskCard, toast, esc } from './components.js';
import { openEditSheet } from './editor.js';

let activeFilter = null; // { kind: 'tag'|'effort', value }

export function renderTasks(view, rerender) {
  const now = Date.now();
  const energy = currentEnergy(now);
  const tasks = allTasks();

  const tagSet = [...new Set(tasks.flatMap(t => t.tags))].sort();
  const hasEfforts = tasks.some(t => t.effort);

  const filterChip = (kind, value, label) => {
    const active = activeFilter?.kind === kind && activeFilter?.value === value;
    return `<button class="chip ${active ? 'energy-match' : ''}" data-kind="${kind}" data-value="${esc(value)}" style="cursor:pointer">${esc(label)}</button>`;
  };

  const open = tasks.filter(t => !t.completedAt);
  const done = tasks.filter(t => t.completedAt);

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

  const onComplete = (task, doneNow, flipped) => {
    if (doneNow) {
      toast(flipped.length > 1 ? `Done ✓ (+${flipped.length - 1} subtasks)` : 'Done ✓', {
        actionLabel: 'Undo',
        onAction: () => { flipped.forEach(id => setCompleted(id, false)); rerender(); },
      });
    }
    rerender();
  };
  const cardOpts = (task, i, depth = 0) => {
    const kids = childrenOf(task.id);
    return {
      energy, index: i, now, depth,
      onComplete,
      onOpen: (t) => openEditSheet(t.id, rerender),
      hasChildren: kids.length > 0,
      collapsed: task.collapsed,
      onToggleCollapse: (t) => { updateTask(t.id, { collapsed: !t.collapsed }); rerender(); },
      progress: kids.length ? progressOf(task.id) : null,
    };
  };

  // subtree renderer: parent, then (unless collapsed) children indented
  const renderTree = (holder, task, i, depth) => {
    holder.appendChild(taskCard(task, cardOpts(task, i, depth)));
    if (task.collapsed) return;
    for (const child of childrenOf(task.id)) {
      renderTree(holder, child, i, depth + 1);
    }
  };

  // ---------- filtered: flat matches, no nesting ----------
  if (activeFilter) {
    let matches = tasks.filter(t => !t.completedAt);
    if (activeFilter.kind === 'tag') matches = matches.filter(t => t.tags.includes(activeFilter.value));
    if (activeFilter.kind === 'effort') matches = matches.filter(t => t.effort === activeFilter.value);
    if (!matches.length) {
      groupsEl.innerHTML = `<div class="empty"><div class="big">📋</div><p>Nothing matches this filter.</p></div>`;
      return;
    }
    const holder = document.createElement('div');
    holder.className = 'stagger';
    matches.forEach((t, i) => holder.appendChild(taskCard(t, {
      ...cardOpts(t, i), hasChildren: false, depth: 0,
      parentLabel: t.parentId ? getTask(t.parentId)?.title : null,
    })));
    groupsEl.appendChild(holder);
    return;
  }

  // ---------- tree: top-level tasks grouped by their own due ----------
  // (orphan guard: a parentId pointing nowhere renders as top-level)
  const topLevel = tasks.filter(t => !t.parentId || !getTask(t.parentId));
  const openTop = topLevel.filter(t => !t.completedAt);
  const doneTop = topLevel.filter(t => t.completedAt).sort((a, b) => b.completedAt - a.completedAt);

  const groups = [
    { label: 'Overdue', items: openTop.filter(t => isOverdue(t, now)) },
    { label: 'Today', items: openTop.filter(t => isDueToday(t, now)) },
    { label: 'Upcoming', items: openTop.filter(t => t.due != null && !isOverdue(t, now) && !isDueToday(t, now)) },
    { label: 'Someday', items: openTop.filter(t => t.due == null) },
  ];
  groups[2].items.sort((a, b) => a.due - b.due);

  let rendered = 0;
  for (const g of groups) {
    if (!g.items.length) continue;
    groupsEl.insertAdjacentHTML('beforeend', `<div class="section-label">${g.label}</div>`);
    const holder = document.createElement('div');
    holder.className = 'stagger';
    g.items.forEach((t, i) => renderTree(holder, t, i, 0));
    groupsEl.appendChild(holder);
    rendered += g.items.length;
  }

  if (!rendered && !doneTop.length) {
    groupsEl.innerHTML = `<div class="empty"><div class="big">📋</div><p>No tasks yet.<br>Tap <strong>+</strong> to add your first one.</p></div>`;
  }

  if (doneTop.length) {
    groupsEl.insertAdjacentHTML('beforeend', `
      <details style="margin-top:18px">
        <summary class="section-label" style="cursor:pointer; list-style:none">Done (${doneTop.length}) ▾</summary>
        <div id="done-list"></div>
      </details>`);
    const doneEl = groupsEl.querySelector('#done-list');
    doneTop.slice(0, 20).forEach((t, i) => {
      const kids = childrenOf(t.id);
      doneEl.appendChild(taskCard(t, {
        energy, index: i, now,
        onComplete,
        onOpen: (x) => openEditSheet(x.id, rerender),
        progress: kids.length ? progressOf(t.id) : null,
      }));
    });
  }
}
