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
  return updateTask(id, { completedAt: completed ? Date.now() : null });
}

export function deleteTask(id) {
  const doc = load();
  const i = doc.tasks.findIndex(t => t.id === id);
  if (i === -1) return false;
  doc.tasks.splice(i, 1);
  save();
  return true;
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
