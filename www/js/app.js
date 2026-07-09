// Focus — bootstrap: router, FAB, notification lifecycle.

import { App, isNative } from './native.js';
import { onChange } from './store.js';
import { initNotifications, reconcile } from './reminders.js';
import { webPushSupported, registerServiceWorker } from './webpush.js';
import { renderToday } from './ui/today.js';
import { renderTasks } from './ui/tasks.js';
import { renderCalendar } from './ui/calendar.js';
import { renderSettings } from './ui/settings.js';
import { openAddSheet } from './ui/editor.js';
import { toast } from './ui/components.js';

const view = document.getElementById('view');
const tabbar = document.getElementById('tabbar');
const fab = document.getElementById('fab');

const routes = { today: renderToday, tasks: renderTasks, calendar: renderCalendar, settings: renderSettings };

function currentRoute() {
  const r = location.hash.replace('#', '');
  return routes[r] ? r : 'today';
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

// iOS has no local background alarms — Web Push needs a service worker
// registered up front so a subscription can be created later.
if (!isNative && webPushSupported) registerServiceWorker();

reconcile();

navigate();
