import { useState, useEffect, useCallback, useRef } from "react";
import { Building2, User, Undo2, AlertTriangle, Check, Clock } from "lucide-react";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { AddTransactionModal } from "./components/AddTransactionModal";
import { Dashboard } from "./views/Dashboard";
import { LockScreen } from "./views/LockScreen";
import { OnboardingWelcome } from "./views/OnboardingWelcome";
import { Settings } from "./views/Settings";
import { Transactions } from "./views/Transactions";
import { Loans } from "./views/Loans";
import { Savings } from "./views/Savings";
import { Bills } from "./views/Bills";
import { Transaction, LoanEntry, SavingsEntry, Keeper, Bill, BillPayment, AppSettings } from "./types";
import { STORAGE_KEYS } from "./data";
import { SplashScreen } from "./components/SplashScreen";
import { generateId, getTodayString } from "./lib/utils";
import { UpdateNotification } from "./components/UpdateNotification";
import { useSyncConnection } from "./lib/useSyncConnection";
import { backButtonIsClaimed } from "./lib/backGuard";
import bcrypt from "bcryptjs";
import { App as CapApp, AppState } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { StatusBar, Style } from "@capacitor/status-bar";

const isBcryptHash = (val?: string) => Boolean(val && (val.startsWith('$2a$') || val.startsWith('$2b$')));

/** How long a change may sit unsent before the user is told it is waiting. */
const SYNC_WAIT_NOTICE_MS = 60_000;

const defaultSettings: AppSettings = {
  authPin: "",
  biometricEnabled: false,
  currency: "LKR",
  lockTimer: "15min",
  undoSeconds: 5,
  businessLedgerName: "Business Ledger",
  personalLedgerName: "Personal Ledger",
};

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.settings);
    if (raw) {
      const parsed: AppSettings = { ...defaultSettings, ...JSON.parse(raw) };
      // Migration: detect if stored PIN is plaintext and hash it in-place
      if (parsed.authPin && !isBcryptHash(parsed.authPin)) {
        try {
          parsed.authPin = bcrypt.hashSync(parsed.authPin, 10);
          localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(parsed));
        } catch (e) {
          console.error("Failed to migrate plaintext PIN in localStorage:", e);
        }
      }
      return parsed;
    }
  } catch {
    // ignore
  }
  return defaultSettings;
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
function gcTombstones<T extends { deleted?: number; updated_at?: number }>(items: T[]): T[] {
  const cutoff = Date.now() - THIRTY_DAYS_MS;
  return items.filter((item) => !(item.deleted === 1 && (item.updated_at || 0) < cutoff));
}

function loadTransactions(): Transaction[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.transactions);
    if (raw !== null) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return gcTombstones(parsed);
    }
  } catch {
    // ignore
  }
  return [];
}

function loadLoans(): LoanEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.loans);
    if (raw !== null) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return gcTombstones(parsed);
    }
  } catch {
    // ignore
  }
  return [];
}

function loadSavings(): SavingsEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.savings);
    if (raw !== null) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return gcTombstones(parsed);
    }
  } catch {
    // ignore
  }
  return [];
}

function loadKeepers(): Keeper[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.keepers);
    if (raw !== null) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return gcTombstones(parsed);
    }
  } catch {
    // ignore
  }
  return [];
}

function loadBills(): Bill[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.bills);
    if (raw !== null) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return gcTombstones(parsed);
    }
  } catch {
    // ignore
  }
  return [];
}

function loadBillPayments(): BillPayment[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.billPayments);
    if (raw !== null) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return gcTombstones(parsed);
    }
  } catch {
    // ignore
  }
  return [];
}


export default function App() {
  const [showSplash, setShowSplash] = useState(() => {
    return !sessionStorage.getItem("splash_shown");
  });
  const [isLocked, setIsLocked] = useState(true);
  const [currentView, setCurrentView] = useState("dashboard");
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const backgroundTimestampRef = useRef<number>(0);

  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const [transactions, setTransactions] = useState<Transaction[]>(loadTransactions);
  const [loans, setLoans] = useState<LoanEntry[]>(loadLoans);
  const [savings, setSavings] = useState<SavingsEntry[]>(loadSavings);
  const [keepers, setKeepers] = useState<Keeper[]>(loadKeepers);
  const [bills, setBills] = useState<Bill[]>(loadBills);
  const [billPayments, setBillPayments] = useState<BillPayment[]>(loadBillPayments);

  // Mobile Sync Hook (for Android LAN WebSocket sync)
  const {
    syncStatus: mobileSyncStatus,
    pendingCount: mobilePendingCount,
    credentials: mobileSyncCredentials,
    lastSyncAt: mobileLastSyncAt,
    showDiscoveryBanner,
    discoveryToast,
    setDiscoveryToast,
    pairDevice: pairMobileSync,
    disconnect: disconnectMobileSync,
    leaveAndForget: leaveMobileSync,
    pcOnline: mobilePcOnline,
    sendDelta: sendMobileDelta,
    sendBulkSync: sendMobileBulkSync,
    clearOutbox: clearMobileOutbox,
  } = useSyncConnection({
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
    setSettings,
  });

  // Desktop App states
  const [isApiAvailable, setIsApiAvailable] = useState(false);
  const [syncStatus, setSyncStatus] = useState("Local Only");
  const [localIp, setLocalIp] = useState("");
  const [authToken, setAuthToken] = useState(() => sessionStorage.getItem("sync_auth_token") || "");
  const authTokenRef = useRef<string>(authToken);
  const [desktopLastSyncAt, setDesktopLastSyncAt] = useState<number | null>(() => {
    const stored = localStorage.getItem('bs_desktop_last_sync_at');
    return stored ? Number(stored) : null;
  });
  const [syncDeviceCount, setSyncDeviceCount] = useState<number>(0);
  /**
   * Desktop only: how the internet post box is doing. A phone that is not on
   * this Wi-Fi still receives changes through it, so the badge counts a working
   * post box as a live link, and shows anything still waiting to go into it.
   */
  const [desktopRelay, setDesktopRelay] = useState<{ paired: boolean; online: boolean; queued: number }>({
    paired: false,
    online: false,
    queued: 0
  });

  useEffect(() => {
    if (Capacitor.isNativePlatform()) return;
    let cancelled = false;
    const readRelay = async () => {
      try {
        const res = await fetch('http://localhost:3001/api/sync/status');
        if (!res.ok) return;
        const data = await res.json();
        const relay = data?.relay;
        if (cancelled || !relay) return;
        // phoneSeenAt: when a phone last got in touch (0 = no phone paired
        // with the current pairing). relay.paired only means this PC has a
        // key, which it always has, so it cannot say whether a phone exists.
        const seenAt = Number(relay.phoneSeenAt) || 0;
        setDesktopRelay({
          paired: seenAt > 0,
          // Through the post box a phone counts as there right now while
          // something from it (a change, or its "I'm here" note every minute
          // and a half) arrived in the last 4 minutes.
          online: Boolean(relay.configured && !relay.failures && seenAt > 0 && Date.now() - seenAt < 4 * 60 * 1000),
          queued: Number(relay.queued) || 0
        });
      } catch {
        if (!cancelled) setDesktopRelay((prev) => ({ ...prev, online: false }));
      }
    };
    readRelay();
    const timer = setInterval(readRelay, 15000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const handleTokenUpdated = (e: any) => {
      if (e.detail) {
        setAuthToken(e.detail);
        authTokenRef.current = e.detail;
      }
    };
    window.addEventListener("auth_token_updated", handleTokenUpdated);
    return () => window.removeEventListener("auth_token_updated", handleTokenUpdated);
  }, []);

  const [autoStart, setAutoStart] = useState(false);
  const [showResetToast, setShowResetToast] = useState(false);
  const [isInitialCheckDone, setIsInitialCheckDone] = useState(() => {
    const localPin = loadSettings().authPin;
    if (localPin && localPin.trim() !== "") return true;
    if (Capacitor.isNativePlatform()) return true;
    return false;
  });

  const apiFetch = useCallback(async (url: string, init?: RequestInit) => {
    const token = authTokenRef.current;
    const headers = new Headers(init?.headers);
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
    return fetch(url, {
      ...init,
      headers
    });
  }, []);

  // Undo last transaction state
  const [lastAction, setLastAction] = useState<{
    type: 'add' | 'delete';
    tx: Transaction;
  } | null>(null);
  const [undoCountdown, setUndoCountdown] = useState(0);
  const undoTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const undoTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync state with local SQLite Express API if available (Electron Desktop only)
  const checkApi = useCallback(async () => {
    // Android / Standalone Mode: Zero fetch attempts to localhost:3001
    const isDesktop = !Capacitor.isNativePlatform();
    if (!isDesktop) {
      setIsApiAvailable(false);
      setSyncStatus("Local Only");
      setIsInitialCheckDone(true);
      return;
    }

    try {
      setSyncStatus("Syncing");
      const res = await fetch("http://localhost:3001/api/system-info");
      if (res.ok) {
        const info = await res.json();
        setLocalIp(info.localIp);
        setAuthToken(info.authToken);
        authTokenRef.current = info.authToken;
        sessionStorage.setItem("sync_auth_token", info.authToken);
        setIsApiAvailable(true);

        // Fetch auto-start status
        const autoStartRes = await apiFetch("http://localhost:3001/api/autostart");
        if (autoStartRes.ok) {
          const autoStartData = await autoStartRes.json();
          setAutoStart(autoStartData.autoStart);
        }

        // Fetch initial client count
        try {
          const syncStatusRes = await apiFetch("http://localhost:3001/api/sync/status");
          if (syncStatusRes.ok) {
            const syncStatusData = await syncStatusRes.json();
            setSyncDeviceCount(syncStatusData.connectedCount ?? syncStatusData.connectedClients ?? 0);
          }
        } catch {}

        // Gather local state data for bidirectional merge
        const localTxs = loadTransactions();
        const localSettings = loadSettings();
        const localLoans = loadLoans();
        const localSavings = loadSavings();
        const localKeepers = loadKeepers();
        const localBills = loadBills();
        const localBillPayments = loadBillPayments();

        // Perform bidirectional sync with the server database
        const syncResponse = await apiFetch("http://localhost:3001/api/sync", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            transactions: localTxs,
            settings: localSettings,
            loans: localLoans,
            keepers: localKeepers,
            savings: localSavings,
            bills: localBills,
            billPayments: localBillPayments
          })
        });

        if (syncResponse.ok) {
          const merged = await syncResponse.json();
          // Restore server settings and data to local state & localStorage (data recovery)
          if (merged.settings && Object.keys(merged.settings).length > 0) {
            let loadedSettings = merged.settings;
            if (loadedSettings.authPin && !isBcryptHash(loadedSettings.authPin)) {
              try {
                loadedSettings.authPin = bcrypt.hashSync(loadedSettings.authPin, 10);
                apiFetch("http://localhost:3001/api/settings", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(loadedSettings)
                }).catch(console.error);
              } catch (e) {
                console.error("Failed to migrate server plaintext PIN:", e);
              }
            }
            setSettings(loadedSettings);
            localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(loadedSettings));
          }
          if (Array.isArray(merged.transactions)) {
            setTransactions(merged.transactions);
            localStorage.setItem(STORAGE_KEYS.transactions, JSON.stringify(merged.transactions));
          }
          if (Array.isArray(merged.loans)) {
            setLoans(merged.loans);
            localStorage.setItem(STORAGE_KEYS.loans, JSON.stringify(merged.loans));
          }
          if (Array.isArray(merged.keepers)) {
            setKeepers(merged.keepers);
            localStorage.setItem(STORAGE_KEYS.keepers, JSON.stringify(merged.keepers));
          }
          if (Array.isArray(merged.savings)) {
            setSavings(merged.savings);
            localStorage.setItem(STORAGE_KEYS.savings, JSON.stringify(merged.savings));
          }
          if (Array.isArray(merged.bills)) {
            setBills(merged.bills);
            localStorage.setItem(STORAGE_KEYS.bills, JSON.stringify(merged.bills));
          }
          if (Array.isArray(merged.billPayments)) {
            setBillPayments(merged.billPayments);
            localStorage.setItem(STORAGE_KEYS.billPayments, JSON.stringify(merged.billPayments));
          }
          setSyncStatus("Synced");
        } else {
          setSyncStatus("Synced (Merge Fail)");
        }
      } else {
        setIsApiAvailable(false);
        setSyncStatus("Local Only");
      }
    } catch (e) {
      console.warn("Express server unreachable, using localStorage fallback:", e);
      setIsApiAvailable(false);
      setSyncStatus("Local Only");
    } finally {
      setIsInitialCheckDone(true);
    }
  }, [apiFetch]);

  useEffect(() => {
    checkApi();
  }, [checkApi]);

  // Desktop real-time WS connection to receive deltas from mobile
  useEffect(() => {
    const isElectron = typeof window !== 'undefined' && Boolean((window as any).electronAPI);
    if (!isElectron || !authToken) return;

    let ws: WebSocket | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    let isClosed = false;

    const connectDesktopWs = () => {
      if (isClosed) return;
      try {
        ws = new WebSocket(`ws://localhost:3001/ws?token=${authToken}`);
        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'sync_delta') {
              const { entity, action, data } = msg;
              if (!entity || !data) return;
              const isDelete = action === 'delete' || data.deleted === 1 || data.deleted === true;
              const incomingData = isDelete ? { ...data, deleted: 1 } : data;

              if (entity === 'transaction') {
                setTransactions((prev) => {
                  const idx = prev.findIndex((t) => t.id === incomingData.id);
                  if (idx > -1) {
                    const existing = prev[idx];
                    const incomingTs = incomingData.updated_at || 0;
                    const existingTs = existing.updated_at || 0;
                    if (incomingTs > existingTs || (incomingTs === existingTs && isDelete)) {
                      const next = [...prev];
                      next[idx] = { ...next[idx], ...incomingData };
                      return next;
                    }
                    return prev;
                  }
                  return [incomingData, ...prev];
                });
              } else if (entity === 'loan') {
                setLoans((prev) => {
                  const idx = prev.findIndex((l) => l.id === incomingData.id);
                  if (idx > -1) {
                    const existing = prev[idx];
                    const incomingTs = incomingData.updated_at || 0;
                    const existingTs = existing.updated_at || 0;
                    if (incomingTs > existingTs || (incomingTs === existingTs && isDelete)) {
                      const next = [...prev];
                      next[idx] = { ...next[idx], ...incomingData };
                      return next;
                    }
                    return prev;
                  }
                  return [...prev, incomingData];
                });
              } else if (entity === 'saving') {
                setSavings((prev) => {
                  const idx = prev.findIndex((s) => s.id === incomingData.id);
                  if (idx > -1) {
                    const existing = prev[idx];
                    const incomingTs = incomingData.updated_at || 0;
                    const existingTs = existing.updated_at || 0;
                    if (incomingTs > existingTs || (incomingTs === existingTs && isDelete)) {
                      const next = [...prev];
                      next[idx] = { ...next[idx], ...incomingData };
                      return next;
                    }
                    return prev;
                  }
                  return [...prev, incomingData];
                });
              } else if (entity === 'keeper') {
                setKeepers((prev) => {
                  const idx = prev.findIndex((k) => k.id === incomingData.id);
                  if (idx > -1) {
                    const existing = prev[idx];
                    const incomingTs = incomingData.updated_at || 0;
                    const existingTs = existing.updated_at || 0;
                    if (incomingTs > existingTs || (incomingTs === existingTs && isDelete)) {
                      const next = [...prev];
                      next[idx] = { ...next[idx], ...incomingData };
                      return next;
                    }
                    return prev;
                  }
                  return [...prev, incomingData];
                });
              } else if (entity === 'bill') {
                setBills((prev) => {
                  const idx = prev.findIndex((b) => b.id === incomingData.id);
                  if (idx > -1) {
                    const existing = prev[idx];
                    const incomingTs = incomingData.updated_at || 0;
                    const existingTs = existing.updated_at || 0;
                    if (incomingTs > existingTs || (incomingTs === existingTs && isDelete)) {
                      const next = [...prev];
                      next[idx] = { ...next[idx], ...incomingData };
                      return next;
                    }
                    return prev;
                  }
                  return [...prev, incomingData];
                });
              } else if (entity === 'billPayment') {
                setBillPayments((prev) => {
                  const idx = prev.findIndex((bp) => bp.id === incomingData.id);
                  if (idx > -1) {
                    const existing = prev[idx];
                    const incomingTs = incomingData.updated_at || 0;
                    const existingTs = existing.updated_at || 0;
                    if (incomingTs > existingTs || (incomingTs === existingTs && isDelete)) {
                      const next = [...prev];
                      next[idx] = { ...next[idx], ...incomingData };
                      return next;
                    }
                    return prev;
                  }
                  return [...prev, incomingData];
                });
              } else if (entity === 'settings') {
                setSettings((prev) => ({ ...prev, ...data }));
              } else if (entity === 'reset') {
                setTransactions([]);
                setLoans([]);
                setSavings([]);
                setKeepers([]);
                setBills([]);
                setBillPayments([]);
              }
              const now = Date.now();
              setDesktopLastSyncAt(now);
              localStorage.setItem('bs_desktop_last_sync_at', String(now));
            } else if (msg.type === 'bulk_sync') {
              const payload = msg.payload || {};
              if (payload.transactions) {
                setTransactions(payload.transactions);
                localStorage.setItem(STORAGE_KEYS.transactions, JSON.stringify(payload.transactions));
              }
              if (payload.loans) {
                setLoans(payload.loans);
                localStorage.setItem(STORAGE_KEYS.loans, JSON.stringify(payload.loans));
              }
              if (payload.savings) {
                setSavings(payload.savings);
                localStorage.setItem(STORAGE_KEYS.savings, JSON.stringify(payload.savings));
              }
              if (payload.keepers) {
                setKeepers(payload.keepers);
                localStorage.setItem(STORAGE_KEYS.keepers, JSON.stringify(payload.keepers));
              }
              if (payload.bills) {
                setBills(payload.bills);
                localStorage.setItem(STORAGE_KEYS.bills, JSON.stringify(payload.bills));
              }
              if (payload.billPayments) {
                setBillPayments(payload.billPayments);
                localStorage.setItem(STORAGE_KEYS.billPayments, JSON.stringify(payload.billPayments));
              }
              if (payload.settings) {
                setSettings((prev) => ({ ...prev, ...payload.settings }));
              }
              const now = Date.now();
              setDesktopLastSyncAt(now);
              localStorage.setItem('bs_desktop_last_sync_at', String(now));
            } else if (msg.type === 'client_count') {
              const count = msg.count ?? 0;
              setSyncDeviceCount(count);
              window.dispatchEvent(new CustomEvent('sync_client_count', { detail: count }));
            } else if (msg.type === 'ping') {
              ws?.send(JSON.stringify({ type: 'pong' }));
            }
          } catch (e) {
            console.error('Desktop WS message error:', e);
          }
        };

        ws.onclose = () => {
          if (!isClosed) {
            reconnectTimeout = setTimeout(connectDesktopWs, 3000);
          }
        };
      } catch (e) {
        if (!isClosed) {
          reconnectTimeout = setTimeout(connectDesktopWs, 5000);
        }
      }
    };

    connectDesktopWs();

    return () => {
      isClosed = true;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (ws) {
        try { ws.close(); } catch {}
      }
    };
  }, [authToken]);

  // Auto-dismiss discovery toast
  useEffect(() => {
    if (discoveryToast) {
      const timer = setTimeout(() => {
        setDiscoveryToast(null);
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [discoveryToast, setDiscoveryToast]);

  /**
   * A change that has not reached the other device yet.
   *
   * Nothing is ever lost when a change cannot be sent: it is written here
   * first and kept in a queue until the other device confirms it. But that
   * queue used to work in complete silence, so a phone that had been out of
   * reach all day looked exactly like one that was fully in step. If something
   * has been waiting longer than a minute, say so once — plainly, without
   * calling it an error, because it is not one — then stop mentioning it.
   */
  const pendingTotal = !Capacitor.isNativePlatform() ? desktopRelay.queued : mobilePendingCount;
  const [syncWaitNotice, setSyncWaitNotice] = useState<string | null>(null);
  const pendingSinceRef = useRef<number | null>(null);
  const waitNoticeShownRef = useRef(false);

  useEffect(() => {
    if (pendingTotal <= 0) {
      pendingSinceRef.current = null;
      waitNoticeShownRef.current = false;
      setSyncWaitNotice(null);
      return;
    }
    if (pendingSinceRef.current === null) pendingSinceRef.current = Date.now();

    const check = () => {
      const since = pendingSinceRef.current;
      if (since === null || waitNoticeShownRef.current) return;
      if (Date.now() - since < SYNC_WAIT_NOTICE_MS) return;
      waitNoticeShownRef.current = true;
      setSyncWaitNotice(
        pendingTotal === 1
          ? "Saved here. 1 change is still waiting to reach your other device."
          : `Saved here. ${pendingTotal} changes are still waiting to reach your other device.`
      );
    };
    check();
    const timer = setInterval(check, 5000);
    return () => clearInterval(timer);
  }, [pendingTotal]);

  useEffect(() => {
    if (!syncWaitNotice) return;
    const timer = setTimeout(() => setSyncWaitNotice(null), 8000);
    return () => clearTimeout(timer);
  }, [syncWaitNotice]);

  /**
   * The Android back button.
   *
   * Nothing used to listen for it here, so every press went straight to
   * Android, which closed the whole app — with a dialog open, from the
   * sidebar, three pages deep, it made no difference. Back should undo the
   * last thing the user did, and only leave the app once there is nothing
   * left to undo.
   *
   * The listener is registered once and reads the current screen through a
   * ref, rather than being torn down and re-added every time a dialog opens.
   */
  const backStateRef = useRef({
    showAddModal: false,
    isSidebarOpen: false,
    currentView: 'dashboard',
    isLocked: true,
    hasPin: false
  });
  backStateRef.current = {
    showAddModal,
    isSidebarOpen,
    currentView,
    isLocked,
    hasPin: Boolean(settings.authPin && settings.authPin.trim() !== '')
  };

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let cancelled = false;
    let handle: any = null;

    CapApp.addListener('backButton', () => {
      // The pairing flow steps back through its own screens while it is open.
      if (backButtonIsClaimed()) return;
      const s = backStateRef.current;

      if (s.showAddModal) { setShowAddModal(false); setEditingTransaction(null); return; }
      if (s.isSidebarOpen) { setIsSidebarOpen(false); return; }

      // On the welcome and lock screens there is nothing behind to go back to,
      // and back must never be a way around the lock.
      if (!s.hasPin || s.isLocked) { CapApp.exitApp(); return; }

      if (s.currentView !== 'dashboard') { setCurrentView('dashboard'); return; }
      CapApp.exitApp();
    }).then((h) => {
      if (cancelled) h.remove();
      else handle = h;
    }).catch(() => {});

    return () => {
      cancelled = true;
      handle?.remove?.();
    };
  }, []);

  /**
   * Android: keep the app out from under the status bar and the notch.
   *
   * The web view is drawn edge to edge by default, so the top bar and any
   * full-screen dialog slid up underneath the clock and the camera cut-out.
   * Telling the status bar not to overlay makes Android reserve that strip
   * itself, which fixes every screen at once instead of each one having to
   * remember to pad its own top edge.
   */
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    StatusBar.setOverlaysWebView({ overlay: false }).catch(() => {});
    StatusBar.setBackgroundColor({ color: '#09090b' }).catch(() => {});
    StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
  }, []);

  // Persist settings
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(settings));
  }, [settings]);

  // Persist transactions
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.transactions, JSON.stringify(transactions));
  }, [transactions]);

  // Persist loans
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.loans, JSON.stringify(loans));
  }, [loans]);

  // Persist savings
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.savings, JSON.stringify(savings));
  }, [savings]);

  // Persist keepers
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.keepers, JSON.stringify(keepers));
  }, [keepers]);

  // Persist bills
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.bills, JSON.stringify(bills));
  }, [bills]);

  // Persist bill payments
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.billPayments, JSON.stringify(billPayments));
  }, [billPayments]);

  // Inactivity auto-lock timer (Web & Capacitor Native Android background detection)
  useEffect(() => {
    if (isLocked || settings.lockTimer === "never" || !settings.authPin) {
      return;
    }

    const getDuration = () => {
      switch (settings.lockTimer) {
        case "1min": return 1 * 60 * 1000;
        case "5min": return 5 * 60 * 1000;
        case "15min": return 15 * 60 * 1000;
        case "30min": return 30 * 60 * 1000;
        default: return 15 * 60 * 1000;
      }
    };

    const idleTime = getDuration();
    let timeoutId: ReturnType<typeof setTimeout>;

    const resetTimer = () => {
      if (timeoutId) clearTimeout(timeoutId);
      
      localStorage.setItem("finance_vault_last_active", Date.now().toString());

      timeoutId = setTimeout(() => {
        setIsLocked(true);
      }, idleTime);
    };

    const events = ["mousedown", "mousemove", "keypress", "scroll", "touchstart", "click"];
    events.forEach(event => window.addEventListener(event, resetTimer));

    resetTimer();

    // Visibility observer to lock immediately if idle threshold is crossed (Desktop / Web)
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        const lastActiveStr = localStorage.getItem("finance_vault_last_active");
        if (lastActiveStr) {
          const lastActive = parseInt(lastActiveStr, 10);
          if (Date.now() - lastActive > idleTime) {
            setIsLocked(true);
          } else {
            resetTimer();
          }
        }
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    // Capacitor Native Android App state listener (handles backgrounding & screen lock)
    let appStateHandlePromise: Promise<any> | null = null;
    if (Capacitor.isNativePlatform()) {
      appStateHandlePromise = CapApp.addListener("appStateChange", (state: AppState) => {
        if (!state.isActive) {
          // App went to background
          const now = Date.now();
          backgroundTimestampRef.current = now;
          localStorage.setItem("finance_vault_bg_time", now.toString());
        } else {
          // App returned to foreground
          const storedBgTime = localStorage.getItem("finance_vault_bg_time");
          const bgTime = backgroundTimestampRef.current || (storedBgTime ? parseInt(storedBgTime, 10) : 0);
          if (bgTime && (Date.now() - bgTime >= idleTime)) {
            setIsLocked(true);
          } else {
            resetTimer();
          }
          backgroundTimestampRef.current = 0;
          localStorage.removeItem("finance_vault_bg_time");
        }
      });
    }

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      events.forEach(event => window.removeEventListener(event, resetTimer));
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (appStateHandlePromise) {
        appStateHandlePromise.then((h) => h.remove()).catch(() => {});
      }
    };
  }, [isLocked, settings.lockTimer, settings.authPin]);

  const handleNavigate = (view: string) => {
    setIsSidebarOpen(false);
    if (view === "lock") {
      setIsLocked(true);
      setCurrentView("dashboard");
    } else {
      setCurrentView(view);
    }
  };

  const startUndoCountdown = () => {
    // Clear any existing undo timers
    if (undoTimerRef.current) clearInterval(undoTimerRef.current);
    if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);

    // How long the Undo offer stays up, in seconds. The user sets this in
    // Settings; 5 was the old fixed value and remains the default. Three
    // seconds proved too short to notice the toast and reach it on a phone.
    const undoSeconds = Math.max(1, Number(settings.undoSeconds) || 5);

    setUndoCountdown(undoSeconds);
    undoTimerRef.current = setInterval(() => {
      setUndoCountdown((prev) => {
        if (prev <= 1) {
          if (undoTimerRef.current) clearInterval(undoTimerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    undoTimeoutRef.current = setTimeout(() => {
      setLastAction(null);
      setUndoCountdown(0);
      if (undoTimerRef.current) clearInterval(undoTimerRef.current);
    }, undoSeconds * 1000);
  };

  const handleAddTransaction = async (tx: Transaction) => {
    const now = Date.now();
    const newTx = { ...tx, updated_at: now };
    setTransactions((prev) => [newTx, ...prev]);

    if (isApiAvailable) {
      try {
        await apiFetch("http://localhost:3001/api/transactions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(newTx)
        });
      } catch (err) {
        console.error("Failed to POST transaction:", err);
      }
    } else {
      sendMobileDelta('transaction', 'upsert', newTx);
    }

    setLastAction({ type: 'add', tx: newTx });
    startUndoCountdown();
  };

  const handleDeleteTransaction = async (id: string) => {
    // Capture the transaction before removing it so we can restore on undo
    const deletedTx = transactions.find((tx) => tx.id === id);
    const now = Date.now();
    setTransactions((prev) =>
      prev.map((tx) => tx.id === id ? { ...tx, deleted: 1, updated_at: now } : tx)
    );

    if (isApiAvailable) {
      try {
        await apiFetch(`http://localhost:3001/api/transactions/${id}`, {
          method: "DELETE"
        });
      } catch (err) {
        console.error("Failed to DELETE transaction:", err);
      }
    } else {
      sendMobileDelta('transaction', 'delete', { id, deleted: 1, updated_at: now });
    }

    if (deletedTx) {
      setLastAction({ type: 'delete', tx: deletedTx });
      startUndoCountdown();
    }
  };

  const handleMarkCleared = async (id: string) => {
    const tx = transactions.find(t => t.id === id);
    if (!tx) return;
    const now = Date.now();
    const nextStatus: 'CLEARED' | 'PENDING' = tx.status === 'PENDING' ? 'CLEARED' : 'PENDING';
    const updated = { ...tx, status: nextStatus, updated_at: now };
    setTransactions(prev => prev.map(t => t.id === id ? updated : t));
    if (isApiAvailable) {
      try {
        await apiFetch(`http://localhost:3001/api/transactions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updated)
        });
      } catch (err) {
        console.error('Failed to update transaction status:', err);
      }
    } else {
      sendMobileDelta('transaction', 'upsert', updated);
    }
  };

  const handleRestoreTransaction = async (tx: Transaction) => {
    const now = Date.now();
    const restoredTx = { ...tx, deleted: 0, updated_at: now };
    setTransactions((prev) => [...prev, restoredTx].sort((a, b) => b.date.localeCompare(a.date)));

    if (isApiAvailable) {
      try {
        await apiFetch("http://localhost:3001/api/transactions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(restoredTx)
        });
      } catch (err) {
        console.error("Failed to restore transaction:", err);
      }
    } else {
      sendMobileDelta('transaction', 'upsert', restoredTx);
    }
  };

  const handleSaveSettings = async (newSettings: AppSettings) => {
    const now = Date.now();
    let settingsToSave = { ...newSettings, settings_updated_at: now, updated_at: now };
    if (settingsToSave.authPin && !isBcryptHash(settingsToSave.authPin)) {
      try {
        settingsToSave.authPin = bcrypt.hashSync(settingsToSave.authPin, 10);
      } catch (e) {
        console.error("Failed to hash PIN with bcrypt:", e);
      }
    }

    /**
     * Changing the currency changes the symbol, and nothing else.
     *
     * This used to rewrite every stored amount using a fixed 1 USD = 300 LKR,
     * which was wrong twice over. That is not the real rate, and the rewrite
     * could not be undone: 1,000 LKR became 3.33 USD, and switching back gave
     * 999 LKR. A rupee vanished from the user's own records for good, and a
     * few switches could quietly move a balance a long way from the truth.
     *
     * So the amounts are left exactly as they were entered. The setting says
     * which symbol to print; the figures stay the user's own.
     */
    setSettings(settingsToSave);

    if (isApiAvailable) {
      try {
        await apiFetch("http://localhost:3001/api/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(settingsToSave)
        });
      } catch (err) {
        console.error("Failed to sync settings:", err);
      }
    } else {
      sendMobileDelta('settings', 'upsert', settingsToSave);
    }
  };

  const handleToggleAutoStart = async (val: boolean) => {
    if (isApiAvailable) {
      try {
        const res = await apiFetch("http://localhost:3001/api/autostart", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ autoStart: val })
        });
        if (res.ok) {
          const data = await res.json();
          setAutoStart(data.autoStart);
        }
      } catch (err) {
        console.error("Failed to toggle auto-start:", err);
      }
    }
  };

  const handleStartFresh = async () => {
    // Start Fresh makes THIS device like a new install - its data gone and no
    // longer paired - while the other device keeps its own data.
    // Step 1: Wipe the server database via the new atomic reset endpoint.
    // (On the PC this also replaces the pairing, so every phone is told it has
    // been disconnected; the phones keep their data.)
    if (isApiAvailable) {
      try {
        const res = await apiFetch("http://localhost:3001/api/reset", {
          method: "DELETE"
        });
        if (!res.ok) {
          const err = await res.json();
          console.error("Server reset failed:", err);
        }
      } catch (e) {
        console.error("Failed to reach server for reset:", e);
      }
    } else {
      // Phone: this used to send a "reset" to the PC, which wiped the PC's
      // data too and left the two still connected. Now the phone tells the
      // PC to forget the pairing and disconnects; the PC's data is untouched.
      await leaveMobileSync();
    }

    // Step 2: Clear all localStorage keys and migration tracker
    localStorage.removeItem(STORAGE_KEYS.transactions);
    localStorage.removeItem(STORAGE_KEYS.settings);
    localStorage.removeItem(STORAGE_KEYS.lockout);
    localStorage.removeItem(STORAGE_KEYS.loans);
    localStorage.removeItem(STORAGE_KEYS.savings);
    localStorage.removeItem(STORAGE_KEYS.keepers);
    localStorage.removeItem(STORAGE_KEYS.bills);
    localStorage.removeItem(STORAGE_KEYS.billPayments);
    localStorage.removeItem("finance_vault_last_active");
    localStorage.removeItem("finance_vault_sync_outbox");
    // Leftovers of the old pairing, so nothing hints at a previous connection.
    localStorage.removeItem(STORAGE_KEYS.syncCredentials);
    localStorage.removeItem("bs_last_sync_at");
    localStorage.removeItem("bs_desktop_last_sync_at");
    localStorage.removeItem("bs_selected_sync_ip");
    localStorage.removeItem("finance_vault_bg_time");
    clearMobileOutbox();

    // Step 3: Reset React state to defaults
    setDesktopLastSyncAt(null);
    setTransactions([]);
    setSettings(defaultSettings);
    setLoans([]);
    setSavings([]);
    setKeepers([]);
    setBills([]);
    setBillPayments([]);
    setCurrentView("dashboard");

    // Step 4: Show a "Data Cleared" toast overlay for 2 seconds, then lock
    setShowResetToast(true);
    setTimeout(() => {
      setShowResetToast(false);
      setIsLocked(true);
    }, 2000);
  };

  // --- Loan CRUD handlers ---

  const handleAddLoan = async (loan: LoanEntry) => {
    const now = Date.now();
    const newLoan = { ...loan, updated_at: now };
    setLoans((prev) => [newLoan, ...prev]);

    if (isApiAvailable) {
      try {
        await apiFetch("http://localhost:3001/api/loans", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(newLoan)
        });
      } catch (err) {
        console.error("Failed to POST loan:", err);
      }
    } else {
      sendMobileDelta('loan', 'upsert', newLoan);
    }
  };

  const handleDeleteLoan = async (id: string) => {
    const now = Date.now();
    setLoans((prev) =>
      prev.map((l) => l.id === id ? { ...l, deleted: 1, updated_at: now } : l)
    );

    if (isApiAvailable) {
      try {
        await apiFetch(`http://localhost:3001/api/loans/${id}`, {
          method: "DELETE"
        });
      } catch (err) {
        console.error("Failed to DELETE loan:", err);
      }
    } else {
      sendMobileDelta('loan', 'delete', { id, deleted: 1, updated_at: now });
    }
  };

  const handleMarkLoanPaid = async (id: string, addAsTransaction: boolean) => {
    const loan = loans.find(l => l.id === id);
    if (!loan) return;

    const now = Date.now();
    const updated = { ...loan, status: 'paid' as const, updated_at: now };
    setLoans(prev => prev.map(l => l.id === id ? updated : l));

    if (isApiAvailable) {
      try {
        await apiFetch("http://localhost:3001/api/loans", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updated)
        });
      } catch (err) {
        console.error("Failed to update loan status:", err);
      }
    } else {
      sendMobileDelta('loan', 'upsert', updated);
    }

    // Optionally add as a transaction to the main ledger
    if (addAsTransaction) {
      const txAmount = loan.type === 'lent' ? loan.amount : -loan.amount;
      const txDescription = loan.type === 'lent'
        ? `Loan repaid by ${loan.personName}`
        : `Debt paid to ${loan.personName}`;

      const tx: Transaction = {
        id: generateId(),
        date: getTodayString(),
        description: txDescription,
        category: 'Personal',
        amount: txAmount,
        status: 'CLEARED',
        updated_at: now,
      };

      setTransactions(prev => [tx, ...prev]);

      if (isApiAvailable) {
        try {
          await apiFetch("http://localhost:3001/api/transactions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(tx)
          });
        } catch (err) {
          console.error("Failed to POST loan settlement transaction:", err);
        }
      } else {
        sendMobileDelta('transaction', 'upsert', tx);
      }
    }
  };

  // --- Savings CRUD handlers ---

  const handleAddSaving = async (saving: SavingsEntry) => {
    const now = Date.now();
    const newSaving = { ...saving, updated_at: now };
    setSavings((prev) => [newSaving, ...prev]);

    if (isApiAvailable) {
      try {
        await apiFetch("http://localhost:3001/api/savings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(newSaving)
        });
      } catch (err) {
        console.error("Failed to POST saving:", err);
      }
    } else {
      sendMobileDelta('saving', 'upsert', newSaving);
    }
  };

  const handleDeleteSaving = async (id: string) => {
    const now = Date.now();
    setSavings((prev) =>
      prev.map((s) => s.id === id ? { ...s, deleted: 1, updated_at: now } : s)
    );

    if (isApiAvailable) {
      try {
        await apiFetch(`http://localhost:3001/api/savings/${id}`, {
          method: "DELETE"
        });
      } catch (err) {
        console.error("Failed to DELETE saving:", err);
      }
    } else {
      sendMobileDelta('saving', 'delete', { id, deleted: 1, updated_at: now });
    }
  };

  const handleWithdrawSaving = async (id: string, addAsTransaction: boolean) => {
    const saving = savings.find(s => s.id === id);
    if (!saving) return;

    const now = Date.now();
    const updated = { ...saving, status: 'withdrawn' as const, updated_at: now };
    setSavings(prev => prev.map(s => s.id === id ? updated : s));

    if (isApiAvailable) {
      try {
        await apiFetch("http://localhost:3001/api/savings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updated)
        });
      } catch (err) {
        console.error("Failed to update saving status:", err);
      }
    } else {
      sendMobileDelta('saving', 'upsert', updated);
    }

    // Optionally add as an income transaction to the personal ledger
    if (addAsTransaction) {
      const tx: Transaction = {
        id: generateId(),
        date: getTodayString(),
        description: `Savings withdrawn from ${saving.keeperName}`,
        category: 'Personal',
        amount: saving.amount,
        status: 'CLEARED',
        updated_at: now,
      };

      setTransactions(prev => [tx, ...prev]);

      if (isApiAvailable) {
        try {
          await apiFetch("http://localhost:3001/api/transactions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(tx)
          });
        } catch (err) {
          console.error("Failed to POST savings withdrawal transaction:", err);
        }
      } else {
        sendMobileDelta('transaction', 'upsert', tx);
      }
    }
  };

  // --- Keepers CRUD handlers ---

  const handleAddKeeper = async (keeper: Keeper) => {
    setKeepers((prev) => [keeper, ...prev]);

    if (isApiAvailable) {
      try {
        await apiFetch("http://localhost:3001/api/keepers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(keeper)
        });
      } catch (err) {
        console.error("Failed to POST keeper:", err);
      }
    } else {
      sendMobileDelta('keeper', 'upsert', keeper);
    }
  };

  const handleEditKeeper = async (id: string, name: string, type: 'bank' | 'wallet' | 'person') => {
    const existing = keepers.find(k => k.id === id);
    const now = Date.now();
    const updated: Keeper = {
      ...(existing || { id, name, type }),
      name,
      type,
      updated_at: now,
      deleted: 0
    };
    setKeepers((prev) => prev.map((k) => k.id === id ? updated : k));

    if (isApiAvailable) {
      try {
        await apiFetch(`http://localhost:3001/api/keepers/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, type })
        });
      } catch (err) {
        console.error("Failed to PUT keeper:", err);
      }
    } else {
      sendMobileDelta('keeper', 'upsert', updated);
    }
  };

  const handleDeleteKeeper = async (id: string) => {
    // Check if keeper is referenced in active client savings
    const isReferenced = savings.some(s => !s.deleted && s.keeper_id === id && s.status === 'kept');
    if (isReferenced) {
      throw new Error("This keeper is used by existing savings entries");
    }

    const now = Date.now();
    if (isApiAvailable) {
      try {
        const res = await apiFetch(`http://localhost:3001/api/keepers/${id}`, {
          method: "DELETE"
        });
        if (!res.ok) {
          const errData = await res.json();
          throw new Error(errData.error || "Failed to delete keeper");
        }
      } catch (err: any) {
        console.error("Failed to DELETE keeper:", err);
        throw err;
      }
    } else {
      sendMobileDelta('keeper', 'delete', { id, deleted: 1, updated_at: now });
    }
    // Update local state keeping tombstone
    setKeepers((prev) =>
      prev.map((k) => k.id === id ? { ...k, deleted: 1, updated_at: now } : k)
    );
  };

  const handleEditTransaction = async (updatedTx: Transaction) => {
    const now = Date.now();
    const finalTx = { ...updatedTx, updated_at: now };
    setTransactions(prev => 
      prev.map(t => t.id === finalTx.id ? finalTx : t)
    );
    
    if (isApiAvailable) {
      try {
        await apiFetch("http://localhost:3001/api/transactions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(finalTx)
        });
      } catch (err) {
        console.error("Failed to sync edited transaction:", err);
      }
    } else {
      sendMobileDelta('transaction', 'upsert', finalTx);
    }
  };

  const openAddModal = () => setShowAddModal(true);
  
  // --- Bills CRUD handlers ---

  const handleAddBill = async (bill: Bill) => {
    const now = Date.now();
    const newBill = { ...bill, updated_at: now };
    setBills((prev) => [newBill, ...prev]);

    if (isApiAvailable) {
      try {
        await apiFetch("http://localhost:3001/api/bills", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(newBill)
        });
      } catch (err) {
        console.error("Failed to POST bill:", err);
      }
    } else {
      sendMobileDelta('bill', 'upsert', newBill);
    }
  };

  const handleDeleteBill = async (id: string) => {
    const now = Date.now();
    setBills((prev) =>
      prev.map((b) => b.id === id ? { ...b, deleted: 1, updated_at: now } : b)
    );

    if (isApiAvailable) {
      try {
        await apiFetch(`http://localhost:3001/api/bills/${id}`, {
          method: "DELETE"
        });
      } catch (err) {
        console.error("Failed to DELETE bill:", err);
      }
    } else {
      sendMobileDelta('bill', 'delete', { id, deleted: 1, updated_at: now });
    }
  };

  const handleMarkBillPaid = async (billId: string, addAsTransaction: boolean) => {
    const bill = bills.find(b => b.id === billId);
    if (!bill) return;

    const now = Date.now();
    const today = getTodayString();
    const currentMonth = today.substring(0, 7); // 'YYYY-MM'

    // Duplicate check: if an active payment already exists for this bill+month, update it
    const existingPayment = billPayments.find(
      bp => bp.bill_id === billId && bp.month === currentMonth && !bp.deleted
    );

    let linkedTxId: string | undefined;

    if (addAsTransaction) {
      const txId = generateId();
      linkedTxId = txId;
      const tx: Transaction = {
        id: txId,
        date: today,
        description: `Bill payment: ${bill.name}`,
        category: bill.category,
        amount: -Math.abs(bill.amount),
        status: 'CLEARED',
        updated_at: now,
      };
      setTransactions(prev => [tx, ...prev]);
      if (isApiAvailable) {
        try {
          await apiFetch("http://localhost:3001/api/transactions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(tx)
          });
        } catch (err) {
          console.error("Failed to POST bill payment transaction:", err);
        }
      } else {
        sendMobileDelta('transaction', 'upsert', tx);
      }
    }

    if (existingPayment) {
      // UPDATE existing record (prevents double-click duplicates)
      const updated: BillPayment = {
        ...existingPayment,
        paid: 1,
        paid_date: today,
        linked_transaction_id: linkedTxId ?? existingPayment.linked_transaction_id,
        updated_at: now,
      };
      setBillPayments(prev =>
        prev.map(bp => bp.id === existingPayment.id ? updated : bp)
      );
      if (isApiAvailable) {
        try {
          await apiFetch("http://localhost:3001/api/bill-payments", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(updated)
          });
        } catch (err) {
          console.error("Failed to update existing bill payment:", err);
        }
      } else {
        sendMobileDelta('billPayment', 'upsert', updated);
      }
    } else {
      // INSERT new record
      const payment: BillPayment = {
        id: generateId(),
        bill_id: billId,
        month: currentMonth,
        paid: 1,
        paid_date: today,
        linked_transaction_id: linkedTxId,
        updated_at: now,
      };
      setBillPayments(prev => [payment, ...prev]);
      if (isApiAvailable) {
        try {
          await apiFetch("http://localhost:3001/api/bill-payments", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payment)
          });
        } catch (err) {
          console.error("Failed to POST bill payment:", err);
        }
      } else {
        sendMobileDelta('billPayment', 'upsert', payment);
      }
    }
  };

  const handleUnpayBill = async (paymentId: string) => {
    const payment = billPayments.find((bp) => bp.id === paymentId);
    const linkedTxId = payment?.linked_transaction_id;
    const now = Date.now();

    // 1. Soft-delete the bill payment
    setBillPayments((prev) =>
      prev.map((bp) => bp.id === paymentId ? { ...bp, deleted: 1, updated_at: now } : bp)
    );

    if (isApiAvailable) {
      try {
        await apiFetch(`http://localhost:3001/api/bill-payments/${paymentId}`, {
          method: "DELETE"
        });
      } catch (err) {
        console.error("Failed to DELETE bill payment:", err);
      }
    } else {
      sendMobileDelta('billPayment', 'delete', { id: paymentId, deleted: 1, updated_at: now });
    }

    // 2. If present, also soft-delete the linked ledger transaction (Fix 2.5)
    if (linkedTxId) {
      setTransactions((prev) =>
        prev.map((t) => t.id === linkedTxId ? { ...t, deleted: 1, updated_at: now } : t)
      );

      if (isApiAvailable) {
        try {
          await apiFetch(`http://localhost:3001/api/transactions/${linkedTxId}`, {
            method: "DELETE"
          });
        } catch (err) {
          console.error("Failed to DELETE linked transaction for bill payment:", err);
        }
      } else {
        sendMobileDelta('transaction', 'delete', { id: linkedTxId, deleted: 1, updated_at: now });
      }
    }
  };

  const openEditModal = (tx: Transaction) => {
    setEditingTransaction(tx);
    setShowAddModal(true);
  };
  
  const closeAddModal = () => {
    setShowAddModal(false);
    setEditingTransaction(null);
  };

  const handleSplashComplete = () => {
    sessionStorage.setItem("splash_shown", "true");
    setShowSplash(false);
  };

  const handleSetInitialPin = async (pin: string) => {
    const hashed = bcrypt.hashSync(pin, 10);
    const newSettings = { ...settings, authPin: hashed };
    setSettings(newSettings);
    localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(newSettings));
    if (isApiAvailable) {
      try {
        await apiFetch("http://localhost:3001/api/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(newSettings),
        });
      } catch (e) {
        console.error("Failed to save initial PIN:", e);
      }
    } else {
      sendMobileDelta('settings', 'upsert', newSettings);
    }
    setIsLocked(false);
  };

  const renderView = () => {
    switch (currentView) {
      case "dashboard":
        return (
          <Dashboard
            transactions={transactions}
            currency={settings.currency}
            onAddTransactionClick={openAddModal}
            businessLedgerName={settings.businessLedgerName}
            personalLedgerName={settings.personalLedgerName}
            loans={loans}
            savings={savings}
          />
        );
      case "transactions":
        return (
          <Transactions
            transactions={transactions}
            currency={settings.currency}
            onDelete={handleDeleteTransaction}
            onRestore={handleRestoreTransaction}
            onMarkCleared={handleMarkCleared}
            businessLedgerName={settings.businessLedgerName}
            personalLedgerName={settings.personalLedgerName}
            onEditClick={openEditModal}
            onAddTransactionClick={openAddModal}
          />
        );
      case "business":
        return (
          <div className="p-6 flex flex-col items-center justify-center h-full text-center">
            <div className="bg-[var(--color-surface-variant)] p-8 rounded-2xl border border-[var(--color-outline)] shadow-2xl flex flex-col items-center max-w-md">
              <div className="w-16 h-16 bg-[var(--color-surface)] border border-[var(--color-outline)] rounded-full flex items-center justify-center mb-6 text-[var(--color-secondary)] shadow-inner">
                <Building2 size={32} />
              </div>
              <h2 className="text-xl font-bold text-[var(--color-on-surface)] mb-2">Business Ledger</h2>
              <p className="text-sm text-[var(--color-on-surface-variant)] leading-relaxed">
                Dedicated business tracking, customized reporting, and advanced analytics are coming soon in a future update.
              </p>
              <div className="mt-8 px-4 py-1.5 rounded-full border border-[var(--color-outline)] bg-[var(--color-surface)] text-[10px] font-bold uppercase tracking-widest text-[var(--color-secondary)]">
                Coming Soon
              </div>
            </div>
          </div>
        );
      case "personal":
        return (
          <div className="p-6 flex flex-col items-center justify-center h-full text-center">
            <div className="bg-[var(--color-surface-variant)] p-8 rounded-2xl border border-[var(--color-outline)] shadow-2xl flex flex-col items-center max-w-md">
              <div className="w-16 h-16 bg-[var(--color-surface)] border border-[var(--color-outline)] rounded-full flex items-center justify-center mb-6 text-[var(--color-primary)] shadow-inner">
                <User size={32} />
              </div>
              <h2 className="text-xl font-bold text-[var(--color-on-surface)] mb-2">Personal Ledger</h2>
              <p className="text-sm text-[var(--color-on-surface-variant)] leading-relaxed">
                Detailed personal budgeting, custom categories, and savings goal tracking are coming soon in a future update.
              </p>
              <div className="mt-8 px-4 py-1.5 rounded-full border border-[var(--color-outline)] bg-[var(--color-surface)] text-[10px] font-bold uppercase tracking-widest text-[var(--color-primary)]">
                Coming Soon
              </div>
            </div>
          </div>
        );
      case "loans":
        return (
          <Loans
            loans={loans}
            currency={settings.currency}
            onAddLoan={handleAddLoan}
            onDeleteLoan={handleDeleteLoan}
            onMarkPaid={handleMarkLoanPaid}
          />
        );
      case "savings":
        return (
          <Savings
            savings={savings}
            keepers={keepers}
            currency={settings.currency}
            onAddSaving={handleAddSaving}
            onDeleteSaving={handleDeleteSaving}
            onWithdraw={handleWithdrawSaving}
            onAddKeeper={handleAddKeeper}
            onEditKeeper={handleEditKeeper}
            onDeleteKeeper={handleDeleteKeeper}
          />
        );
      case "bills":
        return (
          <Bills
            bills={bills}
            billPayments={billPayments}
            currency={settings.currency}
            onAddBill={handleAddBill}
            onDeleteBill={handleDeleteBill}
            onMarkPaid={handleMarkBillPaid}
            onUnpay={handleUnpayBill}
          />
        );
      case "settings":
        return (
          <Settings
            authPin={settings.authPin}
            currency={settings.currency}
            lockTimer={settings.lockTimer}
            undoSeconds={settings.undoSeconds ?? 5}
            businessLedgerName={settings.businessLedgerName}
            personalLedgerName={settings.personalLedgerName}
            onSave={handleSaveSettings}
            onStartFresh={handleStartFresh}
            autoStart={autoStart}
            onToggleAutoStart={handleToggleAutoStart}
            syncStatus={mobileSyncStatus}
            syncCredentials={mobileSyncCredentials}
            lastSyncedAt={!Capacitor.isNativePlatform() ? desktopLastSyncAt : mobileLastSyncAt}
            onPairSync={pairMobileSync}
            onDisconnectSync={disconnectMobileSync}
          />
        );
      default:
        return (
          <Dashboard
            transactions={transactions}
            currency={settings.currency}
            onAddTransactionClick={openAddModal}
            businessLedgerName={settings.businessLedgerName}
            personalLedgerName={settings.personalLedgerName}
            loans={loans}
            savings={savings}
          />
        );
    }
  };

  if (showSplash) {
    return <SplashScreen onComplete={handleSplashComplete} />;
  }

  // If initial sync check with Desktop SQLite server is still in flight:
  if (!isInitialCheckDone) {
    return (
      <div className="min-h-screen flex flex-col bg-[var(--color-background)] items-center justify-center relative select-none">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin" />
          <p className="text-xs text-[var(--color-on-surface-variant)] font-medium">Checking vault security...</p>
        </div>
      </div>
    );
  }

  // 1. FIRST CHECK: Truly fresh install (no PIN set in localStorage and none on server)
  // If yes -> show Onboarding/Welcome screen (set PIN flow)
  // Skip the lock screen entirely — you can't lock what hasn't been configured yet
  const hasPin = Boolean(settings.authPin && settings.authPin.trim() !== "");
  if (!hasPin) {
    return (
      <OnboardingWelcome
        onSetPin={handleSetInitialPin}
        onPairSync={pairMobileSync}
        syncStatus={mobileSyncStatus}
        syncCredentials={mobileSyncCredentials}
        onDisconnectSync={disconnectMobileSync}
      />
    );
  }

  // 2. ONLY AFTER a PIN exists: Is the app locked?
  // If yes -> show Lock Screen
  // If no -> show main app
  if (isLocked) {
    return (
      <LockScreen
        onUnlock={() => setIsLocked(false)}
        authPin={settings.authPin}
      />
    );
  }

  const getTitle = () => {
    switch (currentView) {
      case "dashboard":
        return "Budget Secure";
      case "transactions":
        return "Transaction Management";
      case "business":
        return "Business Ledger";
      case "personal":
        return "Personal Ledger";
      case "loans":
        return "Loans";
      case "savings":
        return "Savings";
      case "bills":
        return "Bills";
      case "settings":
        return "Settings";
      default:
        return "Budget Secure";
    }
  };

  return (
    <div className="flex h-screen w-full overflow-hidden bg-[var(--color-background)]">
      <Sidebar
        currentView={currentView}
        onNavigate={handleNavigate}
        businessName="Budget Secure"
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        currency={settings.currency}
      />

      <div className="flex-1 flex flex-col h-screen overflow-hidden relative">
        <TopBar
          title={getTitle()}
          onLock={() => setIsLocked(true)}
          onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
          // The badge only says whether the other device is linked right now:
          // nothing until one has been paired, then Connected / Disconnected.
          linkPaired={
            !Capacitor.isNativePlatform()
              ? syncDeviceCount > 0 || desktopRelay.paired
              : Boolean(mobileSyncCredentials)
          }
          linkConnected={
            !Capacitor.isNativePlatform()
              ? syncDeviceCount > 0 || desktopRelay.online
              : mobilePcOnline
          }
          onOpenSync={() => handleNavigate('settings')}
        />

        {Capacitor.isNativePlatform() && showDiscoveryBanner && (
          <div className="bg-amber-500/15 border-b border-amber-500/30 px-4 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-amber-200">
            <div className="flex items-center gap-2">
              <AlertTriangle size={16} className="text-amber-400 shrink-0" />
              {/* This shows only while the PC cannot be reached at all - not
                  over Wi-Fi and not through the internet post box - so the
                  likely reason is the PC being closed or offline, not the two
                  being on different networks. Nothing is lost meanwhile:
                  changes made here are kept and go across once it is back. */}
              <span>Can't reach your PC right now. Make sure Budget Secure is open on it and that it has internet. Anything you add here is saved and will sync as soon as it's back.</span>
            </div>
            <button
              type="button"
              onClick={() => handleNavigate('settings')}
              className="self-start sm:self-auto px-2.5 py-1 bg-amber-500/20 hover:bg-amber-500/30 active:bg-amber-500/40 border border-amber-500/40 rounded font-medium text-amber-100 transition-colors whitespace-nowrap cursor-pointer"
            >
              Scan QR again
            </button>
          </div>
        )}

        {discoveryToast && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[300] bg-emerald-950/90 border border-emerald-500/40 text-emerald-200 rounded-lg shadow-2xl px-4 py-2.5 flex items-center gap-2 text-xs font-medium animate-[slideUp_0.2s_ease-out]">
            <Check size={16} className="text-emerald-400 shrink-0" />
            <span>{discoveryToast}</span>
            <button
              type="button"
              onClick={() => setDiscoveryToast(null)}
              className="ml-2 text-emerald-400 hover:text-white"
            >
              ✕
            </button>
          </div>
        )}

        {syncWaitNotice && (
          <div
            className={`fixed ${discoveryToast ? 'bottom-20' : 'bottom-6'} left-1/2 -translate-x-1/2 z-[300] bg-amber-950/90 border border-amber-500/40 text-amber-200 rounded-lg shadow-2xl px-4 py-2.5 flex items-center gap-2 text-xs font-medium animate-[slideUp_0.2s_ease-out]`}
          >
            <Clock size={16} className="text-amber-400 shrink-0" />
            <span>{syncWaitNotice}</span>
            <button
              type="button"
              onClick={() => setSyncWaitNotice(null)}
              className="ml-2 text-amber-400 hover:text-white"
            >
              ✕
            </button>
          </div>
        )}

        <main className="flex-1 overflow-hidden relative bg-[radial-gradient(#1c1c1c_1px,transparent_1px)] [background-size:20px_20px]">
          {renderView()}
        </main>
      </div>

      {showAddModal && (
        <AddTransactionModal
          onClose={closeAddModal}
          onAdd={handleAddTransaction}
          onEdit={handleEditTransaction}
          editingTransaction={editingTransaction}
        />
      )}

      {showResetToast && (
        <div className="fixed bottom-6 right-6 z-[300] bg-[var(--color-surface-variant)] border border-[var(--color-primary)]/40 text-[var(--color-primary)] rounded-lg shadow-2xl px-5 py-3.5 flex items-center gap-3 min-w-[320px] animate-[slideUp_0.2s_ease-out] font-medium text-sm">
          <div className="w-2.5 h-2.5 rounded-full bg-[var(--color-primary)] animate-ping shrink-0" />
          <span>Data Cleared</span>
        </div>
      )}

      {lastAction && undoCountdown > 0 && (
        <div
          className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[300] rounded-lg shadow-2xl px-5 py-3.5 flex items-center gap-4 min-w-[380px] animate-[slideUp_0.2s_ease-out] font-medium text-sm border ${
            lastAction.type === 'add'
              ? 'bg-[var(--color-primary)]/10 border-[var(--color-primary)]/30 text-[var(--color-primary)]'
              : 'bg-[var(--color-error)]/10 border-[var(--color-error)]/30 text-[var(--color-error)]'
          }`}
        >
          <div className="flex-1 min-w-0 truncate">
            {lastAction.type === 'add' ? 'Transaction added.' : 'Transaction deleted.'}
            {' '}
            <span className="opacity-70">Undo ({undoCountdown}s)</span>
          </div>
          <button
            onClick={() => {
              if (!lastAction) return;
              // Clear timers immediately
              if (undoTimerRef.current) clearInterval(undoTimerRef.current);
              if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);

              const action = lastAction;
              setLastAction(null);
              setUndoCountdown(0);

              if (action.type === 'add') {
                // Undo add = soft-delete the transaction
                const now = Date.now();
                setTransactions((prev) =>
                  prev.map((t) => t.id === action.tx.id ? { ...t, deleted: 1, updated_at: now } : t)
                );
                if (isApiAvailable) {
                  apiFetch(`http://localhost:3001/api/transactions/${action.tx.id}`, {
                    method: 'DELETE'
                  }).catch((err) => console.error('Undo add failed:', err));
                } else {
                  sendMobileDelta('transaction', 'delete', { id: action.tx.id, deleted: 1, updated_at: now });
                }
              } else {
                // Undo delete = restore the transaction
                const now = Date.now();
                const restoredTx = { ...action.tx, deleted: 0, updated_at: now };
                setTransactions((prev) => {
                  const idx = prev.findIndex((t) => t.id === restoredTx.id);
                  if (idx > -1) {
                    const next = [...prev];
                    next[idx] = restoredTx;
                    return next.sort((a, b) => b.date.localeCompare(a.date));
                  }
                  return [...prev, restoredTx].sort((a, b) => b.date.localeCompare(a.date));
                });
                if (isApiAvailable) {
                  apiFetch('http://localhost:3001/api/transactions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(restoredTx)
                  }).catch((err) => console.error('Undo delete failed:', err));
                } else {
                  sendMobileDelta('transaction', 'upsert', restoredTx);
                }
              }
            }}
            className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded transition-colors ${
              lastAction.type === 'add'
                ? 'bg-[var(--color-primary)] text-[var(--color-on-primary)] hover:bg-[var(--color-secondary-variant)]'
                : 'bg-[var(--color-error)] text-[var(--color-on-error)] hover:opacity-80'
            }`}
          >
            <Undo2 size={13} />
            Undo
          </button>
        </div>
      )}

      <UpdateNotification />
    </div>
  );
}
