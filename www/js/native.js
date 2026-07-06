// Capacitor shim: real plugins on-device, safe mocks in a plain browser
// (GitHub Pages preview / Playwright). Everything except notifications
// works identically in both worlds.

const cap = typeof window !== 'undefined' ? window.Capacitor : undefined;
export const isNative = !!(cap && cap.isNativePlatform && cap.isNativePlatform());

function plugin(name) {
  return isNative && cap.Plugins && cap.Plugins[name] ? cap.Plugins[name] : null;
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
export const LocalNotifications = plugin('LocalNotifications') || lnMock;
export const notificationsSupported = !!plugin('LocalNotifications');

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
export const App = plugin('App') || appMock;

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
export const Filesystem = plugin('Filesystem') || fsMock;

const shareMock = {
  async share(opts) {
    if (navigator.share) return navigator.share({ title: opts.title, text: opts.text });
    console.info('[mock] share', opts);
  },
};
export const Share = plugin('Share') || shareMock;
