import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sessionNotifications, sessionEndsAt, sessionActive } from '../www/js/reminders.js';

const NOW = new Date(2026, 6, 8, 10, 0, 0).getTime();
const MIN = 60000;

let nextId = 1;
function task(fields = {}) {
  return {
    id: nextId++, title: 'study', due: null, completedAt: null,
    reminder: null, timer: null, breaks: null, muteDuringSession: true,
    session: { startedAt: NOW }, createdAt: NOW - 60 * MIN, ...fields,
  };
}

test('no session → nothing', () => {
  assert.deepEqual(sessionNotifications(task({ session: null }), NOW), []);
  assert.ok(!sessionActive(task({ session: null }), NOW));
});

test('timer only → single time’s-up at duration', () => {
  const t = task({ timer: { durationMin: 45 } });
  const occ = sessionNotifications(t, NOW);
  assert.equal(occ.length, 1);
  assert.equal(occ[0].ts, NOW + 45 * MIN);
  assert.match(occ[0].title, /Time/);
});

test('breaks only → alternating break/back-to-work, capped', () => {
  const t = task({ breaks: { workMin: 25, breakMin: 5 } });
  const occ = sessionNotifications(t, NOW);
  assert.ok(occ.length >= 4);
  assert.equal(occ[0].ts, NOW + 25 * MIN);
  assert.match(occ[0].title, /Break/);
  assert.equal(occ[1].ts, NOW + 30 * MIN);
  assert.match(occ[1].title, /Back to work/);
  assert.equal(occ[2].ts, NOW + 55 * MIN); // next work chunk ends
  assert.ok(occ.length <= 16);
  assert.equal(sessionEndsAt(t), null); // runs until stopped
});

test('timer + breaks → cycle ends with time’s-up when work total reached', () => {
  // 60 min of work in 25-min chunks with 5-min breaks:
  // 25w [break 5] 25w [break 5] 10w → time's up at 70 min
  const t = task({ timer: { durationMin: 60 }, breaks: { workMin: 25, breakMin: 5 } });
  const occ = sessionNotifications(t, NOW);
  const last = occ.at(-1);
  assert.match(last.title, /Time/);
  assert.equal(last.ts, NOW + 70 * MIN);
  assert.equal(sessionEndsAt(t), NOW + 70 * MIN);
});

test('sessionActive flips off after the timer elapses', () => {
  const t = task({ timer: { durationMin: 30 } });
  assert.ok(sessionActive(t, NOW + 10 * MIN));
  assert.ok(!sessionActive(t, NOW + 31 * MIN));
});

test('completed task never has an active session', () => {
  const t = task({ timer: { durationMin: 30 }, completedAt: NOW });
  assert.ok(!sessionActive(t, NOW));
});

test('only future boundaries are scheduled (mid-session reconcile)', () => {
  const t = task({ breaks: { workMin: 25, breakMin: 5 } });
  const later = NOW + 40 * MIN; // first break already passed
  const occ = sessionNotifications(t, later);
  assert.ok(occ.every(o => o.ts > later));
  assert.equal(occ[0].ts, NOW + 55 * MIN);
});

test('session nids stay in the reserved 80+ slot range', () => {
  const t = task({ breaks: { workMin: 25, breakMin: 5 } });
  for (const o of sessionNotifications(t, NOW)) {
    const slot = o.nid - t.id * 100;
    assert.ok(slot >= 80 && slot < 100, `slot ${slot} out of range`);
  }
});
