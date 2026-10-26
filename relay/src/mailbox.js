/**
 * mailbox.js — the rules of the post box, with no Cloudflare-specific code.
 *
 * This is the whole brain of the relay. worker.js is only a thin shell around
 * it, and the tests run this same file directly in Node, so what is tested is
 * exactly what runs in production.
 *
 * What the post box does:
 *   - It keeps two lanes per box: "toPhone" (left by the PC) and "toPc"
 *     (left by phones). Each item gets the next number in that lane.
 *   - A device asks "give me everything after number N" and gets it in order.
 *   - It stores ONLY locked (encrypted) blobs plus a number and a time. It
 *     cannot read anything it holds; it has no key.
 *   - Items are deleted once both sides have moved past them, and in any case
 *     after RETENTION_DAYS, so nothing piles up forever.
 *
 * Who may use a box:
 *   The box name and the password are both derived from the pairing key that
 *   only the PC and the phone know (see deriveBoxId / deriveBoxAuth in the
 *   clients). Someone who does not have the key cannot guess either.
 */

export const LANES = ['toPhone', 'toPc'];
export const RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const MAX_ITEMS_PER_LANE = 5000;
export const MAX_BLOB_BYTES = 128 * 1024; // one locked message
export const MAX_PUSH_ITEMS = 200;

function badRequest(message) {
  return { status: 400, body: { error: message } };
}

/**
 * @param {object} store  key/value storage: get(key), put(key, value), delete(keys[]), list(prefix)
 */
export class Mailbox {
  constructor(store, now = () => Date.now()) {
    this.store = store;
    this.now = now;
  }

  async meta() {
    const m = await this.store.get('meta');
    return m || { toPhone: { next: 1, oldest: 1 }, toPc: { next: 1, oldest: 1 }, createdAt: this.now() };
  }

  async saveMeta(m) {
    await this.store.put('meta', m);
  }

  /** Append locked blobs to one lane. Returns the number of the last item. */
  async push(lane, items) {
    if (!LANES.includes(lane)) return badRequest('unknown lane');
    if (!Array.isArray(items) || items.length === 0) return badRequest('no items');
    if (items.length > MAX_PUSH_ITEMS) return badRequest('too many items in one push');

    for (const it of items) {
      if (!it || typeof it.blob !== 'string' || it.blob.length === 0) return badRequest('item has no blob');
      if (it.blob.length > MAX_BLOB_BYTES) return badRequest('item too large');
    }

    const m = await this.meta();
    const lastSeq = m[lane].next + items.length - 1;
    const writes = [];
    let seq = m[lane].next;
    const at = this.now();
    for (const it of items) {
      writes.push([`${lane}:${String(seq).padStart(12, '0')}`, { seq, blob: it.blob, at }]);
      seq++;
    }
    m[lane].next = seq;
    await this.store.putMany(writes);
    await this.saveMeta(m);
    await this.trim(lane, m);
    return { status: 200, body: { ok: true, lastSeq, lane } };
  }

  /** Read everything in a lane after `since`, oldest first. */
  async pull(lane, since, limit = 200) {
    if (!LANES.includes(lane)) return badRequest('unknown lane');
    const m = await this.meta();
    const from = Number.isFinite(Number(since)) ? Math.max(0, Number(since)) : 0;
    const rows = await this.store.list(`${lane}:`);
    const items = rows
      .map((r) => r.value)
      .filter((v) => v && v.seq > from)
      .sort((a, b) => a.seq - b.seq)
      .slice(0, limit);
    return {
      status: 200,
      body: {
        ok: true,
        lane,
        items: items.map((i) => ({ seq: i.seq, blob: i.blob })),
        upto: m[lane].next - 1,
        // True when the asked-for starting point is older than anything still
        // kept, so the caller knows it may have missed something and should do
        // a full comparison instead of trusting its cursor.
        gap: from > 0 && from < m[lane].oldest - 1
      }
    };
  }

  /**
   * The reader confirms it has stored everything up to `upto`, so those items
   * can be thrown away.
   */
  async ack(lane, upto) {
    if (!LANES.includes(lane)) return badRequest('unknown lane');
    const n = Number(upto);
    if (!Number.isFinite(n) || n < 0) return badRequest('bad upto');
    const m = await this.meta();
    const rows = await this.store.list(`${lane}:`);
    const doomed = rows.filter((r) => r.value && r.value.seq <= n).map((r) => r.key);
    if (doomed.length > 0) await this.store.deleteMany(doomed);
    m[lane].oldest = Math.max(m[lane].oldest, n + 1);
    await this.saveMeta(m);
    return { status: 200, body: { ok: true, removed: doomed.length } };
  }

  /** Drop anything too old or beyond the size cap. */
  async trim(lane, meta) {
    const m = meta || (await this.meta());
    const rows = await this.store.list(`${lane}:`);
    const cutoff = this.now() - RETENTION_MS;
    let doomed = rows.filter((r) => r.value && r.value.at < cutoff);
    const kept = rows.length - doomed.length;
    if (kept > MAX_ITEMS_PER_LANE) {
      const extra = rows
        .filter((r) => r.value && r.value.at >= cutoff)
        .sort((a, b) => a.value.seq - b.value.seq)
        .slice(0, kept - MAX_ITEMS_PER_LANE);
      doomed = doomed.concat(extra);
    }
    if (doomed.length === 0) return;
    await this.store.deleteMany(doomed.map((r) => r.key));
    const highest = Math.max(...doomed.map((r) => r.value.seq));
    m[lane].oldest = Math.max(m[lane].oldest, highest + 1);
    await this.saveMeta(m);
  }

  /** Remove the whole box (used when the user unpairs). */
  async destroy() {
    const all = await this.store.list('');
    if (all.length > 0) await this.store.deleteMany(all.map((r) => r.key));
    return { status: 200, body: { ok: true } };
  }

  async status() {
    const m = await this.meta();
    return {
      status: 200,
      body: {
        ok: true,
        toPhone: { next: m.toPhone.next, oldest: m.toPhone.oldest },
        toPc: { next: m.toPc.next, oldest: m.toPc.oldest }
      }
    };
  }
}

/**
 * Route one request. `path` is everything after /v1/box/<id>/.
 * Returns { status, body }.
 */
export async function handleMailboxRequest(mailbox, method, action, query, body) {
  if (method === 'POST' && action === 'push') {
    return mailbox.push(body?.lane, body?.items);
  }
  if (method === 'GET' && action === 'pull') {
    return mailbox.pull(query.lane, query.since, Number(query.limit) || 200);
  }
  if (method === 'POST' && action === 'ack') {
    return mailbox.ack(body?.lane, body?.upto);
  }
  if (method === 'GET' && action === 'status') {
    return mailbox.status();
  }
  if (method === 'POST' && action === 'destroy') {
    return mailbox.destroy();
  }
  return { status: 404, body: { error: 'unknown action' } };
}
