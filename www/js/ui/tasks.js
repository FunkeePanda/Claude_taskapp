// Tasks view: the full list as a collapsible tree, grouped, with
// tag/effort filter chips (filters show flat matches).
//
// Completed tasks stay greyed in their group until swiped left, which
// moves them (archived) into the Done section.

import { allTasks, setCompleted, updateTask, childrenOf, progressOf, getTask } from '../model.js';
import { taskCard, toast, esc } from './components.js';
import { openEditSheet, openAddSheet } from './editor.js';

let activeFilter = null; // { kind: 'tag'|'effort', value }

export function renderTasks(view, rerender) {
  const now = Date.now();
  const tasks = allTasks();

  const tagSet = [...new Set(tasks.flatMap(t => t.tags))].sort();
  const hasEfforts = tasks.some(t => t.effort);

  const filterChip = (kind, value, label) => {
    const active = activeFilter?.kind === kind && activeFilter?.value === value;
    return `<button class="chip ${active ? 'energy-match' : ''}" data-kind="${kind}" data-value="${esc(value)}" style="cursor:pointer">${esc(label)}</button>`;
  };

  const open = tasks.filter(t => !t.completedAt);
  const doneCount = tasks.filter(t => t.completedAt).length;

  view.innerHTML = `
    <h1 class="screen-title">Tasks</h1>
    <p class="screen-sub">${open.length} open · ${doneCount} done</p>
    ${(tagSet.length || hasEfforts) ? `
      <div class="task-meta" id="filters" style="margin-top:12px">
        ${hasEfforts ? filterChip('effort', 'quick', 'quick wins') + filterChip('effort', 'deep', 'deep focus') : ''}
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
      toast(flipped.length > 1 ? `Done (+${flipped.length - 1} subtasks)` : 'Done', {
        actionLabel: 'Undo',
        onAction: () => { flipped.forEach(id => setCompleted(id, false)); rerender(); },
      });
    }
    rerender();
  };
  const cardOpts = (task, i, depth = 0) => {
    const kids = childrenOf(task.id).filter(t => !t.archived);
    return {
      index: i, now, depth,
      onComplete,
      onOpen: (t) => openEditSheet(t.id, rerender),
      onAddSubtask: (t) => openAddSheet(rerender, { parentId: t.id }),
      onArchived: () => { toast('Moved to Done'); rerender(); },
      hasChildren: kids.length > 0,
      collapsed: task.collapsed,
      onToggleCollapse: (t) => { updateTask(t.id, { collapsed: !t.collapsed }); rerender(); },
      progress: childrenOf(task.id).length ? progressOf(task.id) : null,
    };
  };

  // subtree renderer: parent, then (unless collapsed) unarchived children
  const renderTree = (holder, task, i, depth) => {
    holder.appendChild(taskCard(task, cardOpts(task, i, depth)));
    if (task.collapsed) return;
    for (const child of childrenOf(task.id)) {
      if (!child.archived) renderTree(holder, child, i, depth + 1);
    }
  };

  // ---------- filtered: flat matches, no nesting ----------
  if (activeFilter) {
    let matches = tasks.filter(t => !t.completedAt);
    if (activeFilter.kind === 'tag') matches = matches.filter(t => t.tags.includes(activeFilter.value));
    if (activeFilter.kind === 'effort') matches = matches.filter(t => t.effort === activeFilter.value);
    if (!matches.length) {
      groupsEl.innerHTML = `<div class="empty"><p>Nothing matches this filter.</p></div>`;
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

  // ---------- tree: top-level tasks grouped by due; completed stay put ----
  // (orphan guard: a parentId pointing nowhere renders as top-level)
  const topLevel = tasks.filter(t => (!t.parentId || !getTask(t.parentId)) && !t.archived);
  const archived = tasks.filter(t => t.archived)
    .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));

  // grouping ignores completion so a checked-off task keeps its spot
  const groups = [
    { label: 'Overdue', items: topLevel.filter(t => t.due != null && t.due < now) },
    { label: 'Today', items: topLevel.filter(t => t.due != null && t.due >= now && new Date(t.due).toDateString() === new Date(now).toDateString()) },
    { label: 'Upcoming', items: topLevel.filter(t => t.due != null && t.due >= now && new Date(t.due).toDateString() !== new Date(now).toDateString()) },
    { label: 'Someday', items: topLevel.filter(t => t.due == null) },
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

  if (!rendered && !archived.length) {
    groupsEl.innerHTML = `<div class="empty"><p>No tasks yet.<br>Tap <strong>+</strong> to add your first one.</p></div>`;
  }

  if (archived.length) {
    groupsEl.insertAdjacentHTML('beforeend', `
      <details style="margin-top:18px">
        <summary class="section-label" style="cursor:pointer; list-style:none">Done (${archived.length}) ▾</summary>
        <div id="done-list"></div>
      </details>`);
    const doneEl = groupsEl.querySelector('#done-list');
    archived.slice(0, 30).forEach((t, i) => {
      doneEl.appendChild(taskCard(t, {
        index: i, now,
        onComplete,
        onOpen: (x) => openEditSheet(x.id, rerender),
        parentLabel: t.parentId ? getTask(t.parentId)?.title : null,
        progress: childrenOf(t.id).length ? progressOf(t.id) : null,
      }));
    });
  }
}
