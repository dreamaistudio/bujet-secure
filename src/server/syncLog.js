/**
 * syncLog.js — the desktop's numbered "change book" (sync step 1).
 *
 * Every time a record changes on the desktop (made on the PC, or received from
 * a phone), the record is stamped with the next number in a single increasing
 * sequence (1, 2, 3 ...). A phone remembers the highest number it has seen
 * (its "cursor"). When it reconnects it asks "give me everything after N", so
 * nothing is missed even if the two devices' clocks disagree.
 *
 * Only the LATEST number per record is kept (a record edited 5 times appears
 * once, with its newest number), so the book never grows larger than the
 * number of records and needs no clean-up. The record's current contents are
 * read from the database when a phone catches up.
 *
 * hubId identifies this desktop's book. If the book is ever recreated (fresh
 * install, "Start Fresh"), the hubId changes, phones notice their cursor no
 * longer belongs to this book, and they do one full sync instead.
 *
 * The file lives next to the database in the app's user-data folder.
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

let userDataPath;
try {
  const { app } = require('electron');
  userDataPath = app.getPath('userData');
} catch (e) {
  userDataPath = process.env.BUDGET_SECURE_DATA_DIR || path.join(process.cwd(), 'data');
}

const statePath = path.join(userDataPath, 'sync_state.json');

/** entity name used in sync messages -> database table */
const ENTITY_TABLES = {
  transaction: 'transactions',
  loan: 'loans',
  saving: 'savings',
  keeper: 'keepers',
  bill: 'bills',
  billPayment: 'bill_payments'
};

/** payload key used in init_sync / bulk_sync -> entity name */
const PAYLOAD_KEYS = {
  transactions: 'transaction',
  loans: 'loan',
  savings: 'saving',
  keepers: 'keeper',
  bills: 'bill',
  billPayments: 'billPayment'
};

let state = null; // { hubId, seq, clockMax, changes: { "entity:id": seq } }

function freshState() {
  return {
    hubId: crypto.randomBytes(12).toString('hex'),
    seq: 0,
    clockMax: 0,
    changes: {},
    // Sync step 3: how far we have read the phone's lane in the post box,
    // and which box that position belongs to (see getRelayCursor).
    relayCursor: 0,
    relayCursorTag: '',
    // When a phone last got in touch, over Wi-Fi or through the post box.
    // 0 = no phone has been paired with the current pairing.
    phoneSeenAt: 0
  };
}

function load() {
  if (state) return state;
  try {
    if (fs.existsSync(statePath)) {
      const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      if (parsed && typeof parsed.hubId === 'string' && Number.isFinite(parsed.seq) && parsed.changes) {
        state = {
          hubId: parsed.hubId,
          seq: parsed.seq,
          clockMax: Number(parsed.clockMax) || 0,
          changes: parsed.changes,
          relayCursor: Number(parsed.relayCursor) || 0,
          relayCursorTag: typeof parsed.relayCursorTag === 'string' ? parsed.relayCursorTag : '',
          phoneSeenAt: Number(parsed.phoneSeenAt) || 0
        };
        return state;
      }
    }
  } catch (err) {
    console.error('[SyncLog] Could not read sync_state.json, starting a new change book:', err.message);
  }
  state = freshState();
  state.needsSeed = true;
  return state;
}

function persist() {
  if (!state) return;
  try {
    if (!fs.existsSync(userDataPath)) fs.mkdirSync(userDataPath, { recursive: true });
    const tmp = statePath + '.tmp';
    const { needsSeed, ...toSave } = state;
    fs.writeFileSync(tmp, JSON.stringify(toSave), 'utf8');
    fs.renameSync(tmp, statePath);
  } catch (err) {
    console.error('[SyncLog] Failed to save sync_state.json:', err.message);
  }
}

function keyOf(entity, id) {
  return `${entity}:${id}`;
}

/**
 * On first run (no change book yet) every existing record is entered once,
 * so a brand-new phone with cursor 0 receives the whole database.
 */
function seedFromDatabase(db) {
  const s = load();
  if (!s.needsSeed) return;
  delete s.needsSeed;
  const add = (entity, rows) => {
    for (const row of rows || []) {
      if (row && row.id) {
        s.seq += 1;
        s.changes[keyOf(entity, row.id)] = s.seq;
        observe(row.updated_at);
      }
    }
  };
  try {
    add('transaction', db.getAllTransactionsRaw());
    add('loan', db.getAllLoansRaw());
    add('saving', db.getAllSavingsRaw());
    add('keeper', db.getAllKeepersRaw());
    add('bill', db.getAllBillsRaw());
    add('billPayment', db.getAllBillPaymentsRaw());
    const settings = db.getSettings();
    if (settings && Object.keys(settings).length > 0) {
      s.seq += 1;
      s.changes[keyOf('settings', 'settings')] = s.seq;
    }
  } catch (err) {
    console.error('[SyncLog] Seeding change book from database failed:', err);
  }
  persist();
  console.log(`[SyncLog] Change book created (hub ${s.hubId}) with ${s.seq} existing records.`);
}

/** Stamp one record as changed. Returns its new sequence number. */
function markChanged(entity, id) {
  return markMany([{ entity, id }]);
}

/**
 * Stamp several records at once (one disk write). Returns the highest
 * sequence number assigned, or the current sequence if nothing was marked.
 */
function markMany(items) {
  const s = load();
  let marked = false;
  for (const it of items || []) {
    if (!it || !it.entity) continue;
    const id = it.entity === 'settings' ? 'settings' : it.id;
    if (!id) continue;
    if (it.entity !== 'settings' && !ENTITY_TABLES[it.entity]) continue;
    s.seq += 1;
    s.changes[keyOf(it.entity, id)] = s.seq;
    marked = true;
  }
  if (marked) persist();
  return s.seq;
}

/** All records changed after `cursor`, oldest first: [{ entity, id, seq }] */
function changesSince(cursor) {
  const s = load();
  const from = Number(cursor) || 0;
  const out = [];
  for (const [key, seq] of Object.entries(s.changes)) {
    if (seq > from) {
      const idx = key.indexOf(':');
      out.push({ entity: key.slice(0, idx), id: key.slice(idx + 1), seq });
    }
  }
  out.sort((a, b) => a.seq - b.seq);
  return out;
}

/** Can this phone resume from its cursor, or does it need one full sync? */
function canResume(hubId, cursor) {
  const s = load();
  const c = Number(cursor);
  return typeof hubId === 'string' && hubId === s.hubId && Number.isFinite(c) && c >= 0 && c <= s.seq;
}

/** "Start Fresh": throw away the book; every phone will do one full sync. */
function reset() {
  // "Start Fresh" clears the records, not the pairing: the phone is still
  // paired afterwards, so remember that we have heard from it.
  const seen = load().phoneSeenAt || 0;
  state = freshState();
  state.phoneSeenAt = seen;
  persist();
  console.log(`[SyncLog] Change book reset (new hub ${state.hubId}).`);
}

function getHubId() {
  return load().hubId;
}

/**
 * Sync step 3: position in the phone's post box lane.
 *
 * The numbering belongs to one box, and each pairing has its own box, so the
 * position is kept together with a tag of the box it was read from. Asked
 * about a different box, the answer is 0 - start from the beginning.
 * Without the tag, a position left over from an earlier pairing made the
 * start of a new box look already read: what the phone sent first (its
 * existing data, its first changes) was skipped, and then deleted from the
 * box as "collected". Positions saved before the tag existed have none, so
 * they are read again from the start once - harmless, as applying the same
 * change twice changes nothing.
 */
function getRelayCursor(boxTag) {
  const s = load();
  if (boxTag && s.relayCursorTag !== boxTag) return 0;
  return s.relayCursor || 0;
}

function setRelayCursor(n, boxTag) {
  const s = load();
  const v = Number(n);
  if (!Number.isFinite(v)) return;
  if (boxTag && s.relayCursorTag !== boxTag) {
    // First position in this box.
    s.relayCursorTag = boxTag;
    s.relayCursor = v;
    persist();
    return;
  }
  if (v > (s.relayCursor || 0)) {
    s.relayCursor = v;
    persist();
  }
}

/**
 * A phone just got in touch (over Wi-Fi or through the post box). Saved at
 * most once a minute, so a busy sync does not keep writing the file.
 */
let phoneSeenSavedAt = 0;
function notePhoneSeen() {
  const s = load();
  const now = Date.now();
  // Always kept up to date in memory (the "Connected" badge reads it), but
  // written to disk at most once a minute.
  s.phoneSeenAt = now;
  if (now - phoneSeenSavedAt < 60 * 1000) return;
  phoneSeenSavedAt = now;
  persist();
}

function getPhoneSeenAt() {
  return load().phoneSeenAt || 0;
}

/**
 * The pairing was replaced ("Unpair all phones"). The new pairing gets a new,
 * empty post box whose numbering starts again from 1, so our reading position
 * must start again too - left at the old box's position, every item in the new
 * box would look already read and nothing from the phone would ever arrive.
 * No phone has been heard from on the new pairing yet either.
 */
function forgetPairing() {
  const s = load();
  s.relayCursor = 0;
  s.relayCursorTag = '';
  s.phoneSeenAt = 0;
  persist();
}

function currentSeq() {
  return load().seq;
}

/**
 * Clock helper. Remembers the newest edit time seen from ANY device, so a new
 * edit made here is always stamped later than everything already seen — even
 * if this PC's clock is a little behind the phone's. Without this, an edit
 * made on a device with a slow clock could lose to an older edit.
 */
function observe(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return;
  const s = load();
  // Ignore absurd future times (> 1 day ahead) so one bad clock can't poison ours.
  if (n > Date.now() + 24 * 60 * 60 * 1000) return;
  if (n > s.clockMax) s.clockMax = n;
}

function nextTimestamp() {
  const s = load();
  const ts = Math.max(Date.now(), s.clockMax + 1);
  s.clockMax = ts;
  return ts;
}

module.exports = {
  ENTITY_TABLES,
  PAYLOAD_KEYS,
  seedFromDatabase,
  markChanged,
  markMany,
  changesSince,
  canResume,
  reset,
  getHubId,
  currentSeq,
  observe,
  nextTimestamp,
  getRelayCursor,
  setRelayCursor,
  notePhoneSeen,
  getPhoneSeenAt,
  forgetPairing,
  statePath
};
