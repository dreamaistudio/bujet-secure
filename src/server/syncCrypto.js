/**
 * syncCrypto.js — locks the data travelling between the desktop and a phone
 * (sync step 2), desktop side.
 *
 * Everything sent over the Wi-Fi link is encrypted with AES-256-GCM using a
 * secret key that only the two devices know. The key is created on the desktop
 * and reaches the phone ONLY inside the QR code (or the pairing code typed by
 * hand) — it is never sent over the network. So anyone else on the same Wi-Fi
 * sees nothing but scrambled bytes, even if they captured the pairing token.
 *
 * GCM also detects tampering: a modified message fails to decrypt instead of
 * being applied.
 *
 * Wire format of one locked message:
 *   { "enc": "v1", "iv": "<base64>", "ct": "<base64 ciphertext+tag>" }
 */
const crypto = require('crypto');

const KEY_BYTES = 32; // AES-256
const IV_BYTES = 12;  // standard GCM nonce
const TAG_BYTES = 16;

/** New random key, as a short URL-safe text string for the QR code. */
function generateKey() {
  return crypto.randomBytes(KEY_BYTES).toString('base64url');
}

/** Text key -> raw bytes. Returns null if the text is not a valid key. */
function keyToBuffer(keyText) {
  if (typeof keyText !== 'string' || keyText.length === 0) return null;
  try {
    const buf = Buffer.from(keyText, 'base64url');
    return buf.length === KEY_BYTES ? buf : null;
  } catch {
    return null;
  }
}

/** Lock one message. Returns the envelope object to send. */
function encryptJson(keyBuf, obj) {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBuf, iv);
  const body = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(obj), 'utf8')),
    cipher.final()
  ]);
  const tag = cipher.getAuthTag();
  return {
    enc: 'v1',
    iv: iv.toString('base64'),
    ct: Buffer.concat([body, tag]).toString('base64')
  };
}

/**
 * Unlock one message. Throws if the key is wrong or the message was altered,
 * so callers must wrap this in try/catch and ignore bad messages.
 */
function decryptJson(keyBuf, envelope) {
  if (!envelope || envelope.enc !== 'v1' || typeof envelope.iv !== 'string' || typeof envelope.ct !== 'string') {
    throw new Error('Not a locked message');
  }
  const iv = Buffer.from(envelope.iv, 'base64');
  const full = Buffer.from(envelope.ct, 'base64');
  if (iv.length !== IV_BYTES || full.length <= TAG_BYTES) throw new Error('Malformed locked message');
  const body = full.subarray(0, full.length - TAG_BYTES);
  const tag = full.subarray(full.length - TAG_BYTES);
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuf, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(body), decipher.final()]);
  return JSON.parse(plain.toString('utf8'));
}

function isEnvelope(obj) {
  return Boolean(obj) && obj.enc === 'v1' && typeof obj.iv === 'string' && typeof obj.ct === 'string';
}

module.exports = { generateKey, keyToBuffer, encryptJson, decryptJson, isEnvelope, KEY_BYTES };
