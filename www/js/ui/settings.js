// Settings: permission status, quiet hours, backup, pipeline test, about.

import { isNative, notificationsSupported, LocalNotifications, App, Filesystem, Share } from '../native.js';
import { settings, updateSettings } from '../model.js';
import { exportJSON, importJSON } from '../store.js';
import { ensurePermission, reconcile } from '../reminders.js';
import { toast, confirmSheet, esc } from './components.js';

export async function renderSettings(view, rerender) {
  const s = settings();

  view.innerHTML = `
    <h1 class="screen-title">Settings</h1>

    <div class="section-label">Notifications</div>
    <div class="card">
      <div class="row">
        <div><div class="label">Platform</div><div class="sub">${isNative ? 'Android app' : 'Web preview — reminders need the installed app'}</div></div>
        <span class="status-pill ${isNative ? 'ok' : 'bad'}">${isNative ? 'native' : 'web'}</span>
      </div>
      <div class="row">
        <div><div class="label">Notification permission</div><div class="sub" id="perm-sub">checking…</div></div>
        <span class="status-pill bad" id="perm-pill">…</span>
      </div>
      <div class="row" id="exact-row" style="display:none">
        <div><div class="label">Exact alarms</div><div class="sub">Needed for on-time nags</div></div>
        <span class="status-pill bad" id="exact-pill">…</span>
      </div>
      <div class="row">
        <div style="flex:1">
          <div class="label">Quiet hours</div>
          <div class="sub">No nags between these times</div>
          <div style="display:flex; gap:8px; margin-top:8px; align-items:center">
            <input type="time" class="input" id="quiet-start" value="${esc(s.quietStart)}" style="flex:1" />
            <span class="sub">to</span>
            <input type="time" class="input" id="quiet-end" value="${esc(s.quietEnd)}" style="flex:1" />
          </div>
        </div>
      </div>
      <div class="row">
        <button class="btn secondary block" id="test-nag">Test notification in 2 minutes</button>
      </div>
    </div>

    <div class="section-label">Focus</div>
    <div class="card">
      <div class="row">
        <div><div class="label">Focus list size</div><div class="sub">Max tasks Today picks for you</div></div>
        <div class="segment" id="focus-limit" style="width:150px">
          ${[3, 5, 7].map(n => `<button data-v="${n}" ${s.focusLimit === n ? 'class="active"' : ''}>${n}</button>`).join('')}
        </div>
      </div>
    </div>

    <div class="section-label">Backup</div>
    <div class="card">
      <div class="row">
        <div><div class="label">Export tasks</div><div class="sub">Share a JSON backup — do this now and then!</div></div>
        <button class="btn small secondary" id="export-btn">Export</button>
      </div>
      <div class="row">
        <div><div class="label">Import backup</div><div class="sub">Replaces everything with the file's tasks</div></div>
        <button class="btn small secondary" id="import-btn">Import</button>
        <input type="file" id="import-file" accept="application/json,.json" style="display:none" />
      </div>
      <div class="row">
        <div class="sub">Heads-up: clearing the app's data in Android settings wipes your tasks. Exports are your safety net.</div>
      </div>
    </div>

    <div class="section-label">About</div>
    <div class="card">
      <div class="row">
        <div><div class="label">Focus</div><div class="sub" id="build-sub">…</div></div>
      </div>
      <div class="row">
        <div class="sub">If nags stop arriving, check that battery optimization is off for Focus (Android Settings → Apps → Focus → Battery → Unrestricted). Some phones (Xiaomi, Huawei…) aggressively kill scheduled alarms.</div>
      </div>
    </div>
  `;

  // permission status rows
  const permPill = view.querySelector('#perm-pill');
  const permSub = view.querySelector('#perm-sub');
  try {
    const { display } = await LocalNotifications.checkPermissions();
    permPill.textContent = display;
    permPill.className = 'status-pill ' + (display === 'granted' ? 'ok' : 'bad');
    if (display === 'granted') permSub.textContent = 'Reminders can fire';
    else if (!notificationsSupported) permSub.textContent = 'Install the Android app for reminders';
    else {
      permSub.innerHTML = '<button class="btn small" id="req-perm" style="margin-top:6px">Enable notifications</button>';
      view.querySelector('#req-perm').addEventListener('click', async () => {
        await ensurePermission();
        rerender();
      });
    }
  } catch (e) { permSub.textContent = 'error: ' + e.message; }

  if (notificationsSupported && LocalNotifications.checkExactNotificationSetting) {
    try {
      const { exact_alarm } = await LocalNotifications.checkExactNotificationSetting();
      const row = view.querySelector('#exact-row');
      row.style.display = '';
      const pill = view.querySelector('#exact-pill');
      pill.textContent = exact_alarm;
      pill.className = 'status-pill ' + (exact_alarm === 'granted' ? 'ok' : 'bad');
      if (exact_alarm !== 'granted') {
        pill.style.cursor = 'pointer';
        pill.addEventListener('click', async () => {
          await LocalNotifications.changeExactNotificationSetting();
          rerender();
        });
      }
    } catch { /* pre-Android-12 or plugin variance: row stays hidden */ }
  }

  // quiet hours
  for (const id of ['quiet-start', 'quiet-end']) {
    view.querySelector('#' + id).addEventListener('change', (e) => {
      updateSettings(id === 'quiet-start' ? { quietStart: e.target.value } : { quietEnd: e.target.value });
      reconcile();
      toast('Quiet hours updated');
    });
  }

  // focus limit
  view.querySelector('#focus-limit').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    updateSettings({ focusLimit: parseInt(btn.dataset.v, 10) });
    rerender();
  });

  // test nag
  view.querySelector('#test-nag').addEventListener('click', async () => {
    if (!notificationsSupported) { toast('Notifications need the installed Android app'); return; }
    if (!(await ensurePermission())) { toast('Permission denied — enable notifications in system settings'); return; }
    await LocalNotifications.schedule({
      notifications: [{
        id: 999001,
        channelId: 'reminders',
        title: 'Notifications work!',
        body: 'This fired with the app closed. Nag reminders are a go.',
        schedule: { at: new Date(Date.now() + 2 * 60 * 1000), allowWhileIdle: true },
        smallIcon: 'ic_stat_notify',
      }],
    });
    toast('Scheduled! Swipe the app away and wait 2 min');
  });

  // export / import
  view.querySelector('#export-btn').addEventListener('click', async () => {
    const json = exportJSON();
    const name = `focus-backup-${new Date().toISOString().slice(0, 10)}.json`;
    try {
      if (isNative) {
        const file = await Filesystem.writeFile({
          path: name, data: json, directory: 'CACHE', encoding: 'utf8',
        });
        await Share.share({ title: 'Focus backup', url: file.uri });
      } else {
        await Filesystem.writeFile({ path: name, data: json });
      }
      toast('Backup ready');
    } catch (e) {
      if (!/cancel/i.test(String(e?.message))) toast('Export failed: ' + (e?.message || e));
    }
  });

  const fileInput = view.querySelector('#import-file');
  view.querySelector('#import-btn').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    const text = await file.text();
    let count;
    try {
      // validate before asking, so a bad file never nukes anything
      count = JSON.parse(text)?.tasks?.length ?? 0;
    } catch { toast('Not a valid backup file'); return; }
    if (await confirmSheet(`Replace everything with this backup (${count} tasks)?`, 'Import')) {
      try {
        const n = importJSON(text);
        await reconcile();
        toast(`Imported ${n} tasks`);
        rerender();
      } catch (e) { toast(e.message); }
    }
    fileInput.value = '';
  });

  // build info
  try {
    const info = await App.getInfo();
    view.querySelector('#build-sub').textContent = `v${info.version} (build ${info.build})`;
  } catch {
    view.querySelector('#build-sub').textContent = 'web preview';
  }
}
