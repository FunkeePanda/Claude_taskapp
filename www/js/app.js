// Focus — bootstrap: router, FAB, notification lifecycle.

import { App } from './native.js';
import { onChange } from './store.js';
import { initNotifications, reconcile } from './reminders.js';
import { renderToday } from './ui/today.js';
import { renderTasks } from './ui/tasks.js';
import { renderSettings } from './ui/settings.js';
import { openAddSheet } from './ui/editor.js';
import { toast } from './ui/components.js';

const view = document.getElementById('view');
const tabbar = document.getElementById('tabbar');
const fab = document.getElementById('fab');

const routes = { today: renderToday, tasks: renderTasks, settings: renderSettings };

function currentRoute() {
  const r = location.hash.replace('#', '');
  return routes[r] ? r : 'today';
}

function rerender() {
  routes[currentRoute()](view, rerender);
}

function navigate() {
  const route = currentRoute();
  for (const t of tabbar.querySelectorAll('.tab')) {
    t.classList.toggle('active', t.dataset.route === route);
  }
  view.classList.remove('entering');
  void view.offsetWidth; // restart the entry animation
  view.classList.add('entering');
  rerender();
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

// Reconcile on every resume: refills the rolling reminder window.
App.addListener('resume', () => reconcile());
reconcile();

navigate();
