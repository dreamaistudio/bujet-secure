import { Globe, Save, ShieldCheck, Undo2, ShieldAlert, Building2, Check, Trash2, Eye, EyeOff, Copy, Smartphone, RefreshCw, AlertTriangle, X, QrCode, Laptop, Unlink, Edit3, Loader2, WifiOff } from "lucide-react";
import { useState, useEffect, useCallback, useRef } from "react";
import { useBackButtonDismiss } from "../lib/backGuard";
import QRCode from "qrcode";
import { joinPairingCode } from "../lib/syncCrypto";
import { Capacitor } from "@capacitor/core";
import bcrypt from "bcryptjs";
import { getCurrentAppVersion, getAppPlatform, checkAndroidUpdate, getDistributionFlavor } from "../lib/appUpdater";
import { triggerAppUpdate } from "../components/UpdateNotification";
import { DesktopSyncWizard } from "../components/DesktopSyncWizard";
import { MobileSyncFlow } from "../components/MobileSyncFlow";
import { syncStrings } from "../lib/syncStrings";

interface SettingsProps {
  authPin: string;
  biometricEnabled?: boolean;
  currency: string;
  lockTimer: string;
  undoSeconds: number;
  businessLedgerName: string;
  personalLedgerName: string;
  onSave: (settings: {
    authPin: string;
    biometricEnabled?: boolean;
    currency: string;
    lockTimer: string;
    undoSeconds: number;
    businessLedgerName: string;
    personalLedgerName: string;
  }) => void;
  onStartFresh: () => void;
  
  // Desktop app props
  autoStart?: boolean;
  onToggleAutoStart?: (val: boolean) => void;
  onOpenAppDirectory?: () => void;
  onOpenDataDirectory?: () => void;
  onCheckUpdates?: () => void;
  exportDatabase?: () => Promise<string | null>;
  importDatabase?: (content: string) => Promise<boolean>;
  onExportCsv?: () => void;

  // Mobile Sync props
  syncStatus?: 'disconnected' | 'connecting' | 'connected' | 'syncing' | 'error';
  syncCredentials?: { host: string; port: number; token: string; key?: string; relayUrl?: string } | null;
  lastSyncedAt?: number | null;
  onPairSync?: (creds: { host: string; port: number; token: string; key?: string; relayUrl?: string }) => Promise<void>;
  onDisconnectSync?: () => void;
}

export function Settings({
  authPin,
  biometricEnabled = false,
  currency,
  lockTimer,
  undoSeconds,
  businessLedgerName,
  personalLedgerName,
  onSave,
  onStartFresh,
  autoStart = false,
  onToggleAutoStart,
  onOpenAppDirectory,
  onOpenDataDirectory,
  onCheckUpdates,
  exportDatabase,
  importDatabase,
  onExportCsv,
  syncStatus = 'disconnected',
  syncCredentials = null,
  lastSyncedAt = null,
  onPairSync,
  onDisconnectSync,
}: SettingsProps) {
  // Draft state for form
  const hasConfiguredPin = Boolean(authPin && authPin.length > 0);
  const [isChangingPin, setIsChangingPin] = useState(false);
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmNewPin, setConfirmNewPin] = useState("");
  const [pinError, setPinError] = useState("");
  const [removePin, setRemovePin] = useState(false);
  const [draftCurrency, setDraftCurrency] = useState(currency);
  const [draftLockTimer, setDraftLockTimer] = useState(lockTimer);
  const [draftUndoSeconds, setDraftUndoSeconds] = useState(undoSeconds);
  const [draftBusinessLedgerName, setDraftBusinessLedgerName] = useState(businessLedgerName);
  const [draftPersonalLedgerName, setDraftPersonalLedgerName] = useState(personalLedgerName);
  const [saved, setSaved] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [appVersion, setAppVersion] = useState("Loading...");
  const [updateStatus, setUpdateStatus] = useState<string>('');
  const [checking, setChecking] = useState(false);
  const [isStoreBuild, setIsStoreBuild] = useState(false);

  // Mobile Device Sync State (Desktop Only):
  // Should show when running in Electron (window.electronAPI exists) OR as a desktop browser dev session.
  // It is NOT gated by isNativePlatform() — that is the Android check.
  const isElectron = typeof window !== 'undefined' && Boolean((window as any).electronAPI);
  const isNative = Capacitor.isNativePlatform();
  const isDesktop = isElectron || !isNative;

  // Mobile Device Sync Guided Flow (Mobile Only)
  const [showMobileSyncFlow, setShowMobileSyncFlow] = useState(false);
  const [syncStatusData, setSyncStatusData] = useState<{
    connectedClients?: number;
    connectedCount?: number;
    ip: string;
    availableIps?: Array<{ ip: string; name: string }>;
    port: number;
    token: string;
    /** Sync step 2: the secret that locks data sent to phones. Never leaves this PC except in the QR code. */
    key?: string;
    /** Sync step 3: where this PC's internet post box lives ('' = Wi-Fi only). */
    relayUrl?: string;
    /** Post box state (this PC's own window only). phoneSeenAt: when a phone last got in touch. */
    relay?: { configured?: boolean; phoneSeenAt?: number };
  } | null>(null);
  const [selectedIp, setSelectedIp] = useState<string>(() => localStorage.getItem('bs_selected_sync_ip') || '');
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string>('');

  // A phone is paired but not on this Wi-Fi right now: it is reached through
  // the internet post box instead. Without this the PC showed the whole setup
  // again, as if no phone had ever been paired.
  const phonePairedAway =
    ((syncStatusData?.connectedCount ?? syncStatusData?.connectedClients) || 0) === 0 &&
    Boolean(syncStatusData?.relayUrl) &&
    (syncStatusData?.relay?.phoneSeenAt || 0) > 0;
  const [showToken, setShowToken] = useState<boolean>(false);
  const [copiedToken, setCopiedToken] = useState<boolean>(false);
  const [regeneratingToken, setRegeneratingToken] = useState<boolean>(false);
  const [confirmRegenerate, setConfirmRegenerate] = useState<boolean>(false);

  // Back cancels an open confirmation box instead of leaving Settings.
  useBackButtonDismiss(confirmReset || confirmRegenerate, () => {
    if (confirmRegenerate) setConfirmRegenerate(false);
    else setConfirmReset(false);
  });
  const [firewallStatus, setFirewallStatus] = useState<string | null>(null);
  const [isAllowingFirewall, setIsAllowingFirewall] = useState<boolean>(false);
  const [serverStartupError, setServerStartupError] = useState<string | null>(null);
  const [syncFetchError, setSyncFetchError] = useState<boolean>(false);
  const [isFetchingSync, setIsFetchingSync] = useState<boolean>(false);
  const syncPollTimerRef = useRef<NodeJS.Timeout | null>(null);

  const generateQrForIp = async (ipToEncode: string, token: string, port = 3001, key?: string, relayUrl?: string) => {
    if (!ipToEncode || ipToEncode === '127.0.0.1' || !token) {
      setQrCodeDataUrl('');
      return;
    }
    try {
      const qrPayload = JSON.stringify({
        v: key ? 2 : 1,
        ip: ipToEncode,
        port: port,
        token: token,
        // The lock secret reaches the phone only here, never over the network.
        k: key || undefined,
        // The post box address, so the phone can reach this PC from anywhere.
        r: relayUrl || undefined
      });
      const url = await QRCode.toDataURL(qrPayload, {
        margin: 2,
        width: 192,
        color: {
          dark: '#000000',
          light: '#ffffff'
        }
      });
      setQrCodeDataUrl(url);
    } catch (e) {
      console.error('Failed to generate QR code:', e);
      setQrCodeDataUrl('');
    }
  };

  const checkDesktopHealth = () => {
    const api = (window as any).electronAPI;
    if (api?.getFirewallStatus) {
      api.getFirewallStatus().then((status: string) => {
        setFirewallStatus(status);
      }).catch(() => {});
    }
    if (api?.getServerStartupError) {
      api.getServerStartupError().then((err: string | null) => {
        setServerStartupError(err);
      }).catch(() => {});
    }
  };

  const fetchSyncStatus = async (isBackgroundPoll = false) => {
    if (!isBackgroundPoll) {
      setIsFetchingSync(true);
    }
    checkDesktopHealth();
    try {
      let res: Response;
      try {
        res = await fetch('http://localhost:3001/api/sync/status');
      } catch {
        res = await fetch('/api/sync/status');
      }
      if (res.ok) {
        const data = await res.json();
        setSyncStatusData(data);
        setSyncFetchError(false);
        let effectiveIp = data.ip;
        const stored = localStorage.getItem('bs_selected_sync_ip');
        if (stored && data.availableIps?.some((a: any) => a.ip === stored)) {
          effectiveIp = stored;
        } else if (data.availableIps && data.availableIps.length > 0 && !data.availableIps.some((a: any) => a.ip === data.ip)) {
          effectiveIp = data.availableIps[0].ip;
        }
        if (effectiveIp && effectiveIp !== '127.0.0.1' && data.token) {
          await generateQrForIp(effectiveIp, data.token, data.port || 3001, data.key, data.relayUrl);
        } else {
          setQrCodeDataUrl('');
        }

        // Start 30-second polling only when the server IS reachable and running
        if (isDesktop && !syncPollTimerRef.current) {
          syncPollTimerRef.current = setInterval(() => {
            fetchSyncStatus(true);
          }, 30000);
        }
      } else {
        setSyncFetchError(true);
        if (syncPollTimerRef.current) {
          clearInterval(syncPollTimerRef.current);
          syncPollTimerRef.current = null;
        }
      }
    } catch (e) {
      // Server unreachable - stop auto-polling to prevent flooding console
      setSyncFetchError(true);
      if (syncPollTimerRef.current) {
        clearInterval(syncPollTimerRef.current);
        syncPollTimerRef.current = null;
      }
    } finally {
      if (!isBackgroundPoll) {
        setIsFetchingSync(false);
      }
    }
  };

  useEffect(() => {
    if (!isDesktop) return;

    fetchSyncStatus(false);

    return () => {
      if (syncPollTimerRef.current) {
        clearInterval(syncPollTimerRef.current);
        syncPollTimerRef.current = null;
      }
    };
  }, [isDesktop]);

  // Live push update for connected device count (FIX 1.6 #4)
  useEffect(() => {
    const handleClientCount = (e: any) => {
      if (typeof e.detail === 'number') {
        setSyncStatusData((prev: any) => {
          if (!prev) return prev;
          return {
            ...prev,
            connectedClients: e.detail,
            connectedCount: e.detail
          };
        });
      }
    };
    window.addEventListener('sync_client_count', handleClientCount);
    return () => window.removeEventListener('sync_client_count', handleClientCount);
  }, []);

  const handleSelectIp = (ip: string) => {
    setSelectedIp(ip);
    localStorage.setItem('bs_selected_sync_ip', ip);
    if (syncStatusData?.token) {
      generateQrForIp(ip, syncStatusData.token, syncStatusData.port || 3001, syncStatusData.key, syncStatusData.relayUrl);
    }
  };

  const handleAllowFirewall = async () => {
    const api = (window as any).electronAPI;
    if (!api?.requestFirewallRule) return;
    setIsAllowingFirewall(true);
    try {
      const res = await api.requestFirewallRule();
      setFirewallStatus(res);
    } catch (e) {
      console.error('Failed to request firewall rule:', e);
    } finally {
      setIsAllowingFirewall(false);
    }
  };

  const handleRegenerateToken = async () => {
    try {
      setRegeneratingToken(true);
      const res = await fetch('http://localhost:3001/api/token/regenerate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${syncStatusData?.token || ''}`
        }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.token) {
          sessionStorage.setItem('sync_auth_token', data.token);
          window.dispatchEvent(new CustomEvent('auth_token_updated', { detail: data.token }));
          const statusRes = await fetch('http://localhost:3001/api/sync/status', {
            headers: { 'Authorization': `Bearer ${data.token}` }
          });
          if (statusRes.ok) {
            const statusData = await statusRes.json();
            setSyncStatusData(statusData);
            let effectiveIp = statusData.ip;
            const stored = localStorage.getItem('bs_selected_sync_ip');
            if (stored && statusData.availableIps?.some((a: any) => a.ip === stored)) {
              effectiveIp = stored;
            }
            await generateQrForIp(effectiveIp, statusData.token, statusData.port || 3001, statusData.key, statusData.relayUrl);
          }
        }
      }
    } catch (err) {
      console.error('Failed to regenerate token:', err);
    } finally {
      setRegeneratingToken(false);
      setConfirmRegenerate(false);
    }
  };

  // Typed-by-hand pairing needs the lock secret too, so the code shown is
  // "<token>.<key>" in the same field as before (just a longer code).
  const manualPairingCode = syncStatusData?.token
    ? joinPairingCode(syncStatusData.token, syncStatusData.key || '')
    : '';

  const handleCopyToken = () => {
    if (manualPairingCode) {
      navigator.clipboard.writeText(manualPairingCode);
      setCopiedToken(true);
      setTimeout(() => setCopiedToken(false), 2000);
    }
  };

  useEffect(() => {
    getCurrentAppVersion()
      .then((ver) => {
        setAppVersion(`Version ${ver}`);
      })
      .catch(() => {
        setAppVersion("Version 1.0");
      });

    getDistributionFlavor().then((flavor) => {
      setIsStoreBuild(flavor === 'store');
    });
  }, []);

  useEffect(() => {
    const api = (window as any).electronAPI;
    if (api?.onUpdateStatus) {
      api.onUpdateStatus((data: any) => {
        if (data.status === 'not-available') {
          const latestVer = data.version || (appVersion.startsWith('Version ') ? appVersion.replace('Version ', '') : appVersion);
          setUpdateStatus(`You're up to date! Version ${latestVer} is the latest.`);
          setChecking(false);
        } else if (data.status === 'downloading') {
          setUpdateStatus(`Downloading update: ${Math.round(data.percent || 0)}%`);
        } else if (data.status === 'downloaded') {
          setUpdateStatus(`Version ${data.version} downloaded! Restart the app to install.`);
          setChecking(false);
        } else if (data.status === 'error') {
          if (data.stage === 'downloading') {
            setUpdateStatus('Could not download update. Check your internet connection and try again.');
          } else {
            setUpdateStatus('Update check failed. Try again later.');
          }
          setChecking(false);
        }
      });
    }
  }, [appVersion]);

  const handleCheckUpdates = async () => {
    setChecking(true);
    setUpdateStatus('Checking for updates...');
    const platform = getAppPlatform();

    if (platform === 'electron') {
      const api = (window as any).electronAPI;
      if (api?.checkForUpdates) {
        await api.checkForUpdates();
      } else {
        setUpdateStatus('Update check unavailable in this mode.');
        setChecking(false);
      }
    } else if (platform === 'android') {
      try {
        const result = await checkAndroidUpdate();
        setChecking(false);
        if (result.hasUpdate && result.latestVersion && result.downloadUrl) {
          setUpdateStatus(`Update v${result.latestVersion} found!`);
          triggerAppUpdate({
            status: 'available',
            version: result.latestVersion,
            downloadUrl: result.downloadUrl,
          });
        } else {
          setUpdateStatus(`You're up to date! Version ${result.currentVersion} is the latest.`);
        }
      } catch (err) {
        console.error('Check android update error:', err);
        setChecking(false);
        setUpdateStatus('Could not check updates. Check internet connection.');
      }
    } else {
      setChecking(false);
      setUpdateStatus('In-app updates are available on Android and Desktop.');
    }
  };

  // Sync drafts when upstream props change (e.g. on mount)
  useEffect(() => {
    setIsChangingPin(false);
    setCurrentPin("");
    setNewPin("");
    setConfirmNewPin("");
    setPinError("");
    setRemovePin(false);
    setDraftCurrency(currency);
    setDraftLockTimer(lockTimer);
    setDraftUndoSeconds(undoSeconds);
    setDraftBusinessLedgerName(businessLedgerName);
    setDraftPersonalLedgerName(personalLedgerName);
  }, [authPin, currency, lockTimer, undoSeconds, businessLedgerName, personalLedgerName]);

  const verifyCurrentPin = (entered: string): boolean => {
    if (!authPin) return true;
    if (authPin.startsWith('$2a$') || authPin.startsWith('$2b$')) {
      try {
        return bcrypt.compareSync(entered, authPin);
      } catch {
        return false;
      }
    }
    return entered === authPin;
  };

  const bLedgerError = draftBusinessLedgerName.trim().length === 0 ? "Business ledger name cannot be empty." : "";
  const pLedgerError = draftPersonalLedgerName.trim().length === 0 ? "Personal ledger name cannot be empty." : "";
  const canSave = !bLedgerError && !pLedgerError;

  const handleDiscard = useCallback(() => {
    setIsChangingPin(false);
    setCurrentPin("");
    setNewPin("");
    setConfirmNewPin("");
    setPinError("");
    setRemovePin(false);
    setDraftCurrency(currency);
    setDraftLockTimer(lockTimer);
    setDraftUndoSeconds(undoSeconds);
    setDraftBusinessLedgerName(businessLedgerName);
    setDraftPersonalLedgerName(personalLedgerName);
    setSaved(false);
  }, [authPin, currency, lockTimer, undoSeconds, businessLedgerName, personalLedgerName]);

  const handleSave = () => {
    setPinError("");
    if (bLedgerError || pLedgerError) return;

    let authPinToSave = authPin;

    if (hasConfiguredPin && isChangingPin) {
      if (!currentPin) {
        setPinError("Please enter your current PIN.");
        return;
      }
      if (!verifyCurrentPin(currentPin)) {
        setPinError("Current PIN is incorrect.");
        return;
      }
      if (newPin.length !== 4) {
        setPinError("New PIN must be exactly 4 digits.");
        return;
      }
      if (confirmNewPin !== newPin) {
        setPinError("New PIN and confirmation do not match.");
        return;
      }
      authPinToSave = newPin;
    } else if (hasConfiguredPin && removePin) {
      if (!currentPin) {
        setPinError("Please enter your current PIN to remove security.");
        return;
      }
      if (!verifyCurrentPin(currentPin)) {
        setPinError("Current PIN is incorrect.");
        return;
      }
      authPinToSave = "";
    } else if (!hasConfiguredPin && newPin) {
      if (newPin.length !== 4) {
        setPinError("PIN must be exactly 4 digits.");
        return;
      }
      if (confirmNewPin !== newPin) {
        setPinError("PIN and confirmation do not match.");
        return;
      }
      authPinToSave = newPin;
    }

    onSave({
      authPin: authPinToSave,
      biometricEnabled: false,
      currency: draftCurrency,
      lockTimer: draftLockTimer,
      undoSeconds: draftUndoSeconds,
      businessLedgerName: draftBusinessLedgerName.trim(),
      personalLedgerName: draftPersonalLedgerName.trim(),
    });

    setIsChangingPin(false);
    setCurrentPin("");
    setNewPin("");
    setConfirmNewPin("");
    setRemovePin(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="p-6 h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto space-y-8 pb-12">
        <div>
          <h2 className="text-2xl font-bold text-[var(--color-on-surface)] mb-1 tracking-tight">Application Preferences</h2>
          <p className="text-sm text-[var(--color-on-surface-variant)]">Manage localization, security protocols, and data privacy controls.</p>
        </div>

        {/* Ledger Names */}
        <section className="bg-[var(--color-surface-variant)] border border-[var(--color-outline)] rounded-lg p-6">
          <div className="flex items-center gap-2 mb-6 border-b border-[var(--color-outline)] pb-2">
            <Building2 className="text-[var(--color-primary)]" size={20} />
            <h3 className="text-[11px] font-bold tracking-wider text-[var(--color-on-surface)] uppercase">Ledger Names</h3>
          </div>
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h4 className="font-semibold text-base text-[var(--color-on-surface)]">Business Ledger Name</h4>
                <p className="text-[13px] text-[var(--color-on-surface-variant)]">Customize the label for the Business category ledger.</p>
              </div>
              <div className="w-full sm:w-64">
                <input
                  type="text"
                  value={draftBusinessLedgerName}
                  onChange={(e) => setDraftBusinessLedgerName(e.target.value)}
                  className="w-full bg-[var(--color-background)] border border-[var(--color-outline)] text-[var(--color-on-surface)] text-[13px] rounded px-3 py-2 outline-none focus:border-[var(--color-primary)]"
                  placeholder="Business Ledger"
                />
                {bLedgerError && <p className="text-[var(--color-error)] text-xs mt-1">{bLedgerError}</p>}
              </div>
            </div>
 
            <div className="h-px bg-[var(--color-outline)]/50 w-full"></div>
 
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h4 className="font-semibold text-base text-[var(--color-on-surface)]">Personal Ledger Name</h4>
                <p className="text-[13px] text-[var(--color-on-surface-variant)]">Customize the label for the Personal category ledger.</p>
              </div>
              <div className="w-full sm:w-64">
                <input
                  type="text"
                  value={draftPersonalLedgerName}
                  onChange={(e) => setDraftPersonalLedgerName(e.target.value)}
                  className="w-full bg-[var(--color-background)] border border-[var(--color-outline)] text-[var(--color-on-surface)] text-[13px] rounded px-3 py-2 outline-none focus:border-[var(--color-primary)]"
                  placeholder="Personal Ledger"
                />
                {pLedgerError && <p className="text-[var(--color-error)] text-xs mt-1">{pLedgerError}</p>}
              </div>
            </div>
          </div>
        </section>

        {/* Localization */}
        <section className="bg-[var(--color-surface-variant)] border border-[var(--color-outline)] rounded-lg p-6">
          <div className="flex items-center gap-2 mb-6 border-b border-[var(--color-outline)] pb-2">
            <Globe className="text-[var(--color-primary)]" size={20} />
            <h3 className="text-[11px] font-bold tracking-wider text-[var(--color-on-surface)] uppercase">Localization & Format</h3>
          </div>
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h4 className="font-semibold text-base text-[var(--color-on-surface)]">Default Currency</h4>
                <p className="text-[13px] text-[var(--color-on-surface-variant)]">Set the base currency for all financial aggregations.</p>
              </div>
              <div className="w-full sm:w-64">
                <select
                  value={draftCurrency}
                  onChange={(e) => setDraftCurrency(e.target.value)}
                  className="w-full bg-[var(--color-background)] border border-[var(--color-outline)] text-[var(--color-on-surface)] font-mono text-[13px] rounded px-3 py-2 outline-none focus:border-[var(--color-primary)]"
                >
                  <option value="LKR">LKR - Sri Lankan Rupee</option>
                  <option value="USD">USD - US Dollar</option>
                </select>
                {draftCurrency !== currency && (
                  <p className="text-[11px] text-[var(--color-on-surface-variant)] mt-1.5 font-medium leading-normal">
                    * This changes the symbol shown with your amounts. The amounts themselves are left exactly as they are — nothing is converted.
                  </p>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Undo window - how long a deleted entry can still be brought back */}
        <section className="bg-[var(--color-surface-variant)] border border-[var(--color-outline)] rounded-lg p-6">
          <div className="flex items-center gap-2 mb-6 border-b border-[var(--color-outline)] pb-2">
            <Undo2 className="text-[var(--color-primary)]" size={20} />
            <h3 className="text-[11px] font-bold tracking-wider text-[var(--color-on-surface)] uppercase">Undo</h3>
          </div>
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h4 className="font-semibold text-base text-[var(--color-on-surface)]">Undo Window</h4>
                <p className="text-[13px] text-[var(--color-on-surface-variant)]">How long the Undo button stays on screen after you delete something.</p>
              </div>
              <div className="w-full sm:w-64">
                <select
                  value={draftUndoSeconds}
                  onChange={(e) => setDraftUndoSeconds(Number(e.target.value))}
                  className="w-full bg-[var(--color-background)] border border-[var(--color-outline)] text-[var(--color-on-surface)] font-mono text-[13px] rounded px-3 py-2 outline-none focus:border-[var(--color-primary)]"
                >
                  <option value={3}>3 Seconds</option>
                  <option value={5}>5 Seconds</option>
                  <option value={10}>10 Seconds</option>
                  <option value={15}>15 Seconds</option>
                  <option value={30}>30 Seconds</option>
                </select>
              </div>
            </div>
          </div>
        </section>

        {/* Security */}
        <section className="bg-[var(--color-surface-variant)] border border-[var(--color-outline)] rounded-lg p-6">
          <div className="flex items-center gap-2 mb-6 border-b border-[var(--color-outline)] pb-2">
            <ShieldCheck className="text-[var(--color-primary)]" size={20} />
            <h3 className="text-[11px] font-bold tracking-wider text-[var(--color-on-surface)] uppercase">Access & Authentication</h3>
          </div>
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-6">
              <div className="flex-1 min-w-0">
                <h4 className="font-semibold text-base text-[var(--color-on-surface)]">App PIN Code</h4>
                <p className="text-[13px] text-[var(--color-on-surface-variant)] mt-1 max-w-sm">
                  {hasConfiguredPin
                    ? "Your vault is secured with a 4-digit PIN. Verify your current PIN to change it or remove protection."
                    : "Set a 4-digit PIN to secure your ledger. Leave empty to disable PIN lock."}
                </p>

                {hasConfiguredPin && !isChangingPin && !removePin && (
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                      PIN Protection Active
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setIsChangingPin(true);
                        setRemovePin(false);
                        setCurrentPin("");
                        setNewPin("");
                        setConfirmNewPin("");
                        setPinError("");
                      }}
                      className="px-3 py-1 text-xs font-semibold rounded bg-[var(--color-surface)] border border-[var(--color-outline)] text-[var(--color-on-surface)] hover:bg-[var(--color-surface-variant)] transition-colors cursor-pointer"
                    >
                      Change PIN
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRemovePin(true);
                        setIsChangingPin(false);
                        setCurrentPin("");
                        setPinError("");
                      }}
                      className="text-xs text-[var(--color-error)] hover:underline font-medium cursor-pointer"
                    >
                      Remove PIN
                    </button>
                  </div>
                )}
              </div>

              {/* Form UI for PIN setup, change, or removal */}
              <div className="w-full sm:w-72 shrink-0">
                {hasConfiguredPin && isChangingPin && (
                  <div className="bg-[var(--color-surface)] border border-[var(--color-outline)] p-4 rounded-lg space-y-3">
                    <div className="flex items-center justify-between pb-1 border-b border-[var(--color-outline)]">
                      <span className="text-xs font-bold text-[var(--color-on-surface)]">Change PIN</span>
                      <button
                        type="button"
                        onClick={() => {
                          setIsChangingPin(false);
                          setCurrentPin("");
                          setNewPin("");
                          setConfirmNewPin("");
                          setPinError("");
                        }}
                        className="text-[11px] text-[var(--color-on-surface-variant)] hover:text-white"
                      >
                        Cancel
                      </button>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-[var(--color-on-surface-variant)] uppercase block mb-1">
                        Current PIN
                      </label>
                      <input
                        type="password"
                        maxLength={4}
                        value={currentPin}
                        onChange={(e) => {
                          setCurrentPin(e.target.value.replace(/\D/g, ""));
                          setPinError("");
                        }}
                        placeholder="••••"
                        className="w-full bg-[var(--color-background)] border border-[var(--color-outline)] text-[var(--color-on-surface)] font-mono tracking-widest text-sm rounded px-3 py-1.5 outline-none focus:border-[var(--color-primary)] text-center"
                        autoFocus
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-[var(--color-on-surface-variant)] uppercase block mb-1">
                        New 4-Digit PIN
                      </label>
                      <input
                        type="password"
                        maxLength={4}
                        value={newPin}
                        onChange={(e) => {
                          setNewPin(e.target.value.replace(/\D/g, ""));
                          setPinError("");
                        }}
                        placeholder="••••"
                        className="w-full bg-[var(--color-background)] border border-[var(--color-outline)] text-[var(--color-on-surface)] font-mono tracking-widest text-sm rounded px-3 py-1.5 outline-none focus:border-[var(--color-primary)] text-center"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-[var(--color-on-surface-variant)] uppercase block mb-1">
                        Confirm New PIN
                      </label>
                      <input
                        type="password"
                        maxLength={4}
                        value={confirmNewPin}
                        onChange={(e) => {
                          setConfirmNewPin(e.target.value.replace(/\D/g, ""));
                          setPinError("");
                        }}
                        placeholder="••••"
                        className="w-full bg-[var(--color-background)] border border-[var(--color-outline)] text-[var(--color-on-surface)] font-mono tracking-widest text-sm rounded px-3 py-1.5 outline-none focus:border-[var(--color-primary)] text-center"
                      />
                    </div>
                    {pinError && <p className="text-[var(--color-error)] text-xs mt-1">{pinError}</p>}
                  </div>
                )}

                {hasConfiguredPin && removePin && (
                  <div className="bg-[var(--color-surface)] border border-[var(--color-outline)] p-4 rounded-lg space-y-3">
                    <div className="flex items-center justify-between pb-1 border-b border-[var(--color-outline)]">
                      <span className="text-xs font-bold text-[var(--color-error)]">Remove PIN</span>
                      <button
                        type="button"
                        onClick={() => {
                          setRemovePin(false);
                          setCurrentPin("");
                          setPinError("");
                        }}
                        className="text-[11px] text-[var(--color-on-surface-variant)] hover:text-white"
                      >
                        Cancel
                      </button>
                    </div>
                    <p className="text-xs text-[var(--color-on-surface-variant)]">
                      Enter your current PIN to confirm removal of vault security:
                    </p>
                    <input
                      type="password"
                      maxLength={4}
                      value={currentPin}
                      onChange={(e) => {
                        setCurrentPin(e.target.value.replace(/\D/g, ""));
                        setPinError("");
                      }}
                      placeholder="Current PIN"
                      className="w-full bg-[var(--color-background)] border border-[var(--color-outline)] text-[var(--color-on-surface)] font-mono tracking-widest text-sm rounded px-3 py-1.5 outline-none focus:border-[var(--color-error)] text-center"
                      autoFocus
                    />
                    {pinError && <p className="text-[var(--color-error)] text-xs mt-1">{pinError}</p>}
                  </div>
                )}

                {!hasConfiguredPin && (
                  <div className="space-y-3">
                    <div>
                      <label className="text-[10px] font-bold text-[var(--color-on-surface-variant)] uppercase block mb-1">
                        Set 4-Digit PIN
                      </label>
                      <input
                        type="password"
                        maxLength={4}
                        value={newPin}
                        onChange={(e) => {
                          setNewPin(e.target.value.replace(/\D/g, ""));
                          setPinError("");
                        }}
                        placeholder="••••"
                        className="w-full bg-[var(--color-background)] border border-[var(--color-outline)] text-[var(--color-on-surface)] font-mono tracking-widest text-[13px] rounded px-3 py-2 outline-none focus:border-[var(--color-primary)] text-center"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-[var(--color-on-surface-variant)] uppercase block mb-1">
                        Confirm PIN
                      </label>
                      <input
                        type="password"
                        maxLength={4}
                        value={confirmNewPin}
                        onChange={(e) => {
                          setConfirmNewPin(e.target.value.replace(/\D/g, ""));
                          setPinError("");
                        }}
                        placeholder="••••"
                        className="w-full bg-[var(--color-background)] border border-[var(--color-outline)] text-[var(--color-on-surface)] font-mono tracking-widest text-[13px] rounded px-3 py-2 outline-none focus:border-[var(--color-primary)] text-center"
                      />
                    </div>
                    {pinError && <p className="text-[var(--color-error)] text-xs mt-1">{pinError}</p>}
                  </div>
                )}
              </div>
            </div>
            <div className="h-px bg-[var(--color-outline)]/50 w-full"></div>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h4 className="font-semibold text-base text-[var(--color-on-surface)]">Auto-Lock Timer</h4>
                <p className="text-[13px] text-[var(--color-on-surface-variant)]">Idle time before requiring re-authentication.</p>
              </div>
              <div className="w-full sm:w-64">
                <select
                  value={draftLockTimer}
                  onChange={(e) => setDraftLockTimer(e.target.value)}
                  className="w-full bg-[var(--color-background)] border border-[var(--color-outline)] text-[var(--color-on-surface)] font-mono text-[13px] rounded px-3 py-2 outline-none focus:border-[var(--color-primary)]"
                >
                  <option value="1min">1 Minute</option>
                  <option value="5min">5 Minutes</option>
                  <option value="15min">15 Minutes</option>
                  <option value="30min">30 Minutes</option>
                  <option value="never">Never</option>
                </select>
              </div>
            </div>
          </div>
        </section>

        {/* System Preferences */}
        {/* Desktop only: a phone has no Windows login, so this whole section
            is hidden there instead of offering a setting that does nothing. */}
        {onToggleAutoStart && !isNative && (
          <section className="bg-[var(--color-surface-variant)] border border-[var(--color-outline)] rounded-lg p-6">
            <div className="flex items-center gap-2 mb-6 border-b border-[var(--color-outline)] pb-2">
              <Globe className="text-[var(--color-primary)]" size={20} />
              <h3 className="text-[11px] font-bold tracking-wider text-[var(--color-on-surface)] uppercase">System Preferences</h3>
            </div>
            <div className="space-y-6">
              {/* Auto Start Toggle */}
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h4 className="font-semibold text-base text-[var(--color-on-surface)]">Auto-Start on Boot</h4>
                  <p className="text-[13px] text-[var(--color-on-surface-variant)] mt-1">Start Budget Secure automatically when Windows logs in.</p>
                </div>
                <div className="pt-1">
                  <button
                    onClick={() => onToggleAutoStart(!autoStart)}
                    className={`w-10 h-5 rounded-full relative transition-colors ${autoStart ? "bg-[var(--color-primary)]" : "bg-[var(--color-outline)]"}`}
                  >
                    <div className={`absolute top-0.5 bottom-0.5 w-4 bg-white rounded-full transition-all ${autoStart ? "left-[22px]" : "left-[2px]"}`}></div>
                  </button>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Data Privacy */}
        <section className="bg-[var(--color-surface-variant)] border border-[var(--color-outline)] rounded-lg p-6">
          <div className="flex items-center gap-2 mb-6 border-b border-[var(--color-outline)] pb-2">
            <ShieldAlert className="text-[var(--color-primary)]" size={20} />
            <h3 className="text-[11px] font-bold tracking-wider text-[var(--color-on-surface)] uppercase">Data Privacy</h3>
          </div>
          <div className="space-y-6">
            {/* Start Fresh */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h4 className="font-semibold text-base text-[var(--color-error)]">Start Fresh</h4>
                <p className="text-[13px] text-[var(--color-on-surface-variant)] max-w-sm">
                  Permanently delete all transactions, reset settings to defaults, and clear security configuration. This cannot be undone.
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                {!confirmReset ? (
                  <button
                    onClick={() => setConfirmReset(true)}
                    className="px-4 py-2 bg-[var(--color-error)]/10 border border-[var(--color-error)]/30 text-[var(--color-error)] text-sm rounded hover:bg-[var(--color-error)]/20 transition-colors flex items-center gap-2"
                  >
                    <Trash2 size={16} />
                    Start Fresh
                  </button>
                ) : (
                  <>
                    <button
                      onClick={() => setConfirmReset(false)}
                      className="px-4 py-2 bg-[var(--color-background)] border border-[var(--color-outline)] text-[var(--color-on-surface)] text-sm rounded hover:bg-[var(--color-outline)] transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => { onStartFresh(); setConfirmReset(false); }}
                      className="px-4 py-2 bg-[var(--color-error)] text-white text-sm rounded hover:opacity-80 transition-colors flex items-center gap-2 font-medium"
                    >
                      <Trash2 size={16} />
                      Yes, Delete Everything
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Mobile Device Sync (Desktop Only) */}
        {isDesktop && (
          <section className="bg-[var(--color-surface-variant)] border border-[var(--color-outline)] rounded-lg p-6">
            <div className="flex items-center justify-between mb-6 border-b border-[var(--color-outline)] pb-2">
              <div className="flex items-center gap-2">
                <Smartphone className="text-[var(--color-primary)]" size={20} />
                <h3 className="text-[11px] font-bold tracking-wider text-[var(--color-on-surface)] uppercase">
                  {syncStrings.desktop.panelTitle}
                </h3>
              </div>
              <div className="flex items-center gap-2">
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${
                  ((syncStatusData?.connectedCount ?? syncStatusData?.connectedClients) || 0) > 0 || phonePairedAway
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                    : 'bg-[var(--color-outline)]/20 text-[var(--color-on-surface-variant)] border-[var(--color-outline)]/30'
                }`}>
                  <span className={`w-2 h-2 rounded-full ${
                    ((syncStatusData?.connectedCount ?? syncStatusData?.connectedClients) || 0) > 0 || phonePairedAway ? 'bg-emerald-400 animate-pulse' : 'bg-gray-400'
                  }`} />
                  {((syncStatusData?.connectedCount ?? syncStatusData?.connectedClients) || 0) > 0
                    ? `${syncStatusData?.connectedCount ?? syncStatusData?.connectedClients} ${syncStrings.desktop.deviceCountMultiple}`
                    : phonePairedAway
                      ? syncStrings.desktop.awayBadge
                      : 'No devices connected'}
                </span>
              </div>
            </div>

            <DesktopSyncWizard
              ip={((selectedIp && syncStatusData?.availableIps?.some(a => a.ip === selectedIp)) ? selectedIp : (syncStatusData?.ip || ''))}
              availableIps={syncStatusData?.availableIps || []}
              selectedIp={selectedIp}
              onSelectIp={handleSelectIp}
              port={syncStatusData?.port || 3001}
              token={manualPairingCode}
              qrCodeDataUrl={qrCodeDataUrl}
              connectedCount={(syncStatusData?.connectedCount ?? syncStatusData?.connectedClients) || 0}
              phonePairedAway={phonePairedAway}
              phoneSeenAt={syncStatusData?.relay?.phoneSeenAt || null}
              lastSyncedAt={lastSyncedAt}
              firewallStatus={firewallStatus}
              isAllowingFirewall={isAllowingFirewall}
              onAllowFirewall={handleAllowFirewall}
              onDisconnectAll={handleRegenerateToken}
              onRefresh={() => fetchSyncStatus(false)}
              isRefreshing={isFetchingSync}
            />
          </section>
        )}

        {/* Connect to PC (Mobile Only - Capacitor.isNativePlatform()) */}
        {isNative && (
          <section className="bg-[var(--color-surface-variant)] border border-[var(--color-outline)] rounded-lg p-6">
            <div className="flex items-center justify-between mb-4 border-b border-[var(--color-outline)] pb-2">
              <div className="flex items-center gap-2">
                <Laptop className="text-[var(--color-primary)]" size={20} />
                <h3 className="text-[11px] font-bold tracking-wider text-[var(--color-on-surface)] uppercase">
                  {syncStrings.mobile.entryLabel}
                </h3>
              </div>
              {syncCredentials && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  {syncStrings.mobile.statusConnectedState}
                </span>
              )}
            </div>

            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h4 className="font-semibold text-base text-[var(--color-on-surface)]">
                    {syncStrings.mobile.entryLabel}
                  </h4>
                  <p className="text-[13px] text-[var(--color-on-surface-variant)] mt-1">
                    {syncCredentials
                      ? syncStrings.mobile.entrySubtitleConnected
                      : syncStrings.mobile.entrySubtitleDisconnected}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setShowMobileSyncFlow(true)}
                  className="px-5 py-2.5 bg-[var(--color-primary)] hover:bg-[var(--color-secondary-variant)] text-white text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-2 shadow-sm cursor-pointer"
                >
                  <Laptop size={15} />
                  <span>
                    {syncCredentials ? 'View Connection' : syncStrings.mobile.entryLabel}
                  </span>
                </button>
              </div>
            </div>

            {/* Full-screen Mobile Guided Flow */}
            {showMobileSyncFlow && (
              <MobileSyncFlow
                isOpen={showMobileSyncFlow}
                onClose={() => setShowMobileSyncFlow(false)}
                syncStatus={syncStatus}
                syncCredentials={syncCredentials}
                lastSyncedAt={lastSyncedAt}
                onPairSync={onPairSync || (async () => {})}
                onDisconnectSync={onDisconnectSync || (() => {})}
              />
            )}
          </section>
        )}

        {/* About & Updates */}
        <section className="bg-[var(--color-surface-variant)] border border-[var(--color-outline)] rounded-lg p-6">
          <div className="flex items-center gap-2 mb-6 border-b border-[var(--color-outline)] pb-2">
            <Globe className="text-[var(--color-primary)]" size={20} />
            <h3 className="text-[11px] font-bold tracking-wider text-[var(--color-on-surface)] uppercase">About & Updates</h3>
          </div>
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h4 className="font-semibold text-base text-[var(--color-on-surface)]">Application Version</h4>
                <p className="text-[13px] text-[var(--color-on-surface-variant)]">The currently installed version of Budget Secure.</p>
              </div>
              <div className="w-full sm:w-64 font-semibold text-sm text-[var(--color-on-surface)]">
                {appVersion}
              </div>
            </div>

            {!isStoreBuild && (
              <>
                <div className="h-px bg-[var(--color-outline)]/50 w-full"></div>

                {/* The wording differs by platform: on the phone the Check for
                    Updates button downloads and installs the new version itself,
                    so the desktop installer instructions did not apply there. */}
                <div className="text-[13px] text-[var(--color-on-surface-variant)] leading-relaxed">
                  {isNative
                    ? "To get the latest version with new features and bug fixes, tap Check for Updates below - the new version is downloaded and installed right here, and your data will NOT be lost."
                    : "To get the latest version with new features and bug fixes, download the newest installer from Thisara and simply run it - your data will NOT be lost. The installer automatically updates the app without needing to uninstall first."}
                </div>

                <div className="flex flex-col gap-2">
                  <div>
                    <button
                      onClick={handleCheckUpdates}
                      disabled={checking}
                      className="px-4 py-2 bg-[var(--color-primary)] text-white text-sm rounded hover:bg-[var(--color-secondary-variant)] transition-colors disabled:opacity-50 font-medium"
                    >
                      {checking ? 'Checking...' : 'Check for Updates'}
                    </button>
                  </div>
                  {updateStatus && (
                    <p className="text-xs text-[var(--color-secondary)] font-medium mt-1 animate-pulse">
                      {updateStatus}
                    </p>
                  )}
                </div>

                <div className="text-[12px] text-[var(--color-secondary)] font-medium bg-[var(--color-primary)]/5 p-3 rounded border border-[var(--color-primary)]/10">
                  Note: Your transactions, loans, and savings data are safely stored and will remain after updating.
                </div>
              </>
            )}
          </div>
        </section>

        <div className="flex justify-end gap-3 pt-4 border-t border-[var(--color-outline)]">
          <button
            onClick={handleDiscard}
            className="px-6 py-2 bg-[var(--color-background)] border border-[var(--color-outline)] text-[var(--color-on-surface)] text-sm rounded hover:bg-[var(--color-outline)] transition-colors"
          >
            Discard Changes
          </button>
          <button
            onClick={handleSave}
            disabled={!canSave}
            className={`px-6 py-2 text-sm rounded transition-colors flex items-center gap-2 font-medium ${
              canSave
                ? "bg-[var(--color-primary)] text-white hover:bg-[var(--color-secondary-variant)]"
                : "bg-[var(--color-outline)] text-[var(--color-on-surface-variant)] cursor-not-allowed opacity-50"
            }`}
          >
            {saved ? (
              <>
                <Check size={16} />
                Saved!
              </>
            ) : (
              <>
                <Save size={16} />
                Save Configuration
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

