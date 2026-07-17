import { test } from 'node:test';
import assert from 'node:assert/strict';

// localStorage shim, same pattern as model.test.js — deviceId() persists there.
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};

const { webPushSupported, deviceId, urlBase64ToUint8Array } = await import('../www/js/webpush.js');

test('webPushSupported is false outside a browser (no serviceWorker/PushManager)', () => {
  assert.equal(webPushSupported, false);
});

test('deviceId is generated once and cached across calls', () => {
  const a = deviceId();
  const b = deviceId();
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f-]{36}$/);
});

test('urlBase64ToUint8Array decodes a standard VAPID public key', () => {
  // "hello" base64url-encoded, no padding — mirrors how VAPID keys arrive
  const out = urlBase64ToUint8Array('aGVsbG8');
  assert.deepEqual([...out], [...Buffer.from('hello')]);
});

test('urlBase64ToUint8Array handles -/_ url-safe characters', () => {
  const raw = Buffer.from([0xfb, 0xff, 0xbe]);
  const urlSafe = raw.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const out = urlBase64ToUint8Array(urlSafe);
  assert.deepEqual([...out], [...raw]);
});
