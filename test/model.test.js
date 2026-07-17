import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// store.js persists via localStorage — give node a tiny in-memory shim
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};

const { createTask, getTask, deleteTask, childrenOf, descendantsOf, progressOf, completeWithDescendants, setCompleted, allTasks } =
  await import('../www/js/model.js');

function makeTree() {
  const project = createTask({ title: 'cleaning project' });
  const room = createTask({ title: 'clean room', parentId: project.id });
  const bed = createTask({ title: 'make the bed', parentId: room.id });
  const laundry = createTask({ title: 'compile laundry', parentId: room.id });
  const kitchen = createTask({ title: 'clean kitchen', parentId: project.id });
  return { project, room, bed, laundry, kitchen };
}

beforeEach(() => {
  // wipe all tasks between tests (shared module state)
  for (const t of [...allTasks()]) deleteTask(t.id);
});

test('childrenOf and descendantsOf walk the tree', () => {
  const { project, room, bed, laundry, kitchen } = makeTree();
  assert.deepEqual(childrenOf(project.id).map(t => t.id), [room.id, kitchen.id]);
  assert.deepEqual(descendantsOf(project.id).map(t => t.id).sort((a, b) => a - b),
    [room.id, bed.id, laundry.id, kitchen.id].sort((a, b) => a - b));
  assert.deepEqual(descendantsOf(bed.id), []);
});

test('progressOf counts the whole subtree', () => {
  const { project, bed, kitchen } = makeTree();
  assert.deepEqual(progressOf(project.id), { done: 0, total: 4 });
  setCompleted(bed.id, true);
  setCompleted(kitchen.id, true);
  assert.deepEqual(progressOf(project.id), { done: 2, total: 4 });
});

test('completeWithDescendants flips only open tasks and reports them', () => {
  const { project, room, bed, laundry, kitchen } = makeTree();
  setCompleted(bed.id, true); // already done — must not be in the undo set
  const flipped = completeWithDescendants(project.id);
  assert.deepEqual(flipped.sort((a, b) => a - b),
    [project.id, room.id, laundry.id, kitchen.id].sort((a, b) => a - b));
  for (const t of allTasks()) assert.ok(t.completedAt, t.title + ' should be done');
  // undo restores exactly the flipped set: bed stays completed
  flipped.forEach(id => setCompleted(id, false));
  assert.ok(getTask(bed.id).completedAt);
  assert.equal(getTask(project.id).completedAt, null);
});

test('deleteTask cascades to the whole subtree', () => {
  const { project, room } = makeTree();
  const other = createTask({ title: 'unrelated' });
  assert.ok(deleteTask(room.id));
  assert.equal(allTasks().length, 3); // project, kitchen, unrelated
  assert.ok(deleteTask(project.id));
  assert.deepEqual(allTasks().map(t => t.id), [other.id]);
});

test('completing a leaf does not touch the parent', () => {
  const { room, bed } = makeTree();
  const flipped = completeWithDescendants(bed.id);
  assert.deepEqual(flipped, [bed.id]);
  assert.equal(getTask(room.id).completedAt, null);
});
