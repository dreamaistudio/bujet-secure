/**
 * syncClock.ts — edit timestamps that respect every device's clock.
 *
 * Each record carries `updated_at`; when the phone and the PC both edited the
 * same record, the newer `updated_at` wins. If one device's clock runs behind,
 * its genuinely newer edit could get an OLDER time and lose. To prevent that,
 * this module remembers the newest edit time it has seen from any device and
 * always stamps a new local edit later than that.
 *
 * Use nextTimestamp() instead of Date.now() whenever setting `updated_at`, and
 * call observeTimestamp() for every record received from another device.
 */

const CLOCK_KEY = 'bs_clock_max';
const MAX_FUTURE_SKEW_MS = 24 * 60 * 60 * 1000; // ignore times > 1 day ahead

let clockMax = 0;
try {
  clockMax = Number(localStorage.getItem(CLOCK_KEY)) || 0;
} catch {
  clockMax = 0;
}

function save() {
  try {
    localStorage.setItem(CLOCK_KEY, String(clockMax));
  } catch {
    /* storage unavailable: keep in memory only */
  }
}

/** Record a timestamp received from another device. */
export function observeTimestamp(ts: unknown): void {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return;
  if (n > Date.now() + MAX_FUTURE_SKEW_MS) return; // one broken clock must not poison ours
  if (n > clockMax) {
    clockMax = n;
    save();
  }
}

/** A timestamp for a new local edit: now, but never earlier than anything seen. */
export function nextTimestamp(): number {
  const ts = Math.max(Date.now(), clockMax + 1);
  clockMax = ts;
  save();
  return ts;
}
