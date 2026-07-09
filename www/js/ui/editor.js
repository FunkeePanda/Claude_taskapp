// Add / edit bottom sheet. Add mode is NL-first: one big input parsed
// live into removable chips. Below it (and in edit mode), options live
// behind a Todoist-style chip toolbar: Date · Timing · Priority ·
// Effort · Color · Tags · Notes — tapping a chip unfolds just that
// option's panel (accordion, one at a time).

import { parse } from '../parser.js';
import { createTask, updateTask, deleteTask, getTask, childrenOf, descendantsOf } from '../model.js';
import { ensurePermission, fmtInterval } from '../reminders.js';
import { notificationsSupported } from '../native.js';
import { openSheet, closeSheet, confirmSheet, toast, esc } from './components.js';

const WHEEL_ITEM_H = 36;
const DEFAULT_INTERVAL = 30;   // minutes shown when "notify" first switches on
const DEFAULT_TIMER = 30;      // minutes shown when "task timer" first switches on
const DEFAULT_WORK = 25;       // pomodoro defaults
const DEFAULT_BREAK = 5;

export const COLORS = [
  { name: 'rose', v: '#C4576A' },
  { name: 'ember', v: '#D96C47' },
  { name: 'amber', v: '#D9A441' },
  { name: 'moss', v: '#7FA65A' },
  { name: 'teal', v: '#4A9E8F' },
  { name: 'steel', v: '#5B84A8' },
  { name: 'violet', v: '#8A6FB8' },
  { name: 'slate', v: '#8B97A3' },
];

const ICONS = {
  date: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  timing: '<svg viewBox="0 0 24 24"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6"/></svg>',
  priority: '<svg viewBox="0 0 24 24"><path d="M5 21V4m0 0h13l-2.5 4L18 12H5"/></svg>',
  color: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18c-2 0-2-1.5-1-2.5s.5-2.5-1.5-2.5H7"/></svg>',
  tags: '<svg viewBox="0 0 24 24"><path d="M3 11l9-9 9 9-9 9-9-9z" transform="rotate(45 12 12)"/><circle cx="9" cy="9" r="1.4"/></svg>',
  notes: '<svg viewBox="0 0 24 24"><path d="M5 3h14v18l-4-3H5V3zM8 8h8M8 12h5"/></svg>',
};

export function openAddSheet(onSaved, { parentId = null } = {}) {
  // cleared: option types the user took manual control of; the NL parse
  // no longer touches those controls
  const cleared = new Set();
  let parsed = parse('', new Date());
  const parent = parentId ? getTask(parentId) : null;

  const sheet = openSheet(`
    <h2>${parent ? `New subtask of “${esc(parent.title.slice(0, 28))}”` : 'New task'}</h2>
    <div class="field">
      <input class="input" id="nl-input" autocomplete="off" enterkeyhint="done"
        placeholder="e.g. pay rent friday 5pm every 2h #bills" />
    </div>
    <div class="task-meta" id="nl-chips" style="min-height:24px"></div>
    <div class="sub" style="font-size:0.75rem;color:var(--text-faint);margin:4px 0 10px">
      Understands: friday · tomorrow 5pm · jul 12 · every 30m · high priority · #tag
    </div>
    ${optionToolbar({})}
    <button class="btn block" id="save-task" style="margin-top:16px">Add task</button>
  `);

  const input = sheet.querySelector('#nl-input');
  const chipsEl = sheet.querySelector('#nl-chips');

  function refresh() {
    parsed = parse(input.value, new Date());
    for (const type of cleared) clearField(parsed, type);
    syncManualFields(sheet, parsed, cleared);
    chipsEl.innerHTML = parseChipsHtml(parsed);
    updateChipSummaries(sheet);
  }

  input.addEventListener('input', refresh);
  chipsEl.addEventListener('click', (e) => {
    const x = e.target.closest('.x');
    if (!x) return;
    cleared.add(x.dataset.type);
    refresh();
  });

  bindOptionToolbar(sheet, cleared, {});

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
    ${optionToolbar(task)}
    <button class="btn secondary block" id="add-subtask" style="margin-top:16px">+ Add subtask${
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

  bindOptionToolbar(sheet, new Set(), task);

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

// ---------------------------------------------------------------------
// Option toolbar (chips + accordion panels)
// ---------------------------------------------------------------------

function optionToolbar(task) {
  const chip = (id, label) =>
    `<button class="opt-chip" data-panel="${id}" type="button">${ICONS[id]}<span class="opt-label">${label}</span></button>`;
  return `
    <div class="opt-row" id="opt-row">
      ${chip('date', 'Date')}
      ${chip('timing', 'Timing')}
      ${chip('priority', 'Priority')}
      ${chip('color', 'Color')}
      ${chip('tags', 'Tags')}
      ${chip('notes', 'Notes')}
    </div>
    <div class="opt-panels">
      <div class="opt-panel" data-panel="date" hidden>
        <div style="display:flex; gap:8px">
          <input type="date" class="input" id="f-date" value="${task.due ? toLocalInputValue(task.due).slice(0, 10) : ''}" style="flex:3" />
          <input type="time" class="input" id="f-time" value="${task.due && !task.allDay ? toLocalInputValue(task.due).slice(11) : ''}" style="flex:2" />
        </div>
      </div>

      <div class="opt-panel" data-panel="timing" hidden>
        <div class="timing-row">
          <div><div class="label">Notify me every…</div><div class="sub2">Repeating reminder until done</div></div>
          <button class="switch ${task.reminder ? 'on' : ''}" id="f-notify" role="switch" aria-checked="${!!task.reminder}" aria-label="Interval notifications"></button>
        </div>
        <div class="wheel-row" id="f-wheel-row" style="display:${task.reminder ? 'flex' : 'none'}">
          <div class="wheel" id="f-wheel-h"></div><span class="wheel-unit">hr</span>
          <div class="wheel" id="f-wheel-m"></div><span class="wheel-unit">min</span>
        </div>

        <div class="timing-row">
          <div><div class="label">Task timer</div><div class="sub2">How long should this take?</div></div>
          <button class="switch ${task.timer ? 'on' : ''}" id="f-timer" role="switch" aria-checked="${!!task.timer}" aria-label="Task timer"></button>
        </div>
        <div class="wheel-row" id="f-timer-row" style="display:${task.timer ? 'flex' : 'none'}">
          <div class="wheel" id="f-timer-h"></div><span class="wheel-unit">hr</span>
          <div class="wheel" id="f-timer-m"></div><span class="wheel-unit">min</span>
        </div>

        <div class="timing-row">
          <div><div class="label">Breaks</div><div class="sub2">Work / break cycle while you focus</div></div>
          <button class="switch ${task.breaks ? 'on' : ''}" id="f-breaks" role="switch" aria-checked="${!!task.breaks}" aria-label="Breaks"></button>
        </div>
        <div id="f-breaks-rows" style="display:${task.breaks ? 'block' : 'none'}">
          <div class="wheel-row">
            <span class="wheel-unit" style="width:44px">work</span>
            <div class="wheel" id="f-work-h"></div><span class="wheel-unit">hr</span>
            <div class="wheel" id="f-work-m"></div><span class="wheel-unit">min</span>
          </div>
          <div class="wheel-row">
            <span class="wheel-unit" style="width:44px">break</span>
            <div class="wheel" id="f-break-m"></div><span class="wheel-unit">min</span>
          </div>
        </div>

        <div class="timing-row" id="f-mute-row" style="display:${(task.timer || task.breaks) ? 'flex' : 'none'}">
          <div><div class="label">Silence intervals during a session</div><div class="sub2">Pause “notify me every…” while the timer runs</div></div>
          <button class="switch ${task.muteDuringSession !== false ? 'on' : ''}" id="f-mute" role="switch" aria-checked="${task.muteDuringSession !== false}" aria-label="Silence intervals during session"></button>
        </div>
      </div>

      <div class="opt-panel" data-panel="priority" hidden>
        <div class="segment" id="f-priority">
          <button data-v="0" ${task.priority === 0 ? 'class="active"' : ''} type="button">Low</button>
          <button data-v="1" ${(task.priority ?? 1) === 1 ? 'class="active"' : ''} type="button">Normal</button>
          <button data-v="2" ${task.priority === 2 ? 'class="active"' : ''} type="button">High</button>
        </div>
      </div>

      <div class="opt-panel" data-panel="color" hidden>
        <div class="swatch-row" id="f-color">
          <button class="swatch none ${!task.color ? 'sel' : ''}" data-v="" aria-label="No color" type="button">✕</button>
          ${COLORS.map(c => `<button class="swatch ${task.color === c.v ? 'sel' : ''}" data-v="${c.v}" style="--sw:${c.v}" aria-label="${c.name}" type="button"></button>`).join('')}
        </div>
      </div>

      <div class="opt-panel" data-panel="tags" hidden>
        <input class="input" id="f-tags" value="${esc((task.tags || []).join(', '))}" placeholder="errands, work (comma separated)" />
      </div>

      <div class="opt-panel" data-panel="notes" hidden>
        <textarea class="input" id="f-notes" rows="3" placeholder="Anything worth remembering…">${esc(task.notes || '')}</textarea>
      </div>
    </div>`;
}

function bindOptionToolbar(sheet, cleared, task) {
  // accordion: one open panel at a time
  sheet.querySelector('#opt-row').addEventListener('click', (e) => {
    const chip = e.target.closest('.opt-chip');
    if (!chip) return;
    const id = chip.dataset.panel;
    for (const p of sheet.querySelectorAll('.opt-panel')) {
      p.hidden = p.dataset.panel === id ? !p.hidden : true;
    }
    for (const c of sheet.querySelectorAll('.opt-chip')) {
      c.classList.toggle('open', c === chip && !sheet.querySelector(`.opt-panel[data-panel="${id}"]`).hidden);
    }
    // re-showing a panel: its wheels lost their scroll while hidden —
    // restore the visual from the cached values
    const shown = sheet.querySelector(`.opt-panel[data-panel="${id}"]:not([hidden])`);
    if (shown) {
      requestAnimationFrame(() => {
        for (const w of shown.querySelectorAll('.wheel')) setWheel(w, wheelValue(w));
      });
    }
  });

  // segments
  sheet.querySelector('#f-priority')?.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const seg = sheet.querySelector('#f-priority');
    seg.querySelectorAll('button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    cleared.add('priority');
    updateChipSummaries(sheet);
  });

  // color swatches
  sheet.querySelector('#f-color').addEventListener('click', (e) => {
    const sw = e.target.closest('.swatch');
    if (!sw) return;
    sheet.querySelectorAll('.swatch').forEach(s => s.classList.remove('sel'));
    sw.classList.add('sel');
    updateChipSummaries(sheet);
  });

  // date/time
  for (const id of ['f-date', 'f-time']) {
    sheet.querySelector('#' + id)?.addEventListener('change', () => {
      cleared.add('due'); cleared.add('time');
      updateChipSummaries(sheet);
    });
  }

  // tags / notes summaries
  sheet.querySelector('#f-tags').addEventListener('input', () => updateChipSummaries(sheet));
  sheet.querySelector('#f-notes').addEventListener('input', () => updateChipSummaries(sheet));

  // ----- timing switches + wheels -----
  const wheels = [
    ['f-wheel-h', 24], ['f-wheel-m', 60],
    ['f-timer-h', 24], ['f-timer-m', 60],
    ['f-work-h', 24], ['f-work-m', 60],
    ['f-break-m', 60],
  ];
  for (const [id, count] of wheels) buildWheel(sheet.querySelector('#' + id), count);

  requestAnimationFrame(() => {
    if (task.reminder) positionWheels(sheet, 'f-wheel', task.reminder.intervalMin);
    if (task.timer) positionWheels(sheet, 'f-timer', task.timer.durationMin);
    if (task.breaks) {
      positionWheels(sheet, 'f-work', task.breaks.workMin);
      setWheel(sheet.querySelector('#f-break-m'), task.breaks.breakMin);
    }
  });

  const muteRow = sheet.querySelector('#f-mute-row');
  const refreshMuteRow = () => {
    const anySession = sheet.querySelector('#f-timer').classList.contains('on')
      || sheet.querySelector('#f-breaks').classList.contains('on');
    muteRow.style.display = anySession ? 'flex' : 'none';
  };

  // wheel defaults land a frame later — refresh the chip summary after
  const resummarize = () => setTimeout(() => updateChipSummaries(sheet), 120);

  bindSwitch(sheet, '#f-notify', '#f-wheel-row', () => {
    cleared.add('nag');
    if (wheelsAtZero(sheet, 'f-wheel')) requestAnimationFrame(() => positionWheels(sheet, 'f-wheel', DEFAULT_INTERVAL));
    resummarize();
  });
  bindSwitch(sheet, '#f-timer', '#f-timer-row', () => {
    if (wheelsAtZero(sheet, 'f-timer')) requestAnimationFrame(() => positionWheels(sheet, 'f-timer', DEFAULT_TIMER));
    refreshMuteRow();
    resummarize();
  });
  bindSwitch(sheet, '#f-breaks', '#f-breaks-rows', () => {
    if (wheelsAtZero(sheet, 'f-work') && wheelValue(sheet.querySelector('#f-break-m')) === 0) {
      requestAnimationFrame(() => {
        positionWheels(sheet, 'f-work', DEFAULT_WORK);
        setWheel(sheet.querySelector('#f-break-m'), DEFAULT_BREAK);
      });
    }
    refreshMuteRow();
    resummarize();
  });
  bindSwitch(sheet, '#f-mute', null, () => {});

  for (const [id] of wheels) {
    sheet.querySelector('#' + id).addEventListener('scroll', (e) => {
      if (!e.target.dataset.prog) {
        e.target.dataset.val = String(Math.max(0, Math.round(e.target.scrollTop / WHEEL_ITEM_H)));
        if (id.startsWith('f-wheel')) cleared.add('nag');
        updateChipSummaries(sheet);
      }
    }, { passive: true });
  }

  // the whole row is a drag surface: a vertical pan that starts between
  // the wheels (band, gaps, unit labels) spins the nearest wheel, so
  // fingers don't have to land exactly on the numbers
  for (const row of sheet.querySelectorAll('.wheel-row')) bindRowDrag(row);

  updateChipSummaries(sheet);
}

function bindSwitch(sheet, sel, revealSel, onChange) {
  const toggle = sheet.querySelector(sel);
  toggle.addEventListener('click', () => {
    const on = toggle.classList.toggle('on');
    toggle.setAttribute('aria-checked', on);
    if (revealSel) {
      const el = sheet.querySelector(revealSel);
      el.style.display = on ? (el.classList.contains('wheel-row') ? 'flex' : 'block') : 'none';
      if (on) {
        // wheels hidden by display:none lost their scroll — restore it
        requestAnimationFrame(() => {
          for (const w of el.querySelectorAll('.wheel')) setWheel(w, wheelValue(w));
        });
      }
    }
    onChange(on);
    updateChipSummaries(sheet);
  });
}

// ---------- wheels ----------

// The wheel's true value lives in dataset.val, NOT in scrollTop — a
// hidden panel resets its scroll containers to 0, which would silently
// wipe the chosen time. scrollTop is only the visual.
function buildWheel(el, count) {
  if (!el) return;
  el.dataset.val = '0';
  el.innerHTML = `<div class="pad"></div>${
    Array.from({ length: count }, (_, i) => `<div class="item">${i}</div>`).join('')
  }<div class="pad"></div>`;
}

function wheelValue(el) {
  return Math.max(0, parseInt(el.dataset.val || '0', 10));
}

function setWheel(el, value) {
  // programmatic moves fire 'scroll' too — flag them so listeners can
  // tell them apart from the user's finger
  el.dataset.val = String(value);
  el.dataset.prog = '1';
  el.scrollTop = value * WHEEL_ITEM_H;
  setTimeout(() => delete el.dataset.prog, 80);
}

// Touches that start on a .wheel scroll natively; everywhere else in the
// row we drive the horizontally-nearest wheel ourselves and snap to the
// closest item on release.
function bindRowDrag(row) {
  let target = null, lastY = 0;
  row.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.wheel')) return; // native scroll owns this touch
    const wheels = [...row.querySelectorAll('.wheel')];
    if (!wheels.length) return;
    target = wheels.reduce((best, w) => {
      const r = w.getBoundingClientRect();
      const d = Math.abs(e.clientX - (r.left + r.width / 2));
      return !best || d < best.d ? { w, d } : best;
    }, null).w;
    // mandatory snap re-quantizes every programmatic scrollTop change,
    // swallowing sub-item drag deltas — suspend it for the drag
    target.style.scrollSnapType = 'none';
    lastY = e.clientY;
    row.setPointerCapture(e.pointerId);
  });
  row.addEventListener('pointermove', (e) => {
    if (!target) return;
    target.scrollTop -= e.clientY - lastY; // fires 'scroll' → dataset.val updates
    lastY = e.clientY;
  });
  const release = () => {
    if (!target) return;
    const el = target;
    target = null;
    const snapped = Math.max(0, Math.round(el.scrollTop / WHEEL_ITEM_H));
    el.dataset.val = String(snapped);
    el.scrollTo({ top: snapped * WHEEL_ITEM_H, behavior: 'smooth' });
    // restore snapping once the smooth glide has landed
    setTimeout(() => { el.style.scrollSnapType = ''; }, 350);
  };
  row.addEventListener('pointerup', release);
  row.addEventListener('pointercancel', release);
}

function positionWheels(sheet, prefix, minutes) {
  setWheel(sheet.querySelector(`#${prefix}-h`), Math.floor(minutes / 60));
  setWheel(sheet.querySelector(`#${prefix}-m`), minutes % 60);
}

function wheelsAtZero(sheet, prefix) {
  return wheelValue(sheet.querySelector(`#${prefix}-h`)) === 0
    && wheelValue(sheet.querySelector(`#${prefix}-m`)) === 0;
}

function readWheelMinutes(sheet, prefix) {
  return wheelValue(sheet.querySelector(`#${prefix}-h`)) * 60
    + wheelValue(sheet.querySelector(`#${prefix}-m`));
}

// ---------- chip summaries ----------

function updateChipSummaries(sheet) {
  const set = (panel, active, summary) => {
    const chip = sheet.querySelector(`.opt-chip[data-panel="${panel}"]`);
    if (!chip) return;
    chip.classList.toggle('set', !!active);
    const label = chip.querySelector('.opt-label');
    label.innerHTML = summary || label.dataset.base || label.textContent;
    if (!label.dataset.base) label.dataset.base = panel[0].toUpperCase() + panel.slice(1);
    if (!active) label.textContent = label.dataset.base;
  };

  const dateV = sheet.querySelector('#f-date')?.value;
  const timeV = sheet.querySelector('#f-time')?.value;
  let dateSummary = '';
  if (dateV) {
    const d = new Date(dateV + 'T12:00');
    dateSummary = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    if (timeV) dateSummary += ' ' + timeV;
  } else if (timeV) dateSummary = timeV;
  set('date', dateSummary, esc(dateSummary));

  const parts = [];
  if (sheet.querySelector('#f-notify').classList.contains('on')) {
    parts.push('every ' + fmtShort(readWheelMinutes(sheet, 'f-wheel')));
  }
  if (sheet.querySelector('#f-timer').classList.contains('on')) {
    parts.push(fmtShort(readWheelMinutes(sheet, 'f-timer')) + ' timer');
  }
  if (sheet.querySelector('#f-breaks').classList.contains('on')) {
    parts.push(fmtShort(readWheelMinutes(sheet, 'f-work')) + '/' + wheelValue(sheet.querySelector('#f-break-m')) + 'm');
  }
  set('timing', parts.length, esc(parts.join(' · ')));

  const prio = sheet.querySelector('#f-priority button.active')?.dataset.v;
  set('priority', prio === '0' || prio === '2', prio === '2' ? 'High' : 'Low');

  const color = sheet.querySelector('#f-color .swatch.sel:not(.none)')?.dataset.v;
  set('color', !!color, color ? `<span class="opt-dot" style="background:${color}"></span>` : '');

  const tags = (sheet.querySelector('#f-tags')?.value || '').split(',').map(s => s.trim()).filter(Boolean);
  set('tags', tags.length, tags.length ? esc('#' + tags[0] + (tags.length > 1 ? ` +${tags.length - 1}` : '')) : '');

  set('notes', (sheet.querySelector('#f-notes')?.value || '').trim().length, 'Notes ●');
}

function fmtShort(min) {
  if (min >= 60) {
    const h = Math.floor(min / 60), m = min % 60;
    return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
  }
  return `${min}m`;
}

// ---------- NL parse ↔ controls ----------

// Reflect the parse into controls the user has NOT touched (their manual
// edits, tracked in `cleared`, always win).
function syncManualFields(sheet, parsed, cleared) {
  if (!cleared.has('priority')) {
    sheet.querySelectorAll('#f-priority button').forEach(b =>
      b.classList.toggle('active', b.dataset.v === String(parsed.priority)));
  }
  if (!cleared.has('nag')) {
    const toggle = sheet.querySelector('#f-notify');
    const row = sheet.querySelector('#f-wheel-row');
    const interval = parsed.reminder?.intervalMin ?? null;
    const on = interval != null;
    toggle.classList.toggle('on', on);
    toggle.setAttribute('aria-checked', on);
    row.style.display = on ? 'flex' : 'none';
    if (on) positionWheels(sheet, 'f-wheel', interval);
  }
  if (!cleared.has('due') && !cleared.has('time')) {
    const date = sheet.querySelector('#f-date');
    const time = sheet.querySelector('#f-time');
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

  const on = (sel) => sheet.querySelector(sel).classList.contains('on');
  const reminder = on('#f-notify')
    ? { intervalMin: Math.max(1, readWheelMinutes(sheet, 'f-wheel')), startAt: null }
    : null;
  const timer = on('#f-timer')
    ? { durationMin: Math.max(1, readWheelMinutes(sheet, 'f-timer')) }
    : null;
  const breaks = on('#f-breaks')
    ? {
        workMin: Math.max(1, readWheelMinutes(sheet, 'f-work')),
        breakMin: Math.max(1, wheelValue(sheet.querySelector('#f-break-m'))),
      }
    : null;

  const tags = (sheet.querySelector('#f-tags')?.value || '')
    .split(',').map(s => s.trim().toLowerCase().replace(/^#/, '')).filter(Boolean);
  const parsedTags = parsed?.tags || [];

  return {
    title: parsed ? parsed.title : undefined,
    notes: sheet.querySelector('#f-notes')?.value || '',
    due, allDay,
    priority: parseInt(seg('f-priority') || '1', 10),
    reminder, timer, breaks,
    muteDuringSession: on('#f-mute'),
    color: sheet.querySelector('#f-color .swatch.sel:not(.none)')?.dataset.v || null,
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
  if (p.reminder) chips.push(chip('nag', 'nag', 'every ' + esc(fmtInterval(p.reminder.intervalMin))));
  for (const t of p.tags) chips.push(`<span class="chip tag">#${esc(t)}</span>`);
  return chips.join('');
}

function clearField(parsed, type) {
  if (type === 'due' || type === 'time') { parsed.due = null; parsed.allDay = true; }
  if (type === 'priority') parsed.priority = 1;
  if (type === 'nag') parsed.reminder = null;
}

function toLocalInputValue(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
