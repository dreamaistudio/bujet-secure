import { useState, useEffect, useCallback, useRef } from "react";
import { Building2, User, Undo2 } from "lucide-react";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { AddTransactionModal } from "./components/AddTransactionModal";
import { SupportModal } from "./components/SupportModal";
import { Dashboard } from "./views/Dashboard";
import { LockScreen } from "./views/LockScreen";
import { Settings } from "./views/Settings";
import { Transactions } from "./views/Transactions";
import { Loans } from "./views/Loans";
import { Savings } from "./views/Savings";
import { Bills } from "./views/Bills";
import { Transaction, LoanEntry, SavingsEntry, Keeper, Bill, BillPayment } from "./types";
import { STORAGE_KEYS } from "./data";
import { SplashScreen } from "./components/SplashScreen";
import { generateId, getTodayString } from "./lib/utils";
import { UpdateNotification } from "./components/UpdateNotification";

interface AppSettings {
  authPin: string;
  biometricEnabled: boolean;
  currency: string;
  lockTimer: string;
  businessLedgerName: string;
  personalLedgerName: string;
}

const defaultSettings: AppSettings = {
  authPin: "",
  biometricEnabled: false,
  currency: "LKR",
  lockTimer: "15min",
  businessLedgerName: "Business Ledger",
  personalLedgerName: "Personal Ledger",
};

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.settings);
    if (raw) return { ...defaultSettings, ...JSON.parse(raw) };
  } catch {
    // ignore
  }
  return defaultSettings;
}

function loadTransactions(): Transaction[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.transactions);
    if (raw !== null) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return [];
}

function loadLoans(): LoanEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.loans);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return [];
}

function loadSavings(): SavingsEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.savings);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return [];
}

function loadKeepers(): Keeper[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.keepers);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return [];
}

function loadBills(): Bill[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.bills);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return [];
}

function loadBillPayments(): BillPayment[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.billPayments);
    if (raw) return JSON.parse(raw);
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
  const [showSupportModal, setShowSupportModal] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const [transactions, setTransactions] = useState<Transaction[]>(loadTransactions);
  const [loans, setLoans] = useState<LoanEntry[]>(loadLoans);
  const [savings, setSavings] = useState<SavingsEntry[]>(loadSavings);
  const [keepers, setKeepers] = useState<Keeper[]>(loadKeepers);
  const [bills, setBills] = useState<Bill[]>(loadBills);
  const [billPayments, setBillPayments] = useState<BillPayment[]>(loadBillPayments);

  // Desktop App states
  const [isApiAvailable, setIsApiAvailable] = useState(false);
  const [syncStatus, setSyncStatus] = useState("Local Only");
  const [localIp, setLocalIp] = useState("");
  const [authToken, setAuthToken] = useState(() => sessionStorage.getItem("sync_auth_token") || "");
  const authTokenRef = useRef<string>(authToken);
  const [autoStart, setAutoStart] = useState(false);
  const [showResetToast, setShowResetToast] = useState(false);

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
    const isElectron = typeof window !== 'undefined' && Boolean((window as any).electronAPI);
    if (!isElectron) {
      setIsApiAvailable(false);
      setSyncStatus("Local Only");
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
          if (merged.settings && Object.keys(merged.settings).length > 0) {
            setSettings(merged.settings);
          }
          if (Array.isArray(merged.transactions)) {
            setTransactions(merged.transactions);
          }
          if (Array.isArray(merged.loans)) {
            setLoans(merged.loans);
          }
          if (Array.isArray(merged.keepers)) {
            setKeepers(merged.keepers);
          }
          if (Array.isArray(merged.savings)) {
            setSavings(merged.savings);
          }
          if (Array.isArray(merged.bills)) {
            setBills(merged.bills);
          }
          if (Array.isArray(merged.billPayments)) {
            setBillPayments(merged.billPayments);
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
    }
  }, []);

  useEffect(() => {
    checkApi();
  }, [checkApi]);

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

  // Inactivity auto-lock timer
  useEffect(() => {
    if (isLocked || settings.lockTimer === "never" || !settings.authPin) {
      return;
    }

    const getDuration = () => {
      switch (settings.lockTimer) {
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

    // Visibility observer to lock immediately if idle threshold is crossed
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

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      events.forEach(event => window.removeEventListener(event, resetTimer));
      document.removeEventListener("visibilitychange", handleVisibilityChange);
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

  const startUndoCountdown = useCallback(() => {
    // Clear any existing undo timers
    if (undoTimerRef.current) clearInterval(undoTimerRef.current);
    if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);

    setUndoCountdown(5);
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
    }, 5000);
  }, []);

  const handleAddTransaction = useCallback(async (tx: Transaction) => {
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
    }

    setLastAction({ type: 'add', tx: newTx });
    startUndoCountdown();
  }, [isApiAvailable, startUndoCountdown, apiFetch]);

  const handleDeleteTransaction = useCallback(async (id: string) => {
    // Capture the transaction before removing it so we can restore on undo
    const deletedTx = transactions.find((tx) => tx.id === id);
    setTransactions((prev) => prev.filter((tx) => tx.id !== id));

    if (isApiAvailable) {
      try {
        await apiFetch(`http://localhost:3001/api/transactions/${id}`, {
          method: "DELETE"
        });
      } catch (err) {
        console.error("Failed to DELETE transaction:", err);
      }
    }

    if (deletedTx) {
      setLastAction({ type: 'delete', tx: deletedTx });
      startUndoCountdown();
    }
  }, [isApiAvailable, transactions, startUndoCountdown, apiFetch]);

  const handleMarkCleared = useCallback(async (id: string) => {
    const tx = transactions.find(t => t.id === id);
    if (!tx) return;
    const updated = { ...tx, status: 'CLEARED' as const, updated_at: Date.now() };
    setTransactions(prev => prev.map(t => t.id === id ? updated : t));
    if (isApiAvailable) {
      try {
        await apiFetch(`http://localhost:3001/api/transactions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updated)
        });
      } catch (err) {
        console.error('Failed to mark transaction as cleared:', err);
      }
    }
  }, [transactions, isApiAvailable, apiFetch]);

  const handleRestoreTransaction = useCallback(async (tx: Transaction) => {
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
    }
  }, [isApiAvailable, apiFetch]);

  const handleSaveSettings = useCallback(async (newSettings: AppSettings) => {
    let finalTransactions = transactions;

    // Convert transactions if currency changed
    if (settings.currency !== newSettings.currency) {
      const rate = 300; // 1 USD = 300 LKR
      const now = Date.now();
      
      finalTransactions = transactions.map((tx) => {
        let newAmount = tx.amount;
        if (settings.currency === "LKR" && newSettings.currency === "USD") {
          newAmount = Number((tx.amount / rate).toFixed(2));
        } else if (settings.currency === "USD" && newSettings.currency === "LKR") {
          newAmount = Number((tx.amount * rate).toFixed(2));
        }
        return {
          ...tx,
          amount: newAmount,
          updated_at: now
        };
      });

      setTransactions(finalTransactions);

      // Convert loans
      const convertedLoans = loans.map((loan) => {
        let newAmount = loan.amount;
        if (settings.currency === "LKR" && newSettings.currency === "USD") {
          newAmount = Number((loan.amount / rate).toFixed(2));
        } else if (settings.currency === "USD" && newSettings.currency === "LKR") {
          newAmount = Number((loan.amount * rate).toFixed(2));
        }
        return { ...loan, amount: newAmount, updated_at: now };
      });
      setLoans(convertedLoans);

      // Convert savings
      const convertedSavings = savings.map((saving) => {
        let newAmount = saving.amount;
        if (settings.currency === "LKR" && newSettings.currency === "USD") {
          newAmount = Number((saving.amount / rate).toFixed(2));
        } else if (settings.currency === "USD" && newSettings.currency === "LKR") {
          newAmount = Number((saving.amount * rate).toFixed(2));
        }
        return { ...saving, amount: newAmount, updated_at: now };
      });
      setSavings(convertedSavings);

      // Convert bills
      const convertedBills = bills.map((bill) => {
        let newAmount = bill.amount;
        if (settings.currency === "LKR" && newSettings.currency === "USD") {
          newAmount = Number((bill.amount / rate).toFixed(2));
        } else if (settings.currency === "USD" && newSettings.currency === "LKR") {
          newAmount = Number((bill.amount * rate).toFixed(2));
        }
        return { ...bill, amount: newAmount, updated_at: now };
      });
      setBills(convertedBills);

      // Batch update converted transactions, loans, savings, and bills
      if (isApiAvailable) {
        try {
          for (const tx of finalTransactions) {
            await apiFetch("http://localhost:3001/api/transactions", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(tx)
            });
          }
          for (const loan of convertedLoans) {
            await apiFetch("http://localhost:3001/api/loans", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(loan)
            });
          }
          for (const saving of convertedSavings) {
            await apiFetch("http://localhost:3001/api/savings", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(saving)
            });
          }
          for (const bill of convertedBills) {
            await apiFetch("http://localhost:3001/api/bills", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(bill)
            });
          }
        } catch (err) {
          console.error("Failed to sync converted currency entries:", err);
        }
      }
    }

    setSettings(newSettings);

    if (isApiAvailable) {
      try {
        await apiFetch("http://localhost:3001/api/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(newSettings)
        });
      } catch (err) {
        console.error("Failed to sync settings:", err);
      }
    }
  }, [settings, transactions, isApiAvailable, apiFetch]);

  const handleToggleAutoStart = useCallback(async (val: boolean) => {
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
  }, [isApiAvailable, apiFetch]);

  const handleStartFresh = useCallback(async () => {
    // Step 1: Wipe the server database via the new atomic reset endpoint
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
    }

    // Step 2: Clear all localStorage keys and migration tracker
    localStorage.removeItem(STORAGE_KEYS.transactions);
    localStorage.removeItem(STORAGE_KEYS.settings);
    localStorage.removeItem(STORAGE_KEYS.lockout);
    localStorage.removeItem(STORAGE_KEYS.loans);
    localStorage.removeItem(STORAGE_KEYS.savings);
    localStorage.removeItem(STORAGE_KEYS.bills);
    localStorage.removeItem(STORAGE_KEYS.billPayments);
    localStorage.removeItem("finance_vault_last_active");

    // Step 3: Reset React state to defaults
    setTransactions([]);
    setSettings(defaultSettings);
    setLoans([]);
    setSavings([]);
    setBills([]);
    setBillPayments([]);
    setCurrentView("dashboard");

    // Step 4: Show a "Data Cleared" toast overlay for 2 seconds, then lock
    setShowResetToast(true);
    setTimeout(() => {
      setShowResetToast(false);
      setIsLocked(true);
    }, 2000);
  }, [isApiAvailable]);

  // --- Loan CRUD handlers ---

  const handleAddLoan = useCallback(async (loan: LoanEntry) => {
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
    }
  }, [isApiAvailable, apiFetch]);

  const handleDeleteLoan = useCallback(async (id: string) => {
    setLoans((prev) => prev.filter((l) => l.id !== id));

    if (isApiAvailable) {
      try {
        await apiFetch(`http://localhost:3001/api/loans/${id}`, {
          method: "DELETE"
        });
      } catch (err) {
        console.error("Failed to DELETE loan:", err);
      }
    }
  }, [isApiAvailable, apiFetch]);

  const handleMarkLoanPaid = useCallback(async (id: string, addAsTransaction: boolean) => {
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
      }
    }
  }, [loans, isApiAvailable, apiFetch]);

  // --- Savings CRUD handlers ---

  const handleAddSaving = useCallback(async (saving: SavingsEntry) => {
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
    }
  }, [isApiAvailable, apiFetch]);

  const handleDeleteSaving = useCallback(async (id: string) => {
    setSavings((prev) => prev.filter((s) => s.id !== id));

    if (isApiAvailable) {
      try {
        await apiFetch(`http://localhost:3001/api/savings/${id}`, {
          method: "DELETE"
        });
      } catch (err) {
        console.error("Failed to DELETE saving:", err);
      }
    }
  }, [isApiAvailable, apiFetch]);

  const handleWithdrawSaving = useCallback(async (id: string, addAsTransaction: boolean) => {
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
      }
    }
  }, [savings, isApiAvailable, apiFetch]);

  // --- Keepers CRUD handlers ---

  const handleAddKeeper = useCallback(async (keeper: Keeper) => {
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
    }
  }, [isApiAvailable, apiFetch]);

  const handleEditKeeper = useCallback(async (id: string, name: string, type: 'bank' | 'wallet' | 'person') => {
    setKeepers((prev) => prev.map((k) => k.id === id ? { ...k, name, type } : k));

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
    }
  }, [isApiAvailable, apiFetch]);

  const handleDeleteKeeper = useCallback(async (id: string) => {
    // Check if keeper is referenced in client savings
    const isReferenced = savings.some(s => s.keeper_id === id && s.status === 'kept');
    if (isReferenced) {
      throw new Error("This keeper is used by existing savings entries");
    }

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
    }
    // Update local state if API succeeded (or if local-only)
    setKeepers((prev) => prev.filter((k) => k.id !== id));
  }, [savings, isApiAvailable, apiFetch]);

  const handleEditTransaction = useCallback(async (updatedTx: Transaction) => {
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
    }
  }, [isApiAvailable, apiFetch]);

  const openAddModal = useCallback(() => setShowAddModal(true), []);
  
  // --- Bills CRUD handlers ---

  const handleAddBill = useCallback(async (bill: Bill) => {
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
    }
  }, [isApiAvailable, apiFetch]);

  const handleDeleteBill = useCallback(async (id: string) => {
    setBills((prev) => prev.filter((b) => b.id !== id));

    if (isApiAvailable) {
      try {
        await apiFetch(`http://localhost:3001/api/bills/${id}`, {
          method: "DELETE"
        });
      } catch (err) {
        console.error("Failed to DELETE bill:", err);
      }
    }
  }, [isApiAvailable, apiFetch]);

  const handleMarkBillPaid = useCallback(async (billId: string, addAsTransaction: boolean) => {
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
      }
    }
  }, [bills, billPayments, isApiAvailable, apiFetch]);

  const handleUnpayBill = useCallback(async (paymentId: string) => {
    setBillPayments((prev) => prev.filter((bp) => bp.id !== paymentId));

    if (isApiAvailable) {
      try {
        await apiFetch(`http://localhost:3001/api/bill-payments/${paymentId}`, {
          method: "DELETE"
        });
      } catch (err) {
        console.error("Failed to DELETE bill payment:", err);
      }
    }
  }, [isApiAvailable, apiFetch]);

  const openEditModal = useCallback((tx: Transaction) => {
    setEditingTransaction(tx);
    setShowAddModal(true);
  }, []);
  
  const closeAddModal = useCallback(() => {
    setShowAddModal(false);
    setEditingTransaction(null);
  }, []);

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
            businessLedgerName={settings.businessLedgerName}
            personalLedgerName={settings.personalLedgerName}
            onSave={handleSaveSettings}
            onStartFresh={handleStartFresh}
            autoStart={autoStart}
            onToggleAutoStart={handleToggleAutoStart}
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
    return (
      <SplashScreen
        onComplete={() => {
          sessionStorage.setItem("splash_shown", "true");
          setShowSplash(false);
        }}
      />
    );
  }

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
        onSupportClick={() => {
          setIsSidebarOpen(false);
          setShowSupportModal(true);
        }}
      />

      <div className="flex-1 flex flex-col h-screen overflow-hidden relative">
        <TopBar
          title={getTitle()}
          onLock={() => setIsLocked(true)}
          onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
          syncStatus={syncStatus}
        />

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

      {showSupportModal && (
        <SupportModal onClose={() => setShowSupportModal(false)} />
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
                // Undo add = remove the transaction
                setTransactions((prev) => prev.filter((t) => t.id !== action.tx.id));
                if (isApiAvailable) {
                  apiFetch(`http://localhost:3001/api/transactions/${action.tx.id}`, {
                    method: 'DELETE'
                  }).catch((err) => console.error('Undo add failed:', err));
                }
              } else {
                // Undo delete = restore the transaction
                const now = Date.now();
                const restoredTx = { ...action.tx, deleted: 0, updated_at: now };
                setTransactions((prev) => [...prev, restoredTx].sort((a, b) => b.date.localeCompare(a.date)));
                if (isApiAvailable) {
                  apiFetch('http://localhost:3001/api/transactions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(restoredTx)
                  }).catch((err) => console.error('Undo delete failed:', err));
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
