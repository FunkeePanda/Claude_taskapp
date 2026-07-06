// Capacitor shim: real plugins on-device, safe mocks in a plain browser
// (GitHub Pages preview / Playwright).
//
// Plugin proxies do NOT exist until registerPlugin() is called — the
// native bridge only injects the transport plus PluginHeaders metadata.
// We vendor @capacitor/core (self-contained ESM) and register each
// plugin here; on the web we hand back mocks instead.

import { Capacitor, registerPlugin } from './vendor/capacitor-core.js';

export const isNative = Capacitor.isNativePlatform();

function nativePlugin(name) {
  if (!isNative) return null;
  try {
    return Capacitor.isPluginAvailable(name) ? registerPlugin(name) : null;
  } catch {
    return null;
  }
}

// ---------- LocalNotifications ----------
const lnMock = {
  async checkPermissions() { return { display: 'denied' }; },
  async requestPermissions() { return { display: 'denied' }; },
  async checkExactNotificationSetting() { return { exact_alarm: 'denied' }; },
  async changeExactNotificationSetting() { return { exact_alarm: 'denied' }; },
  async schedule({ notifications }) {
    console.info('[mock] schedule', notifications.map(n => ({ id: n.id, at: n.schedule?.at })));
    return { notifications: notifications.map(n => ({ id: n.id })) };
  },
  async getPending() { return { notifications: [] }; },
  async cancel({ notifications }) { console.info('[mock] cancel', notifications.map(n => n.id)); },
  async createChannel() {},
  async registerActionTypes() {},
  async addListener() { return { remove() {} }; },
};
const ln = nativePlugin('LocalNotifications');
export const LocalNotifications = ln || lnMock;
export const notificationsSupported = !!ln;

// ---------- App (lifecycle) ----------
const appMock = {
  async addListener(event, cb) {
    if (event === 'resume' && typeof document !== 'undefined') {
      const handler = () => { if (document.visibilityState === 'visible') cb(); };
      document.addEventListener('visibilitychange', handler);
      return { remove() { document.removeEventListener('visibilitychange', handler); } };
    }
    return { remove() {} };
  },
  async getInfo() { return { version: 'web-preview', build: '0' }; },
};
export const App = nativePlugin('App') || appMock;

// ---------- Filesystem + Share (export path) ----------
const fsMock = {
  async writeFile({ path, data }) {
    // Browser fallback: trigger a download instead of writing to app cache.
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = path.split('/').pop();
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return { uri: 'browser-download://' + path };
  },
};
export const Filesystem = nativePlugin('Filesystem') || fsMock;

const shareMock = {
  async share(opts) {
    if (navigator.share) return navigator.share({ title: opts.title, text: opts.text });
    console.info('[mock] share', opts);
  },
};
export const Share = nativePlugin('Share') || shareMock;
