// Focus push backend — Cloudflare Worker.
//
// No accounts: every request is scoped by a random deviceId the client
// generates once and keeps in localStorage. Two jobs:
//   1. HTTP routes so the client can register a push subscription and
//      hand over its computed reminder schedule (POST /subscribe, /sync,
//      /unsubscribe).
//   2. A once-a-minute cron that sends any due notification and clears it.
//
// Mirrors the same idempotent "replace this device's rows" pattern
// www/js/reminders.js already uses for Capacitor's local alarms — /sync
// is just that same reconcile() logic with the OS's alarm table swapped
// for a D1 table.

import { sendPushNotification } from 'web-push-browser';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const MAX_SYNC_ITEMS = 200; // matches the client's own planAll() cap

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const url = new URL(request.url);
    try {
      if (request.method === 'POST' && url.pathname === '/subscribe') {
        return await handleSubscribe(request, env);
      }
      if (request.method === 'POST' && url.pathname === '/sync') {
        return await handleSync(request, env);
      }
      if (request.method === 'POST' && url.pathname === '/unsubscribe') {
        return await handleUnsubscribe(request, env);
      }
      if (request.method === 'POST' && url.pathname === '/test') {
        return await handleTest(request, env);
      }
      if (request.method === 'GET' && url.pathname === '/status') {
        return await handleStatus(env);
      }
      return json({ error: 'not found' }, 404);
    } catch (err) {
      return json({ error: String(err && err.message || err) }, 500);
    }
  },

  // Runs every minute (see wrangler.toml). Sends anything due and clears
  // it — best-effort, single attempt per firing; the client resyncs a
  // fresh window on its next reconcile() regardless. Every attempt's
  // outcome lands in the log table (GET /status) so a failing push
  // service is visible instead of silently swallowed.
  async scheduled(event, env) {
    const now = Date.now();
    const due = await env.DB.prepare(
      `SELECT p.device_id, p.nid, p.title, p.body, s.subscription
       FROM pending p JOIN subscriptions s ON s.device_id = p.device_id
       WHERE p.fire_at <= ?1
       LIMIT 500`
    ).bind(now).all();

    const rows = due.results || [];
    if (!rows.length) return;

    const vapidKeys = await vapidKeysFromJWK(env.VAPID_PRIVATE_KEY);
    const deadDevices = new Set();
    const sent = [];
    const logs = [];

    for (const row of rows) {
      const dev = String(row.device_id).slice(0, 8);
      let subscription;
      try { subscription = JSON.parse(row.subscription); } catch {
        logs.push(['error', `bad subscription JSON dev=${dev}`]);
        continue;
      }
      try {
        const resp = await sendPushNotification(
          vapidKeys,
          subscription,
          'focus-app@example.com',
          JSON.stringify({ title: row.title, body: row.body, nid: row.nid }),
          { algorithm: 'aes128gcm', ttl: 3600, urgency: 'high' },
        );
        logs.push(['send', `dev=${dev} nid=${row.nid} status=${resp.status}`]);
        if (resp.status === 410 || resp.status === 404) {
          deadDevices.add(row.device_id);
        }
      } catch (err) {
        logs.push(['error', `dev=${dev} nid=${row.nid} ${String(err && err.message || err).slice(0, 200)}`]);
      }
      // Single best-effort attempt per firing, success or failure: we
      // deliberately don't retry a specific row next minute, since a
      // permanently-broken subscription would otherwise retry forever.
      // Repeating reminders get a fresh occurrence resynced by the
      // client's next reconcile() regardless, so a single missed send
      // self-heals on its own.
      sent.push([row.device_id, row.nid]);
    }

    const stmts = [];
    for (const [deviceId, nid] of sent) {
      stmts.push(env.DB.prepare('DELETE FROM pending WHERE device_id = ?1 AND nid = ?2').bind(deviceId, nid));
    }
    for (const deviceId of deadDevices) {
      stmts.push(env.DB.prepare('DELETE FROM subscriptions WHERE device_id = ?1').bind(deviceId));
      stmts.push(env.DB.prepare('DELETE FROM pending WHERE device_id = ?1').bind(deviceId));
    }
    for (const [kind, detail] of logs) {
      stmts.push(env.DB.prepare('INSERT INTO log (at, kind, detail) VALUES (?1, ?2, ?3)').bind(now, kind, detail));
    }
    stmts.push(env.DB.prepare('DELETE FROM log WHERE id <= (SELECT COALESCE(MAX(id),0) - 100 FROM log)'));
    if (stmts.length) await env.DB.batch(stmts);
  },
};

// The VAPID private key secret is a JWK (has x, y, d). web-push-browser
// wants a CryptoKeyPair, so import the private key for signing and
// rebuild the public half from the JWK's point coordinates — same key
// pair as the day it was generated, nothing rotates.
let vapidKeysPromise = null;
function vapidKeysFromJWK(jwkString) {
  if (!vapidKeysPromise) {
    vapidKeysPromise = (async () => {
      const jwk = JSON.parse(jwkString);
      const privateKey = await crypto.subtle.importKey(
        'jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
      const { kty, crv, x, y } = jwk;
      const publicKey = await crypto.subtle.importKey(
        'jwk', { kty, crv, x, y }, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']);
      return { privateKey, publicKey };
    })();
  }
  return vapidKeysPromise;
}

// Counts + recent delivery log, no reminder text. Public but harmless —
// it exists so "no notification arrived" is debuggable from outside.
async function handleStatus(env) {
  const [subs, pending, next, recent] = await env.DB.batch([
    env.DB.prepare('SELECT COUNT(*) AS n FROM subscriptions'),
    env.DB.prepare('SELECT COUNT(*) AS n FROM pending'),
    env.DB.prepare('SELECT MIN(fire_at) AS t FROM pending'),
    env.DB.prepare('SELECT at, kind, detail FROM log ORDER BY id DESC LIMIT 20'),
  ]);
  return json({
    now: Date.now(),
    subscriptions: subs.results[0].n,
    pending: pending.results[0].n,
    nextFireAt: next.results[0].t,
    recent: recent.results,
  });
}

async function handleSubscribe(request, env) {
  const { deviceId, subscription } = await request.json();
  if (!deviceId || !subscription) return json({ error: 'deviceId and subscription required' }, 400);

  await env.DB.prepare(
    `INSERT INTO subscriptions (device_id, subscription, updated_at) VALUES (?1, ?2, ?3)
     ON CONFLICT(device_id) DO UPDATE SET subscription = excluded.subscription, updated_at = excluded.updated_at`
  ).bind(deviceId, JSON.stringify(subscription), Date.now()).run();

  return json({ ok: true });
}

async function handleUnsubscribe(request, env) {
  const { deviceId } = await request.json();
  if (!deviceId) return json({ error: 'deviceId required' }, 400);

  await env.DB.batch([
    env.DB.prepare('DELETE FROM subscriptions WHERE device_id = ?1').bind(deviceId),
    env.DB.prepare('DELETE FROM pending WHERE device_id = ?1').bind(deviceId),
  ]);
  return json({ ok: true });
}

// Mirrors Android's "Test notification in 2 minutes" button. Unlike /sync
// this only upserts a single sentinel row (nid 999001, matching the id the
// client already uses for the native test notification) so it doesn't
// clobber a device's real pending reminders.
const TEST_NID = 999001;

async function handleTest(request, env) {
  const { deviceId } = await request.json();
  if (!deviceId) return json({ error: 'deviceId required' }, 400);

  const fireAt = Date.now() + 2 * 60 * 1000;
  await env.DB.prepare(
    `INSERT INTO pending (device_id, nid, fire_at, title, body) VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT(device_id, nid) DO UPDATE SET fire_at = excluded.fire_at`
  ).bind(deviceId, TEST_NID, fireAt, 'Test notification', 'This is what a reminder looks like.').run();

  return json({ ok: true, fireAt });
}

// Idempotent replace: wipe this device's pending rows, insert the fresh
// set the client just computed. Same shape as reconcile()'s
// cancel-then-reschedule strategy for Capacitor's local alarms.
async function handleSync(request, env) {
  const { deviceId, notifications } = await request.json();
  if (!deviceId || !Array.isArray(notifications)) {
    return json({ error: 'deviceId and notifications[] required' }, 400);
  }
  const list = notifications.slice(0, MAX_SYNC_ITEMS);

  const stmts = [env.DB.prepare('DELETE FROM pending WHERE device_id = ?1').bind(deviceId)];
  for (const n of list) {
    if (n.nid == null || n.ts == null || !n.title) continue;
    stmts.push(env.DB.prepare(
      'INSERT INTO pending (device_id, nid, fire_at, title, body) VALUES (?1, ?2, ?3, ?4, ?5)'
    ).bind(deviceId, n.nid, n.ts, n.title, n.body || ''));
  }
  await env.DB.batch(stmts);

  return json({ ok: true, count: list.length });
}
