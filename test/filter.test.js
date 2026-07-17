import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesFilter } from '../www/js/filter.js';

const task = (fields = {}) => ({ tags: [], color: null, ...fields });

test('no filters matches everything', () => {
  assert.equal(matchesFilter(task(), {}), true);
  assert.equal(matchesFilter(task({ tags: ['a'], color: '#fff' })), true);
  assert.equal(matchesFilter(task(), { tags: [], colors: [] }), true);
});

test('tag filter is OR within tags', () => {
  const t = task({ tags: ['bills', 'home'] });
  assert.equal(matchesFilter(t, { tags: ['bills'] }), true);
  assert.equal(matchesFilter(t, { tags: ['work', 'home'] }), true);
  assert.equal(matchesFilter(t, { tags: ['work'] }), false);
  assert.equal(matchesFilter(task(), { tags: ['work'] }), false);
});

test('color filter is OR within colors', () => {
  const t = task({ color: '#C4576A' });
  assert.equal(matchesFilter(t, { colors: ['#C4576A'] }), true);
  assert.equal(matchesFilter(t, { colors: ['#4A9E8F', '#C4576A'] }), true);
  assert.equal(matchesFilter(t, { colors: ['#4A9E8F'] }), false);
  assert.equal(matchesFilter(task(), { colors: ['#4A9E8F'] }), false);
});

test('tags and colors combine with AND', () => {
  const t = task({ tags: ['bills'], color: '#C4576A' });
  assert.equal(matchesFilter(t, { tags: ['bills'], colors: ['#C4576A'] }), true);
  assert.equal(matchesFilter(t, { tags: ['bills'], colors: ['#4A9E8F'] }), false);
  assert.equal(matchesFilter(t, { tags: ['work'], colors: ['#C4576A'] }), false);
});

test('tolerates tasks missing a tags array', () => {
  assert.equal(matchesFilter({ color: null }, { tags: ['a'] }), false);
  assert.equal(matchesFilter({ color: null }, {}), true);
});
