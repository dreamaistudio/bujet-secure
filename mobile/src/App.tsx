import React, { useState, useEffect, useCallback } from 'react';
import { 
  Plus, 
  Trash2, 
  Settings as SettingsIcon, 
  LayoutDashboard, 
  ReceiptText, 
  QrCode, 
  RefreshCw,
  AlertCircle,
  Building2,
  User
} from 'lucide-react';
import { BarcodeScanner } from '@capacitor-mlkit/barcode-scanning';
import { LineChart, Line, ResponsiveContainer } from 'recharts';
import { Transaction, LedgerType } from './types';
import * as db from './lib/db';

export default function App() {
  // Navigation & UI States
  const [activeTab, setActiveTab] = useState<'dashboard' | 'ledger' | 'add' | 'settings'>('dashboard');
  const [isLocked, setIsLocked] = useState<boolean>(true);
  const [pinError, setPinError] = useState<string>('');

  // Controlled Input States
  const [pinInput, setPinInput] = useState<string>('');
  const [amount, setAmount] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [date, setDate] = useState<string>(new Date().toISOString().split('T')[0]);

  // Live QR Code Scanner & Connection Link States
  const [scanSuccess, setScanSuccess] = useState<boolean>(false);
  const [isCameraAvailable, setIsCameraAvailable] = useState<boolean>(true);
  const [showManualInputs, setShowManualInputs] = useState<boolean>(false);
  const [desktopIp, setDesktopIp] = useState<string>('');
  const [authToken, setAuthToken] = useState<string>('');
  const [isLinked, setIsLinked] = useState<boolean>(false);
  const [lastSyncedTime, setLastSyncedTime] = useState<number | null>(null);
  const [linkStatus, setLinkStatus] = useState<'synced' | 'connecting' | 'offline' | 'unlinked'>('unlinked');

  // App Data States
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [settings, setSettings] = useState({
    businessName: 'Bujet Secure',
    currency: 'LKR',
    authPin: '',
    syncIp: '',
    syncToken: ''
  });

  // Sync & Status States
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'success' | 'error'>('idle');
  const [syncMessage, setSyncMessage] = useState<string>('Local Mode');

  // Form States (Add Transaction)
  const [category, setCategory] = useState<LedgerType>('Personal');
  const [status, setStatus] = useState<'CLEARED' | 'PENDING'>('CLEARED');
  const [formError, setFormError] = useState<string>('');

  // Ledger Filter States
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<'all' | LedgerType>('all');

  // Time formatter helper for settings screen
  const formatLastSynced = (timestamp: number | null) => {
    if (!timestamp) return 'Never';
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 10) return 'Just now';
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return new Date(timestamp).toLocaleDateString();
  };

  const attemptAutoConnectWithParams = async (ip: string, token: string) => {
    if (!ip || !token) return;
    setLinkStatus('connecting');
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 5000); // 5 sec timeout
      const res = await fetch(`http://${ip}:3001/api/ping`, {
        signal: controller.signal
      });
      clearTimeout(id);

      if (res.ok) {
        setSettings(prev => ({
          ...prev,
          syncIp: ip,
          syncToken: token
        }));
        setLinkStatus('synced');
        await triggerSync(ip, token);
      } else {
        setLinkStatus('offline');
      }
    } catch (err) {
      console.log('Auto-connect check failed silently:', err);
      setLinkStatus('offline');
    }
  };

  const attemptAutoConnect = async () => {
    const savedIp = await db.getSetting<string>('desktopIp');
    const savedToken = await db.getSetting<string>('authToken');
    const savedIsLinked = await db.getSetting<boolean>('isLinked');

    if (savedIsLinked && savedIp && savedToken) {
      const ip = savedIp;
      try {
        const res = await fetch(`http://${ip}:3001/api/sync`);
        const data = await res.json();
        console.log('GET /api/sync data received (initial fetch):', data);
        
        const activeTxs = (data.transactions || []).filter(
          (tx: any) => tx.deleted !== true && tx.deleted !== 1
        );
        
        setTransactions([...activeTxs]);
        await db.clearTransactions();
        await db.saveTransactions(activeTxs);
        setLinkStatus('synced');
      } catch (err) {
        console.log('Initial fetch GET /api/sync failed, fallback to connection ping:', err);
        await attemptAutoConnectWithParams(savedIp, savedToken);
      }
    } else {
      setLinkStatus('unlinked');
    }
  };

  const handleUnlink = async () => {
    await db.saveSetting('desktopIp', '');
    await db.saveSetting('authToken', '');
    await db.saveSetting('isLinked', false);
    await db.saveSetting('lastSynced', null);
    
    setDesktopIp('');
    setAuthToken('');
    setIsLinked(false);
    setLastSyncedTime(null);
    setLinkStatus('unlinked');
    
    setSettings(prev => ({
      ...prev,
      syncIp: '',
      syncToken: ''
    }));
  };

  // Check camera availability
  useEffect(() => {
    const checkCamera = async () => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setIsCameraAvailable(false);
        return;
      }
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const hasCamera = devices.some(device => device.kind === 'videoinput');
        setIsCameraAvailable(hasCamera);
      } catch (e) {
        setIsCameraAvailable(true);
      }
    };
    checkCamera();
  }, []);

  // Poll every 30 seconds when offline/disconnected and linked
  useEffect(() => {
    let intervalId: any = null;

    if (linkStatus === 'offline' && isLinked) {
      intervalId = setInterval(() => {
        attemptAutoConnect();
      }, 30000);
    }

    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [linkStatus, isLinked]);

  // App states moved to top

  // Load Initial Settings & Transactions from IndexedDB
  const loadData = useCallback(async () => {
    try {
      const storedSettings = await db.getSettings();
      const storedTxs = await db.getTransactions();
      
      const newSettings = {
        businessName: storedSettings.businessName ?? 'Bujet Secure',
        currency: storedSettings.currency ?? 'LKR',
        authPin: storedSettings.authPin ?? '',
        syncIp: storedSettings.syncIp ?? '',
        syncToken: storedSettings.syncToken ?? ''
      };
      
      setSettings(newSettings);

      // Load link details
      const savedIp = storedSettings.desktopIp ?? '';
      const savedToken = storedSettings.authToken ?? '';
      const savedIsLinked = !!storedSettings.isLinked;
      const savedLastSynced = storedSettings.lastSynced ?? null;

      setDesktopIp(savedIp);
      setAuthToken(savedToken);
      setIsLinked(savedIsLinked);
      setLastSyncedTime(savedLastSynced);

      if (savedIsLinked) {
        setLinkStatus('connecting');
      } else {
        setLinkStatus('unlinked');
      }
      
      // Filter out deleted transactions
      const activeTxs = storedTxs.filter(tx => tx.deleted !== true && tx.deleted !== 1);
      setTransactions(activeTxs);

      // Handle locking logic
      if (newSettings.authPin) {
        setIsLocked(true);
      } else {
        setIsLocked(false);
      }

      // Auto-connect if linked
      if (savedIsLinked && savedIp && savedToken) {
        attemptAutoConnectWithParams(savedIp, savedToken);
      }
    } catch (err) {
      console.error('Failed to load initial local data:', err);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Monitor online status
  useEffect(() => {
    const goOnline = () => {
      setIsOnline(true);
      if (isLinked) {
        attemptAutoConnect();
      } else {
        triggerSync();
      }
    };
    const goOffline = () => {
      setIsOnline(false);
      if (isLinked) {
        setLinkStatus('offline');
      }
    };

    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);

    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, [settings, isLinked]);

  // Main Sync Function
  const triggerSync = async (targetIp?: string, targetToken?: string) => {
    const ip = targetIp || settings.syncIp;
    const token = targetToken || settings.syncToken;

    if (!ip || !token) {
      setSyncStatus('idle');
      setSyncMessage('Sync settings not configured');
      return;
    }

    setSyncStatus('syncing');
    setSyncMessage('Synchronizing data...');

    try {
      // Get all local transactions including soft-deleted ones to sync deletion events
      const localRawTxs = await db.getRawTransactions();
      const localSettings = await db.getSettings();

      const response = await fetch(`http://${ip}:3001/api/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          transactions: localRawTxs,
          settings: {
            businessName: localSettings.businessName,
            currency: localSettings.currency
          }
        })
      });

      if (!response.ok) {
        throw new Error(`Sync request failed: ${response.statusText}`);
      }

      const mergedData = await response.json();
      console.log('POST /api/sync data received from server:', mergedData);

      // REQUIREMENT: Filter out transactions where deleted=true received from desktop before saving to IndexedDB
      const activeMergedTxs = (mergedData.transactions || []).filter(
        (tx: any) => tx.deleted !== true && tx.deleted !== 1
      );

      // Clear local IndexedDB stores and update with fresh synced state
      await db.clearTransactions();
      await db.saveTransactions(activeMergedTxs);

      // Force React state update
      setTransactions([...activeMergedTxs]);

      const freshSettings = await db.getSettings();
      setSettings(prev => ({
        ...prev,
        businessName: freshSettings.businessName ?? prev.businessName,
        currency: freshSettings.currency ?? prev.currency
      }));

      // Update sync time
      const now = Date.now();
      await db.saveSetting('lastSynced', now);
      setLastSyncedTime(now);

      setLinkStatus('synced');
      setSyncStatus('success');
      setSyncMessage('Sync Completed');
      setTimeout(() => {
        setSyncStatus('idle');
        setSyncMessage('Connected');
      }, 3000);
    } catch (err: any) {
      console.error('Network sync error:', err);
      setSyncStatus('error');
      setSyncMessage(err.message || 'Sync failed');
      setLinkStatus('offline');
    }
  };

  // Run initial sync on settings update or connection changes with a 1000ms debounce
  useEffect(() => {
    if (!isLinked && settings.syncIp && settings.syncToken) {
      const timer = setTimeout(() => {
        triggerSync();
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [settings.syncIp, settings.syncToken, isLinked]);

  // Removed settings ref synchronization

  // PIN Unlock Check
  const handleUnlock = () => {
    const pin = pinInput;
    if (pin === settings.authPin) {
      setIsLocked(false);
      setPinInput('');
      setPinError('');
    } else {
      setPinError('Incorrect PIN. Access Denied.');
      setPinInput('');
    }
  };

  // Add Transaction Action
  const handleAddTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    const descVal = description;
    const amountVal = amount;
    const dateVal = date;

    // Validations
    if (!descVal.trim()) {
      setFormError('Please enter a description.');
      return;
    }

    const parsedAmount = parseFloat(amountVal);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setFormError('Please enter a valid positive amount.');
      return;
    }

    // REQUIREMENT: Add proper date format validation
    // Matches YYYY-MM-DD or DD/MM/YYYY formats
    const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
    const slashDatePattern = /^\d{2}\/\d{2}\/\d{4}$/;
    if (!dateVal || (!isoDatePattern.test(dateVal) && !slashDatePattern.test(dateVal))) {
      setFormError('Please enter a valid date (YYYY-MM-DD or DD/MM/YYYY).');
      return;
    }

    // Standardize input date to YYYY-MM-DD
    let standardizedDate = dateVal;
    if (slashDatePattern.test(dateVal)) {
      const parts = dateVal.split('/');
      // Convert DD/MM/YYYY to YYYY-MM-DD
      standardizedDate = `${parts[2]}-${parts[1]}-${parts[0]}`;
    }

    // Double check validity by parsing
    const parsedDate = new Date(standardizedDate);
    if (isNaN(parsedDate.getTime())) {
      setFormError('Invalid date format.');
      return;
    }

    const newTx: Transaction = {
      id: Math.random().toString(36).substring(2, 11),
      date: standardizedDate,
      description: descVal.trim(),
      amount: parsedAmount,
      category,
      status,
      deleted: 0,
      updated_at: Date.now()
    };

    try {
      await db.saveTransaction(newTx);
      // Refresh transactions state
      const updated = await db.getTransactions();
      setTransactions(updated);

      // Reset Form
      setDescription('');
      setAmount('');
      setDate(new Date().toISOString().split('T')[0]);
      setCategory('Personal');
      setStatus('CLEARED');
      setActiveTab('dashboard');

      // Sync if online
      if (isOnline) {
        triggerSync();
      }
    } catch (err) {
      setFormError('Failed to save transaction locally.');
    }
  };

  // Soft Delete Transaction Action
  const handleDeleteTransaction = async (id: string) => {
    try {
      // Retrieve the current transaction record
      const allRaw = await db.getRawTransactions();
      const current = allRaw.find(tx => tx.id === id);
      
      if (current) {
        const deletedTx: Transaction = {
          ...current,
          deleted: 1,
          updated_at: Date.now()
        };

        // Write soft-deleted transaction back
        await db.saveTransaction(deletedTx);

        // Refresh state
        const updated = await db.getTransactions();
        setTransactions(updated);

        // Sync if online
        if (isOnline) {
          triggerSync();
        }
      }
    } catch (err) {
      console.error('Failed to delete transaction:', err);
    }
  };

  // QR Code Image Parsing
  // MLKit Native QR Barcode Scanner Lifecycle Functions
  const startScanner = async () => {
    setScanSuccess(false);
    setFormError('');
    
    try {
      // Check and request camera permission
      const status = await BarcodeScanner.requestPermissions();
      if (status.camera !== 'granted' && status.camera !== 'limited') {
        alert('Camera permission is required to scan the QR Code.');
        return;
      }
      
      document.body.classList.add('scanner-active');

      // Open native MLKit barcode scanner view directly
      const { barcodes } = await BarcodeScanner.scan();
      
      const rawValue = barcodes[0]?.rawValue;
      if (rawValue) {
        try {
          const parsed = JSON.parse(rawValue);
          if (parsed && parsed.ip && parsed.token) {
            await handleQrSuccess(parsed.ip, parsed.token);
          } else {
            alert('Invalid connection settings format in scanned QR Code.');
          }
        } catch (e) {
          alert('Failed to parse connection QR Code JSON data.');
        }
      }
    } catch (err: any) {
      console.error('MLKit Scanner failed:', err);
      setShowManualInputs(true);
      alert('Native barcode scanning is only supported on Android/iOS. Fallback to manual setup.');
    } finally {
      document.body.classList.remove('scanner-active');
    }
  };

  const handleQrSuccess = async (ip: string, token: string) => {
    document.body.classList.remove('scanner-active');
    setScanSuccess(true);

    await db.saveSetting('desktopIp', ip);
    await db.saveSetting('authToken', token);
    await db.saveSetting('isLinked', true);
    await db.saveSetting('linkedAt', Date.now());
    await db.saveSetting('lastSynced', null);

    setDesktopIp(ip);
    setAuthToken(token);
    setIsLinked(true);
    setLastSyncedTime(null);
    setLinkStatus('connecting');

    setSettings(prev => ({
      ...prev,
      syncIp: ip,
      syncToken: token
    }));

    // Call sync immediately
    triggerSync(ip, token);

    setTimeout(() => {
      setScanSuccess(false);
    }, 2000);
  };

  const computeSummary = (txs: Transaction[]) => {
    const totalIncome = txs.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
    const totalExpenses = txs.filter((t) => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
    const netBalance = totalIncome - totalExpenses;

    // Growth trend: compare last 15 days vs prior 15 days
    const now = new Date();
    const mid = new Date(now);
    mid.setDate(mid.getDate() - 15);
    const start = new Date(mid);
    start.setDate(start.getDate() - 15);

    const recentSum = txs
      .filter((t) => new Date(t.date) >= mid && new Date(t.date) <= now)
      .reduce((s, t) => s + t.amount, 0);
    const priorSum = txs
      .filter((t) => new Date(t.date) >= start && new Date(t.date) < mid)
      .reduce((s, t) => s + t.amount, 0);

    const growthTrend = priorSum === 0 ? (recentSum > 0 ? 100 : 0) : Math.round(((recentSum - priorSum) / Math.abs(priorSum)) * 100);

    return { totalIncome, totalExpenses, netBalance, growthTrend };
  };

  const computeChartData = (txs: Transaction[]) => {
    const sorted = [...txs].sort((a, b) => a.date.localeCompare(b.date));
    const byDate: Record<string, number> = {};
    let cumulative = 0;
    for (const tx of sorted) {
      cumulative += tx.amount;
      byDate[tx.date] = cumulative;
    }
    const chartData = Object.values(byDate).map((v) => ({ value: v }));
    if (chartData.length === 0) return [{ value: 0 }];
    return chartData;
  };

  const renderLedgerCard = (
    title: string,
    type: 'Business' | 'Personal',
    summary: ReturnType<typeof computeSummary>,
    chartData: { value: number }[],
    txs: Transaction[]
  ) => {
    const Icon = type === 'Business' ? Building2 : User;

    return (
      <div className="bg-[#18181b] border border-[#27272a] rounded-xl flex flex-col overflow-hidden shadow-lg">
        {/* Header */}
        <div className="bg-[#09090b]/40 p-4 border-b border-[#27272a]/60 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <Icon size={18} className={type === 'Business' ? 'text-[#22c55e]' : 'text-[#22c55e]'} />
            <h2 className="font-bold text-[#fafafa] text-sm">{title}</h2>
          </div>
          <span className="bg-[#22c55e]/10 border border-[#22c55e]/20 text-[#22c55e] text-[9px] uppercase font-extrabold px-2 py-0.5 tracking-wider rounded">
            ACTIVE
          </span>
        </div>

        <div className="p-4 flex flex-col gap-4">
          {/* Key Stats */}
          <div className="grid grid-cols-3 gap-2.5">
            <div className="bg-[#09090b] border border-[#27272a] p-2.5 rounded-lg">
              <p className="text-[8px] font-extrabold tracking-wider text-[#a1a1aa] uppercase mb-0.5">INCOME</p>
              <p className="font-mono text-xs font-bold text-[#22c55e]">
                {settings.currency} {summary.totalIncome.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </p>
            </div>
            <div className="bg-[#09090b] border border-[#27272a] p-2.5 rounded-lg">
              <p className="text-[8px] font-extrabold tracking-wider text-[#a1a1aa] uppercase mb-0.5">EXPENSES</p>
              <p className="font-mono text-xs font-bold text-red-400">
                {settings.currency} {summary.totalExpenses.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </p>
            </div>
            <div className="bg-[#09090b] border border-[#27272a] p-2.5 rounded-lg">
              <p className="text-[8px] font-extrabold tracking-wider text-[#a1a1aa] uppercase mb-0.5">NET BAL</p>
              <p className="font-mono text-xs font-bold text-[#fafafa]">
                {settings.currency} {summary.netBalance.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </p>
            </div>
          </div>

          {/* Chart Area */}
          <div className="bg-[#09090b] border border-[#27272a] h-36 rounded-lg relative overflow-hidden flex flex-col p-3">
            <div className="flex justify-between items-start mb-1 relative z-10">
              <p className="text-[8px] font-bold tracking-wider text-[#a1a1aa] uppercase">CUMULATIVE TREND</p>
              <div className={`px-1.5 py-0.2 border rounded text-[9px] font-mono font-bold ${
                summary.growthTrend >= 0 ? 'bg-emerald-950/20 border-[#22c55e]/30 text-[#22c55e]' : 'bg-red-950/20 border-red-500/30 text-red-400'
              }`}>
                {summary.growthTrend >= 0 ? '+' : ''}{summary.growthTrend}%
              </div>
            </div>

            <div className="flex-1 mt-1 relative z-10 w-full h-full -ml-2.5">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <Line
                    type="linear"
                    dataKey="value"
                    stroke={summary.netBalance < 0 ? '#f87171' : '#22c55e'}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, fill: summary.netBalance < 0 ? '#f87171' : '#22c55e' }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Recent Transactions list */}
          <div className="border border-[#27272a] rounded-lg overflow-hidden flex flex-col">
            <div className="bg-[#09090b]/60 border-b border-[#27272a]/60 grid grid-cols-4 px-2.5 py-1.5 shrink-0 text-[8px] font-extrabold tracking-wider text-[#a1a1aa] uppercase">
              <div className="col-span-2">DESCRIPTION</div>
              <div className="text-right">DATE</div>
              <div className="text-right">AMOUNT</div>
            </div>
            <div className="bg-[#09090b]/20 divide-y divide-[#27272a]/40">
              {txs.length === 0 ? (
                <div className="p-3 text-center text-xs text-[#a1a1aa]">No ledger logs yet.</div>
              ) : (
                txs.map((tx) => (
                  <div key={tx.id} className="grid grid-cols-4 px-2.5 py-1.5 hover:bg-[#18181b]/40 transition-all text-xs">
                    <div className="col-span-2 text-[#fafafa] font-medium truncate">{tx.description}</div>
                    <div className="font-mono text-[9px] text-[#a1a1aa] text-right pt-0.5">{tx.date}</div>
                    <div className={`font-mono font-bold text-right ${tx.amount < 0 ? 'text-red-400' : 'text-[#22c55e]'}`}>
                      {tx.amount > 0 ? '+' : ''}
                      {tx.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Ledger-specific data filters and calculations
  const bTxs = transactions.filter((t) => t.category === "Business");
  const pTxs = transactions.filter((t) => t.category === "Personal");

  const businessSummary = computeSummary(bTxs);
  const personalSummary = computeSummary(pTxs);
  const chartDataBusiness = computeChartData(bTxs);
  const chartDataPersonal = computeChartData(pTxs);

  const recentBTxs = [...bTxs].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3);
  const recentPTxs = [...pTxs].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3);

  // Filter and search transactions for Ledger tab
  const filteredTransactions = transactions.filter(tx => {
    const matchesSearch = tx.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
      tx.amount.toString().includes(searchTerm) ||
      tx.date.includes(searchTerm);
      
    const matchesCategory = categoryFilter === 'all' || tx.category === categoryFilter;

    return matchesSearch && matchesCategory;
  });

  // UI Components: Lock Screen
  if (isLocked) {
    return (
      <div className="min-h-screen bg-[#09090b] flex flex-col items-center justify-center p-6 select-none font-sans">
        <div className="w-full max-w-[340px] bg-[#18181b] border border-[#27272a] rounded-2xl p-8 flex flex-col items-center shadow-2xl animate-slide-up">
          <div className="w-16 h-16 bg-[#09090b] border border-[#27272a] rounded-full flex items-center justify-center mb-6 text-[#22c55e] shadow-inner">
            <QrCode size={30} />
          </div>
          <h2 className="text-xl font-bold text-[#fafafa] mb-2">Vault Locked</h2>
          <p className="text-sm text-[#a1a1aa] text-center mb-6 leading-relaxed">
            Enter your 4-digit security PIN to access your mobile budget ledger.
          </p>

          <input
            type="password"
            value={pinInput}
            maxLength={4}
            pattern="\d*"
            inputMode="numeric"
            onChange={(e) => setPinInput(e.target.value.replace(/\D/g, ''))}
            className="w-full bg-[#09090b] border border-[#27272a] text-center text-[#fafafa] font-mono text-xl tracking-widest py-3 rounded-lg outline-none focus:border-[#22c55e] mb-2"
            placeholder="••••"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
          />

          {pinError && (
            <p className="text-red-500 text-xs mt-1 mb-4 flex items-center gap-1">
              <AlertCircle size={12} />
              {pinError}
            </p>
          )}

          <button
            onClick={handleUnlock}
            className="w-full py-3 rounded-lg text-sm font-semibold transition-all mt-4 bg-[#22c55e] text-black hover:opacity-95 active:scale-95 cursor-pointer"
          >
            Authenticate
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#09090b] text-[#fafafa] flex flex-col font-sans max-w-[450px] mx-auto border-x border-[#27272a] relative pb-20 select-none">
      
      {/* Top Status Header */}
      <header className="p-4 bg-[#09090b]/80 backdrop-blur border-b border-[#27272a] sticky top-0 z-40 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold tracking-tight text-[#fafafa]">{settings.businessName}</h1>
          <p className="text-[10px] text-[#a1a1aa] font-mono">Mobile Vault</p>
        </div>
        
        {/* Network Sync status badge */}
        <div className="flex items-center gap-2">
          {linkStatus === 'synced' && (
            <span className="flex items-center gap-1.5 text-[10px] text-[#22c55e] bg-[#22c55e]/10 border border-[#22c55e]/20 px-2.5 py-0.5 rounded-full font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e] animate-pulse"></span>
              Synced
            </span>
          )}
          {linkStatus === 'connecting' && (
            <span className="flex items-center gap-1.5 text-[10px] text-amber-400 bg-amber-400/10 border border-amber-400/20 px-2.5 py-0.5 rounded-full font-semibold font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span>
              Connecting...
            </span>
          )}
          {linkStatus === 'offline' && (
            <span className="flex items-center gap-1.5 text-[10px] text-red-400 bg-red-400/10 border border-red-400/20 px-2.5 py-0.5 rounded-full font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400"></span>
              Offline
            </span>
          )}
          {linkStatus === 'unlinked' && (
            <span className="flex items-center gap-1.5 text-[10px] text-gray-400 bg-gray-400/10 border border-gray-400/20 px-2.5 py-0.5 rounded-full font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-gray-400"></span>
              Not Linked
            </span>
          )}
          
          <button 
            onClick={() => isLinked ? attemptAutoConnect() : triggerSync()}
            disabled={syncStatus === 'syncing' || linkStatus === 'connecting'}
            className="p-1 bg-[#18181b] border border-[#27272a] rounded hover:bg-[#27272a] transition-all text-[#fafafa] disabled:opacity-50"
            title="Sync Data"
          >
            <RefreshCw size={14} className={syncStatus === 'syncing' ? 'animate-spin text-[#22c55e]' : ''} />
          </button>
        </div>
      </header>

      {/* Sync Status Overlay / Banner */}
      {syncStatus !== 'idle' && (
        <div className={`text-center py-1.5 px-4 text-xs font-medium border-b flex items-center justify-center gap-2 ${
          syncStatus === 'syncing' ? 'bg-[#22c55e]/10 border-[#22c55e]/30 text-[#22c55e]' :
          syncStatus === 'success' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' :
          'bg-red-500/10 border-red-500/30 text-red-400'
        }`}>
          {syncStatus === 'syncing' && <RefreshCw size={12} className="animate-spin" />}
          <span>{syncMessage}</span>
        </div>
      )}

      {/* Main View Area */}
      <main className="p-4 flex-1">
        {/* VIEW: DASHBOARD */}
        {activeTab === 'dashboard' && (
          <div className="space-y-6 animate-slide-up">
            {renderLedgerCard("Business Ledger", "Business", businessSummary, chartDataBusiness, recentBTxs)}
            {renderLedgerCard("Personal Ledger", "Personal", personalSummary, chartDataPersonal, recentPTxs)}
          </div>
        )}

        {/* VIEW: LEDGER (TRANSACTIONS LIST) */}
        {activeTab === 'ledger' && (
          <div className="space-y-4 animate-slide-up">
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wider text-[#a1a1aa] mb-2">Ledger Registry</h3>
              <p className="text-xs text-[#a1a1aa] mb-4">View and query all financial logs stored in the local vault.</p>
            </div>

            {/* Filters bar */}
            <div className="space-y-2">
              <input
                type="text"
                value={searchTerm}
                placeholder="Search ledger..."
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-[#18181b] border border-[#27272a] text-[#fafafa] text-xs rounded-lg px-3 py-2 outline-none focus:border-[#22c55e]"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
              />
              <div className="flex gap-2">
                <button
                  onClick={() => setCategoryFilter('all')}
                  className={`flex-1 py-1 px-2 rounded-md border text-[11px] font-semibold transition-all ${
                    categoryFilter === 'all'
                      ? 'bg-[#22c55e]/15 border-[#22c55e] text-[#22c55e]'
                      : 'bg-[#18181b] border-[#27272a] text-[#a1a1aa]'
                  }`}
                >
                  All Categories
                </button>
                <button
                  onClick={() => setCategoryFilter('Personal')}
                  className={`flex-1 py-1 px-2 rounded-md border text-[11px] font-semibold transition-all ${
                    categoryFilter === 'Personal'
                      ? 'bg-[#22c55e]/15 border-[#22c55e] text-[#22c55e]'
                      : 'bg-[#18181b] border-[#27272a] text-[#a1a1aa]'
                  }`}
                >
                  Personal
                </button>
                <button
                  onClick={() => setCategoryFilter('Business')}
                  className={`flex-1 py-1 px-2 rounded-md border text-[11px] font-semibold transition-all ${
                    categoryFilter === 'Business'
                      ? 'bg-[#22c55e]/15 border-[#22c55e] text-[#22c55e]'
                      : 'bg-[#18181b] border-[#27272a] text-[#a1a1aa]'
                  }`}
                >
                  Business
                </button>
              </div>
            </div>

            {/* List */}
            {filteredTransactions.length === 0 ? (
              <div className="bg-[#18181b] border border-[#27272a] rounded-lg p-10 text-center text-sm text-[#a1a1aa] mt-4">
                No ledger records match the filters.
              </div>
            ) : (
              <div className="space-y-2 mt-4 max-h-[380px] overflow-y-auto pr-1">
                {filteredTransactions.map(tx => (
                  <div key={tx.id} className="bg-[#18181b] border border-[#27272a] rounded-lg p-3 flex justify-between items-center group">
                    <div className="min-w-0 flex-1 mr-2">
                      <span className="font-semibold text-sm text-[#fafafa] block truncate">{tx.description}</span>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-[10px] text-[#a1a1aa] font-mono">{tx.date}</span>
                        <span className="text-[9px] px-1.5 py-0.2 border border-[#27272a] bg-[#09090b] rounded text-[#a1a1aa] uppercase font-bold">
                          {tx.category}
                        </span>
                        <span className={`text-[8px] px-1 py-0.2 rounded font-mono ${
                          tx.status === 'CLEARED' ? 'bg-[#22c55e]/10 text-[#22c55e]' : 'bg-amber-400/10 text-amber-400'
                        }`}>
                          {tx.status}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className={`text-sm font-bold ${tx.amount > 0 ? 'text-[#22c55e]' : 'text-red-400'}`}>
                        {tx.amount > 0 ? '+' : ''}
                        {tx.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                      <button
                        onClick={() => handleDeleteTransaction(tx.id)}
                        className="p-1.5 text-[#a1a1aa] hover:text-red-400 active:scale-90 transition-all rounded hover:bg-[#27272a]"
                        title="Delete record"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* VIEW: ADD TRANSACTION */}
        {activeTab === 'add' && (
          <div className="space-y-4 animate-slide-up">
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wider text-[#a1a1aa] mb-2">Create Financial Log</h3>
              <p className="text-xs text-[#a1a1aa]">Log a transaction directly to the offline secure IndexedDB vault.</p>
            </div>

            <form onSubmit={handleAddTransaction} className="space-y-4 bg-[#18181b] border border-[#27272a] rounded-xl p-5">
              
              {/* Error box */}
              {formError && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-xs text-red-400 flex items-center gap-2">
                  <AlertCircle size={14} />
                  <span>{formError}</span>
                </div>
              )}

              {/* Amount */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-[#a1a1aa]">Amount ({settings.currency})</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="e.g. 250.00"
                  className="w-full bg-[#09090b] border border-[#27272a] text-[#fafafa] font-semibold text-lg rounded-lg px-3 py-2 outline-none focus:border-[#22c55e]"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                />
                <span className="text-[9px] text-[#a1a1aa]">Use negative values for expenses and positive for income.</span>
              </div>

              {/* Description */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-[#a1a1aa]">Description</label>
                <input
                  type="text"
                  required
                  maxLength={100}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="e.g. Office Coffee Supply"
                  className="w-full bg-[#09090b] border border-[#27272a] text-[#fafafa] text-sm rounded-lg px-3 py-2 outline-none focus:border-[#22c55e]"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                />
              </div>

              {/* Date */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-[#a1a1aa]">Date</label>
                <input
                  type="text"
                  required
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  placeholder="YYYY-MM-DD or DD/MM/YYYY"
                  className="w-full bg-[#09090b] border border-[#27272a] text-[#fafafa] text-sm rounded-lg px-3 py-2 outline-none focus:border-[#22c55e]"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                />
                <span className="text-[9px] text-[#a1a1aa]">Accepts DD/MM/YYYY or YYYY-MM-DD. Validated on submission.</span>
              </div>

              {/* Grid selectors */}
              <div className="grid grid-cols-2 gap-4">
                
                {/* Category */}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-[#a1a1aa]">Ledger Category</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as LedgerType)}
                    className="w-full bg-[#09090b] border border-[#27272a] text-[#fafafa] text-xs rounded-lg px-3 py-2 outline-none focus:border-[#22c55e]"
                  >
                    <option value="Personal">Personal</option>
                    <option value="Business">Business</option>
                  </select>
                </div>

                {/* Status */}
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-[#a1a1aa]">Cleared Status</label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as 'CLEARED' | 'PENDING')}
                    className="w-full bg-[#09090b] border border-[#27272a] text-[#fafafa] text-xs rounded-lg px-3 py-2 outline-none focus:border-[#22c55e]"
                  >
                    <option value="CLEARED">Cleared</option>
                    <option value="PENDING">Pending</option>
                  </select>
                </div>
              </div>

              {/* Submit */}
              <button
                type="submit"
                className="w-full bg-[#22c55e] text-black font-semibold text-sm py-2.5 rounded-lg transition-all hover:opacity-95 active:scale-95 cursor-pointer mt-2"
              >
                Log Transaction
              </button>
            </form>
          </div>
        )}

        {/* VIEW: SETTINGS */}
        {activeTab === 'settings' && (
          <div className="space-y-6 animate-slide-up">
            
            {/* General Preferences */}
            <section className="bg-[#18181b] border border-[#27272a] rounded-xl p-4 space-y-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#a1a1aa] border-b border-[#27272a] pb-1">General Preferences</h3>
                      {/* Business Name */}
              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold text-[#a1a1aa]">Business Name</label>
                <input
                  type="text"
                  value={settings.businessName}
                  onChange={(e) => {
                    const val = e.target.value;
                    setSettings(prev => ({ ...prev, businessName: val }));
                  }}
                  onBlur={async (e) => {
                    await db.saveSetting('businessName', e.target.value);
                  }}
                  className="w-full bg-[#09090b] border border-[#27272a] text-[#fafafa] text-xs rounded-lg px-3 py-2 outline-none focus:border-[#22c55e]"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                />
              </div>

              {/* Security PIN */}
              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold text-[#a1a1aa]">Vault Lock PIN</label>
                <input
                  type="text"
                  value={settings.authPin}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, '');
                    setSettings(prev => ({ ...prev, authPin: val }));
                  }}
                  onBlur={async (e) => {
                    const val = e.target.value.replace(/\D/g, '');
                    await db.saveSetting('authPin', val);
                  }}
                  maxLength={4}
                  placeholder="None (Leave empty to disable)"
                  className="w-full bg-[#09090b] border border-[#27272a] text-[#fafafa] font-mono text-xs rounded-lg px-3 py-2 outline-none focus:border-[#22c55e]"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                />
              </div>
            </section>

            {/* Desktop Sync Parameters */}
            <section className="bg-[#18181b] border border-[#27272a] rounded-xl p-4 space-y-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#a1a1aa] border-b border-[#27272a] pb-1">Desktop Server Sync</h3>

              {isLinked ? (
                <div className="space-y-4 animate-fade-in">
                  <div className="bg-[#09090b] border border-[#27272a] rounded-lg p-4 space-y-2">
                    <div className="flex items-center gap-2 text-xs font-semibold text-[#22c55e]">
                      <span className="w-2 h-2 rounded-full bg-[#22c55e] animate-pulse"></span>
                      <span>Smart Linked</span>
                    </div>
                    <div className="text-xs text-[#a1a1aa] space-y-1.5 pt-1">
                      <p>Linked to: <span className="font-mono text-[#fafafa] font-semibold">{desktopIp}</span></p>
                      <p>Token: <span className="font-mono text-[#fafafa] font-semibold">{authToken ? `••••${authToken.slice(-4)}` : 'None'}</span></p>
                      <p>Last synced: <span className="text-[#fafafa]">{formatLastSynced(lastSyncedTime)}</span></p>
                    </div>
                  </div>
                  <button
                    onClick={handleUnlink}
                    className="w-full py-2 bg-red-500/10 border border-red-500/30 hover:bg-red-500/20 text-red-400 text-xs font-semibold rounded-lg transition-all active:scale-95 cursor-pointer"
                  >
                    Unlink Device
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  {isCameraAvailable ? (
                    <div className="space-y-3">
                      <p className="text-[11px] text-[#a1a1aa] leading-relaxed">Scan the QR code shown on the desktop settings tab to permanently auto-link this mobile device.</p>
                      <button
                        onClick={startScanner}
                        className="w-full flex items-center justify-center gap-2 bg-[#22c55e]/10 border border-[#22c55e]/30 hover:bg-[#22c55e]/20 text-[#22c55e] text-xs font-semibold py-2.5 px-3 rounded-lg cursor-pointer transition-all active:scale-95"
                      >
                        <QrCode size={14} />
                        <span>Scan QR Code</span>
                      </button>
                      
                      <div className="flex items-center justify-between text-[11px] text-[#a1a1aa] pt-1">
                        <span>Configure connection manually:</span>
                        <button
                          onClick={() => setShowManualInputs(!showManualInputs)}
                          className="text-[#22c55e] font-semibold hover:underline"
                        >
                          {showManualInputs ? "Hide settings" : "Show settings"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-[11px] text-amber-400 bg-amber-400/10 border border-amber-400/20 p-2.5 rounded-lg">
                      Camera not available or blocked. Please configure connection details manually below.
                    </p>
                  )}

                  {(!isCameraAvailable || showManualInputs) && (
                    <div className="space-y-4 pt-2 border-t border-[#27272a]/50 animate-fade-in">
                      {/* Desktop IP */}
                      <div className="space-y-1">
                        <label className="text-[10px] uppercase font-bold text-[#a1a1aa]">Desktop IP Address</label>
                        <input
                          type="text"
                          value={settings.syncIp}
                          onChange={(e) => {
                            const val = e.target.value;
                            setSettings(prev => ({ ...prev, syncIp: val }));
                          }}
                          onBlur={async (e) => {
                            const val = e.target.value.trim();
                            await db.saveSetting('syncIp', val);
                          }}
                          placeholder="e.g. 192.168.1.100"
                          className="w-full bg-[#09090b] border border-[#27272a] text-[#fafafa] font-mono text-xs rounded-lg px-3 py-2 outline-none focus:border-[#22c55e]"
                          autoCorrect="off"
                          autoCapitalize="off"
                          spellCheck={false}
                        />
                      </div>

                      {/* Sync Token */}
                      <div className="space-y-1">
                        <label className="text-[10px] uppercase font-bold text-[#a1a1aa]">Sync Authorization Token</label>
                        <input
                          type="password"
                          value={settings.syncToken}
                          onChange={(e) => {
                            const val = e.target.value;
                            setSettings(prev => ({ ...prev, syncToken: val }));
                          }}
                          onBlur={async (e) => {
                            const val = e.target.value.trim();
                            await db.saveSetting('syncToken', val);
                          }}
                          placeholder="Bearer sync token value"
                          className="w-full bg-[#09090b] border border-[#27272a] text-[#fafafa] font-mono text-xs rounded-lg px-3 py-2 outline-none focus:border-[#22c55e]"
                          autoCorrect="off"
                          autoCapitalize="off"
                          spellCheck={false}
                        />
                      </div>
                      
                      <button
                        onClick={async () => {
                          const ipVal = settings.syncIp.trim();
                          const tokenVal = settings.syncToken.trim();
                          if (ipVal && tokenVal) {
                            await db.saveSetting('syncIp', ipVal);
                            await db.saveSetting('syncToken', tokenVal);
                            await db.saveSetting('desktopIp', ipVal);
                            await db.saveSetting('authToken', tokenVal);
                            await db.saveSetting('isLinked', true);
                            await db.saveSetting('linkedAt', Date.now());
                            setDesktopIp(ipVal);
                            setAuthToken(tokenVal);
                            setIsLinked(true);
                            setLinkStatus('connecting');
                            setSettings(prev => ({ ...prev, syncIp: ipVal, syncToken: tokenVal }));
                            attemptAutoConnectWithParams(ipVal, tokenVal);
                          }
                        }}
                        className="w-full py-2 bg-[#22c55e] text-black text-xs font-semibold rounded-lg transition-all active:scale-95 cursor-pointer"
                      >
                        Link Device Manually
                      </button>
                    </div>
                  )}
                </div>
              )}
            </section>

            {/* Info section */}
            <section className="bg-[#18181b] border border-[#27272a] rounded-xl p-4 text-center space-y-1">
              <p className="text-[10px] text-[#a1a1aa]">Offline Database: <span className="font-mono text-[#fafafa]">bujet_mobile_db</span></p>
              <p className="text-[10px] text-[#a1a1aa]">Software Version: <span className="font-mono text-[#fafafa]">v1.0.0-mobile</span></p>
            </section>
          </div>
        )}

      </main>

      {/* Navigation Tab Bar */}
      <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[450px] bg-[#09090b]/95 backdrop-blur border-t border-[#27272a] flex items-center justify-around py-3 z-50 shadow-2xl">
        <button
          onClick={() => setActiveTab('dashboard')}
          className={`flex flex-col items-center gap-1 transition-all ${
            activeTab === 'dashboard' ? 'text-[#22c55e]' : 'text-[#a1a1aa] hover:text-[#fafafa]'
          }`}
        >
          <LayoutDashboard size={18} />
          <span className="text-[9px] font-semibold">Home</span>
        </button>

        <button
          onClick={() => setActiveTab('ledger')}
          className={`flex flex-col items-center gap-1 transition-all ${
            activeTab === 'ledger' ? 'text-[#22c55e]' : 'text-[#a1a1aa] hover:text-[#fafafa]'
          }`}
        >
          <ReceiptText size={18} />
          <span className="text-[9px] font-semibold">Ledger</span>
        </button>

        <button
          onClick={() => setActiveTab('add')}
          className={`flex flex-col items-center gap-1 transition-all ${
            activeTab === 'add' ? 'text-[#22c55e]' : 'text-[#a1a1aa] hover:text-[#fafafa]'
          }`}
        >
          <div className="w-8 h-8 rounded-full bg-[#22c55e]/10 border border-[#22c55e]/30 flex items-center justify-center -mt-4 bg-[#09090b] text-[#22c55e] shadow-md hover:bg-[#22c55e] hover:text-black">
            <Plus size={18} />
          </div>
          <span className="text-[9px] font-semibold">Log</span>
        </button>

        <button
          onClick={() => setActiveTab('settings')}
          className={`flex flex-col items-center gap-1 transition-all ${
            activeTab === 'settings' ? 'text-[#22c55e]' : 'text-[#a1a1aa] hover:text-[#fafafa]'
          }`}
        >
          <SettingsIcon size={18} />
          <span className="text-[9px] font-semibold">Config</span>
        </button>
      </nav>

      {/* Success Link Toast / Overlay */}
      {scanSuccess && (
        <div className="fixed inset-0 z-50 bg-[#09090b]/95 flex flex-col items-center justify-center gap-4 animate-fade-in font-sans">
          <div className="w-20 h-20 rounded-full bg-[#22c55e] flex items-center justify-center text-black animate-scale-up shadow-[0_0_25px_rgba(34,197,94,0.4)]">
            <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h3 className="text-xl font-bold text-[#fafafa] tracking-tight">Connected!</h3>
          <p className="text-xs text-[#a1a1aa]">Smart Link established successfully</p>
        </div>
      )}

    </div>
  );
}
