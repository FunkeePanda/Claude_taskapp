// Focus — bootstrap + hash router.
import { isNative, notificationsSupported, LocalNotifications, App } from './native.js';

const view = document.getElementById('view');
const tabbar = document.getElementById('tabbar');
const fab = document.getElementById('fab');

const routes = { today: renderToday, tasks: renderTasks, settings: renderSettings };

function currentRoute() {
  const r = location.hash.replace('#', '');
  return routes[r] ? r : 'today';
}

function navigate() {
  const route = currentRoute();
  for (const t of tabbar.querySelectorAll('.tab')) {
    t.classList.toggle('active', t.dataset.route === route);
  }
  view.classList.remove('entering');
  void view.offsetWidth; // restart animation
  view.classList.add('entering');
  routes[route]();
}

tabbar.addEventListener('click', (e) => {
  const tab = e.target.closest('.tab');
  if (tab) location.hash = tab.dataset.route;
});
window.addEventListener('hashchange', navigate);

// ---------- Views (milestone-1 skeleton) ----------

function renderToday() {
  const now = new Date();
  const greet = now.getHours() < 12 ? 'Good morning' : now.getHours() < 18 ? 'Good afternoon' : 'Good evening';
  view.innerHTML = `
    <h1 class="screen-title">${greet} 👋</h1>
    <p class="screen-sub">${now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</p>
    <div class="empty">
      <div class="big">🚧</div>
      <p><strong>Pipeline validation build.</strong><br>
      Task features are on the way — first, let's prove notifications work.<br>
      Head to <strong>Settings</strong> and tap “Test nag in 2 minutes”.</p>
    </div>
  `;
}

function renderTasks() {
  view.innerHTML = `
    <h1 class="screen-title">Tasks</h1>
    <div class="empty">
      <div class="big">📋</div>
      <p>Task list coming in the next build.</p>
    </div>
  `;
}

async function renderSettings() {
  view.innerHTML = `
    <h1 class="screen-title">Settings</h1>
    <div class="card" style="margin-top:16px">
      <div class="row">
        <div><div class="label">Platform</div><div class="sub">${isNative ? 'Android app' : 'Web preview (notifications unavailable)'}</div></div>
        <span class="status-pill ${isNative ? 'ok' : 'bad'}">${isNative ? 'native' : 'web'}</span>
      </div>
      <div class="row">
        <div><div class="label">Notification permission</div><div class="sub" id="perm-sub">checking…</div></div>
        <span class="status-pill bad" id="perm-pill">…</span>
      </div>
      <div class="row">
        <div><div class="label">Build</div><div class="sub" id="build-sub">…</div></div>
      </div>
    </div>
    <div class="card">
      <div class="label" style="margin-bottom:6px">Notification pipeline test</div>
      <div class="sub" style="margin-bottom:12px">Schedules a notification 2 minutes from now. Tap it, then <strong>swipe the app away</strong> — the notification should still arrive.</div>
      <button class="btn block" id="test-nag">🔔 Test nag in 2 minutes</button>
    </div>
  `;

  const permPill = document.getElementById('perm-pill');
  const permSub = document.getElementById('perm-sub');
  try {
    const { display } = await LocalNotifications.checkPermissions();
    permPill.textContent = display;
    permPill.className = 'status-pill ' + (display === 'granted' ? 'ok' : 'bad');
    permSub.textContent = display === 'granted' ? 'Reminders can fire' :
      notificationsSupported ? 'Will be requested on first use' : 'Install the Android app for reminders';
  } catch (e) {
    permSub.textContent = 'error: ' + e.message;
  }

  try {
    const info = await App.getInfo();
    document.getElementById('build-sub').textContent = `v${info.version} (build ${info.build})`;
  } catch {
    document.getElementById('build-sub').textContent = 'web preview';
  }

  document.getElementById('test-nag').addEventListener('click', testNag);
}

async function testNag() {
  if (!notificationsSupported) {
    toast('Notifications need the installed Android app');
    return;
  }
  let { display } = await LocalNotifications.checkPermissions();
  if (display !== 'granted') {
    ({ display } = await LocalNotifications.requestPermissions());
  }
  if (display !== 'granted') {
    toast('Permission denied — enable notifications in system settings');
    return;
  }
  await LocalNotifications.createChannel({
    id: 'reminders',
    name: 'Task reminders',
    description: 'Nagging reminders for tasks',
    importance: 5,
    visibility: 1,
    vibration: true,
  });
  await LocalNotifications.schedule({
    notifications: [{
      id: 999001,
      channelId: 'reminders',
      title: '🎉 The pipeline works!',
      body: 'This notification fired with the app closed. Reminders are a go.',
      schedule: { at: new Date(Date.now() + 2 * 60 * 1000), allowWhileIdle: true },
    }],
  });
  toast('Scheduled! Now swipe the app away and wait 2 min');
}

// ---------- Toast ----------
let toastTimer;
export function toast(msg) {
  const root = document.getElementById('toast-root');
  root.innerHTML = `<div class="toast">${msg}</div>`;
  const el = root.firstElementChild;
  requestAnimationFrame(() => el.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

fab.addEventListener('click', () => toast('Task creation lands in the next build ✨'));

navigate();
