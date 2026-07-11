import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  occurrencesFor, planAll, isQuietTime, nidFor, taskIdFromNid,
} from '../www/js/reminders.js';

const NOW = new Date(2026, 6, 6, 10, 0, 0).getTime(); // 10:00 local
const MIN = 60000;
const HOUR = 60 * MIN;

let nextId = 1;
function task(fields = {}) {
  return {
    id: nextId++, title: 't', due: null, priority: 1, tags: [],
    effort: null, createdAt: NOW - HOUR, completedAt: null,
    reminder: { intervalMin: 30, startAt: null }, ...fields,
  };
}

test('nid round-trips', () => {
  assert.equal(taskIdFromNid(nidFor(42, 7)), 42);
});

test('no reminder or completed → no occurrences', () => {
  assert.deepEqual(occurrencesFor(task({ reminder: null }), NOW), []);
  assert.deepEqual(occurrencesFor(task({ completedAt: NOW }), NOW), []);
});

test('occurrences are future, spaced by interval, anchored to createdAt', () => {
  const t = task({ createdAt: NOW - 10 * MIN, reminder: { intervalMin: 30, startAt: null } });
  const occ = occurrencesFor(t, NOW);
  assert.ok(occ.length > 0);
  assert.ok(occ[0].ts > NOW);
  assert.equal(occ[0].ts, t.createdAt + 30 * MIN); // first future slot
  assert.equal(occ[1].ts - occ[0].ts, 30 * MIN);
});

test('anchor in the future starts there', () => {
  const t = task({ reminder: { intervalMin: 15, startAt: NOW + 2 * HOUR } });
  const occ = occurrencesFor(t, NOW);
  assert.equal(occ[0].ts, NOW + 2 * HOUR);
});

test('a future due date does NOT delay intervals — they run from creation', () => {
  const t = task({
    due: NOW + 6 * HOUR,
    createdAt: NOW - 10 * MIN,
    reminder: { intervalMin: 60, startAt: null },
  });
  const occ = occurrencesFor(t, NOW);
  assert.equal(occ[0].ts, t.createdAt + 60 * MIN); // first firing within the hour
  assert.ok(occ[0].ts < t.due);
});

test('window capped at 24 per task and ~12h', () => {
  const t = task({ reminder: { intervalMin: 5, startAt: null } });
  const occ = occurrencesFor(t, NOW);
  assert.equal(occ.length, 24);
  const t2 = task({ reminder: { intervalMin: 120, startAt: null } });
  const occ2 = occurrencesFor(t2, NOW);
  assert.ok(occ2.every(o => o.ts <= NOW + 12 * HOUR));
});

test('quiet hours are skipped', () => {
  // 21:00 now, nags every 30min, quiet 22:00-08:00
  const evening = new Date(2026, 6, 6, 21, 0, 0).getTime();
  const t = task({ createdAt: evening - MIN, reminder: { intervalMin: 30, startAt: null } });
  const occ = occurrencesFor(t, evening, { quietStart: '22:00', quietEnd: '08:00' });
  for (const o of occ) {
    assert.ok(!isQuietTime(o.ts, '22:00', '08:00'),
      `occurrence at ${new Date(o.ts)} is inside quiet hours`);
  }
  // fires until 22:00, then resumes at 08:00 next morning
  const hours = [...new Set(occ.map(o => new Date(o.ts).getHours()))];
  assert.deepEqual(hours, [21, 8]);
});

test('isQuietTime handles midnight crossing and same start/end', () => {
  const at = (h, m = 0) => new Date(2026, 6, 6, h, m).getTime();
  assert.ok(isQuietTime(at(23), '22:00', '08:00'));
  assert.ok(isQuietTime(at(3), '22:00', '08:00'));
  assert.ok(!isQuietTime(at(12), '22:00', '08:00'));
  assert.ok(isQuietTime(at(13), '12:00', '14:00'));      // non-crossing window
  assert.ok(!isQuietTime(at(13), '13:00', '13:00'));     // disabled
});

test('planAll merges tasks earliest-first and caps the total', () => {
  const tasks = Array.from({ length: 12 }, () => task({ reminder: { intervalMin: 5, startAt: null } }));
  const plan = planAll(tasks, NOW);
  assert.equal(plan.length, 180);
  for (let i = 1; i < plan.length; i++) assert.ok(plan[i].ts >= plan[i - 1].ts);
});

test('slots stay unique per task', () => {
  const t = task({ reminder: { intervalMin: 5, startAt: null } });
  const occ = occurrencesFor(t, NOW);
  const nids = new Set(occ.map(o => o.nid));
  assert.equal(nids.size, occ.length);
});

// ---------- due-time notifications ----------

import { dueNotification } from '../www/js/reminders.js';

test('timed due → one notification at the exact chosen moment', () => {
  const due = NOW + 3 * HOUR;
  const t = task({ due, allDay: false, reminder: null });
  const out = dueNotification(t, NOW);
  assert.equal(out.length, 1);
  assert.equal(out[0].ts, due);
  assert.equal(out[0].body, 'Due now');
  assert.equal(taskIdFromNid(out[0].nid), t.id);
});

test('all-day due → notifies at 9:00 that morning, not 23:59', () => {
  const endOfDay = new Date(2026, 6, 8, 23, 59, 0).getTime();
  const t = task({ due: endOfDay, allDay: true, reminder: null });
  const out = dueNotification(t, NOW);
  assert.equal(out.length, 1);
  assert.equal(new Date(out[0].ts).getHours(), 9);
  assert.equal(new Date(out[0].ts).getDate(), 8);
  assert.equal(out[0].body, 'Due today');
});

test('past, completed, or missing due → nothing', () => {
  assert.deepEqual(dueNotification(task({ due: NOW - MIN, allDay: false }), NOW), []);
  assert.deepEqual(dueNotification(task({ due: NOW + HOUR, allDay: false, completedAt: NOW }), NOW), []);
  assert.deepEqual(dueNotification(task({ due: null }), NOW), []);
});

test('all-day due today with 9:00 already past → nothing (not a 23:59 surprise)', () => {
  const endOfToday = new Date(2026, 6, 6, 23, 59, 0).getTime(); // NOW is 10:00
  assert.deepEqual(dueNotification(task({ due: endOfToday, allDay: true }), NOW), []);
});

test('due slot never collides with nag or session nids', () => {
  const t = task({ due: NOW + HOUR, allDay: false, reminder: { intervalMin: 30, startAt: null } });
  const dueNid = dueNotification(t, NOW)[0].nid;
  const nagNids = occurrencesFor(t, NOW).map(o => o.nid);
  assert.ok(!nagNids.includes(dueNid));
  assert.ok(dueNid % 100 < 80); // below the session slot range
});
