// Home view: greeting, the auto-picked focus short-list, then every task
// as a collapsible tree grouped by due date, a Done section, and
// Category / Tags picker filters (filters show flat matches).
//
// Completing a task greys it through the check animation, then it moves
// to Done on its own (Undo in the toast brings it right back).

import {
  allTasks, settings, setCompleted, setArchived, updateTask,
  childrenOf, progressOf, getTask, deleteTask, descendantsOf,
} from '../model.js';
import { todayList } from '../focus.js';
import { matchesFilter } from '../filter.js';
import { taskCard, toast, esc, openSheet, closeSheet, confirmSheet } from './components.js';
import { openEditSheet, openAddSheet } from './editor.js';

const filterTags = new Set();
const filterColors = new Set();
let pendingReveal = null; // task id whose subtree should slide open after render

export function renderTasks(view, rerender) {
  const now = Date.now();
  const d = new Date(now);
  const greet = d.getHours() < 12 ? 'Good morning' : d.getHours() < 18 ? 'Good afternoon' : 'Good evening';
  const tasks = allTasks();
  const byId = new Map(tasks.map(t => [t.id, t]));

  const tagSet = [...new Set(tasks.flatMap(t => t.tags))].sort();
  const colorSet = [...new Set(tasks.map(t => t.color).filter(Boolean))];
  // selections pointing at tags/colors that no longer exist are dropped
  for (const t of filterTags) if (!tagSet.includes(t)) filterTags.delete(t);
  for (const c of filterColors) if (!colorSet.includes(c)) filterColors.delete(c);

  const open = tasks.filter(t => !t.completedAt);
  const doneCount = tasks.filter(t => t.completedAt).length;
  const doneToday = tasks.filter(t => t.completedAt && new Date(t.completedAt).toDateString() === d.toDateString()).length;

  view.innerHTML = `
    <h1 class="screen-title">${greet}</h1>
    <p class="screen-sub">${d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })} · ${open.length} open${doneToday ? ` · ${doneToday} done today` : ''}</p>
    ${(tagSet.length || colorSet.length) ? `
      <div class="task-meta" id="filters" style="margin-top:12px">
        ${colorSet.length ? `
          <button class="chip picker-chip ${filterColors.size ? 'chip-active' : ''}" id="cat-chip">
            <span class="dot" style="background:${filterColors.size ? esc([...filterColors][0]) : 'currentColor'}"></span>
            Category${filterColors.size ? ` · ${filterColors.size}` : ''}
          </button>` : ''}
        ${tagSet.length ? `
          <button class="chip picker-chip ${filterTags.size ? 'chip-active' : ''}" id="tags-chip">
            #&hairsp;Tags${filterTags.size ? ` · ${filterTags.size}` : ''}
          </button>` : ''}
      </div>` : ''}
    <div id="groups"></div>
  `;

  view.querySelector('#cat-chip')?.addEventListener('click', () => openCategoryPicker(colorSet, rerender));
  view.querySelector('#tags-chip')?.addEventListener('click', () => openTagPicker(tagSet, rerender));

  const groupsEl = view.querySelector('#groups');

  const onComplete = (task, doneNow, flipped) => {
    if (doneNow) {
      toast(flipped.length > 1 ? `Done (+${flipped.length - 1} subtasks)` : 'Done ✓', {
        actionLabel: 'Undo',
        onAction: () => {
          flipped.forEach(id => setCompleted(id, false));
          setArchived(task.id, false); // auto-archive took the whole subtree
          rerender();
        },
      });
    }
    rerender();
  };

  const onDelete = async (task) => {
    const n = descendantsOf(task.id).length;
    if (n && !(await confirmSheet(`Delete “${task.title.slice(0, 26)}” and ${n} subtask${n > 1 ? 's' : ''}?`))) return;
    deleteTask(task.id);
    toast('Deleted');
    rerender();
  };

  // expanding slides the subtree down from behind the parent; collapsing
  // slides it back up, then commits the state
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

  const cardOpts = (task, i) => {
    const kids = childrenOf(task.id).filter(t => !t.archived);
    return {
      index: i, now,
      onComplete,
      onDelete,
      onOpen: (t) => openEditSheet(t.id, rerender),
      onAddSubtask: (t) => openAddSheet(rerender, { parentId: t.id }),
      onSession: () => rerender(),
      hasChildren: kids.length > 0,
      collapsed: task.collapsed,
      onToggleCollapse: toggleCollapse,
      progress: childrenOf(task.id).length ? progressOf(task.id) : null,
    };
  };

  // tree renderer: card, then its unarchived children in a connected,
  // collapsible subtree
  const renderTree = (holder, task, i) => {
    const node = document.createElement('div');
    node.className = 'tree-node';
    node.appendChild(taskCard(task, cardOpts(task, i)));
    const kids = childrenOf(task.id).filter(t => !t.archived);
    if (kids.length && !task.collapsed) {
      const clip = document.createElement('div');
      clip.className = 'subtree-clip' + (pendingReveal === task.id ? ' closed' : '');
      const sub = document.createElement('div');
      sub.className = 'subtree';
      kids.forEach((child, j) => renderTree(sub, child, j));
      clip.appendChild(sub);
      node.appendChild(clip);
    }
    holder.appendChild(node);
  };

  // ---------- filtered: flat matches, no nesting ----------
  if (filterTags.size || filterColors.size) {
    const f = { tags: [...filterTags], colors: [...filterColors] };
    const matches = tasks.filter(t => !t.completedAt && matchesFilter(t, f));
    if (!matches.length) {
      groupsEl.innerHTML = `<div class="empty"><p>Nothing matches these filters.</p></div>`;
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

  // ---------- focus short-list: overdue + due-today + best-scored ----------
  // completed-but-not-archived tasks keep their spot: rank them as if
  // they were still open, then render the real (greyed) task
  const candidates = tasks
    .filter(t => !t.archived)
    .map(t => t.completedAt ? { ...t, completedAt: null } : t);
  const picks = todayList(candidates, now, settings().focusLimit).map(c => byId.get(c.id));
  // top-level picks render as full subtrees here and are deduped from the
  // groups below; picked subtasks show flat with a parent label (their
  // root keeps its place in the groups)
  const focusRoots = picks.filter(t => !t.parentId || !getTask(t.parentId));
  const focusRootIds = new Set(focusRoots.map(t => t.id));
  const underFocusRoot = (t) => {
    for (let p = t.parentId; p != null; p = getTask(p)?.parentId ?? null) {
      if (focusRootIds.has(p)) return true;
    }
    return false;
  };
  const focusSubs = picks.filter(t => t.parentId && getTask(t.parentId) && !underFocusRoot(t));

  if (focusRoots.length || focusSubs.length) {
    groupsEl.insertAdjacentHTML('beforeend', `<div class="section-label">Your focus</div>`);
    const holder = document.createElement('div');
    holder.className = 'stagger';
    focusRoots.forEach((t, i) => renderTree(holder, t, i));
    focusSubs.forEach((t, i) => holder.appendChild(taskCard(t, {
      ...cardOpts(t, focusRoots.length + i), hasChildren: false,
      parentLabel: getTask(t.parentId)?.title ?? null,
    })));
    groupsEl.appendChild(holder);
  }

  // ---------- tree: remaining top-level tasks grouped by due ----------
  // (orphan guard: a parentId pointing nowhere renders as top-level)
  const topLevel = tasks.filter(t => (!t.parentId || !getTask(t.parentId)) && !t.archived && !focusRootIds.has(t.id));
  // Done shows one card per archived subtree, not every subtask
  const archived = tasks.filter(t => t.archived && (!t.parentId || !getTask(t.parentId)?.archived))
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
    g.items.forEach((t, i) => renderTree(holder, t, i));
    groupsEl.appendChild(holder);
    rendered += g.items.length;
  }

  // a freshly-expanded subtree starts closed, then slides open
  if (pendingReveal != null) {
    const id = pendingReveal;
    pendingReveal = null;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      view.querySelector(`.task-card[data-id="${id}"]`)
        ?.closest('.tree-node')?.querySelector(':scope > .subtree-clip')?.classList.remove('closed');
    }));
  }

  if (!rendered && !focusRoots.length && !focusSubs.length && !archived.length) {
    groupsEl.innerHTML = `<div class="empty"><p>All clear.<br>Tap <strong>+</strong> to capture your first task.<br><span style="font-size:0.8rem;color:var(--text-faint)">Try: “pay rent friday 5pm every 2h”</span></p></div>`;
  }

  if (archived.length) {
    groupsEl.insertAdjacentHTML('beforeend', `
      <details style="margin-top:18px">
        <summary class="section-label" style="cursor:pointer; list-style:none">Done (${archived.length}) ▾</summary>
        <div id="done-list"></div>
        <button class="btn secondary block" id="clear-done" style="margin-top:6px">Clear all (${archived.length})</button>
      </details>`);
    const doneEl = groupsEl.querySelector('#done-list');
    archived.slice(0, 30).forEach((t, i) => {
      doneEl.appendChild(taskCard(t, {
        index: i, now,
        onComplete,
        onDelete,
        onOpen: (x) => openEditSheet(x.id, rerender),
        parentLabel: t.parentId ? getTask(t.parentId)?.title : null,
        progress: childrenOf(t.id).length ? progressOf(t.id) : null,
      }));
    });
    groupsEl.querySelector('#clear-done').addEventListener('click', async () => {
      if (!(await confirmSheet(`Delete all ${archived.length} done task${archived.length > 1 ? 's' : ''}?`, 'Clear all'))) return;
      archived.forEach(t => deleteTask(t.id));
      toast('Done list cleared');
      rerender();
    });
  }
}

// ---------- filter pickers ----------
// Taps apply instantly (the list behind updates live); Done just closes.

function openTagPicker(allTags, rerender) {
  const sheet = openSheet(`
    <h2>Filter by tags</h2>
    <div class="field">
      <input class="input" id="tag-search" placeholder="Search tags…" autocomplete="off" enterkeyhint="done" />
    </div>
    <div class="task-meta picker-opts" id="tag-opts"></div>
    <div style="display:flex; gap:10px; margin-top:16px">
      <button class="btn secondary" style="flex:1" id="pk-clear">Clear</button>
      <button class="btn" style="flex:1" id="pk-done">Done</button>
    </div>`);
  const opts = sheet.querySelector('#tag-opts');
  const search = sheet.querySelector('#tag-search');
  const renderOpts = () => {
    const q = search.value.trim().toLowerCase();
    const shown = allTags.filter(t => t.toLowerCase().includes(q));
    opts.innerHTML = shown.length
      ? shown.map(t => `<button class="chip pick ${filterTags.has(t) ? 'chip-active' : ''}" data-tag="${esc(t)}">#${esc(t)}</button>`).join('')
      : `<span class="screen-sub">No tags match “${esc(search.value.trim())}”</span>`;
  };
  renderOpts();
  search.addEventListener('input', renderOpts);
  opts.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tag]');
    if (!b) return;
    const tag = b.dataset.tag;
    filterTags.has(tag) ? filterTags.delete(tag) : filterTags.add(tag);
    renderOpts();
    rerender();
  });
  sheet.querySelector('#pk-clear').addEventListener('click', () => {
    filterTags.clear();
    renderOpts();
    rerender();
  });
  sheet.querySelector('#pk-done').addEventListener('click', closeSheet);
}

function openCategoryPicker(colors, rerender) {
  const sheet = openSheet(`
    <h2>Filter by category</h2>
    <p class="screen-sub" style="margin-bottom:14px">Colors in use across your tasks</p>
    <div class="swatch-row" id="cat-opts">
      ${colors.map(c => `<button class="swatch ${filterColors.has(c) ? 'sel' : ''}" data-color="${esc(c)}" style="--sw:${esc(c)}" aria-label="Filter color"></button>`).join('')}
    </div>
    <div style="display:flex; gap:10px; margin-top:18px">
      <button class="btn secondary" style="flex:1" id="pk-clear">Clear</button>
      <button class="btn" style="flex:1" id="pk-done">Done</button>
    </div>`);
  const opts = sheet.querySelector('#cat-opts');
  opts.addEventListener('click', (e) => {
    const b = e.target.closest('[data-color]');
    if (!b) return;
    const c = b.dataset.color;
    filterColors.has(c) ? filterColors.delete(c) : filterColors.add(c);
    b.classList.toggle('sel', filterColors.has(c));
    rerender();
  });
  sheet.querySelector('#pk-clear').addEventListener('click', () => {
    filterColors.clear();
    opts.querySelectorAll('.swatch').forEach(s => s.classList.remove('sel'));
    rerender();
  });
  sheet.querySelector('#pk-done').addEventListener('click', closeSheet);
}
