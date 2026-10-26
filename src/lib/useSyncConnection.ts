import React, { useEffect, useRef, useState, useCallback } from 'react';
import { App as CapApp } from '@capacitor/app';
import { Network } from '@capacitor/network';
import { STORAGE_KEYS } from '../data';
import { observeTimestamp } from './syncClock';
import { encryptJson, decryptJson, isEnvelope, isValidKeyText } from './syncCrypto';
import { pushToPc, pullFromPc, ackPcLane, normalizeRelayUrl, relayReachable } from './relayClient';
import {
  Transaction,
  LoanEntry,
  SavingsEntry,
  Keeper,
  Bill,
  BillPayment,
  AppSettings
} from '../types';

export type SyncStatus = 'disconnected' | 'connecting' | 'connected' | 'syncing' | 'error';

export interface SyncCredentials {
  host: string;
  port: number;
  token: string;
  /** Sync step 2: the secret that locks the data. Comes from the QR code only. */
  key?: string;
  /** Sync step 3: the internet post box, for when the PC is not on this Wi-Fi. */
  relayUrl?: string;
  lastConnectedAt?: number;
}

export interface UseSyncConnectionProps {
  transactions: Transaction[];
  loans: LoanEntry[];
  savings: SavingsEntry[];
  keepers: Keeper[];
  bills: Bill[];
  billPayments: BillPayment[];
  settings: AppSettings;
  setTransactions: React.Dispatch<React.SetStateAction<Transaction[]>>;
  setLoans: React.Dispatch<React.SetStateAction<LoanEntry[]>>;
  setSavings: React.Dispatch<React.SetStateAction<SavingsEntry[]>>;
  setKeepers: React.Dispatch<React.SetStateAction<Keeper[]>>;
  setBills: React.Dispatch<React.SetStateAction<Bill[]>>;
  setBillPayments: React.Dispatch<React.SetStateAction<BillPayment[]>>;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
}

const BACKOFF_DELAYS = [1000, 2000, 4000, 8000, 15000, 30000];

// ---------------------------------------------------------------------------
// Sync step 1: device id + cursor into the desktop's numbered change book
// ---------------------------------------------------------------------------

const DEVICE_ID_KEY = 'bs_device_id';
const CURSOR_KEY = 'bs_sync_cursor';
/** Once a day do one full comparison as a safety net, even if nothing seems missing. */
const FULL_RESYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** An older desktop version does not answer "hello"; fall back to the old full sync. */
const HELLO_TIMEOUT_MS = 5000;

export interface SyncCursor {
  hubId: string;
  seq: number;
  lastFullSyncAt: number;
}

// ---------------------------------------------------------------------------
// Sync step 3: position in the PC's post box lane. The numbering belongs to one
// box, and a new pairing means a new box, so the position is stored next to a
// tag of the key and reset whenever that changes.
// ---------------------------------------------------------------------------

const RELAY_CURSOR_KEY = 'bs_relay_cursor';
/** How often to look in the post box while the app is open and off Wi-Fi. */
const RELAY_POLL_MS = 25000;
/** How often this phone leaves an "I'm here" note in the post box while away. */
const PRESENCE_EVERY_MS = 90 * 1000;
/**
 * Through the post box, the PC counts as there right now if something from it
 * (a change or its own "I'm here" note) arrived within this long.
 */
const PRESENCE_FRESH_MS = 4 * 60 * 1000;
/** While waiting for the PC's first word back, look this often... */
const EAGER_POLL_MS = 4000;
/** ...for at most this long, then settle back to the usual slow rhythm. */
const EAGER_WINDOW_MS = 90 * 1000;

function keyTag(keyText: string): string {
  return (keyText || '').slice(0, 10);
}

export function loadRelayCursor(keyText: string): number {
  try {
    const raw = localStorage.getItem(RELAY_CURSOR_KEY);
    if (!raw) return 0;
    const c = JSON.parse(raw);
    if (c && c.tag === keyTag(keyText) && Number.isFinite(c.seq)) return c.seq;
  } catch {}
  return 0;
}

export function saveRelayCursor(keyText: string, seq: number): void {
  try {
    localStorage.setItem(RELAY_CURSOR_KEY, JSON.stringify({ tag: keyTag(keyText), seq }));
  } catch {}
}

function clearRelayCursor(): void {
  try { localStorage.removeItem(RELAY_CURSOR_KEY); } catch {}
  try { localStorage.removeItem(RELAY_BOOT_KEY); } catch {}
}

// ---------------------------------------------------------------------------
// Sync step 3: the first full exchange, through the post box.
//
// Over Wi-Fi the first connection swaps both devices' complete data
// (init_sync / init_sync_ack). A phone that pairs from another network never
// gets that connection, so without this it would only ever see changes made
// AFTER pairing - nothing that was already on the PC. Instead it leaves its
// full copy in the post box, in parts, and the PC answers with its own.
// ---------------------------------------------------------------------------

const RELAY_BOOT_KEY = 'bs_relay_boot';
/** If the PC has not answered by then (it was off, say), send the copy again. */
const RELAY_BOOT_RESEND_MS = 6 * 60 * 60 * 1000;
/** Plain data per part; a part grows by about a third once locked (limit 128 KB). */
const SNAPSHOT_PART_BYTES = 48 * 1024;

interface RelayBoot {
  tag: string;
  sentAt: number;
  done: boolean;
}

function loadRelayBoot(keyText: string): RelayBoot | null {
  try {
    const raw = localStorage.getItem(RELAY_BOOT_KEY);
    if (!raw) return null;
    const b = JSON.parse(raw);
    if (b && b.tag === keyTag(keyText)) {
      return { tag: b.tag, sentAt: Number(b.sentAt) || 0, done: Boolean(b.done) };
    }
  } catch {}
  return null;
}

function saveRelayBoot(keyText: string, boot: { sentAt: number; done: boolean }): void {
  try {
    localStorage.setItem(RELAY_BOOT_KEY, JSON.stringify({ tag: keyTag(keyText), ...boot }));
  } catch {}
}

/** The full exchange has happened (by Wi-Fi or post box): no need to send the copy. */
function markRelayBootDone(keyText: string): void {
  if (!keyText) return;
  saveRelayBoot(keyText, { sentAt: Date.now(), done: true });
}

/** This phone's full copy, as init_sync messages small enough for the post box. */
function buildSnapshotParts(st: {
  transactions: any[]; loans: any[]; savings: any[]; keepers: any[];
  bills: any[]; billPayments: any[]; settings: any;
}, bootId: string): any[] {
  const lists: Array<[string, any[]]> = [
    ['transactions', st.transactions || []],
    ['loans', st.loans || []],
    ['keepers', st.keepers || []],
    ['savings', st.savings || []],
    ['bills', st.bills || []],
    ['billPayments', st.billPayments || []]
  ];
  // Worked out over everything, because only one part carries the settings
  // and the PC needs this answer to decide whose settings to keep.
  const hasData = [st.transactions, st.loans, st.savings, st.bills]
    .some((arr) => (arr || []).some((r: any) => r && !r.deleted));

  const payloads: any[] = [];
  let current: any = {};
  let size = 0;
  if (st.settings) {
    current.settings = st.settings;
    size += JSON.stringify(st.settings).length;
  }
  for (const [name, rows] of lists) {
    for (const row of rows) {
      const rowSize = JSON.stringify(row).length + 1;
      if (size > 0 && size + rowSize > SNAPSHOT_PART_BYTES) {
        payloads.push(current);
        current = {};
        size = 0;
      }
      (current[name] = current[name] || []).push(row);
      size += rowSize;
    }
  }
  payloads.push(current);
  return payloads.map((payload, i) => ({
    type: 'init_sync',
    payload,
    hasData,
    bootId,
    part: i,
    parts: payloads.length
  }));
}

function randomId(): string {
  try {
    const c: any = (globalThis as any).crypto;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  } catch {}
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = randomId();
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    return 'unknown-device';
  }
}

export function loadSyncCursor(): SyncCursor | null {
  try {
    const raw = localStorage.getItem(CURSOR_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw);
    if (c && typeof c.hubId === 'string' && Number.isFinite(c.seq)) {
      return { hubId: c.hubId, seq: c.seq, lastFullSyncAt: Number(c.lastFullSyncAt) || 0 };
    }
  } catch {}
  return null;
}

export function saveSyncCursor(cursor: SyncCursor | null): void {
  try {
    if (cursor) localStorage.setItem(CURSOR_KEY, JSON.stringify(cursor));
    else localStorage.removeItem(CURSOR_KEY);
  } catch {}
}

/** Move the cursor forward after a live change from the same desktop book. */
function advanceSyncCursor(hubId: unknown, seq: unknown): void {
  if (typeof hubId !== 'string' || typeof seq !== 'number' || !Number.isFinite(seq)) return;
  const c = loadSyncCursor();
  if (c && c.hubId === hubId && seq > c.seq) {
    saveSyncCursor({ ...c, seq });
  }
}

/**
 * Validate host connectivity and token before saving credentials
 */
export async function validateCredentials(credentials: SyncCredentials, timeoutMs = 7000): Promise<boolean> {
  return new Promise((resolve) => {
    let resolved = false;
    let ws: WebSocket | null = null;
    const finish = (ok: boolean) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      try { ws?.close(); } catch {}
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);

    try {
      ws = new WebSocket(`ws://${credentials.host}:${credentials.port}/ws?token=${credentials.token}`);
      ws.onmessage = async (event) => {
        try {
          let msg = JSON.parse(event.data);
          if (isEnvelope(msg)) {
            if (!credentials.key) return finish(false);
            // Unlocking this proves the key is right.
            msg = await decryptJson(credentials.key, msg);
          }
          if (msg.type === 'connected') {
            // Prove the key works before saying the pairing is good.
            if (credentials.key && ws && ws.readyState === WebSocket.OPEN) {
              const env = await encryptJson(credentials.key, { type: 'ping' });
              ws.send(JSON.stringify(env));
            } else if (msg.secure) {
              finish(false); // desktop needs a key, this code has none
            } else {
              finish(true); // older desktop without locking
            }
          } else if (msg.type === 'pong') {
            finish(true);
          }
        } catch {
          finish(false);
        }
      };
      ws.onerror = () => finish(false);
      ws.onclose = () => finish(false);
    } catch {
      finish(false);
    }
  });
}

export function loadSyncCredentials(): SyncCredentials | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.syncCredentials);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.host && parsed.port && parsed.token) {
        return parsed; // `key` (sync step 2) travels with the rest
      }
    }
  } catch {}
  return null;
}

export function saveSyncCredentials(creds: SyncCredentials | null) {
  if (creds) {
    localStorage.setItem(STORAGE_KEYS.syncCredentials, JSON.stringify(creds));
  } else {
    localStorage.removeItem(STORAGE_KEYS.syncCredentials);
  }
}

/**
 * Take the settings the PC sent, but never let a blank from the PC wipe
 * something this phone has: a PC that has no PIN (or no ledger name) must not
 * remove the phone's. Everything else - ledger names, currency, lock timer and
 * so on - is the same on both devices, so the PC's newer copy is kept.
 */
function mergeSettingsFromDesktop(prev: any, incoming: any): any {
  const next = { ...prev, ...incoming };
  const blank = (v: unknown) => typeof v !== 'string' || v.trim() === '';
  for (const key of ['authPin', 'businessLedgerName', 'personalLedgerName', 'currency', 'lockTimer']) {
    if (blank(incoming?.[key]) && !blank(prev?.[key])) next[key] = prev[key];
  }
  return next;
}

const IPV4_RE = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

/**
 * A short fingerprint of the pairing, worked out from the key exactly as the
 * PC does (api.js pairingFingerprint). The PC shows it to anyone who asks;
 * the key cannot be worked out from it. It tells this phone's own PC apart
 * from any other PC running Budget Secure on the same network.
 */
async function pairingFingerprint(keyText: string): Promise<string> {
  try {
    const data = new TextEncoder().encode(`budget-secure-pair-id:${keyText}`);
    const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', data as unknown as BufferSource));
    let hex = '';
    for (let i = 0; i < digest.length; i++) hex += digest[i].toString(16).padStart(2, '0');
    return hex.slice(0, 16);
  } catch {
    return '';
  }
}

/**
 * Is a PC running Budget Secure answering at ip:port, and is it the PC this
 * phone is paired with? (An older PC that shows no fingerprint is accepted.)
 */
async function isOurPcAt(ip: string, port: number, fingerprint: string, timeoutMs: number): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`http://${ip}:${port}/api/sync/ping`, { signal: controller.signal });
    if (!res.ok) return false;
    const data = await res.json();
    if (!data || data.app !== 'budget-secure') return false;
    if (fingerprint && typeof data.pair === 'string' && data.pair && data.pair !== fingerprint) return false;
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Probe /24 subnet for desktop instance if DHCP changed desktop IP.
 * `fingerprint` (when known) makes it skip any other PC running Budget
 * Secure on the network: connecting to one of those would be turned away
 * and wipe this phone's pairing.
 */
async function discoverDesktopOnSubnet(
  currentHost: string,
  port: number,
  onFound: (newHost: string) => void,
  fingerprint = ''
): Promise<boolean> {
  const parts = currentHost.split('.');
  if (parts.length !== 4) return false;
  const subnet = parts.slice(0, 3).join('.');

  const ips: string[] = [];
  for (let i = 1; i <= 254; i++) {
    const ip = `${subnet}.${i}`;
    if (ip !== currentHost) {
      ips.push(ip);
    }
  }

  const CONCURRENCY = 20;
  let found = false;

  for (let i = 0; i < ips.length; i += CONCURRENCY) {
    if (found) break;
    const batch = ips.slice(i, i + CONCURRENCY);
    const promises = batch.map(async (ip) => {
      if (found) return;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 300);
        const res = await fetch(`http://${ip}:${port}/api/sync/ping`, {
          signal: controller.signal
        });
        clearTimeout(timer);
        if (res.ok) {
          const data = await res.json();
          const otherPc = Boolean(fingerprint && data && typeof data.pair === 'string' && data.pair && data.pair !== fingerprint);
          if (data && data.app === 'budget-secure' && !otherPc && !found) {
            found = true;
            onFound(ip);
          }
        }
      } catch {
        // Expected timeout or unreachable
      }
    });

    await Promise.all(promises);
  }

  return found;
}

export interface OutboxItem {
  seq: number;
  entity: string;
  action: 'upsert' | 'delete';
  data: any;
  queuedAt: number;
  /** Unique id; the desktop confirms each change by this id before it is removed. */
  changeId?: string;
}

export const OUTBOX_STORAGE_KEY = 'finance_vault_sync_outbox';
const OUTBOX_CAP = 2000;

export function loadOutbox(): OutboxItem[] {
  try {
    const raw = localStorage.getItem(OUTBOX_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        // Items queued by an older version have no changeId yet: give them one.
        let patched = false;
        for (const item of parsed) {
          if (item && !item.changeId) {
            item.changeId = randomId();
            patched = true;
          }
        }
        if (patched) localStorage.setItem(OUTBOX_STORAGE_KEY, JSON.stringify(parsed));
        return parsed;
      }
    }
  } catch {}
  return [];
}

/** Number of changes made on this device that the desktop has not confirmed yet. */
export function getPendingChangeCount(): number {
  return loadOutbox().length;
}

export function saveOutbox(items: OutboxItem[]): void {
  try {
    localStorage.setItem(OUTBOX_STORAGE_KEY, JSON.stringify(items));
  } catch (err) {
    console.error('[SyncOutbox] Failed to save outbox to localStorage:', err);
  }
}

export function clearOutboxStorage(): void {
  localStorage.removeItem(OUTBOX_STORAGE_KEY);
}

export function deduplicateOutbox(items: OutboxItem[]): OutboxItem[] {
  if (items.length <= 1) return items;
  // If the outbox contains multiple entries for the same (entity, id),
  // keep only the LATEST one — except that a 'delete' always wins over any earlier 'upsert' for the same id.
  const entityMap = new Map<string, OutboxItem>();
  const passThroughItems: OutboxItem[] = [];

  for (const item of items) {
    const id = item.data?.id;
    if (!id || item.entity === 'bulk_sync' || item.entity === 'reset') {
      passThroughItems.push(item);
      continue;
    }
    const key = `${item.entity}:${id}`;
    const existing = entityMap.get(key);
    if (!existing) {
      entityMap.set(key, item);
    } else {
      if (existing.action === 'delete' && item.action === 'upsert' && existing.queuedAt >= item.queuedAt) {
        // delete wins
      } else {
        entityMap.set(key, item);
      }
    }
  }

  const result = [...passThroughItems, ...Array.from(entityMap.values())];
  result.sort((a, b) => a.seq - b.seq || a.queuedAt - b.queuedAt);
  return result;
}

export function appendToOutbox(
  entity: string,
  action: 'upsert' | 'delete',
  data: any
): OutboxItem[] {
  const current = loadOutbox();
  const nextSeq = current.length > 0 ? current[current.length - 1].seq + 1 : 1;
  const newItem: OutboxItem = {
    seq: nextSeq,
    entity,
    action,
    data,
    queuedAt: Date.now(),
    changeId: randomId()
  };
  let updated = [...current, newItem];

  if (updated.length > OUTBOX_CAP) {
    console.warn(`[SyncOutbox] Outbox exceeded ${OUTBOX_CAP} entries. Dropping oldest non-delete entry.`);
    const oldestNonDeleteIndex = updated.findIndex((i) => i.action !== 'delete');
    if (oldestNonDeleteIndex >= 0) {
      updated.splice(oldestNonDeleteIndex, 1);
    } else {
      updated.shift();
    }
  }

  saveOutbox(updated);
  return updated;
}

/**
 * Merge local state with incoming rows by ID using Last-Write-Wins (LWW)
 * Preserves unacknowledged local tombstones (Fix 2.2 #5)
 */
export function mergeEntitiesById<T extends { id: string; updated_at?: number; deleted?: number }>(
  localList: T[],
  incomingList: T[]
): T[] {
  const map = new Map<string, T>();
  for (const item of localList) {
    if (item && item.id) {
      map.set(item.id, item);
    }
  }
  for (const incoming of incomingList) {
    if (!incoming || !incoming.id) continue;
    const existing = map.get(incoming.id);
    if (!existing) {
      map.set(incoming.id, incoming);
    } else {
      const incomingTs = incoming.updated_at || 0;
      const existingTs = existing.updated_at || 0;
      // Keep the existing fields and lay the winning copy on top, so a short
      // delete notice ({ id, deleted, updated_at }) does not wipe the record's details.
      if (incomingTs > existingTs) {
        map.set(incoming.id, { ...existing, ...incoming });
      } else if (incomingTs === existingTs) {
        if (existing.deleted && !incoming.deleted) {
          // Local deletion wins tie
        } else {
          map.set(incoming.id, { ...existing, ...incoming });
        }
      }
    }
  }
  return Array.from(map.values());
}

export function useSyncConnection({
  transactions,
  loans,
  savings,
  keepers,
  bills,
  billPayments,
  settings,
  setTransactions,
  setLoans,
  setSavings,
  setKeepers,
  setBills,
  setBillPayments,
  setSettings
}: UseSyncConnectionProps) {
  const [credentials, setCredentials] = useState<SyncCredentials | null>(loadSyncCredentials);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('disconnected');
  /** How many changes made here the desktop has not confirmed yet. */
  const [pendingCount, setPendingCount] = useState<number>(() => getPendingChangeCount());
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(() => {
    const stored = localStorage.getItem('bs_last_sync_at');
    return stored ? Number(stored) : null;
  });
  const [showDiscoveryBanner, setShowDiscoveryBanner] = useState<boolean>(false);
  const [discoveryToast, setDiscoveryToast] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const activeCredsRef = useRef<SyncCredentials | null>(credentials);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const isManuallyClosedRef = useRef(false);
  const isBackgroundedRef = useRef(false);
  const disconnectStartTimeRef = useRef<number | null>(null);
  const isDiscoveringRef = useRef(false);

  // Heartbeat watchdog refs (FIX 1.1)
  const lastPingSentAtRef = useRef<number>(0);
  const lastInboundAtRef = useRef<number>(Date.now());
  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const resumeVerifyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync step 2: the secret that locks data, plus queues that keep messages in
  // order. Locking and unlocking take a moment, so every outgoing message waits
  // for the previous one, and the same for incoming ones.
  const secureKeyRef = useRef<string>('');
  /** Sync step 3 */
  const relayUrlRef = useRef<string>('');
  const relayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const relayBusyRef = useRef(false);
  const relayFailuresRef = useRef(0);
  /**
   * Until this moment, look in the post box every few seconds instead of
   * every 25. Set after this phone has left something for the PC but has not
   * heard back yet: the PC's answer cannot arrive any faster than the next
   * look, and waiting the full 25 seconds for it is what left this phone
   * showing "Disconnected" while the PC already showed "Connected".
   */
  const eagerUntilRef = useRef(0);
  /**
   * True while the post box round trip is working. The status badge treats that
   * as connected: changes really are reaching the desktop, just by post instead
   * of over Wi-Fi, so showing "Offline" there would be untrue.
   */
  const relayHealthyRef = useRef(false);
  /** When the PC was last heard from through the post box (0 = not lately). */
  const lastHeardFromPcRef = useRef(0);
  /** When this phone last put anything in the post box. */
  const lastPushToPcRef = useRef(0);
  /**
   * For the badge at the top: is the PC there RIGHT NOW? True while the
   * Wi-Fi link is up, or while the PC is being heard from through the post
   * box. (syncStatus says "connected" as soon as the post box answers, even
   * if the PC itself is switched off.)
   */
  const [pcOnline, setPcOnline] = useState(false);
  /** Handles "this is where the PC is now" from the post box (set further down). */
  const considerPcAddressRef = useRef<(lan: any) => void>(() => {});
  const lastAddressProbeRef = useRef<{ at: number; list: string }>({ at: 0, list: '' });
  const addressProbeBusyRef = useRef(false);
  const sendQueueRef = useRef<Promise<void>>(Promise.resolve());
  const inboundQueueRef = useRef<Promise<void>>(Promise.resolve());

  // Sync step 1 refs
  const helloTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** True once this socket finished catching up; changes are only sent after that. */
  const handshakeDoneRef = useRef(false);
  /** True when the desktop confirms each change (new desktop); false for an older desktop. */
  const serverSupportsAcksRef = useRef(false);
  /** Changes already sent on the current socket (re-sent only after a reconnect). */
  const sentOnThisSocketRef = useRef<Set<string>>(new Set());

  // Forward ref for connect to prevent circular dependencies
  const connectRef = useRef<(creds?: SyncCredentials | null) => void>(() => {});

  // Keep references to current state for init_sync
  const stateRef = useRef({
    transactions,
    loans,
    savings,
    keepers,
    bills,
    billPayments,
    settings
  });

  useEffect(() => {
    stateRef.current = {
      transactions,
      loans,
      savings,
      keepers,
      bills,
      billPayments,
      settings
    };
  }, [transactions, loans, savings, keepers, bills, billPayments, settings]);

  const markSyncActivity = useCallback(() => {
    const now = Date.now();
    setLastSyncAt(now);
    localStorage.setItem('bs_last_sync_at', String(now));
  }, []);

  const teardownSocket = useCallback((ws: WebSocket | null) => {
    if (!ws) return;
    try {
      ws.onopen = null;
      ws.onclose = null;
      ws.onerror = null;
      ws.onmessage = null;
      ws.close();
    } catch {}
  }, []);

  /**
   * Send one message to the desktop, locked when a key is set. Queued so the
   * desktop receives messages in the same order they were made.
   */
  const sendSecure = useCallback((ws: WebSocket | null, obj: any) => {
    if (!ws) return;
    sendQueueRef.current = sendQueueRef.current
      .then(async () => {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        const key = secureKeyRef.current;
        const text = key ? JSON.stringify(await encryptJson(key, obj)) : JSON.stringify(obj);
        if (ws.readyState === WebSocket.OPEN) ws.send(text);
      })
      .catch((err) => {
        console.error('[SyncClient] Failed to send message:', err);
      });
  }, []);

  const clearHeartbeat = useCallback(() => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
    if (resumeVerifyTimerRef.current) {
      clearTimeout(resumeVerifyTimerRef.current);
      resumeVerifyTimerRef.current = null;
    }
  }, []);

  const clearHelloTimer = useCallback(() => {
    if (helloTimerRef.current) {
      clearTimeout(helloTimerRef.current);
      helloTimerRef.current = null;
    }
  }, []);

  /**
   * Merge records received from the desktop into this device's data.
   * Newer edit wins per record. Saved to storage right away (together with the
   * cursor afterwards) so a crash cannot leave the cursor ahead of the data.
   */
  const mergeRowsIntoState = useCallback((rowsByEntity: Record<string, any[]>) => {
    const targets: Record<string, { key: string; set: React.Dispatch<React.SetStateAction<any[]>> }> = {
      transaction: { key: STORAGE_KEYS.transactions, set: setTransactions as any },
      loan: { key: STORAGE_KEYS.loans, set: setLoans as any },
      saving: { key: STORAGE_KEYS.savings, set: setSavings as any },
      keeper: { key: STORAGE_KEYS.keepers, set: setKeepers as any },
      bill: { key: STORAGE_KEYS.bills, set: setBills as any },
      billPayment: { key: STORAGE_KEYS.billPayments, set: setBillPayments as any }
    };
    for (const [entity, rows] of Object.entries(rowsByEntity)) {
      const target = targets[entity];
      if (!target || !Array.isArray(rows) || rows.length === 0) continue;
      const cleanRows = rows.filter((r) => r && typeof r.id === 'string');
      if (cleanRows.length === 0) continue;
      for (const r of cleanRows) observeTimestamp(r.updated_at);
      try {
        let stored: any[] = [];
        const raw = localStorage.getItem(target.key);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) stored = parsed;
        }
        localStorage.setItem(target.key, JSON.stringify(mergeEntitiesById(stored, cleanRows)));
      } catch (err) {
        console.error('[SyncClient] Failed to save merged rows:', err);
      }
      target.set((prev: any[]) => mergeEntitiesById(prev, cleanRows));
    }
  }, [setTransactions, setLoans, setSavings, setKeepers, setBills, setBillPayments]);

  const applySettingsFromDesktop = useCallback((incoming: any, onlyIfNewer: boolean) => {
    if (!incoming || typeof incoming !== 'object') return;
    setSettings((prev) => {
      const inTs = Number(incoming.settings_updated_at) || 0;
      const localTs = Number((prev as any)?.settings_updated_at) || 0;
      if (onlyIfNewer && inTs < localTs) return prev;
      const next = mergeSettingsFromDesktop(prev, incoming);
      localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(next));
      return next;
    });
  }, [setSettings]);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  const triggerDiscoveryIfNeeded = useCallback(async (creds: SyncCredentials) => {
    if (isDiscoveringRef.current || isManuallyClosedRef.current) return;
    isDiscoveringRef.current = true;
    console.log('[SyncClient] Connection failing for >60s. Initiating subnet discovery...');
    try {
      const fingerprint = creds.key ? await pairingFingerprint(creds.key) : '';
      const found = await discoverDesktopOnSubnet(creds.host, creds.port, (newHost) => {
        console.log(`[SyncClient] Desktop discovered at new IP: ${newHost}`);
        const updated: SyncCredentials = { ...creds, host: newHost, lastConnectedAt: Date.now() };
        saveSyncCredentials(updated);
        setCredentials(updated);
        // (Not activeCredsRef here: connect() records the new address itself.
        // Recording it first made connect() take the new address for the
        // attempt already under way to the old one, and skip connecting.)
        setShowDiscoveryBanner(false);
        setDiscoveryToast('Desktop found at a new address — reconnected.');
        reconnectAttemptRef.current = 0;
        connectRef.current(updated);
      }, fingerprint);

      if (!found) {
        console.warn('[SyncClient] Subnet discovery found no host.');
        setShowDiscoveryBanner(true);
      }
    } catch (err) {
      console.error('[SyncClient] Subnet discovery error:', err);
    } finally {
      isDiscoveringRef.current = false;
    }
  }, []);

  const scheduleReconnect = useCallback((forcedDelay?: number) => {
    if (isManuallyClosedRef.current) return;
    if (isBackgroundedRef.current) return;
    clearReconnectTimer();

    const targetCreds = activeCredsRef.current || loadSyncCredentials();
    if (!targetCreds) {
      setSyncStatus('disconnected');
      return;
    }

    let delay: number;
    if (typeof forcedDelay === 'number') {
      delay = forcedDelay;
    } else {
      const base = BACKOFF_DELAYS[Math.min(reconnectAttemptRef.current, BACKOFF_DELAYS.length - 1)];
      const jitter = 0.8 + Math.random() * 0.4;
      delay = Math.round(base * jitter);
      reconnectAttemptRef.current += 1;
    }

    // Check if disconnected for > 60 seconds (FIX 1.5)
    if (disconnectStartTimeRef.current && Date.now() - disconnectStartTimeRef.current > 60000) {
      triggerDiscoveryIfNeeded(targetCreds);
    }

    reconnectTimeoutRef.current = setTimeout(() => {
      connectRef.current(targetCreds);
    }, delay);
  }, [clearReconnectTimer, triggerDiscoveryIfNeeded]);

  const flushOutbox = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !handshakeDoneRef.current) return;
    const items = deduplicateOutbox(loadOutbox());
    saveOutbox(items); // store the compacted list
    if (items.length === 0) return;

    // New desktop: keep each change until the desktop confirms it (delta_ack),
    // so a change sent into a silently dead connection is re-sent, never lost.
    // Older desktop (no confirmations): remove after sending, as before.
    const awaitAcks = serverSupportsAcksRef.current;
    const sent = sentOnThisSocketRef.current;
    const removeNow = new Set<string>();

    for (const item of items) {
      const changeId = item.changeId || '';
      if (awaitAcks && changeId && sent.has(changeId)) continue;
      try {
        if (item.entity === 'bulk_sync') {
          sendSecure(ws, { type: 'bulk_sync', payload: item.data, changeId });
        } else {
          sendSecure(ws, {
            type: 'sync_delta',
            entity: item.entity,
            action: item.action,
            data: item.data,
            updated_at: item.data?.updated_at || Date.now(),
            changeId
          });
        }
        if (changeId) sent.add(changeId);
        if (!awaitAcks && changeId) removeNow.add(changeId);
      } catch (err) {
        console.error('[SyncOutbox] ws.send failed during flush:', err);
        break;
      }
    }

    if (removeNow.size > 0) {
      saveOutbox(loadOutbox().filter((i) => !removeNow.has(i.changeId || '')));
      markSyncActivity();
    }
  }, [markSyncActivity, sendSecure]);

  const flushOutboxRef = useRef(flushOutbox);
  useEffect(() => {
    flushOutboxRef.current = flushOutbox;
  }, [flushOutbox]);

  /**
   * Apply one message from the desktop, whether it arrived over Wi-Fi or was
   * collected from the internet post box.
   *
   * Note on post box messages (ctx.viaRelay): they are applied in full, but
   * they do NOT move the Wi-Fi catch-up marker. Only the Wi-Fi path guarantees
   * that nothing in between was missed, so the marker moves there alone. The
   * worst case is that a few changes are downloaded again next time the phone
   * is on the same Wi-Fi, which is harmless — applying the same change twice
   * changes nothing.
   */
  const disconnectRef = useRef<(() => void) | null>(null);

  const applyIncomingMessage = useCallback((msg: any, ctx: {
    viaRelay?: boolean;
    reply?: (obj: any) => void;
    sendInitSync?: () => void;
  } = {}) => {
        try {
          if (msg.type === 'resume_changes') {
            // New desktop: only the changes we missed since our cursor.
            clearHelloTimer();
            serverSupportsAcksRef.current = true;
            const grouped: Record<string, any[]> = {};
            let settingsRow: any = null;
            for (const r of Array.isArray(msg.rows) ? msg.rows : []) {
              if (!r || !r.entity || !r.data) continue;
              if (r.entity === 'settings') settingsRow = r.data;
              else (grouped[r.entity] = grouped[r.entity] || []).push(r.data);
            }
            mergeRowsIntoState(grouped);
            if (settingsRow) applySettingsFromDesktop(settingsRow, true);
            const prev = loadSyncCursor();
            if (typeof msg.hubId === 'string' && typeof msg.upto === 'number') {
              saveSyncCursor({
                hubId: msg.hubId,
                seq: msg.upto,
                lastFullSyncAt: prev && prev.hubId === msg.hubId ? prev.lastFullSyncAt : Date.now()
              });
            }
            handshakeDoneRef.current = true;
            // Resuming means a full exchange happened before, so the post box
            // never needs to carry one for this pairing.
            markRelayBootDone(secureKeyRef.current);
            stopRelayRef.current();
            setSyncStatus('connected');
            markSyncActivity();
            flushOutboxRef.current();
          } else if (msg.type === 'bootstrap_required') {
            // New desktop, but our cursor is missing/old: do one full sync.
            clearHelloTimer();
            serverSupportsAcksRef.current = true;
            ctx.sendInitSync?.();
          } else if (msg.type === 'init_sync_ack' && ctx.viaRelay) {
            // The PC's full copy, sent in parts through the post box after
            // this phone paired from another network. Each part is merged as
            // it comes; the Wi-Fi link is left alone - there is none.
            const payload = msg.payload || {};
            mergeRowsIntoState({
              transaction: payload.transactions || [],
              loan: payload.loans || [],
              saving: payload.savings || [],
              keeper: payload.keepers || [],
              bill: payload.bills || [],
              billPayment: payload.billPayments || []
            });
            if (payload.settings) applySettingsFromDesktop(payload.settings, false);
            const isLast = typeof msg.parts !== 'number' || msg.part === msg.parts - 1;
            if (isLast) {
              // Only once every part is in is this a complete copy, so only
              // then may the Wi-Fi catch-up marker point at it.
              if (typeof msg.hubId === 'string' && typeof msg.upto === 'number') {
                saveSyncCursor({ hubId: msg.hubId, seq: msg.upto, lastFullSyncAt: Date.now() });
              }
              markRelayBootDone(secureKeyRef.current);
            }
            if (msg.lan) considerPcAddressRef.current(msg.lan);
            markSyncActivity();
          } else if (msg.type === 'presence') {
            // The PC's "I'm here" note through the post box. It also says
            // where the PC can be reached on its network now.
            if (ctx.viaRelay && msg.lan) considerPcAddressRef.current(msg.lan);
          } else if (msg.type === 'init_sync_ack') {
            clearHelloTimer();
            const payload = msg.payload || {};
            mergeRowsIntoState({
              transaction: payload.transactions || [],
              loan: payload.loans || [],
              saving: payload.savings || [],
              keeper: payload.keepers || [],
              bill: payload.bills || [],
              billPayment: payload.billPayments || []
            });
            if (payload.settings) applySettingsFromDesktop(payload.settings, false);
            markRelayBootDone(secureKeyRef.current);
            if (typeof msg.hubId === 'string' && typeof msg.upto === 'number') {
              // New desktop: remember where its change book is now.
              saveSyncCursor({ hubId: msg.hubId, seq: msg.upto, lastFullSyncAt: Date.now() });
            }
            handshakeDoneRef.current = true;
            stopRelayRef.current();
            setSyncStatus('connected');
            markSyncActivity();
            flushOutboxRef.current();
          } else if (msg.type === 'delta_ack') {
            // The desktop saved these changes: now (and only now) remove them.
            const ids = new Set<string>(Array.isArray(msg.ids) ? msg.ids : []);
            if (ids.size > 0) {
              saveOutbox(loadOutbox().filter((i) => !ids.has(i.changeId || '')));
              for (const id of ids) sentOnThisSocketRef.current.delete(id);
              markSyncActivity();
            }
            // Our own change got the very next number in the PC's change book:
            // move the cursor so we don't download our own change back later.
            if (typeof msg.hubId === 'string' && typeof msg.seq === 'number') {
              const c = loadSyncCursor();
              if (c && c.hubId === msg.hubId && msg.seq === c.seq + 1) {
                saveSyncCursor({ ...c, seq: msg.seq });
              }
            }
          } else if (msg.type === 'bulk_sync') {
            const payload = msg.payload || {};
            mergeRowsIntoState({
              transaction: payload.transactions || [],
              loan: payload.loans || [],
              saving: payload.savings || [],
              keeper: payload.keepers || [],
              bill: payload.bills || [],
              billPayment: payload.billPayments || []
            });
            if (payload.settings) applySettingsFromDesktop(payload.settings, false);
            if (!ctx.viaRelay) advanceSyncCursor(msg.hubId, msg.seq);
            markSyncActivity();
            if (!ctx.viaRelay) setSyncStatus('connected');
          } else if (msg.type === 'sync_delta') {
            const { entity, action, data } = msg;
            if (!entity || !data) return;
            if (entity === 'settings') {
              observeTimestamp(data.updated_at);
              setSettings((prev) => {
                const next = mergeSettingsFromDesktop(prev, data);
                localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(next));
                return next;
              });
            } else if (entity === 'reset') {
              // "Start Fresh" on the desktop: wipe this device too, including
              // unsent changes, and start reading the desktop's new change book.
              setTransactions([]);
              setLoans([]);
              setSavings([]);
              setKeepers([]);
              setBills([]);
              setBillPayments([]);
              localStorage.removeItem(STORAGE_KEYS.transactions);
              localStorage.removeItem(STORAGE_KEYS.loans);
              localStorage.removeItem(STORAGE_KEYS.savings);
              localStorage.removeItem(STORAGE_KEYS.keepers);
              localStorage.removeItem(STORAGE_KEYS.bills);
              localStorage.removeItem(STORAGE_KEYS.billPayments);
              clearOutboxStorage();
              if (typeof msg.hubId === 'string') {
                saveSyncCursor({ hubId: msg.hubId, seq: 0, lastFullSyncAt: Date.now() });
              }
            } else {
              const isDelete = action === 'delete' || data.deleted === 1 || data.deleted === true;
              const incomingData = isDelete ? { ...data, deleted: 1 } : data;
              mergeRowsIntoState({ [entity]: [incomingData] });
            }
            if (entity !== 'reset' && !ctx.viaRelay) advanceSyncCursor(msg.hubId, msg.seq);
            markSyncActivity();
            if (!ctx.viaRelay) setSyncStatus('connected');
          } else if (msg.type === 'ping') {
            ctx.reply?.({ type: 'pong' });
          } else if (msg.type === 'pong') {
            // Heartbeat pong received, lastInboundAtRef updated
          } else if (msg.type === 'connected') {
            markSyncActivity();
          } else if (msg.type === 'unpaired') {
            disconnectRef.current?.();
          }
        } catch (err) {
          console.error('[SyncClient] Error handling message:', err);
        }
  }, [
    clearHelloTimer,
    mergeRowsIntoState,
    applySettingsFromDesktop,
    markSyncActivity,
    setTransactions,
    setLoans,
    setSavings,
    setKeepers,
    setBills,
    setBillPayments,
    setSettings
  ]);

  const applyIncomingMessageRef = useRef(applyIncomingMessage);
  useEffect(() => {
    applyIncomingMessageRef.current = applyIncomingMessage;
  }, [applyIncomingMessage]);

  const disconnect = useCallback(() => {
    isManuallyClosedRef.current = true;
    clearReconnectTimer();
    clearHeartbeat();
    clearOutboxStorage();
    if (wsRef.current) {
      teardownSocket(wsRef.current);
      wsRef.current = null;
    }
    disconnectStartTimeRef.current = null;
    setShowDiscoveryBanner(false);
    saveSyncCredentials(null);
    saveSyncCursor(null);
    clearHelloTimer();
    stopRelayRef.current();
    clearRelayCursor();
    secureKeyRef.current = '';
    relayUrlRef.current = '';
    handshakeDoneRef.current = false;
    lastHeardFromPcRef.current = 0;
    setPcOnline(false);
    setCredentials(null);
    activeCredsRef.current = null;
    setSyncStatus('disconnected');
  }, [clearReconnectTimer, clearHeartbeat, clearHelloTimer, teardownSocket]);


  // ---------------------------------------------------------------------------
  // Sync step 3: the internet post box.
  //
  // Used only while the direct Wi-Fi link is NOT working. Changes made here are
  // locked and left in the box, and whatever the PC left is collected and
  // applied. Both devices never need to be awake at the same time.
  // ---------------------------------------------------------------------------

  const relayReady = useCallback(() => {
    return Boolean(relayUrlRef.current) && Boolean(secureKeyRef.current) && !isManuallyClosedRef.current;
  }, []);

  const lanConnected = useCallback(() => {
    return Boolean(wsRef.current) && wsRef.current!.readyState === WebSocket.OPEN && handshakeDoneRef.current;
  }, []);

  const relayRoundTrip = useCallback(async () => {
    if (!relayReady() || lanConnected() || relayBusyRef.current) return;
    relayBusyRef.current = true;
    const url = relayUrlRef.current;
    const key = secureKeyRef.current;
    // Whether anything was left for the PC this round; see the end of it.
    let leftSomething = false;
    try {
      // 0. The first full exchange, if it has not happened yet for this
      //    pairing (see buildSnapshotParts). A phone that already did one over
      //    Wi-Fi - it has a catch-up marker - is recorded as done instead, so
      //    phones paired the old way do not upload everything again.
      let boot = loadRelayBoot(key);
      if (!boot && loadSyncCursor()) {
        markRelayBootDone(key);
        boot = loadRelayBoot(key);
      }
      if (!boot || (!boot.done && Date.now() - boot.sentAt > RELAY_BOOT_RESEND_MS)) {
        const parts = buildSnapshotParts(stateRef.current, randomId());
        for (let i = 0; i < parts.length; i += 20) {
          await pushToPc(url, key, parts.slice(i, i + 20));
        }
        saveRelayBoot(key, { sentAt: Date.now(), done: false });
        lastPushToPcRef.current = Date.now();
        leftSomething = true;
        markSyncActivity();
      }

      // 1. Leave anything this phone has not managed to send yet.
      const waiting = deduplicateOutbox(loadOutbox());
      if (waiting.length > 0) {
        const batch = waiting.slice(0, 100);
        const messages = batch.map((item) =>
          item.entity === 'bulk_sync'
            ? { type: 'bulk_sync', payload: item.data, changeId: item.changeId }
            : {
                type: 'sync_delta',
                entity: item.entity,
                action: item.action,
                data: item.data,
                updated_at: item.data?.updated_at || Date.now(),
                changeId: item.changeId
              }
        );
        await pushToPc(url, key, messages);
        // The post box keeps them until the PC collects them, so they can be
        // taken off this phone's waiting list now.
        const sentIds = new Set(batch.map((i) => i.changeId || ''));
        saveOutbox(loadOutbox().filter((i) => !sentIds.has(i.changeId || '')));
        lastPushToPcRef.current = Date.now();
        leftSomething = true;
        markSyncActivity();
      }

      // 1b. An "I'm here" note now and then, so the PC can tell this phone is
      //     around even when nothing changes (its "Connected" badge).
      if (Date.now() - lastPushToPcRef.current > PRESENCE_EVERY_MS) {
        await pushToPc(url, key, [{ type: 'presence' }]);
        lastPushToPcRef.current = Date.now();
        leftSomething = true;
      }

      // 2. Collect whatever the PC left for us. One trip brings at most 200,
      //    and the PC's full copy can sit behind older changes, so keep going
      //    (a few trips at most) until the box is empty.
      for (let trip = 0; trip < 10; trip++) {
        const since = loadRelayCursor(key);
        const { messages, upto, lastInBox } = await pullFromPc(url, key, since);
        if (messages.length > 0) {
          // Anything at all from the PC (a change, its copy, or just its
          // "I'm here" note) shows it is there right now.
          lastHeardFromPcRef.current = Date.now();
          for (const msg of messages) {
            applyIncomingMessageRef.current(msg, { viaRelay: true });
          }
          markSyncActivity();
          // The PC left a "you have been disconnected" note (Start Fresh or
          // "Unpair all phones" on the PC): the pairing is gone, so stop here
          // instead of carrying on and showing "connected" again.
          if (isManuallyClosedRef.current) return;
        }
        if (upto > since) {
          saveRelayCursor(key, upto);
          try {
            await ackPcLane(url, key, upto);
          } catch {
            // Not confirming only means the box keeps them a little longer.
          }
        }
        if (upto <= since || !(lastInBox > upto)) break;
      }
      relayFailuresRef.current = 0;
      // The post box answered, so this device is in touch with the desktop.
      relayHealthyRef.current = true;
      if (!lanConnected()) setSyncStatus('connected');

      // Left something for the PC but still not heard back: keep looking
      // often for a short while, so its reply is picked up within seconds.
      const heardFromPc = Date.now() - lastHeardFromPcRef.current < PRESENCE_FRESH_MS;
      if (leftSomething && !heardFromPc) {
        eagerUntilRef.current = Date.now() + EAGER_WINDOW_MS;
      } else if (heardFromPc) {
        eagerUntilRef.current = 0;
      }
    } catch (err) {
      relayFailuresRef.current += 1;
      relayHealthyRef.current = false;
      if (!lanConnected()) setSyncStatus('disconnected');
      if (relayFailuresRef.current <= 2) {
        console.warn('[SyncClient] Post box not reachable:', err);
      }
    } finally {
      relayBusyRef.current = false;
    }
  }, [relayReady, lanConnected, markSyncActivity]);

  const relayRoundTripRef = useRef(relayRoundTrip);
  useEffect(() => {
    relayRoundTripRef.current = relayRoundTrip;
  }, [relayRoundTrip]);

  /**
   * The PC said, through the post box, where it can be reached on its network
   * now. If that is not the address this phone has (the PC moved to another
   * Wi-Fi, or the router gave it a new one), check each new address for OUR
   * PC and, when it answers, switch to it and connect directly. Before this,
   * the phone kept trying the old address and could only search its old
   * network, so it stayed on the slower post box even on the same Wi-Fi.
   */
  const considerPcAddress = useCallback(async (lan: any) => {
    if (!lan || !Array.isArray(lan.ips)) return;
    if (lanConnected() || isManuallyClosedRef.current || addressProbeBusyRef.current) return;
    const creds = activeCredsRef.current;
    if (!creds || !creds.key) return;
    const reported = Number(lan.port);
    const port = Number.isInteger(reported) && reported > 0 && reported < 65536 ? reported : creds.port;
    const ips: string[] = lan.ips
      .filter((ip: unknown): ip is string => typeof ip === 'string' && IPV4_RE.test(ip))
      .slice(0, 8);
    if (ips.length === 0) return;
    // Still one of the PC's addresses: nothing to change. (The direct link is
    // down for another reason - another network, or the PC's firewall.)
    if (ips.includes(creds.host) && port === creds.port) return;
    // A new list is tried at once; the same list again only every 2 minutes
    // (while this phone is on another network those addresses lead nowhere).
    const list = `${ips.join(',')}:${port}`;
    const last = lastAddressProbeRef.current;
    if (last.list === list && Date.now() - last.at < 2 * 60 * 1000) return;
    lastAddressProbeRef.current = { at: Date.now(), list };
    addressProbeBusyRef.current = true;
    try {
      const fingerprint = await pairingFingerprint(creds.key);
      for (const ip of ips) {
        if (lanConnected() || isManuallyClosedRef.current) return;
        if (await isOurPcAt(ip, port, fingerprint, 1500)) {
          const current = activeCredsRef.current;
          // The pairing changed while we were looking: leave it alone.
          if (!current || current.token !== creds.token || current.key !== creds.key) return;
          console.log(`[SyncClient] PC is now at ${ip}:${port} (told through the post box); connecting directly.`);
          const updated: SyncCredentials = { ...current, host: ip, port, lastConnectedAt: Date.now() };
          saveSyncCredentials(updated);
          setCredentials(updated);
          setShowDiscoveryBanner(false);
          reconnectAttemptRef.current = 0;
          // connect() records the new address itself. Recording it here
          // first made connect() take the new address for the attempt
          // already under way to the OLD one, and skip connecting.
          connectRef.current(updated);
          return;
        }
      }
    } finally {
      addressProbeBusyRef.current = false;
    }
  }, [lanConnected]);

  useEffect(() => {
    considerPcAddressRef.current = (lan: any) => { void considerPcAddress(lan); };
  }, [considerPcAddress]);

  const scheduleRelay = useCallback((delay?: number) => {
    if (relayTimerRef.current) clearTimeout(relayTimerRef.current);
    relayTimerRef.current = null;
    if (!relayReady()) return;
    const failures = relayFailuresRef.current;
    const eager = failures === 0 && Date.now() < eagerUntilRef.current;
    const wait = typeof delay === 'number'
      ? delay
      : eager
        ? EAGER_POLL_MS
        : Math.min(RELAY_POLL_MS * Math.pow(2, Math.max(0, failures - 1)), 5 * 60 * 1000);
    relayTimerRef.current = setTimeout(async () => {
      relayTimerRef.current = null;
      await relayRoundTripRef.current();
      scheduleRelayRef.current(undefined);
    }, wait);
  }, [relayReady]);

  const scheduleRelayRef = useRef(scheduleRelay);
  useEffect(() => {
    scheduleRelayRef.current = scheduleRelay;
  }, [scheduleRelay]);

  const stopRelayRef = useRef<() => void>(() => {});

  const stopRelay = useCallback(() => {
    if (relayTimerRef.current) {
      clearTimeout(relayTimerRef.current);
      relayTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    stopRelayRef.current = stopRelay;
  }, [stopRelay]);

  useEffect(() => {
    disconnectRef.current = disconnect;
  }, [disconnect]);

  const connect = useCallback((targetCreds?: SyncCredentials | null) => {
    const activeCreds = targetCreds !== undefined ? targetCreds : credentials;
    if (!activeCreds) {
      setSyncStatus('disconnected');
      return;
    }

    isManuallyClosedRef.current = false;
    clearReconnectTimer();

    // Guard against duplicate/concurrent connects (FIX 1.2 #3)
    if (
      wsRef.current &&
      (wsRef.current.readyState === WebSocket.CONNECTING || wsRef.current.readyState === WebSocket.OPEN) &&
      activeCredsRef.current &&
      activeCreds.host === activeCredsRef.current.host &&
      activeCreds.port === activeCredsRef.current.port &&
      activeCreds.token === activeCredsRef.current.token
    ) {
      return;
    }

    // Teardown previous socket (FIX 1.2 #2)
    if (wsRef.current) {
      teardownSocket(wsRef.current);
      wsRef.current = null;
    }
    clearHeartbeat();

    activeCredsRef.current = activeCreds;
    secureKeyRef.current = activeCreds.key && isValidKeyText(activeCreds.key) ? activeCreds.key : '';
    relayUrlRef.current = normalizeRelayUrl(activeCreds.relayUrl);
    // Looking for the Wi-Fi link again is not a step backwards while the post
    // box is already carrying changes through.
    setSyncStatus(relayHealthyRef.current ? 'connected' : 'connecting');
    clearHelloTimer();
    handshakeDoneRef.current = false;
    serverSupportsAcksRef.current = false;
    sentOnThisSocketRef.current = new Set();

    // Full sync: send everything this device has (including deleted markers).
    const sendInitSync = (socket: WebSocket) => {
      const st = stateRef.current;
      sendSecure(socket, {
        type: 'init_sync',
        payload: {
          transactions: st.transactions,
          loans: st.loans,
          savings: st.savings,
          keepers: st.keepers,
          bills: st.bills,
          billPayments: st.billPayments,
          settings: st.settings
        }
      });
    };

    try {
      const url = `ws://${activeCreds.host}:${activeCreds.port}/ws?token=${activeCreds.token}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectAttemptRef.current = 0; // Reset backoff
        disconnectStartTimeRef.current = null;
        setShowDiscoveryBanner(false);
        setSyncStatus('syncing');

        // Persist lastConnectedAt (FIX 1.5 #1)
        const updatedCreds: SyncCredentials = {
          ...activeCreds,
          lastConnectedAt: Date.now()
        };
        saveSyncCredentials(updatedCreds);
        setCredentials(updatedCreds);
        activeCredsRef.current = updatedCreds;

        // Initialize heartbeat watchdog (FIX 1.1 #1)
        lastInboundAtRef.current = Date.now();
        lastPingSentAtRef.current = 0;
        clearHeartbeat();

        // Watchdog: checks every 5s. Sends a ping every 15s; the server answers
        // every ping with a pong. If NOTHING has arrived from the server for 35s
        // (two missed pongs), the link is dead even if readyState still says OPEN.
        // (The previous version compared against the latest ping time, which was
        // overwritten every 15s, so the timeout could never trigger.)
        heartbeatIntervalRef.current = setInterval(() => {
          if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
          const now = Date.now();

          if (now - lastInboundAtRef.current >= 35000) {
            console.warn('[SyncClient] Heartbeat watchdog: no message from desktop for 35s. Reconnecting...');
            teardownSocket(wsRef.current);
            wsRef.current = null;
            clearHeartbeat();
            setSyncStatus('disconnected');
            if (disconnectStartTimeRef.current === null) {
              disconnectStartTimeRef.current = now;
            }
            scheduleReconnect(0);
            return;
          }

          if (now - lastPingSentAtRef.current >= 15000) {
            sendSecure(wsRef.current, { type: 'ping' });
            lastPingSentAtRef.current = now;
          }
        }, 5000);

        // Sync step 1: say hello with our cursor. A new desktop answers with
        // only the changes we missed (resume_changes) or asks for one full sync
        // (bootstrap_required). An older desktop does not answer -> full sync.
        const cursor = loadSyncCursor();
        const forceFull = !cursor || Date.now() - (cursor.lastFullSyncAt || 0) > FULL_RESYNC_INTERVAL_MS;
        sendSecure(ws, {
          type: 'hello',
          v: 2,
          deviceId: getDeviceId(),
          hubId: cursor?.hubId,
          cursor: cursor?.seq ?? 0,
          forceFull
        });
        clearHelloTimer();
        helloTimerRef.current = setTimeout(() => {
          helloTimerRef.current = null;
          if (wsRef.current === ws && ws.readyState === WebSocket.OPEN && !handshakeDoneRef.current) {
            console.warn('[SyncClient] Desktop did not answer hello (older version). Using full sync.');
            serverSupportsAcksRef.current = false;
            sendInitSync(ws);
          }
        }, HELLO_TIMEOUT_MS);
      };

      // Unlocking takes a moment, so messages are handled one after another to
      // keep them in the order the desktop sent them.
      ws.onmessage = (event) => {
        // Track inbound message for heartbeat watchdog (FIX 1.1 #2)
        lastInboundAtRef.current = Date.now();
        inboundQueueRef.current = inboundQueueRef.current
          .then(async () => {
            let parsed = JSON.parse(event.data);
            if (isEnvelope(parsed)) {
              if (!secureKeyRef.current) {
                console.warn('[SyncClient] Locked message received but this phone has no key. Pair again.');
                return;
              }
              parsed = await decryptJson(secureKeyRef.current, parsed);
            }
            applyIncomingMessageRef.current(parsed, {
              reply: (obj: any) => sendSecure(ws, obj),
              sendInitSync: () => sendInitSync(ws)
            });
          })
          .catch((err) => {
            console.error('[SyncClient] Error processing message:', err);
          });
      };


      ws.onclose = (event: CloseEvent) => {
        clearHeartbeat();
        clearHelloTimer();
        handshakeDoneRef.current = false;

        // 4003 = the desktop locks its sync data and this pairing predates the
        // lock (or uses the wrong key). Retrying cannot help, so forget the
        // pairing and let the user scan the QR code again. Anything waiting to
        // be sent is KEPT and goes out once they pair again.
        if (event && event.code === 4003) {
          console.warn('[SyncClient] Desktop asked for a fresh pairing (locked sync). Scan the QR code again.');
          isManuallyClosedRef.current = true;
          clearReconnectTimer();
          saveSyncCredentials(null);
          saveSyncCursor(null);
          stopRelayRef.current();
          clearRelayCursor();
          secureKeyRef.current = '';
          relayUrlRef.current = '';
          setCredentials(null);
          activeCredsRef.current = null;
          setSyncStatus('disconnected');
          return;
        }

        if (isManuallyClosedRef.current) return;
        if (disconnectStartTimeRef.current === null) {
          disconnectStartTimeRef.current = Date.now();
        }
        setSyncStatus(relayHealthyRef.current ? 'connected' : 'disconnected');
        // No direct link any more: fall back to the internet post box while we
        // keep trying to get back onto the same Wi-Fi.
        scheduleRelayRef.current(1000);
        scheduleReconnect();
      };

      ws.onerror = () => {
        if (isManuallyClosedRef.current) return;
        if (disconnectStartTimeRef.current === null) {
          disconnectStartTimeRef.current = Date.now();
        }
        setSyncStatus(relayHealthyRef.current ? 'connected' : 'error');
        // Try again from here too. An attempt that never opens usually ends
        // with "closed" as well, and that is where the retry used to be set
        // up - but when only "error" arrives, the phone stopped looking for
        // the PC on Wi-Fi altogether for the rest of the session: no further
        // attempts, no search of the network, and so no "can't reach your
        // PC" notice either. Scheduling here replaces any attempt already
        // pending rather than adding one, so the two paths cannot pile up.
        scheduleRelayRef.current(1000);
        scheduleReconnect();
      };
    } catch (e) {
      console.error('[SyncClient] Connection initiation error:', e);
      clearHeartbeat();
      if (disconnectStartTimeRef.current === null) {
        disconnectStartTimeRef.current = Date.now();
      }
      setSyncStatus(relayHealthyRef.current ? 'connected' : 'error');
      scheduleReconnect();
    }
  }, [
    credentials,
    setTransactions,
    setLoans,
    setSavings,
    setKeepers,
    setBills,
    setBillPayments,
    setSettings,
    disconnect,
    clearHeartbeat,
    clearReconnectTimer,
    clearHelloTimer,
    teardownSocket,
    markSyncActivity,
    scheduleReconnect,
    mergeRowsIntoState,
    applySettingsFromDesktop
  ]);

  // Keep connectRef pointing to latest connect callback
  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  // Connect on initial load if credentials exist
  useEffect(() => {
    if (credentials) {
      secureKeyRef.current = credentials.key && isValidKeyText(credentials.key) ? credentials.key : '';
      relayUrlRef.current = normalizeRelayUrl(credentials.relayUrl);
      connect(credentials);
      // Until the direct link is up, the post box is the way through.
      scheduleRelayRef.current(2500);
    }
    return () => {
      clearReconnectTimer();
      clearHeartbeat();
      clearHelloTimer();
      stopRelayRef.current();
      if (wsRef.current) {
        teardownSocket(wsRef.current);
        wsRef.current = null;
      }
    };
  }, []);

  // Listeners for appStateChange and Network with cancellation pattern (FIX 1.3 & 1.4)
  useEffect(() => {
    let cancelled = false;
    let appHandle: any = null;
    let netHandle: any = null;

    const handleAppStateChange = (isActive: boolean) => {
      if (isActive) {
        isBackgroundedRef.current = false;
        reconnectAttemptRef.current = 0; // Reset delay to 1s
        const creds = activeCredsRef.current || loadSyncCredentials();
        if (!creds || isManuallyClosedRef.current) return;

        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          // Do NOT trust readyState. Verify with immediate ping (FIX 1.1 #5)
          lastPingSentAtRef.current = Date.now();
          sendSecure(wsRef.current, { type: 'ping' });

          if (resumeVerifyTimerRef.current) clearTimeout(resumeVerifyTimerRef.current);
          resumeVerifyTimerRef.current = setTimeout(() => {
            if (lastInboundAtRef.current < lastPingSentAtRef.current) {
              console.warn('[SyncClient] Resume verification failed: socket dead. Recycling and reconnecting...');
              teardownSocket(wsRef.current);
              wsRef.current = null;
              clearHeartbeat();
              setSyncStatus('disconnected');
              if (disconnectStartTimeRef.current === null) {
                disconnectStartTimeRef.current = Date.now();
              }
              scheduleReconnect(0);
            }
          }, 5000);
        } else {
          scheduleReconnect(0);
        }
        // Also look in the post box right away, in case the PC left something
        // while this phone was asleep.
        if (!lanConnected()) scheduleRelayRef.current(500);
      } else {
        // App backgrounded (FIX 1.3 #3): Pause reconnect timer entirely
        isBackgroundedRef.current = true;
        clearReconnectTimer();
        stopRelayRef.current();
        if (resumeVerifyTimerRef.current) {
          clearTimeout(resumeVerifyTimerRef.current);
          resumeVerifyTimerRef.current = null;
        }
      }
    };

    const handleNetworkChange = (connected: boolean) => {
      if (connected) {
        reconnectAttemptRef.current = 0; // Reset backoff to 1s
        const creds = activeCredsRef.current || loadSyncCredentials();
        if (creds && !isManuallyClosedRef.current && !isBackgroundedRef.current) {
          if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
            console.log('[SyncClient] Network connection restored. Reconnecting immediately...');
            scheduleReconnect(0);
            scheduleRelayRef.current(1500);
          }
        }
      }
    };

    try {
      CapApp.addListener('appStateChange', (state) => {
        if (cancelled) return;
        handleAppStateChange(state.isActive);
      }).then((h) => {
        if (cancelled) h.remove();
        else appHandle = h;
      });
    } catch {}

    try {
      Network.addListener('networkStatusChange', (status) => {
        if (cancelled) return;
        handleNetworkChange(status.connected);
      }).then((h) => {
        if (cancelled) h.remove();
        else netHandle = h;
      });
    } catch {}

    return () => {
      cancelled = true;
      appHandle?.remove?.();
      netHandle?.remove?.();
    };
  }, [clearHeartbeat, clearReconnectTimer, scheduleReconnect, teardownSocket, lanConnected]);

  // Send a delta: always queue to persistent outbox first, then flush if socket is open
  const sendDelta = useCallback((
    entity: 'transaction' | 'loan' | 'saving' | 'keeper' | 'bill' | 'billPayment' | 'settings',
    action: 'upsert' | 'delete',
    data: any
  ) => {
    appendToOutbox(entity, action, data);
    flushOutbox();
    // If the direct link is down, get it into the post box shortly.
    if (!lanConnected()) scheduleRelayRef.current(1200);
  }, [flushOutbox, lanConnected]);

  const sendBulkSync = useCallback((payload: any) => {
    appendToOutbox('bulk_sync', 'upsert', payload);
    flushOutbox();
    if (!lanConnected()) scheduleRelayRef.current(1200);
  }, [flushOutbox, lanConnected]);

  // Keep the "waiting to be sent" number on the badge in step with the outbox.
  // The outbox is written from several places (a new change, a confirmation
  // from the desktop, a post box round trip), so it is read back on a timer
  // rather than every one of those remembering to report in.
  useEffect(() => {
    const readOutbox = () => {
      setPendingCount((prev) => {
        const next = getPendingChangeCount();
        return next === prev ? prev : next;
      });
    };
    readOutbox();
    const timer = setInterval(readOutbox, 2000);
    return () => clearInterval(timer);
  }, []);

  const pairDevice = useCallback(async (newCreds: SyncCredentials) => {
    // The pairing screen has already checked the code. Here the PC must be
    // reachable one way or the other: directly over Wi-Fi, or through its
    // internet post box when the phone is on another network. Whichever says
    // yes first is enough; only when both say no does pairing fail. (Checking
    // Wi-Fi alone here is what made pairing from mobile data fail even after
    // the pairing screen had found the post box.)
    const isValid = await new Promise<boolean>((resolve) => {
      let waiting = 2;
      const answer = (ok: boolean) => {
        if (ok) resolve(true);
        else if (--waiting === 0) resolve(false);
      };
      validateCredentials(newCreds).then(answer, () => answer(false));
      const url = normalizeRelayUrl(newCreds.relayUrl);
      const keyOk = Boolean(newCreds.key && isValidKeyText(newCreds.key));
      (url && keyOk ? relayReachable(url) : Promise.resolve(false)).then(answer, () => answer(false));
    });
    if (!isValid) {
      throw new Error(`Could not connect to Desktop at ${newCreds.host}:${newCreds.port}. Make sure Desktop Budget Secure is running and both devices are on the same Wi-Fi.`);
    }
    // A new pairing starts clean. Markers left from an earlier pairing (where
    // this phone had got to in the PC's change book and in the post box, and
    // whether the first full exchange was done) belong to that pairing. Kept,
    // they made this phone skip sending its existing data to the PC - it
    // believed the full exchange had already happened. Cleared, the first
    // connection (over Wi-Fi or through the post box) swaps everything again,
    // which is harmless when the data is already there.
    saveSyncCursor(null);
    clearRelayCursor();
    const credsWithTimestamp: SyncCredentials = {
      ...newCreds,
      key: newCreds.key && isValidKeyText(newCreds.key) ? newCreds.key : undefined,
      relayUrl: normalizeRelayUrl(newCreds.relayUrl) || undefined,
      lastConnectedAt: Date.now()
    };
    saveSyncCredentials(credsWithTimestamp);
    setCredentials(credsWithTimestamp);
    connect(credsWithTimestamp);
  }, [connect]);

  // Keep the "is the PC there right now" answer fresh for the top badge.
  useEffect(() => {
    const update = () => {
      const online =
        lanConnected() ||
        (lastHeardFromPcRef.current > 0 && Date.now() - lastHeardFromPcRef.current < PRESENCE_FRESH_MS);
      setPcOnline((prev) => (prev === online ? prev : online));
      // The "can't reach your PC" notice is about the PC being out of touch
      // altogether. Once it is back - over Wi-Fi OR through the post box -
      // the notice has nothing left to say, so it is put away and must be
      // earned again by a fresh failure. It used to be cleared only when the
      // Wi-Fi link came up, so a phone that reconnected through the post box
      // kept showing it next to a "Connected" badge.
      if (online) setShowDiscoveryBanner((prev) => (prev ? false : prev));
    };
    update();
    const timer = setInterval(update, 5000);
    return () => clearInterval(timer);
  }, [lanConnected, syncStatus]);

  /**
   * Start Fresh on this phone: tell the PC to forget this pairing - directly
   * over Wi-Fi, or through the post box when away - and then disconnect here.
   * Only this phone's data is wiped (by the caller); the PC keeps its own.
   * If the PC cannot be reached at all the phone still disconnects; the PC
   * can then be unpaired with "Unpair all phones".
   */
  const leaveAndForget = useCallback(async () => {
    const message = { type: 'unpair_request' };
    try {
      if (lanConnected() && wsRef.current) {
        sendSecure(wsRef.current, message);
        await sendQueueRef.current; // make sure it has gone before closing
      } else if (relayUrlRef.current && secureKeyRef.current) {
        await pushToPc(relayUrlRef.current, secureKeyRef.current, [message]);
      }
    } catch (err) {
      console.warn('[SyncClient] Could not tell the PC about Start Fresh:', err);
    }
    disconnect();
  }, [lanConnected, sendSecure, disconnect]);

  return {
    syncStatus,
    /** Changes made here that the desktop has not confirmed yet. */
    pendingCount,
    leaveAndForget,
    /** The PC is there right now (Wi-Fi link up, or heard from through the post box lately). */
    pcOnline,
    credentials,
    lastSyncAt,
    /**
     * Show the "can't reach your PC" notice only while the PC really is out
     * of reach. Searching the Wi-Fi and finding nothing is what raises it,
     * but that search knows nothing about the post box - on mobile data it
     * always fails, which is why the notice used to appear while sync was in
     * fact working.
     */
    showDiscoveryBanner: showDiscoveryBanner && !pcOnline,
    discoveryToast,
    setDiscoveryToast,
    pairDevice,
    disconnect,
    sendDelta,
    sendBulkSync,
    flushOutbox,
    getPendingChangeCount,
    relayConfigured: Boolean(normalizeRelayUrl(credentials?.relayUrl)),
    checkRelayNow: () => scheduleRelayRef.current(0),
    clearOutbox: clearOutboxStorage,
    retryDiscovery: () => {
      const creds = activeCredsRef.current || loadSyncCredentials();
      if (creds) triggerDiscoveryIfNeeded(creds);
    }
  };
}
