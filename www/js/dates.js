// Pure calendar date math — unit-tested in test/dates.test.js.

// Cells for a month grid: leading nulls to align the 1st under its
// weekday (weeks start Sunday), then a Date at local midnight per day.
export function monthGrid(year, month) {
  const first = new Date(year, month, 1);
  const cells = [];
  for (let i = 0; i < first.getDay(); i++) cells.push(null);
  const days = new Date(year, month + 1, 0).getDate();
  for (let d = 1; d <= days; d++) cells.push(new Date(year, month, d));
  return cells;
}

// Map of dayOfMonth → { open, done } counts for tasks due in that
// local month.
export function tasksByDay(tasks, year, month) {
  const map = new Map();
  for (const t of tasks) {
    if (t.due == null) continue;
    const d = new Date(t.due);
    if (d.getFullYear() !== year || d.getMonth() !== month) continue;
    const day = d.getDate();
    const entry = map.get(day) || { open: 0, done: 0 };
    t.completedAt ? entry.done++ : entry.open++;
    map.set(day, entry);
  }
  return map;
}

export function sameDay(a, b) {
  const da = new Date(a), db = new Date(b);
  return da.getFullYear() === db.getFullYear()
    && da.getMonth() === db.getMonth()
    && da.getDate() === db.getDate();
}
