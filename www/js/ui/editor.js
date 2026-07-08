// Add / edit bottom sheet. Add mode is NL-first: one big input parsed
// live into removable chips. Edit mode exposes the manual controls.

import { parse } from '../parser.js';
import { createTask, updateTask, deleteTask, getTask, childrenOf, descendantsOf } from '../model.js';
import { ensurePermission } from '../reminders.js';
import { notificationsSupported } from '../native.js';
import { openSheet, closeSheet, confirmSheet, toast, esc } from './components.js';
import { fmtInterval } from '../reminders.js';

const WHEEL_ITEM_H = 36;
const DEFAULT_INTERVAL = 30; // what the wheel shows when first switched on

export function openAddSheet(onSaved, { parentId = null } = {}) {
  // cleared: chip types the user explicitly dismissed; won't be re-applied
  const cleared = new Set();
  let parsed = parse('', new Date());
  const parent = parentId ? getTask(parentId) : null;

  const sheet = openSheet(`
    <h2>${parent ? `New subtask of “${esc(parent.title.slice(0, 28))}”` : 'New task'}</h2>
    <div class="field">
      <input class="input" id="nl-input" autocomplete="off" enterkeyhint="done"
        placeholder="e.g. pay rent friday 5pm every 2h #bills" />
    </div>
    <div class="task-meta" id="nl-chips" style="min-height:26px"></div>
    <div class="sub" style="font-size:0.75rem;color:var(--text-faint);margin:6px 0 12px">
      Understands: friday · tomorrow 5pm · jul 12 · every 30m · high priority · quick · #tag
    </div>
    <details id="more-opts">
      <summary style="color:var(--text-dim);font-size:0.85rem;cursor:pointer;margin-bottom:12px">More options</summary>
      ${manualFieldsHtml({})}
    </details>
    <button class="btn block" id="save-task" style="margin-top:14px">Add task</button>
  `);

  const input = sheet.querySelector('#nl-input');
  const chipsEl = sheet.querySelector('#nl-chips');

  function refresh() {
    parsed = parse(input.value, new Date());
    for (const type of cleared) clearField(parsed, type);
    syncManualFields(sheet, parsed, cleared);
    chipsEl.innerHTML = parseChipsHtml(parsed);
  }

  input.addEventListener('input', refresh);
  chipsEl.addEventListener('click', (e) => {
    const x = e.target.closest('.x');
    if (!x) return;
    cleared.add(x.dataset.type);
    refresh();
  });

  bindManualFields(sheet, () => parsed, cleared, {});

  sheet.querySelector('#save-task').addEventListener('click', async () => {
    const fields = collectFields(sheet, parsed);
    if (!fields.title) { toast('Give the task a name'); input.focus(); return; }
    if (fields.reminder && notificationsSupported) {
      const ok = await ensurePermission();
      if (!ok) toast('Reminders need notification permission — enable it in Settings');
    }
    createTask({ ...fields, parentId });
    closeSheet();
    onSaved?.();
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sheet.querySelector('#save-task').click();
  });

  setTimeout(() => input.focus(), 350);
  refresh();
}

export function openEditSheet(taskId, onSaved) {
  const task = getTask(taskId);
  if (!task) return;

  const sheet = openSheet(`
    <h2>Edit task</h2>
    <div class="field">
      <label>Title</label>
      <input class="input" id="edit-title" value="${esc(task.title)}" />
    </div>
    ${manualFieldsHtml(task)}
    <button class="btn secondary block" id="add-subtask">+ Add subtask${
      childrenOf(taskId).length ? ` <span style="color:var(--text-dim);font-weight:500">(${childrenOf(taskId).length} so far)</span>` : ''
    }</button>
    <div style="display:flex; gap:10px; margin-top:12px">
      <button class="btn danger" id="delete-task">Delete</button>
      <button class="btn" style="flex:1" id="save-task">Save</button>
    </div>
  `);

  sheet.querySelector('#add-subtask').addEventListener('click', () => {
    closeSheet();
    setTimeout(() => openAddSheet(onSaved, { parentId: taskId }), 360);
  });

  bindManualFields(sheet, () => null, new Set(), task);

  sheet.querySelector('#save-task').addEventListener('click', async () => {
    const fields = collectFields(sheet, null);
    fields.title = sheet.querySelector('#edit-title').value.trim() || task.title;
    if (fields.reminder && notificationsSupported) {
      const ok = await ensurePermission();
      if (!ok) toast('Reminders need notification permission — enable it in Settings');
    }
    updateTask(taskId, fields);
    closeSheet();
    onSaved?.();
  });

  sheet.querySelector('#delete-task').addEventListener('click', async () => {
    closeSheet();
    const subCount = descendantsOf(taskId).length;
    const msg = subCount
      ? `Delete “${task.title}” and its ${subCount} subtask${subCount > 1 ? 's' : ''}?`
      : `Delete “${task.title}”?`;
    if (await confirmSheet(msg)) {
      deleteTask(taskId);
      onSaved?.();
    }
  });
}

// ---------- shared pieces ----------

function manualFieldsHtml(task) {
  const dateVal = task.due ? toLocalInputValue(task.due).slice(0, 10) : '';
  const timeVal = task.due && !task.allDay ? toLocalInputValue(task.due).slice(11) : '';
  const hasReminder = !!task.reminder;
  return `
    <div class="field">
      <label>Notes</label>
      <textarea class="input" id="f-notes" rows="2">${esc(task.notes || '')}</textarea>
    </div>
    <div class="field">
      <label>Due — date and/or time</label>
      <div style="display:flex; gap:8px">
        <input type="date" class="input" id="f-date" value="${dateVal}" style="flex:3" />
        <input type="time" class="input" id="f-time" value="${timeVal}" style="flex:2" />
      </div>
    </div>
    <div class="field">
      <label>Priority</label>
      <div class="segment" id="f-priority">
        <button data-v="0" ${task.priority === 0 ? 'class="active"' : ''}>Low</button>
        <button data-v="1" ${(task.priority ?? 1) === 1 ? 'class="active"' : ''}>Normal</button>
        <button data-v="2" ${task.priority === 2 ? 'class="active"' : ''}>High</button>
      </div>
    </div>
    <div class="field">
      <label>Effort</label>
      <div class="segment" id="f-effort">
        <button data-v="" ${!task.effort ? 'class="active"' : ''}>—</button>
        <button data-v="quick" ${task.effort === 'quick' ? 'class="active"' : ''}>Quick win</button>
        <button data-v="deep" ${task.effort === 'deep' ? 'class="active"' : ''}>Deep focus</button>
      </div>
    </div>
    <div class="field">
      <div style="display:flex; align-items:center; justify-content:space-between">
        <label style="margin-bottom:0">Notify me every…</label>
        <button class="switch ${hasReminder ? 'on' : ''}" id="f-notify" role="switch"
          aria-checked="${hasReminder}" aria-label="Interval notifications"></button>
      </div>
      <div class="wheel-row" id="f-wheel-row" style="display:${hasReminder ? 'flex' : 'none'}">
        <div class="wheel" id="f-wheel-h"></div>
        <span class="wheel-unit">hr</span>
        <div class="wheel" id="f-wheel-m"></div>
        <span class="wheel-unit">min</span>
      </div>
    </div>
    <div class="field">
      <label>Tags (comma separated)</label>
      <input class="input" id="f-tags" value="${esc((task.tags || []).join(', '))}" placeholder="errands, work" />
    </div>`;
}

// ---------- interval wheel ----------

function buildWheel(el, count) {
  el.innerHTML = `<div class="pad"></div>${
    Array.from({ length: count }, (_, i) => `<div class="item">${i}</div>`).join('')
  }<div class="pad"></div>`;
}

function wheelValue(el) {
  return Math.max(0, Math.round(el.scrollTop / WHEEL_ITEM_H));
}

function setWheel(el, value) {
  // programmatic moves fire 'scroll' too — flag them so the listener can
  // tell them apart from the user's finger
  el.dataset.prog = '1';
  el.scrollTop = value * WHEEL_ITEM_H;
  setTimeout(() => delete el.dataset.prog, 80);
}

function setupIntervalControl(sheet, cleared, initialMin) {
  const toggle = sheet.querySelector('#f-notify');
  const row = sheet.querySelector('#f-wheel-row');
  const wheelH = sheet.querySelector('#f-wheel-h');
  const wheelM = sheet.querySelector('#f-wheel-m');
  buildWheel(wheelH, 24);  // 0–23 hours
  buildWheel(wheelM, 60);  // 0–59 minutes

  const position = (min) => {
    setWheel(wheelH, Math.floor(min / 60));
    setWheel(wheelM, min % 60);
  };
  if (initialMin) requestAnimationFrame(() => position(initialMin));

  toggle.addEventListener('click', () => {
    const on = toggle.classList.toggle('on');
    toggle.setAttribute('aria-checked', on);
    row.style.display = on ? 'flex' : 'none';
    cleared.add('nag');
    if (on && wheelValue(wheelH) === 0 && wheelValue(wheelM) === 0) {
      requestAnimationFrame(() => position(DEFAULT_INTERVAL));
    }
  });
  for (const w of [wheelH, wheelM]) {
    w.addEventListener('scroll', () => {
      if (!w.dataset.prog) cleared.add('nag');
    }, { passive: true });
  }
}

function readIntervalControl(sheet) {
  const toggle = sheet.querySelector('#f-notify');
  if (!toggle?.classList.contains('on')) return null;
  const min = wheelValue(sheet.querySelector('#f-wheel-h')) * 60
    + wheelValue(sheet.querySelector('#f-wheel-m'));
  return { intervalMin: Math.max(1, min), startAt: null };
}

function bindManualFields(sheet, getParsed, cleared, task = {}) {
  for (const id of ['f-priority', 'f-effort']) {
    const seg = sheet.querySelector('#' + id);
    seg?.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      seg.querySelectorAll('button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      // a manual choice overrides whatever the NL parse said
      cleared.add(id === 'f-priority' ? 'priority' : 'effort');
    });
  }
  setupIntervalControl(sheet, cleared, task.reminder?.intervalMin ?? 0);
  sheet.querySelector('#f-date')?.addEventListener('change', () => { cleared.add('due'); cleared.add('time'); });
  sheet.querySelector('#f-time')?.addEventListener('change', () => { cleared.add('due'); cleared.add('time'); });
}

// When the NL parse changes, reflect it into the manual controls — but a
// control the user already touched (its type is in `cleared`) is theirs
// now, and the parse must keep its hands off it.
function syncManualFields(sheet, parsed, cleared) {
  const setSeg = (id, val) => {
    const seg = sheet.querySelector('#' + id);
    if (!seg) return;
    seg.querySelectorAll('button').forEach(b =>
      b.classList.toggle('active', b.dataset.v === String(val ?? '')));
  };
  if (!cleared.has('priority')) setSeg('f-priority', parsed.priority);
  if (!cleared.has('effort')) setSeg('f-effort', parsed.effort ?? '');

  // reminder → switch + wheels
  if (!cleared.has('nag')) {
    const toggle = sheet.querySelector('#f-notify');
    const row = sheet.querySelector('#f-wheel-row');
    const interval = parsed.reminder?.intervalMin ?? null;
    const on = interval != null;
    toggle.classList.toggle('on', on);
    toggle.setAttribute('aria-checked', on);
    row.style.display = on ? 'flex' : 'none';
    if (on) {
      setWheel(sheet.querySelector('#f-wheel-h'), Math.floor(interval / 60));
      setWheel(sheet.querySelector('#f-wheel-m'), interval % 60);
    }
  }

  // due → single date + optional time row
  if (!cleared.has('due') && !cleared.has('time')) {
    const date = sheet.querySelector('#f-date');
    const time = sheet.querySelector('#f-time');
    if (date && time) {
      if (parsed.due) {
        const v = toLocalInputValue(parsed.due);
        date.value = v.slice(0, 10);
        time.value = parsed.allDay ? '' : v.slice(11);
      } else {
        date.value = '';
        time.value = '';
      }
    }
  }
}

function collectFields(sheet, parsed) {
  const seg = (id) => sheet.querySelector(`#${id} button.active`)?.dataset.v ?? '';
  const dateV = sheet.querySelector('#f-date')?.value;
  const timeV = sheet.querySelector('#f-time')?.value;

  // one Due row: date only → all-day; date+time → exact; time only → today
  let due = null, allDay = true;
  if (dateV && timeV) {
    due = new Date(`${dateV}T${timeV}`).getTime();
    allDay = false;
  } else if (dateV) {
    due = new Date(dateV + 'T23:59:00').getTime();
    allDay = true;
  } else if (timeV) {
    const d = new Date();
    const [h, m] = timeV.split(':').map(Number);
    d.setHours(h, m, 0, 0);
    due = d.getTime();
    allDay = false;
  }

  const tags = (sheet.querySelector('#f-tags')?.value || '')
    .split(',').map(s => s.trim().toLowerCase().replace(/^#/, '')).filter(Boolean);
  const parsedTags = parsed?.tags || [];

  return {
    title: parsed ? parsed.title : undefined,
    notes: sheet.querySelector('#f-notes')?.value || '',
    due, allDay,
    priority: parseInt(seg('f-priority') || '1', 10),
    effort: seg('f-effort') || null,
    reminder: readIntervalControl(sheet),
    tags: [...new Set([...parsedTags, ...tags])],
  };
}

function parseChipsHtml(p) {
  const chips = [];
  const chip = (type, cls, label) =>
    `<span class="chip ${cls}">${label}<button class="x" data-type="${type}" aria-label="remove">✕</button></span>`;
  if (p.due != null) {
    const d = new Date(p.due);
    const label = p.allDay
      ? d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
      : d.toLocaleDateString(undefined, { weekday: 'short' }) + ' ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    chips.push(chip('due', 'due today', esc(label)));
  }
  if (p.priority !== 1) chips.push(chip('priority', p.priority === 2 ? 'prio-high' : '', p.priority === 2 ? 'high priority' : 'low priority'));
  if (p.effort) chips.push(chip('effort', 'effort', p.effort === 'quick' ? 'quick win' : 'deep focus'));
  if (p.reminder) chips.push(chip('nag', 'nag', 'every ' + esc(fmtInterval(p.reminder.intervalMin))));
  for (const t of p.tags) chips.push(`<span class="chip tag">#${esc(t)}</span>`);
  return chips.join('');
}

function clearField(parsed, type) {
  if (type === 'due' || type === 'time') { parsed.due = null; parsed.allDay = true; }
  if (type === 'priority') parsed.priority = 1;
  if (type === 'effort') parsed.effort = null;
  if (type === 'nag') parsed.reminder = null;
}

function toLocalInputValue(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
