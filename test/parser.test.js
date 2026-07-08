import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../www/js/parser.js';

// Monday 2026-07-06 10:00 local
const NOW = new Date(2026, 6, 6, 10, 0, 0);

function d(y, mo, day, h = 23, mi = 59) {
  return new Date(y, mo, day, h, mi, 0, 0).getTime();
}

test('plain title passes through untouched', () => {
  const r = parse('buy milk', NOW);
  assert.equal(r.title, 'buy milk');
  assert.equal(r.due, null);
  assert.equal(r.priority, 1);
});

test('weekday + priority: "pay rent friday high priority"', () => {
  const r = parse('pay rent friday high priority', NOW);
  assert.equal(r.title, 'pay rent');
  assert.equal(r.due, d(2026, 6, 10)); // Friday July 10, end of day
  assert.equal(r.allDay, true);
  assert.equal(r.priority, 2);
});

test('weekday matching today means today', () => {
  const r = parse('standup monday', NOW); // NOW is a Monday
  assert.equal(r.due, d(2026, 6, 6));
});

test('"next monday" said on a monday jumps a week', () => {
  const r = parse('review next monday', NOW);
  assert.equal(r.due, d(2026, 6, 13));
});

test('"next friday" said on a monday means friday of next week', () => {
  const r = parse('deploy next friday', NOW);
  assert.equal(r.due, d(2026, 6, 17));
});

test('tomorrow with time', () => {
  const r = parse('call dentist tomorrow at 2:30pm', NOW);
  assert.equal(r.title, 'call dentist');
  assert.equal(r.due, d(2026, 6, 7, 14, 30));
  assert.equal(r.allDay, false);
});

test('bare time in the past rolls to tomorrow', () => {
  const r = parse('meds 9am', NOW); // it is 10:00
  assert.equal(r.due, d(2026, 6, 7, 9, 0));
});

test('bare time in the future stays today', () => {
  const r = parse('meds 9pm', NOW);
  assert.equal(r.due, d(2026, 6, 6, 21, 0));
});

test('tonight', () => {
  const r = parse('trash out tonight', NOW);
  assert.equal(r.due, d(2026, 6, 6, 20, 0));
  assert.equal(r.title, 'trash out');
});

test('in N days', () => {
  const r = parse('renew passport in 3 days', NOW);
  assert.equal(r.due, d(2026, 6, 9));
});

test('in N hours gives exact time', () => {
  const r = parse('check oven in 2 hours', NOW);
  assert.equal(r.due, d(2026, 6, 6, 12, 0));
  assert.equal(r.allDay, false);
});

test('month-name date', () => {
  const r = parse('taxes jul 15', NOW);
  assert.equal(r.due, d(2026, 6, 15));
  assert.equal(r.title, 'taxes');
});

test('past month-name date rolls to next year', () => {
  const r = parse('anniversary feb 14', NOW);
  assert.equal(r.due, d(2027, 1, 14));
});

test('slash date month-first', () => {
  const r = parse('flight 8/22', NOW);
  assert.equal(r.due, d(2026, 7, 22));
});

test('"on the 15th"', () => {
  const r = parse('rent on the 15th', NOW);
  assert.equal(r.due, d(2026, 6, 15));
});

test('"on the 3rd" past → next month', () => {
  const r = parse('invoice on the 3rd', NOW);
  assert.equal(r.due, d(2026, 7, 3));
});

test('nag interval minutes: "every 30m"', () => {
  const r = parse('drink water every 30m', NOW);
  assert.deepEqual(r.reminder, { intervalMin: 30, startAt: null });
  assert.equal(r.title, 'drink water');
});

test('nag interval hours: "nag me every 2 hours"', () => {
  const r = parse('stretch nag me every 2 hours', NOW);
  assert.deepEqual(r.reminder, { intervalMin: 120, startAt: null });
  assert.equal(r.title, 'stretch');
});

test('hourly', () => {
  const r = parse('posture check hourly', NOW);
  assert.equal(r.reminder.intervalMin, 60);
});

test('tags', () => {
  const r = parse('buy cake #errands #birthday', NOW);
  assert.deepEqual(r.tags, ['errands', 'birthday']);
  assert.equal(r.title, 'buy cake');
});

test('low priority words', () => {
  const r = parse('reorganize garage someday', NOW);
  assert.equal(r.priority, 0);
});

test('urgent', () => {
  const r = parse('fix prod urgent', NOW);
  assert.equal(r.priority, 2);
});

test('kitchen sink', () => {
  const r = parse('finish slides friday 5pm high priority every 45 min #work', NOW);
  assert.equal(r.title, 'finish slides');
  assert.equal(r.due, d(2026, 6, 10, 17, 0));
  assert.equal(r.priority, 2);
  assert.deepEqual(r.tags, ['work']);
  assert.equal(r.reminder.intervalMin, 45);
});

test('matches record what was consumed (for UI chips)', () => {
  const r = parse('pay rent friday high priority', NOW);
  const types = r.matches.map(m => m.type).sort();
  assert.deepEqual(types, ['due', 'priority']);
});
