/**
 * syncCrypto.ts — locks the data travelling between the phone and the desktop
 * (sync step 2), phone side. Mirrors src/server/syncCrypto.js exactly.
 *
 * The key arrives only inside the QR code (or the pairing code typed by hand)
 * and is stored on the phone with the other pairing details. It is never sent
 * over the network, so another device on the same Wi-Fi cannot read anything,
 * and a changed message fails to unlock instead of being applied.
 *
 * Wire format: { enc: "v1", iv: "<base64>", ct: "<base64 ciphertext+tag>" }
 */

export interface SyncEnvelope {
  enc: 'v1';
  iv: string;
  ct: string;
}

const KEY_BYTES = 32;
const IV_BYTES = 12;

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000; // avoid "too many arguments" on large payloads
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return btoa(bin);
}

/** URL-safe key text (as produced on the desktop) -> raw bytes. */
function keyTextToBytes(keyText: string): Uint8Array | null {
  if (typeof keyText !== 'string' || keyText.length === 0) return null;
  try {
    let b64 = keyText.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4 !== 0) b64 += '=';
    const bytes = base64ToBytes(b64);
    return bytes.length === KEY_BYTES ? bytes : null;
  } catch {
    return null;
  }
}

/** True if this text could be a valid key (used to validate a scanned code). */
export function isValidKeyText(keyText: string): boolean {
  return keyTextToBytes(keyText) !== null;
}

const keyCache = new Map<string, Promise<CryptoKey>>();

function getCryptoKey(keyText: string): Promise<CryptoKey> {
  let cached = keyCache.get(keyText);
  if (!cached) {
    const bytes = keyTextToBytes(keyText);
    if (!bytes) return Promise.reject(new Error('Invalid sync key'));
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) return Promise.reject(new Error('This device cannot lock sync data (no secure crypto available)'));
    cached = subtle.importKey('raw', bytes as unknown as BufferSource, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    keyCache.set(keyText, cached);
  }
  return cached;
}

/** True when this device can lock/unlock sync data at all. */
export function isCryptoAvailable(): boolean {
  return Boolean(globalThis.crypto?.subtle && globalThis.crypto?.getRandomValues);
}

/** Lock one message. */
export async function encryptJson(keyText: string, obj: unknown): Promise<SyncEnvelope> {
  const key = await getCryptoKey(keyText);
  const iv = new Uint8Array(IV_BYTES);
  globalThis.crypto.getRandomValues(iv);
  const plain = new TextEncoder().encode(JSON.stringify(obj));
  const ct = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    plain as unknown as BufferSource
  );
  return { enc: 'v1', iv: bytesToBase64(iv), ct: bytesToBase64(new Uint8Array(ct)) };
}

/** Unlock one message. Rejects if the key is wrong or the message was altered. */
export async function decryptJson(keyText: string, envelope: SyncEnvelope): Promise<any> {
  if (!isEnvelope(envelope)) throw new Error('Not a locked message');
  const key = await getCryptoKey(keyText);
  const iv = base64ToBytes(envelope.iv);
  const ct = base64ToBytes(envelope.ct);
  const plain = await globalThis.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    ct as unknown as BufferSource
  );
  return JSON.parse(new TextDecoder().decode(plain));
}

export function isEnvelope(obj: any): obj is SyncEnvelope {
  return Boolean(obj) && obj.enc === 'v1' && typeof obj.iv === 'string' && typeof obj.ct === 'string';
}

/**
 * The pairing code shown on the desktop and typed on the phone carries both
 * parts as "<token>.<key>". Splitting is done here so both screens agree.
 */
export function splitPairingCode(code: string): { token: string; key: string } {
  const trimmed = (code || '').trim();
  const dot = trimmed.lastIndexOf('.');
  if (dot <= 0 || dot === trimmed.length - 1) return { token: trimmed, key: '' };
  return { token: trimmed.slice(0, dot), key: trimmed.slice(dot + 1) };
}

export function joinPairingCode(token: string, key: string): string {
  return key ? `${token}.${key}` : token;
}
