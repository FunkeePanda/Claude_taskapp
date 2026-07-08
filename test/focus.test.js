import { test } from 'node:test';
import assert from 'node:assert/strict';
import { score, todayList, isOverdue, isDueToday } from '../www/js/focus.js';

const NOW = new Date(2026, 6, 6, 10, 0, 0).getTime(); // Mon Jul 6, 10:00
const HOUR = 3600000;
const DAY = 24 * HOUR;

let nextId = 1;
function task(fields = {}) {
  return {
    id: nextId++, title: 't', notes: '', due: null, allDay: true,
    priority: 1, tags: [], reminder: null,
    createdAt: NOW - DAY, completedAt: null, ...fields,
  };
}

test('overdue outranks everything', () => {
  const overdue = task({ due: NOW - 5 * HOUR });
  const today = task({ due: NOW + 5 * HOUR });
  assert.ok(score(overdue, NOW) > score(today, NOW));
});

test('due today > tomorrow > next week', () => {
  const today = task({ due: NOW + 5 * HOUR });
  const tomorrow = task({ due: NOW + DAY + 5 * HOUR });
  const nextWeek = task({ due: NOW + 6 * DAY });
  assert.ok(score(today, NOW) > score(tomorrow, NOW));
  assert.ok(score(tomorrow, NOW) > score(nextWeek, NOW));
});

test('priority breaks ties', () => {
  const high = task({ priority: 2 });
  const low = task({ priority: 0 });
  assert.ok(score(high, NOW) > score(low, NOW));
});

test('old tasks bubble up, capped at 21 days', () => {
  const fresh = task({ createdAt: NOW });
  const old = task({ createdAt: NOW - 10 * DAY });
  const ancient = task({ createdAt: NOW - 60 * DAY });
  assert.ok(score(old, NOW) > score(fresh, NOW));
  assert.equal(score(ancient, NOW), score(task({ createdAt: NOW - 21 * DAY }), NOW));
});

test('todayList always includes ALL overdue even past the limit', () => {
  const tasks = [
    ...Array.from({ length: 7 }, (_, i) => task({ due: NOW - (i + 1) * HOUR })),
    ...Array.from({ length: 5 }, () => task()),
  ];
  const list = todayList(tasks, NOW, 5);
  const overdueCount = list.filter(t => isOverdue(t, NOW)).length;
  assert.equal(overdueCount, 7);
});

test('todayList fills to limit with best-scored non-urgent tasks', () => {
  const tasks = [
    task({ due: NOW + 2 * HOUR }),                 // due today
    task({ priority: 2 }),                          // high prio, no due
    task({ priority: 0, createdAt: NOW }),          // low prio, fresh
    task({ priority: 0, createdAt: NOW }),
    task({ priority: 0, createdAt: NOW }),
    task({ priority: 0, createdAt: NOW }),
    task({ priority: 0, createdAt: NOW }),
  ];
  const list = todayList(tasks, NOW, 5);
  assert.equal(list.length, 5);
  assert.equal(list[0].due, NOW + 2 * HOUR); // urgent first
});

test('completed tasks never appear', () => {
  const tasks = [task({ completedAt: NOW, due: NOW - HOUR }), task()];
  const list = todayList(tasks, NOW, 5);
  assert.equal(list.length, 1);
  assert.equal(list[0].completedAt, null);
});

test('isDueToday true only for future-today', () => {
  assert.ok(isDueToday(task({ due: NOW + HOUR }), NOW));
  assert.ok(!isDueToday(task({ due: NOW - HOUR }), NOW));   // that's overdue
  assert.ok(!isDueToday(task({ due: NOW + DAY }), NOW));    // tomorrow
});
