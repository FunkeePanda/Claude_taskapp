// Web Push client — the iOS path. Kept separate from native.js so that
// file's Capacitor-vs-mock split doesn't grow a third, unrelated concern.
//
// No accounts: each device gets a random id, cached in localStorage, that
// scopes it on the Worker backend (see worker/src/index.js). The pure
// planning functions in reminders.js (occurrencesFor/planAll/
// sessionNotifications) are reused unchanged — this module only differs
// in where the computed schedule ends up.

// Filled in during Phase B once the Worker is deployed. Until then,
// webPushSupported is false and every other export in this file is inert.
const WORKER_URL = '';
const VAPID_PUBLIC_KEY = '';

export const webPushSupported = !!(
  WORKER_URL && VAPID_PUBLIC_KEY &&
  typeof navigator !== 'undefined' && 'serviceWorker' in navigator &&
  typeof window !== 'undefined' && 'PushManager' in window
);

export function deviceId() {
  const key = 'focus.deviceId';
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}

// Push subscriptions need the VAPID public key as a raw Uint8Array, but
// browsers only accept it base64url-encoded.
export function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const base64Safe = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64Safe);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

let swRegistration = null;

export async function registerServiceWorker() {
  if (!webPushSupported) return null;
  if (swRegistration) return swRegistration;
  swRegistration = await navigator.serviceWorker.register('sw.js');
  return swRegistration;
}

export async function webPushPermission() {
  if (!webPushSupported) return 'unsupported';
  return Notification.permission; // 'granted' | 'denied' | 'default'
}

// Must be called from a user gesture (button click) — Notification
// permission prompts are blocked otherwise on iOS Safari.
export async function ensureWebPushSubscription() {
  if (!webPushSupported) return false;
  const reg = await registerServiceWorker();
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return false;

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }

  const resp = await fetch(WORKER_URL + '/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId: deviceId(), subscription: sub.toJSON() }),
  });
  return resp.ok;
}

// Idempotent replace: hand the Worker this device's full computed
// schedule; it wipes and reinserts, same shape as reconcile() does for
// Capacitor's local alarms.
export async function syncWebPush(notifications) {
  if (!webPushSupported) return false;
  const resp = await fetch(WORKER_URL + '/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId: deviceId(), notifications }),
  });
  return resp.ok;
}

export async function unsubscribeWebPush() {
  if (!webPushSupported) return false;
  const reg = await registerServiceWorker();
  const sub = await reg.pushManager.getSubscription();
  if (sub) await sub.unsubscribe();
  const resp = await fetch(WORKER_URL + '/unsubscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId: deviceId() }),
  });
  return resp.ok;
}

export async function sendTestPush() {
  if (!webPushSupported) return false;
  const resp = await fetch(WORKER_URL + '/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId: deviceId() }),
  });
  return resp.ok;
}
