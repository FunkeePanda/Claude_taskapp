// Persistence: single versioned document in localStorage with a
// last-known-good backup copy as a corruption guard.

const KEY = 'focus.data.v1';
const BAK = 'focus.data.v1.bak';
const SCHEMA_VERSION = 1;

function defaults() {
  return {
    schemaVersion: SCHEMA_VERSION,
    tasks: [],
    settings: {
      quietStart: '22:00',
      quietEnd: '08:00',
      focusLimit: 5,
      energy: null,          // 'high' | 'low' | null
      energySetAt: null,     // ms timestamp; expires after 4h
    },
    meta: { nextId: 1 },
  };
}

let doc = null;
let saveTimer = null;
const listeners = new Set();

function tryParse(raw) {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw);
    if (d && d.schemaVersion && Array.isArray(d.tasks) && d.meta) return d;
  } catch { /* corrupted */ }
  return null;
}

export function load() {
  if (doc) return doc;
  doc = tryParse(localStorage.getItem(KEY))
     || tryParse(localStorage.getItem(BAK))
     || defaults();
  // fill any settings added after the user first saved data
  doc.settings = { ...defaults().settings, ...doc.settings };
  return doc;
}

export function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const prev = localStorage.getItem(KEY);
    if (prev) localStorage.setItem(BAK, prev);
    localStorage.setItem(KEY, JSON.stringify(doc));
  }, 250);
  for (const fn of listeners) fn(doc);
}

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function exportJSON() {
  return JSON.stringify(load(), null, 2);
}

// Validates and replaces the whole document. Throws with a readable
// message if the payload isn't a Focus backup.
export function importJSON(text) {
  let d;
  try { d = JSON.parse(text); } catch { throw new Error('Not a valid JSON file'); }
  if (!d || typeof d !== 'object' || !Array.isArray(d.tasks) || !d.schemaVersion) {
    throw new Error('This file is not a Focus backup');
  }
  for (const t of d.tasks) {
    if (typeof t.id !== 'number' || typeof t.title !== 'string') {
      throw new Error('Backup contains invalid tasks');
    }
  }
  d.settings = { ...defaults().settings, ...(d.settings || {}) };
  d.meta = d.meta && typeof d.meta.nextId === 'number' ? d.meta
    : { nextId: Math.max(0, ...d.tasks.map(t => t.id)) + 1 };
  doc = d;
  save();
  return d.tasks.length;
}
