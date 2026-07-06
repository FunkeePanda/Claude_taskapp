// Focus scoring + energy matching. Pure — unit-tested in test/focus.test.js.

const DAY = 24 * 60 * 60 * 1000;

export function daysBetween(a, b) {
  const da = new Date(a); da.setHours(0, 0, 0, 0);
  const db = new Date(b); db.setHours(0, 0, 0, 0);
  return Math.round((db - da) / DAY);
}

// Urgency + priority + anti-staleness. Deterministic: same inputs, same
// list all day — a stable plan, not a shifting one.
export function score(task, now = Date.now()) {
  let s = 0;

  if (task.due != null) {
    if (task.due < now) {
      s += 100 + Math.min((now - task.due) / 3600000, 48); // overdue, grows for 48h
    } else {
      const dueInDays = daysBetween(now, task.due);
      if (dueInDays <= 0) s += 80;
      else if (dueInDays === 1) s += 55;
      else if (dueInDays <= 3) s += 35;
      else if (dueInDays <= 7) s += 15;
    }
  }

  s += task.priority * 15;
  s += Math.min(daysBetween(task.createdAt, now), 21) * 1.5;
  if (task.reminder) s += 10;

  return s;
}

// Energy re-ranks; it never hides. 'low' favors quick wins, 'high'
// favors deep-focus work.
export function energyAdjust(task, energy) {
  if (!energy || !task.effort) return 0;
  if (energy === 'low') return task.effort === 'quick' ? 20 : -15;
  return task.effort === 'deep' ? 20 : -5;
}

export function isOverdue(task, now = Date.now()) {
  return task.due != null && task.due < now && !task.completedAt;
}

export function isDueToday(task, now = Date.now()) {
  return task.due != null && !task.completedAt
    && task.due >= now && daysBetween(now, task.due) <= 0;
}

// The Today list: every overdue + due-today task is always included
// (even past the limit), then the best-scored rest fill up to `limit`.
export function todayList(tasks, now = Date.now(), limit = 5, energy = null) {
  const open = tasks.filter(t => !t.completedAt);
  const ranked = open
    .map(t => ({ t, s: score(t, now) + energyAdjust(t, energy) }))
    .sort((a, b) => b.s - a.s);

  const must = ranked.filter(({ t }) => isOverdue(t, now) || isDueToday(t, now));
  const rest = ranked.filter(({ t }) => !isOverdue(t, now) && !isDueToday(t, now));

  const picked = [...must];
  for (const r of rest) {
    if (picked.length >= limit) break;
    picked.push(r);
  }
  return picked.map(({ t }) => t);
}

// Badge helper: does this task match the current energy level?
export function matchesEnergy(task, energy) {
  return !!energy && !!task.effort &&
    ((energy === 'low' && task.effort === 'quick') ||
     (energy === 'high' && task.effort === 'deep'));
}
