// Task CRUD on top of the store.

import { load, save } from './store.js';

export function allTasks() {
  return load().tasks;
}

export function getTask(id) {
  return load().tasks.find(t => t.id === id) || null;
}

export function createTask(fields) {
  const doc = load();
  const task = {
    id: doc.meta.nextId++,
    title: (fields.title || '').trim() || 'Untitled task',
    notes: fields.notes || '',
    due: fields.due ?? null,          // epoch ms
    allDay: fields.allDay ?? true,
    priority: fields.priority ?? 1,   // 0 low / 1 normal / 2 high
    tags: fields.tags || [],
    effort: fields.effort ?? null,    // 'quick' | 'deep' | null
    reminder: fields.reminder ?? null, // { intervalMin, startAt|null } | null
    timer: fields.timer ?? null,       // { durationMin } — how long this should take
    breaks: fields.breaks ?? null,     // { workMin, breakMin } — work/break cycle
    muteDuringSession: fields.muteDuringSession ?? true,
    session: null,                     // { startedAt } while a timer/breaks run
    color: fields.color ?? null,       // category color (preset palette hex)
    parentId: fields.parentId ?? null, // nesting: id of the parent task
    collapsed: false,                  // UI: children hidden in the Tasks tree
    archived: false,                   // swiped into the Done section
    createdAt: Date.now(),
    completedAt: null,
  };
  doc.tasks.push(task);
  save();
  return task;
}

export function updateTask(id, fields) {
  const task = getTask(id);
  if (!task) return null;
  Object.assign(task, fields);
  save();
  return task;
}

export function setCompleted(id, completed) {
  // unchecking a task that was moved to Done brings it back out;
  // completing one ends any running focus session
  return updateTask(id, completed
    ? { completedAt: Date.now(), session: null }
    : { completedAt: null, archived: false });
}

// Deleting a task takes its whole subtree with it.
export function deleteTask(id) {
  const doc = load();
  const doomed = new Set([id, ...descendantsOf(id).map(t => t.id)]);
  const before = doc.tasks.length;
  doc.tasks = doc.tasks.filter(t => !doomed.has(t.id));
  if (doc.tasks.length === before) return false;
  save();
  return true;
}

// ---------- subtasks ----------

export function childrenOf(id) {
  return load().tasks.filter(t => t.parentId === id);
}

export function descendantsOf(id) {
  const out = [];
  const walk = (pid) => {
    for (const c of childrenOf(pid)) {
      out.push(c);
      walk(c.id);
    }
  };
  walk(id);
  return out;
}

// Progress over the whole subtree: { done, total }.
export function progressOf(id) {
  const all = descendantsOf(id);
  return { done: all.filter(t => t.completedAt).length, total: all.length };
}

// Move a task (and its subtree) in or out of the Done section.
// Un-archiving is used when a task in Done gets unchecked.
export function setArchived(id, archived) {
  for (const t of [getTask(id), ...descendantsOf(id)]) {
    if (t) t.archived = archived;
  }
  save();
}

// Complete a task and all its open descendants; returns the ids that
// actually flipped, so an undo can restore exactly those.
export function completeWithDescendants(id) {
  const now = Date.now();
  const flipped = [];
  for (const t of [getTask(id), ...descendantsOf(id)]) {
    if (t && !t.completedAt) {
      t.completedAt = now;
      t.session = null;
      flipped.push(t.id);
    }
  }
  save();
  return flipped;
}

export function settings() {
  return load().settings;
}

export function updateSettings(fields) {
  Object.assign(load().settings, fields);
  save();
}

// Energy is transient: reads as null once 4 hours have passed.
const ENERGY_TTL_MS = 4 * 60 * 60 * 1000;

export function currentEnergy(now = Date.now()) {
  const s = settings();
  if (!s.energy || !s.energySetAt || now - s.energySetAt > ENERGY_TTL_MS) return null;
  return s.energy;
}

export function setEnergy(level) {
  updateSettings({ energy: level, energySetAt: level ? Date.now() : null });
}
