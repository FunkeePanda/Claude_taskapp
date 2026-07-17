// Focus — bootstrap: router, FAB, notification lifecycle.

import { App, isNative } from './native.js';
import { onChange } from './store.js';
import { settings } from './model.js';
import { applyTheme } from './themes.js';
import { initNotifications, reconcile } from './reminders.js';
import { webPushSupported, registerServiceWorker } from './webpush.js';
import { renderTasks } from './ui/tasks.js';
import { renderCalendar } from './ui/calendar.js';
import { renderSettings } from './ui/settings.js';
import { openAddSheet } from './ui/editor.js';
import { toast } from './ui/components.js';

const view = document.getElementById('view');
const tabbar = document.getElementById('tabbar');
const fab = document.getElementById('fab');

const routes = { tasks: renderTasks, calendar: renderCalendar, settings: renderSettings };

function currentRoute() {
  const r = location.hash.replace('#', '');
  return routes[r] ? r : 'tasks'; // legacy '#today' bookmarks land here too
}

// Re-render the current view WITHOUT the app feeling like it reset:
// scroll position and open <details> sections survive, and entry
// animations don't replay (those belong to navigation only).
function rerender() {
  const scrollY = window.scrollY;
  const openDetails = [...view.querySelectorAll('details')].map(d => d.open);
  routes[currentRoute()](view, rerender);
  const details = [...view.querySelectorAll('details')];
  openDetails.forEach((open, i) => { if (details[i]) details[i].open = open; });
  window.scrollTo(0, scrollY);
}

let enteringTimer;
function navigate() {
  const route = currentRoute();
  for (const t of tabbar.querySelectorAll('.tab')) {
    t.classList.toggle('active', t.dataset.route === route);
  }
  view.classList.remove('entering');
  void view.offsetWidth; // restart the entry animation
  view.classList.add('entering');
  clearTimeout(enteringTimer);
  enteringTimer = setTimeout(() => view.classList.remove('entering'), 500);
  routes[route](view, rerender);
  window.scrollTo(0, 0);
}

tabbar.addEventListener('click', (e) => {
  const tab = e.target.closest('.tab');
  if (!tab) return;
  if (currentRoute() === tab.dataset.route) rerender();
  else location.hash = tab.dataset.route;
});
window.addEventListener('hashchange', navigate);

fab.addEventListener('click', () => openAddSheet(rerender));

// Any data change → resync Android's pending alarms (debounced by save()).
let reconcileQueued = false;
onChange(() => {
  if (reconcileQueued) return;
  reconcileQueued = true;
  setTimeout(async () => {
    reconcileQueued = false;
    await reconcile();
  }, 400);
});

// Notification actions (✓ Done / Snooze from the lockscreen) land here.
initNotifications((actionId, taskId) => {
  if (actionId === 'done') toast('Task completed ✓');
  if (actionId === 'snooze') toast('Snoozed for 1 hour');
  rerender();
});

// Keep the live chips (session countdown, next-nag minutes) current.
// Paused while a sheet is open so a re-render never eats an edit.
setInterval(() => {
  if (document.querySelector('#sheet-root .sheet')) return;
  rerender();
}, 30 * 1000);

// Reconcile on every resume: refills the rolling reminder window.
App.addListener('resume', () => reconcile());

// iOS home-screen apps love to keep running stale code for days. Poll the
// deploy's version stamp on launch and every resume; when a new build is
// live, reload once so fixes actually reach the phone. (Web only — the
// Android app ships its own bundled copy.)
let runningBuild = null;
async function checkForNewBuild() {
  try {
    const resp = await fetch('version.json', { cache: 'no-store' });
    if (!resp.ok) return; // local dev / no stamp — nothing to compare
    const { build } = await resp.json();
    if (!build) return;
    if (runningBuild == null) runningBuild = build;
    else if (build !== runningBuild) location.reload();
  } catch { /* offline — try again next resume */ }
}
if (!isNative) {
  checkForNewBuild();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkForNewBuild();
  });
}

// The APK can't hot-update, so at least SAY when a newer build exists:
// compare this install's versionCode (the APK workflow's run number)
// against the rolling GitHub release. Once per launch, quiet on failure.
if (isNative) {
  (async () => {
    try {
      const info = await App.getInfo();
      const resp = await fetch('https://api.github.com/repos/FunkeePanda/Claude_taskapp/releases/latest');
      if (!resp.ok) return;
      const rel = await resp.json();
      const m = /1\.0\.(\d+)/.exec(rel.name || '');
      if (m && parseInt(m[1], 10) > parseInt(info.build, 10)) {
        toast(`Update available: v1.0.${m[1]} — you're on v${info.version}`, {
          actionLabel: 'Get it',
          onAction: () => window.open('https://github.com/FunkeePanda/Claude_taskapp/releases/latest', '_blank'),
          duration: 8000,
        });
      }
    } catch { /* offline or rate-limited — try next launch */ }
  })();
}

// iOS has no local background alarms — Web Push needs a service worker
// registered up front so a subscription can be created later.
if (!isNative && webPushSupported) registerServiceWorker();

applyTheme(settings().theme);

reconcile();

navigate();
