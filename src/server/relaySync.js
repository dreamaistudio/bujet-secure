/**
 * relaySync.js — keeps the desktop's post box moving (sync step 3).
 *
 * Two jobs:
 *   1. Whatever the desktop changes gets dropped into the box for the phone,
 *      in small batches so a burst of edits costs one trip, not twenty.
 *   2. Every so often it looks in the box for what the phone left, hands those
 *      changes to the app, and then tells the box they can be deleted.
 *
 * Everything is locked before it leaves and unlocked after it arrives, so the
 * post box only ever holds sealed envelopes.
 *
 * It does nothing at all until a post box address is set up, so a desktop with
 * no post box behaves exactly as before.
 */
const relayClient = require('./relayClient');

const PUSH_DEBOUNCE_MS = 1500;      // gather a burst of edits into one trip
const PUSH_MAX_BATCH = 200;         // the box accepts at most 200 per trip
const POLL_IDLE_MS = 30000;         // normal check for what the phone left
const POLL_BUSY_MS = 5000;          // quicker just after we heard something
const POLL_BACKOFF_MAX_MS = 5 * 60 * 1000;
const QUEUE_CAP = 2000;

let cfg = null;
let outgoing = [];
let pushTimer = null;
let pollTimer = null;
let running = false;
let pushing = false;
let polling = false;
let failures = 0;
let lastError = null;
let lastOkAt = 0;

// "I'm here" notes. Through the post box neither side can otherwise tell
// whether the other one is actually there right now (the box answers even
// when the other device is switched off), so each side drops a tiny note now
// and then and the "Connected" badge goes by when one was last seen. The PC
// only sends them while a phone has been heard from through the box lately,
// so they never pile up for a phone that is gone (or is on this Wi-Fi).
const PRESENCE_EVERY_MS = 90 * 1000;
const PRESENCE_WHILE_HEARD_MS = 10 * 60 * 1000;
let lastHeardFromPhoneAt = 0;
let lastPushedAt = 0;
/** A phone has just spoken up after being quiet: answer it without delay. */
let phoneJustAppeared = false;

function log(...args) {
  console.log('[Relay]', ...args);
}

/**
 * @param {object} options
 *  getRelayUrl() -> string            where the post box is ('' = switched off)
 *  getKey()      -> string            the pairing key ('' = not paired)
 *  getCursor()   -> number            how far we have read the phone's lane
 *  setCursor(n)                       remember that position
 *  applyFromPhone(messages)           hand the phone's changes to the app
 *  getLanInfo()  -> { ips, port }     (optional) where this PC can be reached
 *                                     on its network right now
 */
function start(options) {
  cfg = options;
  running = true;
  failures = 0;
  scheduleNextPoll(POLL_BUSY_MS);
  const url = safeUrl();
  log(url ? `Post box ready at ${url}` : 'No post box set up — Wi-Fi sync only.');
}

function stop() {
  running = false;
  if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
}

function safeUrl() {
  try { return cfg && cfg.getRelayUrl() ? cfg.getRelayUrl() : ''; } catch { return ''; }
}

function safeKey() {
  try { return cfg && cfg.getKey() ? cfg.getKey() : ''; } catch { return ''; }
}

function isReady() {
  return running && Boolean(safeUrl()) && Boolean(safeKey());
}

/** Where this PC can be reached on its network right now, or undefined. */
function lanInfo() {
  try {
    const info = cfg && typeof cfg.getLanInfo === 'function' ? cfg.getLanInfo() : null;
    if (info && Array.isArray(info.ips) && info.ips.length > 0) return info;
  } catch {}
  return undefined;
}

/** Queue one message for the phone. Harmless when no post box is set up. */
function queueForPhone(message) {
  if (!isReady() || !message) return;
  outgoing.push(message);
  if (outgoing.length > QUEUE_CAP) {
    const dropped = outgoing.length - QUEUE_CAP;
    outgoing = outgoing.slice(dropped);
    console.warn(`[Relay] Post box queue was full; dropped ${dropped} older message(s).`);
  }
  if (!pushTimer) pushTimer = setTimeout(flushOutgoing, PUSH_DEBOUNCE_MS);
}

async function flushOutgoing() {
  pushTimer = null;
  if (pushing || !isReady() || outgoing.length === 0) return;
  pushing = true;
  const batch = outgoing.slice(0, PUSH_MAX_BATCH);
  try {
    await relayClient.pushToPhone(safeUrl(), safeKey(), batch);
    lastPushedAt = Date.now();
    outgoing = outgoing.slice(batch.length);
    lastError = null;
    lastOkAt = Date.now();
    failures = 0;
    if (outgoing.length > 0 && !pushTimer) pushTimer = setTimeout(flushOutgoing, 250);
  } catch (err) {
    // Keep the messages queued and try again on the next poll tick.
    lastError = err.message;
    failures++;
    console.warn('[Relay] Could not leave changes in the post box:', err.message);
  } finally {
    pushing = false;
  }
}

function scheduleNextPoll(delay) {
  if (pollTimer) clearTimeout(pollTimer);
  if (!running) return;
  pollTimer = setTimeout(pollOnce, delay);
}

async function pollOnce() {
  pollTimer = null;
  if (!isReady()) {
    scheduleNextPoll(POLL_IDLE_MS);
    return;
  }
  if (polling) {
    scheduleNextPoll(POLL_BUSY_MS);
    return;
  }
  polling = true;
  let gotSomething = false;
  try {
    // Send anything waiting first, so a reply can come back in the same round.
    if (outgoing.length > 0) await flushOutgoing();

    const since = Number(cfg.getCursor()) || 0;
    const keyAtStart = safeKey();
    const { messages, upto, gap, lastInBox } = await relayClient.pullFromPhone(safeUrl(), keyAtStart, since);
    // The pairing was replaced while this trip was on its way: what came back
    // belongs to the old box, and its numbering must not be carried over to
    // the new one (that would make the new box look already read).
    if (safeKey() !== keyAtStart) return;
    if (gap) {
      console.warn('[Relay] Some post box items had already expired; the phone will send a full copy when it can.');
    }
    // More waiting than one trip brings: come back soon rather than in 30 s.
    if (lastInBox > upto) gotSomething = true;
    if (messages.length > 0) {
      gotSomething = true;
      // A phone that has been quiet for a while has most likely just been
      // opened. Answer that one straight away rather than waiting out the
      // usual gap between notes: until this PC says something, the phone has
      // no way to know it is there, so its badge would sit on "Disconnected"
      // for up to a minute while this PC already showed "Connected".
      if (Date.now() - lastHeardFromPhoneAt > PRESENCE_EVERY_MS) phoneJustAppeared = true;
      lastHeardFromPhoneAt = Date.now();
      log(`Collected ${messages.length} change(s) left by the phone.`);
      await cfg.applyFromPhone(messages);
      // A message in that batch may have replaced the pairing (a phone that
      // pressed Start Fresh). Its position in the old box must not be carried
      // over to the new one.
      if (safeKey() !== keyAtStart) return;
    }
    if (upto > since) {
      cfg.setCursor(upto);
      // Only now, once the changes are stored here, let the box delete them.
      try {
        await relayClient.ackPhoneLane(safeUrl(), safeKey(), upto);
      } catch (err) {
        console.warn('[Relay] Could not confirm collection to the post box:', err.message);
      }
    }
    lastError = null;
    lastOkAt = Date.now();
    failures = 0;

    const now = Date.now();
    if (
      now - lastHeardFromPhoneAt < PRESENCE_WHILE_HEARD_MS &&
      (phoneJustAppeared || now - lastPushedAt > PRESENCE_EVERY_MS) &&
      outgoing.length === 0
    ) {
      phoneJustAppeared = false;
      // The note also says where this PC can be reached on its network now.
      // A phone that knows only an old address (the PC moved to another
      // Wi-Fi, or the router handed out a new one) uses it to connect
      // directly again instead of staying on the slower post box.
      queueForPhone({ type: 'presence', lan: lanInfo() });
    }
  } catch (err) {
    failures++;
    lastError = err.message;
    if (failures <= 3 || failures % 10 === 0) {
      console.warn(`[Relay] Post box unreachable (${failures} time(s)):`, err.message);
    }
  } finally {
    polling = false;
    const backoff = Math.min(POLL_IDLE_MS * Math.pow(2, Math.max(0, failures - 1)), POLL_BACKOFF_MAX_MS);
    scheduleNextPoll(failures > 0 ? backoff : (gotSomething ? POLL_BUSY_MS : POLL_IDLE_MS));
  }
}

/** Check for the phone's changes right now (e.g. the app just started). */
function pollNow() {
  scheduleNextPoll(0);
}

/** Forget everything: used when the user unpairs or rotates the pairing. */
async function clearBox(keyText) {
  outgoing = [];
  lastHeardFromPhoneAt = 0; // that pairing's phone is gone
  phoneJustAppeared = false;
  if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
  const url = safeUrl();
  const key = keyText || safeKey();
  if (!url || !key) return;
  try {
    await relayClient.destroyBox(url, key);
    log('Post box emptied.');
  } catch (err) {
    console.warn('[Relay] Could not empty the post box:', err.message);
  }
  // Leave one last note in the emptied box: "you have been disconnected".
  // A phone on this Wi-Fi is told directly, but a phone that is away only
  // ever looks in the box - without this note it would keep showing
  // "connected" to a pairing that no longer exists. (Emptying the box keeps
  // its numbering, so the phone finds the note after what it already read.)
  try {
    await relayClient.pushToPhone(url, key, [{ type: 'unpaired', reason: 'Pairing replaced on the PC' }]);
  } catch (err) {
    console.warn('[Relay] Could not leave the disconnect note in the post box:', err.message);
  }
}

function status() {
  return {
    configured: Boolean(safeUrl()),
    paired: Boolean(safeKey()),
    queued: outgoing.length,
    failures,
    lastError,
    lastOkAt
  };
}

module.exports = { start, stop, queueForPhone, pollNow, clearBox, status, isReady, lanInfo };
