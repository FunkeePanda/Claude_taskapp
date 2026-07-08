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

import { buildPushHTTPRequest } from '@pushforge/builder';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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
      return json({ error: 'not found' }, 404);
    } catch (err) {
      return json({ error: String(err && err.message || err) }, 500);
    }
  },

  // Runs every minute (see wrangler.toml). Sends anything due and clears
  // it — best-effort, single attempt per firing; the client resyncs a
  // fresh window on its next reconcile() regardless.
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

    const deadDevices = new Set();
    const sent = [];

    for (const row of rows) {
      let subscription;
      try { subscription = JSON.parse(row.subscription); } catch { continue; }
      try {
        const { endpoint, headers, body } = await buildPushHTTPRequest({
          privateJWK: JSON.parse(env.VAPID_PRIVATE_KEY),
          subscription,
          message: {
            payload: { title: row.title, body: row.body, nid: row.nid },
            adminContact: 'mailto:focus-app@example.com',
            options: { ttl: 3600, urgency: 'high' },
          },
        });
        const resp = await fetch(endpoint, { method: 'POST', headers, body });
        if (resp.status === 410 || resp.status === 404) {
          deadDevices.add(row.device_id);
        }
      } catch {
        // network/build failure on this attempt — fall through and clear
        // the row anyway (see note below)
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
    if (stmts.length) await env.DB.batch(stmts);
  },
};

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
