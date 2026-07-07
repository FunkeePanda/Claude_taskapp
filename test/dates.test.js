import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthGrid, tasksByDay, sameDay } from '../www/js/dates.js';

test('monthGrid pads to the first weekday and has all days', () => {
  // July 2026 starts on a Wednesday (day 3)
  const cells = monthGrid(2026, 6);
  assert.equal(cells.filter(c => c === null).length, 3);
  assert.equal(cells.filter(Boolean).length, 31);
  assert.equal(cells[3].getDate(), 1);
  assert.equal(cells.at(-1).getDate(), 31);
});

test('monthGrid handles february and leap years', () => {
  assert.equal(monthGrid(2026, 1).filter(Boolean).length, 28);
  assert.equal(monthGrid(2028, 1).filter(Boolean).length, 29);
});

test('tasksByDay counts open vs done per day, same month only', () => {
  const due = (d, h = 12) => new Date(2026, 6, d, h).getTime();
  const tasks = [
    { due: due(10), completedAt: null },
    { due: due(10, 18), completedAt: null },
    { due: due(10, 9), completedAt: 123 },
    { due: due(22), completedAt: null },
    { due: new Date(2026, 7, 10).getTime(), completedAt: null }, // august — excluded
    { due: null, completedAt: null },                             // no due — excluded
  ];
  const map = tasksByDay(tasks, 2026, 6);
  assert.deepEqual(map.get(10), { open: 2, done: 1 });
  assert.deepEqual(map.get(22), { open: 1, done: 0 });
  assert.equal(map.get(11), undefined);
  assert.equal(map.size, 2);
});

test('sameDay respects local day boundaries', () => {
  const a = new Date(2026, 6, 10, 0, 1).getTime();
  const b = new Date(2026, 6, 10, 23, 58).getTime();
  const c = new Date(2026, 6, 11, 0, 1).getTime();
  assert.ok(sameDay(a, b));
  assert.ok(!sameDay(b, c));
});
