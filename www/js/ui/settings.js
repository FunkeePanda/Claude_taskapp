// Settings: permission status, quiet hours, backup, pipeline test, about.

import { isNative, notificationsSupported, LocalNotifications, App, Filesystem, Share } from '../native.js';
import { settings, updateSettings } from '../model.js';
import { exportJSON, importJSON } from '../store.js';
import { ensurePermission, permissionStatus, reconcile } from '../reminders.js';
import { webPushSupported, sendTestPush } from '../webpush.js';
import { FAMILIES, THEMES, getTheme, applyTheme } from '../themes.js';
import { toast, confirmSheet, esc } from './components.js';

// iPadOS reports a desktop Mac UA but exposes touch points — catch both.
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

export async function renderSettings(view, rerender) {
  const s = settings();

  view.innerHTML = `
    <h1 class="screen-title">Settings</h1>

    <div class="section-label">Notifications</div>
    <div class="card">
      <div class="row">
        <div><div class="label">Platform</div><div class="sub">${isNative ? 'Android app' : webPushSupported ? 'Web Push reminders enabled' : isIOS ? 'iPhone/iPad — add Focus to your Home Screen (Safari: Share → Add to Home Screen) to enable reminders' : 'Web preview — reminders need the installed app'}</div></div>
        <span class="status-pill ${isNative || webPushSupported ? 'ok' : 'bad'}">${isNative ? 'native' : webPushSupported ? 'push' : 'web'}</span>
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
      ${!isNative ? `
      <div class="row">
        <div class="sub">🔇 No sound? Your iPhone decides that, not the app: Settings → Notifications → Focus → turn on <b>Sounds</b>. Silent-mode switch and Focus/Do-Not-Disturb also mute it.</div>
      </div>` : ''}
    </div>

    <div class="section-label">Appearance</div>
    <div class="card">
      <div class="row" style="border-bottom:none; padding-bottom:8px">
        <div>
          <div class="label">Theme</div>
          <div class="sub" id="theme-blurb">${esc(FAMILIES.find(f => f.id === getTheme(s.theme).family)?.blurb || '')}</div>
        </div>
      </div>
      <div class="task-meta" id="theme-families" style="padding:0 2px 10px">
        ${FAMILIES.map(f => `<button class="chip picker-chip ${getTheme(s.theme).family === f.id ? 'chip-active' : ''}" data-family="${f.id}">${esc(f.name)}</button>`).join('')}
      </div>
      <div id="theme-variants" style="padding:0 2px 12px"></div>
    </div>

    <div class="section-label">Focus</div>
    <div class="card">
      <div class="row">
        <div><div class="label">Focus list size</div><div class="sub">Max tasks “Your focus” picks for you</div></div>
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
      ${isNative ? `
      <div class="row">
        <div style="flex:1"><div class="label">App version</div><div class="sub" id="update-sub">Check for the latest version</div></div>
        <button class="btn small" id="update-btn">Update</button>
      </div>` : ''}
      <div class="row">
        <div class="sub">If nags stop arriving, check that battery optimization is off for Focus (Android Settings → Apps → Focus → Battery → Unrestricted). Some phones (Xiaomi, Huawei…) aggressively kill scheduled alarms.</div>
      </div>
    </div>
  `;

  // permission status rows
  const permPill = view.querySelector('#perm-pill');
  const permSub = view.querySelector('#perm-sub');
  try {
    const status = await permissionStatus();
    permPill.textContent = status;
    permPill.className = 'status-pill ' + (status === 'granted' ? 'ok' : 'bad');
    if (status === 'granted') permSub.textContent = 'Reminders can fire';
    else if (status === 'unsupported' && isIOS) permSub.textContent = 'Reminders need the Home Screen app — in Safari tap Share → Add to Home Screen, then enable here';
    else if (status === 'unsupported') permSub.textContent = 'Install the Android app for reminders';
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

  // theme picker: family chips reveal that family's variants, each chip
  // painted in its own palette so the chip IS the preview; tapping a
  // variant restyles the whole app live and saves the choice
  let shownFamily = getTheme(s.theme).family;
  const famRow = view.querySelector('#theme-families');
  const varRow = view.querySelector('#theme-variants');
  const blurbEl = view.querySelector('#theme-blurb');
  const renderVariants = () => {
    const current = settings().theme;
    blurbEl.textContent = FAMILIES.find(f => f.id === shownFamily)?.blurb || '';
    famRow.querySelectorAll('[data-family]').forEach(b =>
      b.classList.toggle('chip-active', b.dataset.family === shownFamily));
    varRow.innerHTML = THEMES.filter(t => t.family === shownFamily).map(t => `
      <button class="theme-chip ${t.id === current ? 'sel' : ''}" data-theme="${t.id}"
        style="--tc-a:${t.tokens.accent}; background:${t.tokens.bgElev}; color:${t.tokens.text}; border-color:${t.tokens.border}">
        <span class="tc-dot" style="background:${t.tokens.accent}"></span>
        ${esc(t.name)}${t.dark ? '' : ' ☀︎'}
      </button>`).join('');
  };
  renderVariants();
  famRow.addEventListener('click', (e) => {
    const b = e.target.closest('[data-family]');
    if (!b) return;
    shownFamily = b.dataset.family;
    renderVariants();
  });
  varRow.addEventListener('click', (e) => {
    const b = e.target.closest('[data-theme]');
    if (!b) return;
    updateSettings({ theme: b.dataset.theme });
    applyTheme(b.dataset.theme);
    renderVariants();
    toast(`Theme: ${getTheme(b.dataset.theme).name}`);
  });

  // focus limit
  view.querySelector('#focus-limit').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    updateSettings({ focusLimit: parseInt(btn.dataset.v, 10) });
    rerender();
  });

  // test nag
  view.querySelector('#test-nag').addEventListener('click', async () => {
    if (notificationsSupported) {
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
      return;
    }
    if (webPushSupported) {
      if (!(await ensurePermission())) { toast('Permission denied — enable notifications in Settings'); return; }
      const ok = await sendTestPush();
      toast(ok ? 'Scheduled! Close the app and wait 2 min' : 'Could not reach the push server');
      return;
    }
    if (isIOS) { toast('Add Focus to your Home Screen first — Share → Add to Home Screen'); return; }
    toast('Notifications need the installed Android app');
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
  let installedBuild = null;
  try {
    const info = await App.getInfo();
    installedBuild = parseInt(info.build, 10);
    view.querySelector('#build-sub').textContent = `v${info.version} (build ${info.build})`;
  } catch {
    view.querySelector('#build-sub').textContent = 'web preview';
  }

  // Update button (APK only): the sideloaded app can't self-update, so this
  // checks the rolling release and, when a newer build exists, opens the
  // download page. build number == the APK workflow's run number.
  const RELEASES = 'https://github.com/FunkeePanda/Claude_taskapp/releases/latest';
  const updateBtn = view.querySelector('#update-btn');
  if (updateBtn) {
    const updateSub = view.querySelector('#update-sub');
    updateBtn.addEventListener('click', async () => {
      updateBtn.disabled = true;
      updateSub.textContent = 'Checking…';
      try {
        const resp = await fetch('https://api.github.com/repos/FunkeePanda/Claude_taskapp/releases/latest');
        if (!resp.ok) throw new Error('offline');
        const rel = await resp.json();
        const latest = parseInt(/1\.0\.(\d+)/.exec(rel.name || '')?.[1], 10);
        if (Number.isNaN(latest) || installedBuild == null || latest > installedBuild) {
          // newer build (or can't tell) → send them to the download
          updateSub.textContent = Number.isNaN(latest) ? 'Opening downloads…' : `v1.0.${latest} available — opening…`;
          window.open(RELEASES, '_blank');
        } else {
          updateSub.textContent = 'You’re on the latest version ✓';
        }
      } catch {
        // no network to check — just take them to the page anyway
        updateSub.textContent = 'Opening downloads…';
        window.open(RELEASES, '_blank');
      } finally {
        updateBtn.disabled = false;
      }
    });
  }
}
