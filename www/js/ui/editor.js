// Add / edit bottom sheet. Add mode is NL-first: one big input parsed
// live into removable chips. Edit mode exposes the manual controls.

import { parse } from '../parser.js';
import { createTask, updateTask, deleteTask, getTask } from '../model.js';
import { ensurePermission } from '../reminders.js';
import { notificationsSupported } from '../native.js';
import { openSheet, closeSheet, confirmSheet, toast, esc } from './components.js';
import { fmtInterval } from '../reminders.js';

const NAG_PRESETS = [
  { label: 'Off', value: null },
  { label: '15m', value: 15 },
  { label: '30m', value: 30 },
  { label: '1h', value: 60 },
  { label: '2h', value: 120 },
];

export function openAddSheet(onSaved) {
  // cleared: chip types the user explicitly dismissed; won't be re-applied
  const cleared = new Set();
  let parsed = parse('', new Date());

  const sheet = openSheet(`
    <h2>New task</h2>
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
    syncManualFields(sheet, parsed);
    chipsEl.innerHTML = parseChipsHtml(parsed);
  }

  input.addEventListener('input', refresh);
  chipsEl.addEventListener('click', (e) => {
    const x = e.target.closest('.x');
    if (!x) return;
    cleared.add(x.dataset.type);
    refresh();
  });

  bindManualFields(sheet, () => parsed, cleared);

  sheet.querySelector('#save-task').addEventListener('click', async () => {
    const fields = collectFields(sheet, parsed);
    if (!fields.title) { toast('Give the task a name'); input.focus(); return; }
    if (fields.reminder && notificationsSupported) {
      const ok = await ensurePermission();
      if (!ok) toast('Reminders need notification permission — enable it in Settings');
    }
    createTask(fields);
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
    <div style="display:flex; gap:10px; margin-top:16px">
      <button class="btn danger" id="delete-task">Delete</button>
      <button class="btn" style="flex:1" id="save-task">Save</button>
    </div>
  `);

  bindManualFields(sheet, () => null, new Set());

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
    if (await confirmSheet(`Delete “${task.title}”?`)) {
      deleteTask(taskId);
      onSaved?.();
    }
  });
}

// ---------- shared pieces ----------

function manualFieldsHtml(task) {
  const dueVal = task.due && !task.allDay ? toLocalInputValue(task.due) : '';
  const dateVal = task.due && task.allDay ? toLocalInputValue(task.due).slice(0, 10) : '';
  return `
    <div class="field">
      <label>Notes</label>
      <textarea class="input" id="f-notes" rows="2">${esc(task.notes || '')}</textarea>
    </div>
    <div class="field">
      <label>Due date ${task.allDay === false ? '& time' : ''}</label>
      <input type="date" class="input" id="f-date" value="${dateVal}" style="margin-bottom:8px" />
      <input type="datetime-local" class="input" id="f-datetime" value="${dueVal}" placeholder="or exact time" />
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
        <button data-v="quick" ${task.effort === 'quick' ? 'class="active"' : ''}>⚡ Quick win</button>
        <button data-v="deep" ${task.effort === 'deep' ? 'class="active"' : ''}>🧠 Deep focus</button>
      </div>
    </div>
    <div class="field">
      <label>Nag me every…</label>
      <div class="segment" id="f-nag">
        ${NAG_PRESETS.map(p => `<button data-v="${p.value ?? ''}" ${
          (task.reminder?.intervalMin ?? null) === p.value ? 'class="active"' : ''
        }>${p.label}</button>`).join('')}
      </div>
    </div>
    <div class="field">
      <label>Tags (comma separated)</label>
      <input class="input" id="f-tags" value="${esc((task.tags || []).join(', '))}" placeholder="errands, work" />
    </div>`;
}

function bindManualFields(sheet, getParsed, cleared) {
  for (const id of ['f-priority', 'f-effort', 'f-nag']) {
    const seg = sheet.querySelector('#' + id);
    seg?.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      seg.querySelectorAll('button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      // a manual choice overrides whatever the NL parse said
      if (id === 'f-priority') cleared.add('priority');
      if (id === 'f-effort') cleared.add('effort');
      if (id === 'f-nag') cleared.add('nag');
    });
  }
  const date = sheet.querySelector('#f-date');
  const dt = sheet.querySelector('#f-datetime');
  date?.addEventListener('change', () => { cleared.add('due'); cleared.add('time'); if (date.value) dt.value = ''; });
  dt?.addEventListener('change', () => { cleared.add('due'); cleared.add('time'); if (dt.value) date.value = ''; });
}

// When the NL parse changes, reflect it into the manual controls (unless
// the user already touched them — their edits win via `cleared`).
function syncManualFields(sheet, parsed) {
  const setSeg = (id, val) => {
    const seg = sheet.querySelector('#' + id);
    if (!seg) return;
    seg.querySelectorAll('button').forEach(b =>
      b.classList.toggle('active', b.dataset.v === String(val ?? '')));
  };
  setSeg('f-priority', parsed.priority);
  setSeg('f-effort', parsed.effort ?? '');
  setSeg('f-nag', parsed.reminder?.intervalMin ?? '');
  const date = sheet.querySelector('#f-date');
  const dt = sheet.querySelector('#f-datetime');
  if (date && dt) {
    if (parsed.due && parsed.allDay) { date.value = toLocalInputValue(parsed.due).slice(0, 10); dt.value = ''; }
    else if (parsed.due) { dt.value = toLocalInputValue(parsed.due); date.value = ''; }
    else { date.value = ''; dt.value = ''; }
  }
}

function collectFields(sheet, parsed) {
  const seg = (id) => sheet.querySelector(`#${id} button.active`)?.dataset.v ?? '';
  const dateV = sheet.querySelector('#f-date')?.value;
  const dtV = sheet.querySelector('#f-datetime')?.value;

  let due = null, allDay = true;
  if (dtV) { due = new Date(dtV).getTime(); allDay = false; }
  else if (dateV) {
    const d = new Date(dateV + 'T23:59:00');
    due = d.getTime(); allDay = true;
  }

  const nagV = seg('f-nag');
  const tags = (sheet.querySelector('#f-tags')?.value || '')
    .split(',').map(s => s.trim().toLowerCase().replace(/^#/, '')).filter(Boolean);
  const parsedTags = parsed?.tags || [];

  return {
    title: parsed ? parsed.title : undefined,
    notes: sheet.querySelector('#f-notes')?.value || '',
    due, allDay,
    priority: parseInt(seg('f-priority') || '1', 10),
    effort: seg('f-effort') || null,
    reminder: nagV ? { intervalMin: parseInt(nagV, 10), startAt: null } : null,
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
    chips.push(chip('due', 'due today', '📅 ' + esc(label)));
  }
  if (p.priority !== 1) chips.push(chip('priority', p.priority === 2 ? 'prio-high' : '', p.priority === 2 ? 'high priority' : 'low priority'));
  if (p.effort) chips.push(chip('effort', 'effort', p.effort === 'quick' ? '⚡ quick win' : '🧠 deep focus'));
  if (p.reminder) chips.push(chip('nag', 'nag', '🔔 every ' + esc(fmtInterval(p.reminder.intervalMin))));
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
