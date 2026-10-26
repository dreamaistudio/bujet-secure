/**
 * relayClient.ts — the phone's side of the internet post box (sync step 3).
 * Mirrors src/server/relayClient.js exactly.
 *
 * When the phone is not on the same Wi-Fi as the PC, or the PC is asleep,
 * changes are dropped into a post box on the internet and collected by the
 * other device whenever it next has a connection.
 *
 * Everything is locked with the pairing key before it leaves the phone, and
 * the post box never sees that key: even the box's name and password are
 * worked out from it, so only the two paired devices can find or open the box.
 */
import { encryptJson, decryptJson } from './syncCrypto';

const TIMEOUT_MS = 12000;

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}

function keyTextToBytes(keyText: string): Uint8Array | null {
  try {
    let b64 = keyText.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4 !== 0) b64 += '=';
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.length === 32 ? out : null;
  } catch {
    return null;
  }
}

const hmacCache = new Map<string, Promise<string>>();

async function derive(keyText: string, label: string): Promise<string> {
  const cacheKey = `${keyText}|${label}`;
  let cached = hmacCache.get(cacheKey);
  if (!cached) {
    cached = (async () => {
      const bytes = keyTextToBytes(keyText);
      if (!bytes) throw new Error('Invalid sync key');
      const key = await globalThis.crypto.subtle.importKey(
        'raw',
        bytes as unknown as BufferSource,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      );
      const sig = await globalThis.crypto.subtle.sign(
        'HMAC',
        key,
        new TextEncoder().encode(label) as unknown as BufferSource
      );
      return bytesToHex(new Uint8Array(sig));
    })();
    hmacCache.set(cacheKey, cached);
  }
  return cached;
}

/** The box's name: unguessable without the pairing key. */
export function deriveBoxId(keyText: string): Promise<string> {
  return derive(keyText, 'budget-secure-box-id');
}

/** The box's password: a different value from the same key. */
export function deriveBoxAuth(keyText: string): Promise<string> {
  return derive(keyText, 'budget-secure-box-auth');
}

export function normalizeRelayUrl(url: unknown): string {
  if (typeof url !== 'string') return '';
  const trimmed = url.trim().replace(/\/+$/, '');
  if (!trimmed || !/^https:\/\//i.test(trimmed)) return ''; // only secure addresses
  return trimmed;
}

/**
 * Where this build's post box lives, mirroring src/server/relayConfig.js.
 *
 * A pairing normally carries the PC's own address, taken from the QR code,
 * and that one always wins. This is the fallback for a pairing that arrives
 * without one - a code typed in by hand, which has nowhere to put an address,
 * or a QR code made by an older PC build. Both devices work the box's name
 * out from the pairing key alone, so as long as they agree on the address
 * they meet in the same box.
 */
const DEFAULT_RELAY_URL = 'https://budget-secure-relay.dreamaistudio.workers.dev';

export function defaultRelayUrl(): string {
  return normalizeRelayUrl(DEFAULT_RELAY_URL);
}

async function request(
  relayUrl: string,
  keyText: string,
  method: 'GET' | 'POST',
  action: string,
  opts: { query?: Record<string, string | number>; body?: any } = {}
): Promise<any> {
  const [boxId, auth] = await Promise.all([deriveBoxId(keyText), deriveBoxAuth(keyText)]);
  if (!relayUrl || !boxId || !auth) throw new Error('Post box is not set up');

  const url = new URL(`${relayUrl}/v1/box/${boxId}/${action}`);
  for (const [k, v] of Object.entries(opts.query || {})) url.searchParams.set(k, String(v));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      method,
      headers: {
        authorization: `Bearer ${auth}`,
        ...(opts.body ? { 'content-type': 'application/json' } : {})
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal
    });
    const text = await res.text();
    let parsed: any = null;
    try { parsed = text ? JSON.parse(text) : null; } catch {}
    if (!res.ok) {
      const err: any = new Error(`Post box replied ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

/** Lock these messages and leave them in the box for the PC. */
export async function pushToPc(relayUrl: string, keyText: string, messages: any[]): Promise<void> {
  if (!Array.isArray(messages) || messages.length === 0) return;
  const items = [];
  for (const m of messages) {
    items.push({ blob: JSON.stringify(await encryptJson(keyText, m)) });
  }
  await request(relayUrl, keyText, 'POST', 'push', { body: { lane: 'toPc', items } });
}

export interface RelayPullResult {
  messages: any[];
  upto: number;
  gap: boolean;
  /** The newest item number in the box, so the caller knows if more is waiting. */
  lastInBox: number;
}

/** Collect what the PC left. Unreadable items are skipped, not fatal. */
export async function pullFromPc(relayUrl: string, keyText: string, since: number): Promise<RelayPullResult> {
  const res = await request(relayUrl, keyText, 'GET', 'pull', {
    query: { lane: 'toPhone', since: since || 0, limit: 200 }
  });
  const messages: any[] = [];
  let upto = Number(since) || 0;
  for (const item of res?.items || []) {
    upto = item.seq;
    try {
      messages.push(await decryptJson(keyText, JSON.parse(item.blob)));
    } catch {
      // A single bad item must not stop the rest from arriving.
    }
  }
  return { messages, upto, gap: Boolean(res?.gap), lastInBox: Number(res?.upto) || 0 };
}

/** Tell the box everything up to `upto` is stored here, so it can be removed. */
export async function ackPcLane(relayUrl: string, keyText: string, upto: number): Promise<void> {
  if (!upto) return;
  await request(relayUrl, keyText, 'POST', 'ack', { body: { lane: 'toPhone', upto } });
}

export async function relayReachable(relayUrl: string): Promise<boolean> {
  const url = normalizeRelayUrl(relayUrl);
  if (!url) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${url}/v1/ping`, { signal: controller.signal });
    if (!res.ok) return false;
    const data = await res.json();
    return Boolean(data && data.app === 'budget-secure-relay');
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
