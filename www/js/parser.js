// Natural-language quick-add parser. Pure function, no DOM, injectable
// clock — unit-tested in test/parser.test.js.
//
// parse("pay rent friday 5pm high priority every 2h #bills", now) →
// { title:"pay rent", due:<ms>, allDay:false, priority:2,
//   effort:null, tags:["bills"], reminder:{intervalMin:120,startAt:null},
//   matches:[{type:'due',text:'friday'},…] }

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july',
  'august', 'september', 'october', 'november', 'december'];

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function nextWeekday(now, target, forceNext) {
  const d = startOfDay(now);
  let diff = (target - d.getDay() + 7) % 7;
  if (forceNext && diff === 0) diff = 7;
  if (forceNext && diff > 0 && diff < 7) diff += 7; // "next fri" said on a monday = fri of next week
  d.setDate(d.getDate() + diff);
  return d;
}

export function parse(input, now = new Date()) {
  let text = ' ' + input + ' ';
  const matches = [];
  const out = {
    title: '', due: null, allDay: true, priority: 1,
    effort: null, tags: [], reminder: null, matches,
  };

  let day = null;        // Date at local midnight
  let time = null;       // { h, m }

  // consume(re, type, fn): first match is recorded, removed from text,
  // and handed to fn(groups). Word-ish boundaries via leading/trailing \s
  // kept out of the capture so removal doesn't eat neighbouring spaces.
  function consume(re, type, fn) {
    const m = text.match(re);
    if (!m) return false;
    matches.push({ type, text: m[0].trim() });
    text = text.replace(re, ' ');
    fn(m);
    return true;
  }

  // ---- reminders (before times: "every 2h" must not read as a time) ----
  consume(/\bevery\s+(\d+)?\s*(m|min|mins|minute|minutes)\b/i, 'nag', (m) => {
    out.reminder = { intervalMin: Math.max(1, parseInt(m[1] || '30', 10)), startAt: null };
  }) ||
  consume(/\bevery\s+(\d+)?\s*(h|hr|hrs|hour|hours)\b/i, 'nag', (m) => {
    out.reminder = { intervalMin: Math.max(1, parseInt(m[1] || '1', 10)) * 60, startAt: null };
  }) ||
  consume(/\b(nag me\s+)?hourly\b/i, 'nag', () => {
    out.reminder = { intervalMin: 60, startAt: null };
  });
  // strip a dangling "nag me" / "remind me" that referred to the interval
  text = text.replace(/\b(nag|remind)( me)?\b/i, ' ');

  // ---- priority ----
  consume(/\b(high priority|urgent|important|asap)\b|!!/i, 'priority', () => { out.priority = 2; }) ||
  consume(/\b(low priority|someday|whenever)\b/i, 'priority', () => { out.priority = 0; });

  // ---- effort ----
  consume(/\b(quick win|quick|easy)\b/i, 'effort', () => { out.effort = 'quick'; }) ||
  consume(/\b(deep focus|deep|big)\b/i, 'effort', () => { out.effort = 'deep'; });

  // ---- tags ----
  let tm;
  while ((tm = text.match(/#([\p{L}\p{N}_-]+)/u))) {
    out.tags.push(tm[1].toLowerCase());
    matches.push({ type: 'tag', text: tm[0] });
    text = text.replace(tm[0], ' ');
  }

  // ---- relative days ----
  consume(/\btoday\b/i, 'due', () => { day = startOfDay(now); }) ||
  consume(/\btomorrow\b/i, 'due', () => {
    day = startOfDay(now); day.setDate(day.getDate() + 1);
  }) ||
  consume(/\btonight\b/i, 'due', () => {
    day = startOfDay(now); time = { h: 20, m: 0 };
  }) ||
  consume(/\bin\s+(\d+)\s+(day|days)\b/i, 'due', (m) => {
    day = startOfDay(now); day.setDate(day.getDate() + parseInt(m[1], 10));
  }) ||
  consume(/\bin\s+(\d+)\s+(week|weeks)\b/i, 'due', (m) => {
    day = startOfDay(now); day.setDate(day.getDate() + 7 * parseInt(m[1], 10));
  }) ||
  consume(/\bin\s+(\d+)\s+(hour|hours|hr|hrs)\b/i, 'due', (m) => {
    const d = new Date(now.getTime() + parseInt(m[1], 10) * 3600000);
    day = startOfDay(d); time = { h: d.getHours(), m: d.getMinutes() };
  }) ||
  consume(/\bin\s+(\d+)\s+(minute|minutes|min|mins)\b/i, 'due', (m) => {
    const d = new Date(now.getTime() + parseInt(m[1], 10) * 60000);
    day = startOfDay(d); time = { h: d.getHours(), m: d.getMinutes() };
  });

  // ---- weekdays ----
  if (!day) {
    const wd = WEEKDAYS.map((w, i) => ({ w, i, short: w.slice(0, 3) }));
    for (const { w, i, short } of wd) {
      const re = new RegExp(`\\b(next\\s+)?(${w}|${short})\\b`, 'i');
      const m = text.match(re);
      if (m) {
        matches.push({ type: 'due', text: m[0].trim() });
        text = text.replace(re, ' ');
        day = nextWeekday(now, i, !!m[1]);
        break;
      }
    }
  }

  // ---- explicit dates: "jul 12", "12 jul", "7/12", "on the 15th" ----
  if (!day) {
    const monAlt = MONTHS.map(m => m.slice(0, 3)).join('|');
    consume(new RegExp(`\\b(${monAlt})[a-z]*\\.?\\s+(\\d{1,2})(st|nd|rd|th)?\\b`, 'i'), 'due', (m) => {
      const mon = MONTHS.findIndex(x => x.startsWith(m[1].toLowerCase()));
      day = dateFor(now, mon, parseInt(m[2], 10));
    }) ||
    consume(new RegExp(`\\b(\\d{1,2})(st|nd|rd|th)?\\s+(${monAlt})[a-z]*\\b`, 'i'), 'due', (m) => {
      const mon = MONTHS.findIndex(x => x.startsWith(m[3].toLowerCase()));
      day = dateFor(now, mon, parseInt(m[1], 10));
    }) ||
    consume(/\b(\d{1,2})\/(\d{1,2})\b/, 'due', (m) => {
      day = dateFor(now, parseInt(m[1], 10) - 1, parseInt(m[2], 10));
    }) ||
    consume(/\bon the (\d{1,2})(st|nd|rd|th)?\b/i, 'due', (m) => {
      const dom = parseInt(m[1], 10);
      const d = startOfDay(now);
      if (d.getDate() > dom) d.setMonth(d.getMonth() + 1);
      d.setDate(dom);
      day = d;
    });
  }

  // ---- times ----
  if (!time) {
    consume(/\b(at\s+)?(\d{1,2}):(\d{2})\s*(am|pm)?\b/i, 'time', (m) => {
      let h = parseInt(m[2], 10);
      const min = parseInt(m[3], 10);
      if (m[4]) h = to24(h, m[4]);
      if (h < 24 && min < 60) time = { h, m: min };
    }) ||
    consume(/\b(at\s+)?(\d{1,2})\s*(am|pm)\b/i, 'time', (m) => {
      time = { h: to24(parseInt(m[2], 10), m[3]), m: 0 };
    }) ||
    consume(/\bnoon\b/i, 'time', () => { time = { h: 12, m: 0 }; }) ||
    consume(/\bmidnight\b/i, 'time', () => { time = { h: 23, m: 59 }; }) ||
    consume(/\b(this\s+)?morning\b/i, 'time', () => { time = { h: 9, m: 0 }; }) ||
    consume(/\b(this\s+)?afternoon\b/i, 'time', () => { time = { h: 14, m: 0 }; }) ||
    consume(/\b(this\s+)?evening\b/i, 'time', () => { time = { h: 18, m: 0 }; });
  }

  // ---- combine day + time into due ----
  if (day || time) {
    const d = day ? new Date(day) : startOfDay(now);
    if (time) {
      d.setHours(time.h, time.m, 0, 0);
      // bare time already past today → they meant tomorrow
      if (!day && d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
      out.allDay = false;
    } else {
      d.setHours(23, 59, 0, 0); // all-day tasks come due at end of day
      out.allDay = true;
    }
    out.due = d.getTime();
  }

  // ---- title = whatever survived ----
  out.title = text
    .replace(/\b(on|at|by|due)\s*$/i, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return out;
}

function to24(h, ampm) {
  const isPM = ampm.toLowerCase() === 'pm';
  if (h === 12) return isPM ? 12 : 0;
  return isPM ? h + 12 : h;
}

// Month/day in the current year, or next year if already past.
function dateFor(now, month, dayOfMonth) {
  const d = startOfDay(now);
  d.setMonth(month, dayOfMonth);
  if (d.getTime() < startOfDay(now).getTime()) d.setFullYear(d.getFullYear() + 1);
  return d;
}
