/**
 * worker.js — the Cloudflare side of the Budget Secure post box.
 *
 * It is a thin shell: all the real rules live in mailbox.js, which the tests
 * run directly. This file only turns HTTP requests into Mailbox calls and
 * stores data in a Durable Object (a tiny private store, one per box).
 *
 * IMPORTANT: this service never sees your money data. Everything it holds was
 * already locked by your PC and phone with a key it does not have. It only
 * moves sealed envelopes between the two devices.
 *
 * Addresses:
 *   POST /v1/box/<boxId>/push     { lane, items:[{blob}] }
 *   GET  /v1/box/<boxId>/pull?lane=..&since=N
 *   POST /v1/box/<boxId>/ack      { lane, upto }
 *   GET  /v1/box/<boxId>/status
 *   POST /v1/box/<boxId>/destroy
 *   GET  /v1/ping
 *
 * Who may open a box: the box name and its password are two different values
 * worked out from the pairing key that only the PC and the phone know. The
 * first request to a new box records a fingerprint of the password; every later
 * request must match it, so nobody who merely learns the box name from a log
 * can take the box over.
 */
import { Mailbox, handleMailboxRequest } from './mailbox.js';

const HEX_RE = /^[a-f0-9]{32,64}$/;

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'GET, POST, OPTIONS'
};

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...CORS_HEADERS
    }
  });
}

/**
 * The reply to the browser's "may I send this?" question.
 *
 * The phone runs inside a web view, so every call that carries the box
 * password is preceded by an OPTIONS request. HTTP 204 means "no content", and
 * a 204 carrying a body is rejected outright by the runtime — answering it
 * with a JSON body threw, the browser saw no permission, and the phone could
 * never reach the box at all (the PC, which is not a browser, never asks and
 * so was unaffected). The body must be null.
 */
function preflight() {
  return new Response(null, {
    status: 204,
    headers: {
      ...CORS_HEADERS,
      // Ask once a day rather than before every single call.
      'access-control-max-age': '86400'
    }
  });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return preflight();

    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean); // v1, box, <id>, <action>

    if (parts[0] === 'v1' && parts[1] === 'ping') {
      return json(200, { app: 'budget-secure-relay', v: 1 });
    }
    if (parts[0] !== 'v1' || parts[1] !== 'box' || parts.length < 4) {
      return json(404, { error: 'not found' });
    }
    if (!HEX_RE.test(parts[2])) return json(400, { error: 'bad box id' });

    const stub = env.MAILBOX.get(env.MAILBOX.idFromName(parts[2]));
    return stub.fetch(new Request(url.toString(), request));
  }
};

/** One Durable Object = one box, with its own small storage. */
export class MailboxObject {
  constructor(state) {
    this.state = state;
    const storage = state.storage;
    this.storage = storage;
    this.store = {
      get: (key) => storage.get(key),
      put: (key, value) => storage.put(key, value),
      putMany: async (pairs) => {
        for (let i = 0; i < pairs.length; i += 128) {
          const slice = {};
          for (const [k, v] of pairs.slice(i, i + 128)) slice[k] = v;
          await storage.put(slice);
        }
      },
      deleteMany: async (keys) => {
        for (let i = 0; i < keys.length; i += 128) {
          await storage.delete(keys.slice(i, i + 128));
        }
      },
      list: async (prefix) => {
        const map = await storage.list({ prefix });
        return [...map.entries()]
          .filter(([key]) => key !== 'meta' && key !== 'authHash')
          .map(([key, value]) => ({ key, value }));
      }
    };
    this.mailbox = new Mailbox(this.store);
  }

  /** Fingerprint of the password, so the password itself is never stored. */
  async hash(text) {
    const bytes = new TextEncoder().encode(`budget-secure-box:${text}`);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  /** Equal-length compare that does not leak where two values differ. */
  safeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }

  async checkAuth(request) {
    const auth = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (!HEX_RE.test(auth)) return false;
    const given = await this.hash(auth);
    const known = await this.storage.get('authHash');
    if (!known) {
      // First ever use of this box: remember whose it is.
      await this.storage.put('authHash', given);
      return true;
    }
    return this.safeEqual(given, known);
  }

  async fetch(request) {
    if (request.method === 'OPTIONS') return preflight();

    const url = new URL(request.url);
    const action = url.pathname.split('/').filter(Boolean)[3];

    if (!(await this.checkAuth(request))) return json(401, { error: 'unauthorized' });

    let body = null;
    if (request.method === 'POST') {
      try {
        body = await request.json();
      } catch {
        body = null;
      }
    }
    const query = Object.fromEntries(url.searchParams.entries());
    const result = await handleMailboxRequest(this.mailbox, request.method, action, query, body);
    return json(result.status, result.body);
  }
}
