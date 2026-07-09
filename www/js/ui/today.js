// Today view: greeting and the focused list. Completed tasks stay in
// place (greyed) until the user swipes them left into Done.

import { allTasks, settings, setCompleted, getTask, updateTask, childrenOf, progressOf } from '../model.js';
import { todayList, isOverdue } from '../focus.js';
import { taskCard, toast } from './components.js';
import { openEditSheet, openAddSheet } from './editor.js';

let pendingReveal = null; // task id whose subtree should slide open after render

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
  // expanding slides the subtree down from behind the parent; collapsing
  // slides it back up, then commits — same behavior as the Tasks page
  const toggleCollapse = (t) => {
    if (t.collapsed) {
      updateTask(t.id, { collapsed: false });
      pendingReveal = t.id;
      rerender();
    } else {
      const clip = view.querySelector(`.task-card[data-id="${t.id}"]`)
        ?.closest('.tree-node')?.querySelector(':scope > .subtree-clip');
      if (clip) {
        clip.classList.add('closed');
        setTimeout(() => { updateTask(t.id, { collapsed: true }); rerender(); }, 300);
      } else {
        updateTask(t.id, { collapsed: true });
        rerender();
      }
    }
  };

  const opts = (i, task, nested, kids) => ({
    index: i, now,
    onComplete,
    onOpen: (t) => openEditSheet(t.id, rerender),
    onAddSubtask: (t) => openAddSheet(rerender, { parentId: t.id }),
    onArchived: () => { toast('Moved to Done'); rerender(); },
    onSession: () => rerender(),
    hasChildren: kids.length > 0,
    collapsed: task.collapsed,
    onToggleCollapse: toggleCollapse,
    progress: childrenOf(task.id).length ? progressOf(task.id) : null,
    // context label only when the parent card isn't right above it
    parentLabel: !nested && task.parentId ? getTask(task.parentId)?.title : null,
  });

  // Same tree look and controls as the Tasks page: when a listed task's
  // parent is also in the same section, nest it under the parent with
  // connector lines, a collapse chevron, and the hold-swipe gesture.
  const renderSection = (holder, items) => {
    const ids = new Set(items.map(t => t.id));
    const kidsOf = (id) => items.filter(t => t.parentId === id);
    const renderNode = (into, t, i, nested) => {
      const node = document.createElement('div');
      node.className = 'tree-node';
      const kids = kidsOf(t.id);
      node.appendChild(taskCard(t, opts(i, t, nested, kids)));
      if (kids.length && !t.collapsed) {
        const clip = document.createElement('div');
        clip.className = 'subtree-clip' + (pendingReveal === t.id ? ' closed' : '');
        const sub = document.createElement('div');
        sub.className = 'subtree';
        kids.forEach((k, j) => renderNode(sub, k, j, true));
        clip.appendChild(sub);
        node.appendChild(clip);
      }
      into.appendChild(node);
    };
    const roots = items.filter(t => !t.parentId || !ids.has(t.parentId));
    roots.forEach((t, i) => renderNode(holder, t, i, false));
  };

  const overdueEl = view.querySelector('#overdue-list');
  if (overdueEl) renderSection(overdueEl, overdue);

  const focusEl = view.querySelector('#focus-list');
  if (!focus.length && !overdue.length) {
    focusEl.outerHTML = openCount
      ? `<div class="empty"><p>Nothing pressing today.<br>Check the Tasks tab or add something new.</p></div>`
      : `<div class="empty"><p>All clear.<br>Tap <strong>+</strong> to capture your first task.<br><span style="font-size:0.8rem;color:var(--text-faint)">Try: “pay rent friday 5pm every 2h”</span></p></div>`;
  } else {
    renderSection(focusEl, focus);
  }
}
