// Multi-select task filtering. Pure — unit-tested in test/filter.test.js.
//
// Tags are OR within the set (any selected tag matches); colors likewise;
// when both kinds are selected a task must match both kinds (AND).

export function matchesFilter(task, { tags = [], colors = [] } = {}) {
  const tagOk = !tags.length || (task.tags || []).some(t => tags.includes(t));
  const colorOk = !colors.length || colors.includes(task.color);
  return tagOk && colorOk;
}
