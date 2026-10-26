const { WebSocketServer } = require('ws');
const crypto = require('crypto');
const db = require('./database');
const syncLog = require('./syncLog');
const syncCrypto = require('./syncCrypto');
const relaySync = require('./relaySync');
const relayClient = require('./relayClient');

let wss = null;
let syncTokenGetter = null;
let syncKeyGetter = null;

/**
 * Sync step 2: the secret that locks data sent to phones. Fetched lazily from
 * api.js so this module can be loaded before api.js has finished loading.
 */
function getSyncKeyText() {
  if (syncKeyGetter) {
    try { return syncKeyGetter() || ''; } catch { return ''; }
  }
  try {
    const apiRouter = require('./api');
    return (apiRouter.getSyncKey ? apiRouter.getSyncKey() : '') || '';
  } catch {
    return '';
  }
}

/**
 * Send one message to one client. Phones get it locked (encrypted); this PC's
 * own window talks over the loopback address inside the machine and stays plain.
 */
function sendTo(ws, obj) {
  if (!ws || ws.readyState !== 1) return;
  try {
    const payload = ws.secureKeyBuf ? JSON.stringify(syncCrypto.encryptJson(ws.secureKeyBuf, obj)) : JSON.stringify(obj);
    ws.send(payload);
  } catch (err) {
    console.error('[WebSocket] Failed to send message:', err.message);
  }
}

/** Send the same message to many clients, locked per client as needed. */
function sendToAll(clients, obj, exclude) {
  let sent = 0;
  for (const client of clients) {
    if (client === exclude || client.readyState !== 1) continue;
    sendTo(client, obj);
    sent++;
  }
  return sent;
}
const onClientCountChangeCallbacks = [];

/**
 * Constant-time comparison between two strings to prevent timing attacks
 */
function timingSafeCompareTokens(tokenA, tokenB) {
  if (typeof tokenA !== 'string' || typeof tokenB !== 'string') return false;
  const bufA = Buffer.from(tokenA);
  const bufB = Buffer.from(tokenB);
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, bufA); // avoid leaking length by timing
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

// Handshake rate-limiting & connection attempt tracking (FIX 2.7)
const failedHandshakes = new Map(); // ip -> { count, firstFail, blockedUntil }
const connectionAttempts = new Map(); // ip -> [timestamps]

function isLoopbackAddress(ip) {
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

function checkHandshakeRateLimit(ip) {
  if (isLoopbackAddress(ip)) return true;
  const now = Date.now();
  const record = failedHandshakes.get(ip);
  if (record && record.blockedUntil && now < record.blockedUntil) {
    return false;
  }
  return true;
}

function recordFailedHandshake(ip) {
  if (isLoopbackAddress(ip)) return;
  const now = Date.now();
  const record = failedHandshakes.get(ip) || { count: 0, firstFail: now, blockedUntil: 0 };
  if (now - record.firstFail > 60000) {
    record.count = 1;
    record.firstFail = now;
  } else {
    record.count++;
  }
  if (record.count >= 10) {
    record.blockedUntil = now + 5 * 60 * 1000; // Block for 5 minutes
    console.warn(`[WebSocket Security] IP ${ip} exceeded 10 failed handshakes. Blocked for 5 minutes.`);
  }
  failedHandshakes.set(ip, record);
}

function recordSuccessfulHandshake(ip) {
  if (isLoopbackAddress(ip)) return;
  failedHandshakes.delete(ip);
}

function recordConnectionAttempt(ip) {
  if (isLoopbackAddress(ip)) return true;
  const now = Date.now();
  const attempts = (connectionAttempts.get(ip) || []).filter(t => now - t < 60000);
  attempts.push(now);
  connectionAttempts.set(ip, attempts);
  return attempts.length <= 20; // Max 20 connection attempts per minute from one IP
}

/**
 * Validate incoming delta structure and sanity before DB application (FIX 2.6)
 */
function validateDelta(entity, action, data) {
  if (!entity || !action) return false;
  if (entity === 'reset') return true;
  if (entity === 'bulk_sync') {
    return data && typeof data === 'object';
  }
  if (!data || typeof data !== 'object') {
    console.warn(`[Validation] Rejected delta for ${entity}: data is not an object`);
    return false;
  }
  // data.id must be non-empty string under 64 chars. Settings are the one
  // exception: there is only ever one set of them, so they carry no id. (This
  // check used to throw away every settings change made on the phone, so a
  // ledger renamed there never reached the PC.)
  if (entity !== 'settings' && (typeof data.id !== 'string' || data.id.trim() === '' || data.id.length > 64)) {
    console.warn(`[Validation] Rejected delta for ${entity}: invalid id "${data.id}"`);
    return false;
  }

  // numeric fields within sane range -1e12 to 1e12
  const numericKeys = ['amount', 'dueDay', 'paid'];
  for (const key of numericKeys) {
    if (data[key] !== undefined && data[key] !== null) {
      const num = Number(data[key]);
      if (!Number.isFinite(num) || num < -1e12 || num > 1e12) {
        console.warn(`[Validation] Rejected delta for ${entity}: invalid numeric field ${key}=${data[key]}`);
        return false;
      }
      data[key] = num;
    }
  }

  // string fields capped at 500 chars (truncate rather than reject)
  for (const key of Object.keys(data)) {
    if (typeof data[key] === 'string' && data[key].length > 500) {
      data[key] = data[key].slice(0, 500);
    }
  }

  // date fields parse as valid dates
  const dateKeys = ['date', 'paid_date', 'created_at'];
  for (const key of dateKeys) {
    if (data[key]) {
      const parsed = Date.parse(data[key]);
      if (isNaN(parsed)) {
        console.warn(`[Validation] Rejected delta for ${entity}: invalid date ${key}=${data[key]}`);
        return false;
      }
    }
  }

  // updated_at is a finite number; if missing, set it to Date.now()
  if (data.updated_at === undefined || data.updated_at === null || !Number.isFinite(Number(data.updated_at))) {
    data.updated_at = Date.now();
  } else {
    data.updated_at = Number(data.updated_at);
  }

  return true;
}

// ---------------------------------------------------------------------------
// Sync step 1 helpers: numbered change book, catch-up, acknowledgements
// ---------------------------------------------------------------------------

/** Change ids already applied (so a change re-sent after a reconnect is not applied twice). */
const seenChangeIds = new Map();
const SEEN_CHANGE_IDS_CAP = 5000;

function rememberChangeId(id) {
  if (!id) return;
  seenChangeIds.set(id, Date.now());
  if (seenChangeIds.size > SEEN_CHANGE_IDS_CAP) {
    const oldest = seenChangeIds.keys().next().value;
    seenChangeIds.delete(oldest);
  }
}

function sendAck(ws, changeId, extra) {
  if (!changeId || ws.readyState !== 1) return;
  try {
    sendTo(ws, { type: 'delta_ack', ids: [changeId], ...(extra || {}) });
  } catch {}
}

/** Current stored version of one record (including deleted ones), or null. */
function currentRow(entity, id) {
  if (entity === 'settings') return db.getSettings();
  const table = syncLog.ENTITY_TABLES[entity];
  if (!table || !id) return null;
  return db.getRowById(table, id);
}

const RAW_GETTERS = {
  transaction: () => db.getAllTransactionsRaw(),
  loan: () => db.getAllLoansRaw(),
  saving: () => db.getAllSavingsRaw(),
  keeper: () => db.getAllKeepersRaw(),
  bill: () => db.getAllBillsRaw(),
  billPayment: () => db.getAllBillPaymentsRaw()
};

/** Fingerprint of every record's version, used to see what a merge changed. */
function snapshotVersions() {
  const snap = {};
  for (const [entity, getAll] of Object.entries(RAW_GETTERS)) {
    const m = new Map();
    try {
      for (const row of getAll() || []) {
        if (row && row.id) m.set(row.id, `${row.updated_at || 0}|${row.deleted ? 1 : 0}`);
      }
    } catch {}
    snap[entity] = m;
  }
  try {
    snap.settings = JSON.stringify(db.getSettings() || {});
  } catch {
    snap.settings = '';
  }
  return snap;
}

/**
 * Compare with a snapshot taken before a merge, stamp every record that
 * changed in the change book, and return [{ entity, id, seq, data }].
 */
function recordMergeChanges(before) {
  const after = snapshotVersions();
  const changed = [];
  for (const entity of Object.keys(RAW_GETTERS)) {
    const b = before[entity] || new Map();
    for (const [id, version] of after[entity]) {
      if (b.get(id) !== version) changed.push({ entity, id });
    }
  }
  if (before.settings !== after.settings) changed.push({ entity: 'settings', id: 'settings' });
  if (changed.length === 0) return [];
  syncLog.markMany(changed);
  const out = [];
  for (const c of changed) {
    const data = currentRow(c.entity, c.id);
    if (!data) continue;
    if (data.updated_at) syncLog.observe(data.updated_at);
    out.push({ entity: c.entity, id: c.id, seq: syncLog.currentSeq(), data });
  }
  return out;
}

/** Rows a phone needs to catch up from its cursor. */
function buildCatchUpRows(cursor) {
  const rows = [];
  for (const c of syncLog.changesSince(cursor)) {
    const data = currentRow(c.entity, c.id);
    if (!data) continue; // record purged since (old tombstone) — nothing to send
    rows.push({ entity: c.entity, seq: c.seq, data });
  }
  return rows;
}

/** Stamp every record contained in a bulk payload (e.g. currency conversion). */
function markBulkPayload(payload) {
  const items = [];
  for (const [key, entity] of Object.entries(syncLog.PAYLOAD_KEYS)) {
    if (Array.isArray(payload[key])) {
      for (const row of payload[key]) {
        if (row && row.id) {
          items.push({ entity, id: row.id });
          syncLog.observe(row.updated_at);
        }
      }
    }
  }
  if (payload.settings && typeof payload.settings === 'object') items.push({ entity: 'settings', id: 'settings' });
  return syncLog.markMany(items);
}

function userDataPathForRelay() {
  try {
    const { app } = require('electron');
    return app.getPath('userData');
  } catch {
    const path = require('path');
    return process.env.BUDGET_SECURE_DATA_DIR || path.join(process.cwd(), 'data');
  }
}

/**
 * Merge a phone's full copy of its data into this PC (an init_sync), with all
 * the protections for settings: the PIN, ledger names, lock timer and currency
 * are never overwritten by blanks or by an unconverted change. Used both for
 * a full exchange over Wi-Fi and for one that comes through the post box.
 */
function mergePhoneSnapshot(payload, hasDataHint) {
  // FIX 2.4: Check if client has ANY active data. Through the post box the
  // phone's data arrives in several parts, and only the part carrying the
  // settings needs this answer, so the phone works it out over all of its
  // data and sends it along (hasDataHint).
  const clientHasData = typeof hasDataHint === 'boolean' ? hasDataHint : (
    (Array.isArray(payload.transactions) && payload.transactions.some(t => !t.deleted)) ||
    (Array.isArray(payload.loans) && payload.loans.some(l => !l.deleted)) ||
    (Array.isArray(payload.savings) && payload.savings.some(s => !s.deleted)) ||
    (Array.isArray(payload.bills) && payload.bills.some(b => !b.deleted))
  );

  const currentSettings = db.getSettings();

  // This PC has no PIN yet: it is being set up right now and was connected to
  // an already set-up phone ("Connect to mobile" on the first screen). The
  // phone's settings - PIN, ledger names, currency and the rest - are the
  // real ones, so this PC takes them over instead of handing its blank
  // first-run settings to the phone (which would wipe the phone's PIN).
  const pcBeingSetUp = !currentSettings.authPin &&
    payload.settings && typeof payload.settings === 'object' && Boolean(payload.settings.authPin);

  if (pcBeingSetUp) {
    console.log('[WebSocket] This PC has no PIN yet; taking over the phone\'s settings.');
    try {
      db.saveSettings({ ...currentSettings, ...payload.settings, settings_updated_at: Date.now() });
    } catch (err) {
      console.error('[WebSocket] Failed to save settings in init_sync:', err);
    }
  } else if (!clientHasData) {
    console.log('[WebSocket] Client has no active data on init_sync; Desktop settings win unconditionally.');
    // Desktop settings stay intact and are pushed to phone via init_sync_ack
  } else if (payload.settings && typeof payload.settings === 'object') {
    const clientSettingsUpdatedAt = payload.settings.settings_updated_at || 0;
    const desktopSettingsUpdatedAt = currentSettings.settings_updated_at || 0;

    if (clientSettingsUpdatedAt >= desktopSettingsUpdatedAt) {
      const settingsToSave = { ...currentSettings, ...payload.settings };

      // Protect authPin from empty/blank clobbering
      if (!payload.settings.authPin && currentSettings.authPin) {
        settingsToSave.authPin = currentSettings.authPin;
      }

      // Protect businessLedgerName, personalLedgerName, lockTimer
      if (!payload.settings.businessLedgerName || payload.settings.businessLedgerName.trim() === '') {
        settingsToSave.businessLedgerName = currentSettings.businessLedgerName;
      }
      if (!payload.settings.personalLedgerName || payload.settings.personalLedgerName.trim() === '') {
        settingsToSave.personalLedgerName = currentSettings.personalLedgerName;
      }
      if (!payload.settings.lockTimer) {
        settingsToSave.lockTimer = currentSettings.lockTimer;
      }

      // Currency: changing it only changes the symbol shown (amounts are never
      // converted any more), so the newer choice is simply kept, the same on
      // both devices.
      if (!payload.settings.currency) {
        settingsToSave.currency = currentSettings.currency;
      }

      settingsToSave.settings_updated_at = Math.max(clientSettingsUpdatedAt, Date.now());
      try {
        db.saveSettings(settingsToSave);
      } catch (err) {
        console.error('[WebSocket] Failed to save settings in init_sync:', err);
      }
    } else {
      console.log('[WebSocket] Desktop settings are newer; keeping Desktop settings.');
    }
  }

  // FIX 2.6: Wrap each entity merge in its own try/catch so a failure in one does not abort the others
  if (Array.isArray(payload.transactions)) {
    try { db.syncTransactions(payload.transactions); } catch (err) { console.error('[WebSocket] Error merging transactions in init_sync:', err); }
  }
  if (Array.isArray(payload.loans)) {
    try { db.syncLoans(payload.loans); } catch (err) { console.error('[WebSocket] Error merging loans in init_sync:', err); }
  }
  if (Array.isArray(payload.keepers)) {
    try { db.syncKeepers(payload.keepers); } catch (err) { console.error('[WebSocket] Error merging keepers in init_sync:', err); }
  }
  if (Array.isArray(payload.savings)) {
    try { db.syncSavings(payload.savings); } catch (err) { console.error('[WebSocket] Error merging savings in init_sync:', err); }
  }
  if (Array.isArray(payload.bills)) {
    try { db.syncBills(payload.bills); } catch (err) { console.error('[WebSocket] Error merging bills in init_sync:', err); }
  }
  if (Array.isArray(payload.billPayments)) {
    try { db.syncBillPayments(payload.billPayments); } catch (err) { console.error('[WebSocket] Error merging billPayments in init_sync:', err); }
  }
}

/** Everything this PC holds, deleted records included (marked deleted). */
function fullStatePayload() {
  return {
    transactions: db.getAllTransactionsRaw(),
    settings: db.getSettings(),
    loans: db.getAllLoansRaw(),
    keepers: db.getAllKeepersRaw(),
    savings: db.getAllSavingsRaw(),
    bills: db.getAllBillsRaw(),
    billPayments: db.getAllBillPaymentsRaw()
  };
}

/**
 * The post box takes at most 128 KB per message, and a message grows by about
 * a third once it is locked. Parts are kept to this much plain data each so
 * they always fit, however many records there are.
 */
const SNAPSHOT_PART_BYTES = 48 * 1024;
const SNAPSHOT_LISTS = ['transactions', 'loans', 'keepers', 'savings', 'bills', 'billPayments'];

/** Split a full copy into parts small enough for the post box. */
function splitSnapshot(full) {
  const parts = [];
  let current = {};
  let size = 0;
  const startNew = () => {
    parts.push(current);
    current = {};
    size = 0;
  };
  if (full.settings) {
    current.settings = full.settings;
    size += JSON.stringify(full.settings).length;
  }
  for (const list of SNAPSHOT_LISTS) {
    for (const row of full[list] || []) {
      const rowSize = JSON.stringify(row).length + 1;
      if (size > 0 && size + rowSize > SNAPSHOT_PART_BYTES) startNew();
      (current[list] = current[list] || []).push(row);
      size += rowSize;
    }
  }
  parts.push(current);
  return parts;
}

/**
 * Sync step 3: a phone that paired from another network has sent its full
 * copy through the post box. Answer the same way a Wi-Fi pairing is answered -
 * with this PC's full merged copy - but in parts, through the post box.
 */
function queueFullStateForPhone(bootId) {
  const parts = splitSnapshot(fullStatePayload());
  const hubId = syncLog.getHubId();
  const upto = syncLog.currentSeq();
  const lan = currentLanInfo() || undefined;
  parts.forEach((payload, i) => {
    relaySync.queueForPhone({
      type: 'init_sync_ack',
      hubId,
      upto,
      payload,
      bootId,
      part: i,
      parts: parts.length,
      // With the last part: where this PC can be reached on its network, so
      // a phone that paired from elsewhere can connect directly once it is
      // on the same Wi-Fi.
      ...(i === parts.length - 1 && lan ? { lan } : {})
    });
  });
  console.log(`[Relay] Sent this PC's full copy to the phone through the post box in ${parts.length} part(s).`);
}

/**
 * A phone pressed Start Fresh: it wipes only itself and leaves the pairing.
 * The PC keeps all of its data, but drops the pairing, so it no longer shows
 * a phone as connected and a new QR code is needed to pair again - the same
 * as "Unpair all phones".
 */
function forgetPairingAtPhoneRequest() {
  console.log('[Sync] A phone was reset (Start Fresh) and asked to be forgotten; replacing the pairing.');
  try {
    const apiRouter = require('./api');
    if (apiRouter.regenerateSyncToken) apiRouter.regenerateSyncToken();
  } catch (err) {
    console.error('[Sync] Could not replace the pairing:', err);
  }
}

/**
 * Apply changes the phone left in the post box. Exactly the same handling as a
 * change arriving over Wi-Fi: it is checked, stored, stamped in the change
 * book, and passed on to anything connected right now (including this PC's own
 * window, so the screen updates immediately).
 */
async function applyMessagesFromPhone(messages) {
  if (Array.isArray(messages) && messages.length > 0) syncLog.notePhoneSeen();
  for (const msg of messages || []) {
    try {
      if (!msg || typeof msg !== 'object') continue;

      if (msg.type === 'unpair_request') {
        // The phone pressed Start Fresh while away from this Wi-Fi.
        forgetPairingAtPhoneRequest();
        return; // the pairing is gone; anything after this belongs to it
      } else if (msg.type === 'init_sync') {
        // A phone paired from another network: its full copy, one part at a
        // time. Each part is merged as it arrives; after the last one the PC
        // answers with its own full copy, just like a Wi-Fi pairing.
        const payload = msg.payload || {};
        const before = snapshotVersions();
        mergePhoneSnapshot(payload, typeof msg.hasData === 'boolean' ? msg.hasData : undefined);
        for (const ch of recordMergeChanges(before)) {
          broadcastToLanOnly(ch.entity, ch.data.deleted ? 'delete' : 'upsert', ch.data, ch.seq);
        }
        const isLast = !Number.isFinite(msg.parts) || msg.part === msg.parts - 1;
        if (isLast) queueFullStateForPhone(typeof msg.bootId === 'string' ? msg.bootId.slice(0, 64) : undefined);
      } else if (msg.type === 'sync_delta') {
        const { entity, action, data, changeId } = msg;
        if (!entity || !data) continue;
        if (changeId && seenChangeIds.has(changeId)) continue; // already applied
        if (!validateDelta(entity, action, data)) continue;
        syncLog.observe(data.updated_at);
        applyIncomingWsDelta(entity, action, data);
        if (entity === 'reset') {
          syncLog.reset();
          broadcastToLanOnly(entity, action, data, 0);
        } else {
          const id = entity === 'settings' ? 'settings' : data.id;
          const seq = syncLog.markChanged(entity, id);
          const stored = currentRow(entity, id) || data;
          const isDeleted = entity !== 'settings' && Boolean(stored.deleted);
          broadcastToLanOnly(entity, isDeleted ? 'delete' : action, stored, seq);
        }
        rememberChangeId(changeId);
      } else if (msg.type === 'bulk_sync') {
        const payload = msg.payload || msg.data;
        const changeId = msg.changeId;
        if (changeId && seenChangeIds.has(changeId)) continue;
        if (!payload || typeof payload !== 'object') continue;
        db.bulkSync(payload);
        const seq = markBulkPayload(payload);
        if (wss) {
          sendToAll(wss.clients, { type: 'bulk_sync', payload, seq, hubId: syncLog.getHubId() });
        }
        rememberChangeId(changeId);
      }
      // 'hello', pings and the like are meaningless through the post box.
    } catch (err) {
      console.error('[Relay] Failed to apply a change from the post box:', err);
    }
  }
}

/**
 * Pass a change to devices connected right now, WITHOUT putting it back into
 * the post box (it came from there, so the phone already has it).
 */
function broadcastToLanOnly(entity, action, data, seq) {
  if (!wss) return;
  sendToAll(wss.clients, {
    type: 'sync_delta',
    entity,
    action,
    data,
    updated_at: data?.updated_at || Date.now(),
    seq: typeof seq === 'number' ? seq : undefined,
    hubId: syncLog.getHubId()
  });
}

/**
 * Initialize the WebSocket server on the given HTTP server instance.
 * @param {import('http').Server} httpServer
 * @param {() => string} getSyncToken
 */
/**
 * A short tag naming the post box of the current pairing (worked out from the
 * key, never the key itself), so a saved reading position can be checked
 * against the box it belongs to.
 */
/**
 * This PC's addresses on its network right now (Wi-Fi first), for a phone
 * that only knows an old one. The sync server always listens on port 3001.
 */
function currentLanInfo() {
  try {
    const apiRouter = require('./api');
    const list = apiRouter.getCandidateIps ? apiRouter.getCandidateIps() : [];
    const ips = list.map((c) => c.ip).filter((ip) => typeof ip === 'string').slice(0, 8);
    return ips.length > 0 ? { ips, port: 3001 } : null;
  } catch {
    return null;
  }
}

function relayBoxTag() {
  const keyText = getSyncKeyText();
  if (!keyText) return '';
  return crypto.createHash('sha256').update(`budget-secure-box-tag:${keyText}`).digest('hex').slice(0, 16);
}

function initWebSocketServer(httpServer, getSyncToken, getSyncKey) {
  syncTokenGetter = getSyncToken;
  syncKeyGetter = getSyncKey || null;

  // Sync step 3: the internet post box, used when the phone is not on this
  // Wi-Fi or is asleep. Does nothing until an address is set up.
  relaySync.start({
    getRelayUrl: () => relayClient.readRelayUrl(userDataPathForRelay()),
    getKey: () => getSyncKeyText(),
    // The reading position belongs to the box of the current pairing.
    getCursor: () => syncLog.getRelayCursor(relayBoxTag()),
    setCursor: (n) => syncLog.setRelayCursor(n, relayBoxTag()),
    applyFromPhone: (messages) => applyMessagesFromPhone(messages),
    getLanInfo: () => currentLanInfo()
  });
  syncLog.seedFromDatabase(db);

  wss = new WebSocketServer({
    server: httpServer,
    path: '/ws'
  });

  console.log('[WebSocket] Server initialized on path /ws');

  wss.on('connection', (ws, req) => {
    try {
      const remoteAddress = req.socket.remoteAddress || '';
      const isLoopback = isLoopbackAddress(remoteAddress);
      ws.isLoopback = isLoopback;

      // FIX 2.7: Rate limit connection attempts (max 20 attempts/min per IP)
      if (!isLoopback && !recordConnectionAttempt(remoteAddress)) {
        console.warn(`[WebSocket] Connection rejected from ${remoteAddress}: Too many connection attempts (>20/min).`);
        ws.close(4029, 'Rate limit exceeded: Max 20 connection attempts per minute');
        return;
      }

      // FIX 2.7: Check failed handshake block (10 failures in 60s -> 5m block)
      if (!isLoopback && !checkHandshakeRateLimit(remoteAddress)) {
        console.warn(`[WebSocket] Connection rejected from ${remoteAddress}: IP temporarily blocked due to repeated auth failures.`);
        ws.close(4029, 'Too many failed authentication attempts');
        return;
      }

      // FIX 2.7: Cap concurrent authenticated clients (max 5)
      if (getConnectedClientCount() >= 5) {
        console.warn(`[WebSocket] Connection rejected from ${remoteAddress}: Max concurrent client limit (5) reached.`);
        ws.close(4008, 'Server busy: Maximum 5 concurrent connections reached');
        return;
      }

      const url = new URL(req.url, 'http://localhost');
      const token = url.searchParams.get('token');
      const expectedToken = syncTokenGetter ? syncTokenGetter() : '';

      // FIX 2.7: Timing-safe token comparison
      if (!token || !timingSafeCompareTokens(token, expectedToken)) {
        recordFailedHandshake(remoteAddress);
        console.warn(`[WebSocket] Unauthorized connection rejected from ${remoteAddress}. Token mismatch.`);
        ws.close(4001, 'Unauthorized: Invalid sync token');
        return;
      }

      recordSuccessfulHandshake(remoteAddress);
      console.log(`[WebSocket] Client authenticated & connected from ${remoteAddress} (loopback: ${ws.isLoopback})`);
      ws.isAlive = true;

      ws.on('pong', () => {
        ws.isAlive = true;
      });

      // Handle incoming messages from client
      ws.on('message', (messageBuffer) => {
        try {
          ws.isAlive = true;
          const raw = messageBuffer.toString();
          let msg = JSON.parse(raw);

          // Sync step 2: unlock the message if it is locked, and refuse plain
          // messages from another device once a lock secret exists.
          if (syncCrypto.isEnvelope(msg)) {
            const keyBuf = syncCrypto.keyToBuffer(getSyncKeyText());
            if (!keyBuf) {
              console.warn('[WebSocket] Locked message received but this PC has no key.');
              return;
            }
            try {
              msg = syncCrypto.decryptJson(keyBuf, msg);
            } catch {
              console.warn('[WebSocket] Could not unlock a message (wrong key or altered). Asking the phone to pair again.');
              try { ws.close(4003, 'Pairing out of date: scan the QR code again'); } catch {}
              return;
            }
            ws.secureKeyBuf = keyBuf;
          } else if (!ws.isLoopback) {
            const keyBuf = syncCrypto.keyToBuffer(getSyncKeyText());
            if (keyBuf) {
              console.warn(`[WebSocket] Refused an unlocked message from ${req.socket.remoteAddress}. The phone must pair again.`);
              try { ws.close(4003, 'Pairing out of date: scan the QR code again'); } catch {}
              return;
            }
          }

          if (msg.type === 'hello') {
            // Sync step 1: a phone says who it is and how far it has read our
            // change book. If its cursor belongs to this book we send only what
            // changed since; otherwise it must do one full sync (init_sync).
            ws.deviceId = typeof msg.deviceId === 'string' ? msg.deviceId.slice(0, 64) : undefined;
            ws.syncProtocol = 2;
            if (!ws.isLoopback) syncLog.notePhoneSeen();
            if (!msg.forceFull && syncLog.canResume(msg.hubId, msg.cursor)) {
              const rows = buildCatchUpRows(msg.cursor);
              sendTo(ws, {
                type: 'resume_changes',
                hubId: syncLog.getHubId(),
                upto: syncLog.currentSeq(),
                rows
              });
              console.log(`[WebSocket] Phone ${ws.deviceId || '?'} resumed from #${msg.cursor}; sent ${rows.length} change(s) up to #${syncLog.currentSeq()}.`);
            } else {
              sendTo(ws, { type: 'bootstrap_required', hubId: syncLog.getHubId() });
              console.log(`[WebSocket] Phone ${ws.deviceId || '?'} needs a full sync (cursor not from this desktop).`);
            }
          } else if (msg.type === 'init_sync') {
            // One full exchange over Wi-Fi. The merge itself is shared with
            // the post box route (applyMessagesFromPhone), so both follow the
            // very same rules.
            if (!ws.isLoopback) syncLog.notePhoneSeen();
            const payload = msg.payload || {};
            const beforeMerge = snapshotVersions();
            mergePhoneSnapshot(payload);

            // Stamp everything the phone's data changed here, and show those
            // changes on the PC screen and on any other connected phone now.
            const mergeChanges = recordMergeChanges(beforeMerge);
            for (const ch of mergeChanges) {
              broadcastDeltaToOthers(ws, ch.entity, ch.data.deleted ? 'delete' : 'upsert', ch.data, ch.seq);
            }

            // Respond with Desktop's FULL merged state. Deleted records are
            // included (marked deleted) so the phone removes them too instead of
            // keeping a copy the PC already deleted.
            sendTo(ws, {
              type: 'init_sync_ack',
              hubId: syncLog.getHubId(),
              upto: syncLog.currentSeq(),
              payload: fullStatePayload()
            });
          } else if (msg.type === 'unpair_request') {
            // The phone pressed Start Fresh (on this Wi-Fi).
            if (!ws.isLoopback) forgetPairingAtPhoneRequest();
          } else if (msg.type === 'sync_delta') {
            const { entity, action, data, changeId } = msg;
            if (changeId && seenChangeIds.has(changeId)) {
              // Already applied (re-sent after a reconnect) — just confirm again.
              sendAck(ws, changeId);
              return;
            }
            if (entity && data) {
              let ackExtra;
              if (validateDelta(entity, action, data)) {
                syncLog.observe(data.updated_at);
                applyIncomingWsDelta(entity, action, data);
                if (entity === 'reset') {
                  syncLog.reset();
                  broadcastDeltaToOthers(ws, entity, action, data, 0);
                } else {
                  const id = entity === 'settings' ? 'settings' : data.id;
                  const seq = syncLog.markChanged(entity, id);
                  // Send the record as it is stored NOW (the incoming copy may have
                  // lost to a newer edit already on the PC).
                  const stored = currentRow(entity, id) || data;
                  const isDeleted = entity !== 'settings' && Boolean(stored.deleted);
                  broadcastDeltaToOthers(ws, entity, isDeleted ? 'delete' : action, stored, seq);
                  ackExtra = { seq, hubId: syncLog.getHubId() };
                }
                rememberChangeId(changeId);
                sendAck(ws, changeId, ackExtra);
              } else {
                // Invalid change: confirm anyway so the phone stops re-sending it forever.
                rememberChangeId(changeId);
                sendAck(ws, changeId, { rejected: true });
              }
            } else {
              sendAck(ws, changeId, { rejected: true });
            }
          } else if (msg.type === 'bulk_sync') {
            // FIX 2.8: Single batched message applying conversions in an atomic transaction
            const payload = msg.payload || msg.data;
            const changeId = msg.changeId;
            if (changeId && seenChangeIds.has(changeId)) {
              sendAck(ws, changeId);
              return;
            }
            if (payload && typeof payload === 'object') {
              try {
                db.bulkSync(payload);
                const seq = markBulkPayload(payload);
                broadcastBulkSyncToOthers(ws, payload, seq);
                rememberChangeId(changeId);
                sendAck(ws, changeId);
              } catch (err) {
                console.error('[WebSocket] Error processing bulk_sync message:', err);
              }
            }
          } else if (msg.type === 'ping') {
            ws.isAlive = true;
            sendTo(ws, { type: 'pong' });
          } else if (msg.type === 'pong') {
            ws.isAlive = true;
          }
        } catch (err) {
          console.error('[WebSocket] Error processing message:', err);
        }
      });

      ws.on('close', (code, reason) => {
        console.log(`[WebSocket] Client disconnected (${code}): ${reason || 'Normal close'}`);
        notifyClientCountChange();
        broadcastClientCount();
      });

      ws.on('error', (err) => {
        console.error('[WebSocket] Socket error:', err.message);
      });

      // Send initial welcome/ready
      // Sent before the phone has said anything, so it stays plain: it carries
      // no data, and the phone uses it to know the link is up.
      ws.send(JSON.stringify({
        type: 'connected',
        timestamp: Date.now(),
        secure: Boolean(syncCrypto.keyToBuffer(getSyncKeyText()))
      }));

      notifyClientCountChange();
      broadcastClientCount();
    } catch (err) {
      console.error('[WebSocket] Connection setup error:', err);
      ws.close(1011, 'Internal Server Error');
    }
  });

  // Heartbeat ping interval (25 seconds)
  const heartbeatInterval = setInterval(() => {
    if (!wss) return;
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) {
        console.log('[WebSocket] Terminating inactive client (ping timeout)');
        return ws.terminate();
      }
      ws.isAlive = false;
      try {
        ws.ping();
      } catch (err) {
        ws.terminate();
      }
    });
  }, 25000);

  wss.on('close', () => {
    clearInterval(heartbeatInterval);
  });

  return wss;
}

/**
 * Apply a WebSocket delta directly to the database without triggering api.js REST broadcast path.
 * FIX 2.3: Branch on action for EVERY entity, calling proper soft-delete function when action === 'delete'.
 */
function applyIncomingWsDelta(entity, action, data) {
  try {
    const isDelete = action === 'delete' || Boolean(data?.deleted);

    switch (entity) {
      case 'transaction':
        if (isDelete) {
          db.deleteTransaction(data.id, data.updated_at);
        } else {
          db.syncTransactions([data]);
        }
        break;
      case 'loan':
        if (isDelete) {
          db.deleteLoan(data.id, data.updated_at);
        } else {
          db.syncLoans([data]);
        }
        break;
      case 'keeper':
        if (isDelete) {
          db.deleteKeeper(data.id, data.updated_at);
        } else {
          db.syncKeepers([data]);
        }
        break;
      case 'saving':
        if (isDelete) {
          db.deleteSaving(data.id, data.updated_at);
        } else {
          db.syncSavings([data]);
        }
        break;
      case 'bill':
        if (isDelete) {
          db.deleteBill(data.id, data.updated_at);
        } else {
          db.syncBills([data]);
        }
        break;
      case 'billPayment':
        if (isDelete) {
          db.deleteBillPayment(data.id, data.updated_at);
        } else {
          db.syncBillPayments([data]);
        }
        break;
      case 'settings': {
        const currentSettings = db.getSettings();
        // An older change arriving late (it waited on a phone that was
        // offline) must not undo a newer one made here since. A PC that is
        // still being set up (no PIN yet) takes the phone's settings anyway.
        const incomingAt = Number(data.settings_updated_at) || 0;
        const currentAt = Number(currentSettings.settings_updated_at) || 0;
        if (currentSettings.authPin && incomingAt < currentAt) {
          console.log('[WebSocket] Ignored an older settings change from the phone; this PC has a newer one.');
          break;
        }
        const settingsToSave = { ...currentSettings, ...data };

        // Protect PIN
        if (!settingsToSave.authPin && currentSettings.authPin) {
          settingsToSave.authPin = currentSettings.authPin;
        }

        // Protect ledger names and lockTimer
        if (!settingsToSave.businessLedgerName || settingsToSave.businessLedgerName.trim() === '') {
          settingsToSave.businessLedgerName = currentSettings.businessLedgerName;
        }
        if (!settingsToSave.personalLedgerName || settingsToSave.personalLedgerName.trim() === '') {
          settingsToSave.personalLedgerName = currentSettings.personalLedgerName;
        }
        if (!settingsToSave.lockTimer) {
          settingsToSave.lockTimer = currentSettings.lockTimer;
        }

        // Currency only changes the symbol shown (amounts are never converted
        // any more), so a change made on the phone is kept here too.
        if (!settingsToSave.currency) {
          settingsToSave.currency = currentSettings.currency;
        }

        settingsToSave.settings_updated_at = data.settings_updated_at || Date.now();
        db.saveSettings(settingsToSave);
        break;
      }
      case 'reset':
        db.resetAll();
        break;
      default:
        console.warn(`[WebSocket] Unknown delta entity: ${entity}`);
    }
  } catch (err) {
    console.error(`[WebSocket] Failed to apply incoming delta for ${entity}:`, err);
  }
}

/**
 * Broadcast delta to other connected WebSocket clients (excluding the sender).
 * Used when a delta originates from a WebSocket client.
 */
function broadcastDeltaToOthers(senderWs, entity, action, data, seq) {
  const message = {
    type: 'sync_delta',
    entity,
    action,
    data,
    updated_at: data?.updated_at || Date.now(),
    seq: typeof seq === 'number' ? seq : undefined,
    hubId: syncLog.getHubId()
  };
  // Also leave it in the post box, for any phone that is not here right now.
  relaySync.queueForPhone(message);
  if (!wss) return;
  const sentCount = sendToAll(wss.clients, message, senderWs);
  if (sentCount > 0) {
    console.log(`[WebSocket] Relayed WS delta (${entity}:${action}) to ${sentCount} other client(s)`);
  }
}

/**
 * Broadcast bulk_sync to other connected WebSocket clients (excluding the sender).
 */
function broadcastBulkSyncToOthers(senderWs, payload, seq) {
  const message = {
    type: 'bulk_sync',
    payload,
    seq: typeof seq === 'number' ? seq : undefined,
    hubId: syncLog.getHubId()
  };
  relaySync.queueForPhone(message);
  if (!wss) return;
  const sentCount = sendToAll(wss.clients, message, senderWs);
  if (sentCount > 0) {
    console.log(`[WebSocket] Relayed bulk_sync to ${sentCount} other client(s)`);
  }
}

/**
 * Broadcast bulk_sync to ALL connected WebSocket clients (e.g. from desktop REST API).
 */
function broadcastBulkSync(payload) {
  // Called after the PC itself converted everything (e.g. currency change).
  const seq = payload && typeof payload === 'object' ? markBulkPayload(payload) : undefined;
  const message = { type: 'bulk_sync', payload, seq, hubId: syncLog.getHubId() };
  relaySync.queueForPhone(message);
  if (!wss) return;
  const sentCount = sendToAll(wss.clients, message);
  if (sentCount > 0) {
    console.log(`[WebSocket] Broadcasted bulk_sync to ${sentCount} client(s)`);
  }
}

/**
 * Broadcast an entity mutation delta to ALL connected WebSocket clients.
 * Exclusively called by api.js on HTTP REST mutations.
 * @param {'transaction'|'loan'|'saving'|'keeper'|'bill'|'billPayment'|'settings'|'reset'} entity
 * @param {'upsert'|'delete'} action
 * @param {any} data
 */
function broadcastDelta(entity, action, data) {
  // Every change made on the PC goes through here: stamp it in the change book
  // first, so a phone that is offline right now still gets it later.
  let seq;
  if (entity === 'reset') {
    syncLog.reset();
    seq = 0;
  } else {
    const id = entity === 'settings' ? 'settings' : data?.id;
    if (data?.updated_at) syncLog.observe(data.updated_at);
    seq = id ? syncLog.markChanged(entity, id) : undefined;
  }
  const message = {
    type: 'sync_delta',
    entity,
    action,
    data,
    updated_at: data?.updated_at || Date.now(),
    seq,
    hubId: syncLog.getHubId()
  };
  relaySync.queueForPhone(message);
  if (!wss) return;
  const sentCount = sendToAll(wss.clients, message);
  if (sentCount > 0) {
    console.log(`[WebSocket] Broadcasted REST delta (${entity}:${action}) to ${sentCount} client(s)`);
  }
}

/**
 * Disconnect and unpair all connected clients (e.g. after token regeneration).
 * @param {string} reason
 */
function disconnectAll(reason = 'Unpaired by host') {
  if (!wss) return;
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      sendTo(client, { type: 'unpaired', reason });
      client.close(4001, reason);
    }
  });
  notifyClientCountChange();
  broadcastClientCount();
}

/**
 * Get count of actively connected WebSocket clients.
 * @returns {number}
 */
function getConnectedClientCount() {
  if (!wss) return 0;
  let count = 0;
  wss.clients.forEach((client) => {
    if (client.readyState === 1) count++;
  });
  return count;
}

/**
 * Get count of non-loopback mobile clients.
 * @returns {number}
 */
function getMobileClientCount() {
  if (!wss) return 0;
  let count = 0;
  wss.clients.forEach((client) => {
    if (client.readyState === 1 && !client.isLoopback) count++;
  });
  return count;
}

function broadcastClientCount() {
  if (!wss) return;
  const mobileCount = getMobileClientCount();
  const totalCount = getConnectedClientCount();
  sendToAll(wss.clients, {
    type: 'client_count',
    count: mobileCount,
    total: totalCount
  });
}

function notifyClientCountChange() {
  const count = getConnectedClientCount();
  onClientCountChangeCallbacks.forEach(cb => {
    try { cb(count); } catch (e) { /* ignore */ }
  });
}

function onClientCountChange(callback) {
  onClientCountChangeCallbacks.push(callback);
}

/**
 * For merges done outside the socket (the PC window's own start-up sync):
 * take a snapshot before, then call publishMergeChanges(snapshot) after.
 */
function publishMergeChanges(before) {
  const changes = recordMergeChanges(before);
  for (const ch of changes) {
    broadcastDeltaToOthers(null, ch.entity, ch.data.deleted ? 'delete' : 'upsert', ch.data, ch.seq);
  }
  return changes.length;
}

module.exports = {
  /** Empty the post box of a pairing that is being replaced. */
  clearRelayBox: (oldKeyText) => {
    // The pairing is being replaced: start reading the new box from the
    // beginning, and forget that a phone was paired.
    syncLog.forgetPairing();
    return relaySync.clearBox(oldKeyText);
  },
  // phoneSeenAt: when a phone last got in touch, so the PC can say "paired,
  // connected over the internet" instead of offering setup again.
  relayStatus: () => ({ ...relaySync.status(), phoneSeenAt: syncLog.getPhoneSeenAt() }),
  /** Start Fresh: a new, empty change book (the records are gone). */
  resetChangeBook: () => syncLog.reset(),
  relayPollNow: () => relaySync.pollNow(),
  snapshotVersions,
  publishMergeChanges,
  nextTimestamp: () => syncLog.nextTimestamp(),
  initWebSocketServer,
  broadcastDelta,
  broadcastBulkSync,
  disconnectAll,
  getConnectedClientCount,
  getMobileClientCount,
  broadcastClientCount,
  onClientCountChange
};
