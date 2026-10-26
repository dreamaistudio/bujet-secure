/**
 * relayClient.js — the desktop's side of the internet post box (sync step 3).
 *
 * When the phone is not on the same Wi-Fi, or is asleep, changes cannot be
 * handed over directly. Instead the desktop drops them, already locked, into a
 * post box on the internet, and the phone picks them up whenever it next has a
 * connection — and the other way round.
 *
 * The post box never receives the key, so it cannot read anything it holds.
 * Even the name of the box and the password used to open it are worked out
 * from that key, so only the two paired devices can find or open it.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const syncCrypto = require('./syncCrypto');

const DEFAULT_TIMEOUT_MS = 12000;

/** Where this install's post box lives. Empty means "no post box set up". */
function readRelayUrl(userDataPath) {
  // A file beside the database wins, so the address can be changed without
  // rebuilding the app; otherwise the address built into this version is used.
  try {
    const p = path.join(userDataPath, 'sync_relay.txt');
    if (fs.existsSync(p)) {
      const text = fs.readFileSync(p, 'utf8').trim();
      if (text) return normalizeUrl(text);
    }
  } catch {}
  try {
    return normalizeUrl(require('./relayConfig').RELAY_URL || '');
  } catch {
    return '';
  }
}

function normalizeUrl(url) {
  if (typeof url !== 'string') return '';
  const trimmed = url.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  if (!/^https:\/\//i.test(trimmed)) return ''; // only secure addresses
  return trimmed;
}

/** The box's name: worked out from the pairing key, unguessable without it. */
function deriveBoxId(keyText) {
  const keyBuf = syncCrypto.keyToBuffer(keyText);
  if (!keyBuf) return '';
  return crypto.createHmac('sha256', keyBuf).update('budget-secure-box-id').digest('hex');
}

/** The box's password: a different value from the same key. */
function deriveBoxAuth(keyText) {
  const keyBuf = syncCrypto.keyToBuffer(keyText);
  if (!keyBuf) return '';
  return crypto.createHmac('sha256', keyBuf).update('budget-secure-box-auth').digest('hex');
}

async function request(relayUrl, keyText, method, action, { query, body } = {}) {
  const boxId = deriveBoxId(keyText);
  const auth = deriveBoxAuth(keyText);
  if (!relayUrl || !boxId || !auth) throw new Error('Post box is not set up');

  const url = new URL(`${relayUrl}/v1/box/${boxId}/${action}`);
  for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, String(v));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      method,
      headers: {
        authorization: `Bearer ${auth}`,
        ...(body ? { 'content-type': 'application/json' } : {})
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });
    const text = await res.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch {}
    if (!res.ok) {
      const err = new Error(`Post box replied ${res.status}`);
      err.status = res.status;
      err.body = parsed;
      throw err;
    }
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

/** Lock each message and leave them in the box for the phone. */
async function pushToPhone(relayUrl, keyText, messages) {
  if (!Array.isArray(messages) || messages.length === 0) return null;
  const keyBuf = syncCrypto.keyToBuffer(keyText);
  if (!keyBuf) throw new Error('No key, cannot use the post box');
  const items = messages.map((m) => ({ blob: JSON.stringify(syncCrypto.encryptJson(keyBuf, m)) }));
  return request(relayUrl, keyText, 'POST', 'push', { body: { lane: 'toPhone', items } });
}

/**
 * Collect what the phone left. Returns { messages, upto, gap } with anything
 * unreadable skipped rather than stopping the whole batch.
 */
async function pullFromPhone(relayUrl, keyText, since) {
  const keyBuf = syncCrypto.keyToBuffer(keyText);
  if (!keyBuf) throw new Error('No key, cannot use the post box');
  const res = await request(relayUrl, keyText, 'GET', 'pull', {
    query: { lane: 'toPc', since: since || 0, limit: 200 }
  });
  const messages = [];
  let upto = Number(since) || 0;
  for (const item of res?.items || []) {
    upto = item.seq;
    try {
      messages.push(syncCrypto.decryptJson(keyBuf, JSON.parse(item.blob)));
    } catch (err) {
      console.warn('[Relay] Skipped an unreadable item from the post box:', err.message);
    }
  }
  return { messages, upto, gap: Boolean(res?.gap), lastInBox: Number(res?.upto) || 0 };
}

/** Tell the box everything up to `upto` has been stored, so it can be removed. */
async function ackPhoneLane(relayUrl, keyText, upto) {
  if (!upto) return null;
  return request(relayUrl, keyText, 'POST', 'ack', { body: { lane: 'toPc', upto } });
}

/** Empty the box completely (used when the user unpairs). */
async function destroyBox(relayUrl, keyText) {
  return request(relayUrl, keyText, 'POST', 'destroy', { body: {} });
}

async function ping(relayUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(`${normalizeUrl(relayUrl)}/v1/ping`, { signal: controller.signal });
    if (!res.ok) return false;
    const data = await res.json();
    return data && data.app === 'budget-secure-relay';
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  readRelayUrl,
  normalizeUrl,
  deriveBoxId,
  deriveBoxAuth,
  pushToPhone,
  pullFromPhone,
  ackPhoneLane,
  destroyBox,
  ping
};
