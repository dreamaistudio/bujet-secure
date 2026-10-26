import { useState, useEffect, useRef } from "react";
import { 
  Smartphone, 
  Laptop, 
  ArrowLeft, 
  Camera, 
  Edit3, 
  Check, 
  AlertTriangle, 
  RefreshCw, 
  Wifi, 
  WifiOff, 
  HelpCircle, 
  X, 
  CheckCircle2, 
  Unlink, 
  ExternalLink,
  ShieldCheck,
  Radio
} from "lucide-react";
import { BarcodeScanner, BarcodeFormat } from "@capacitor-mlkit/barcode-scanning";
import { Network } from "@capacitor/network";
import { Capacitor } from "@capacitor/core";
import { App as CapApp } from "@capacitor/app";
import { syncStrings } from "../lib/syncStrings";
import { claimBackButton } from "../lib/backGuard";
import { encryptJson, decryptJson, isEnvelope, isValidKeyText, splitPairingCode } from "../lib/syncCrypto";
import { normalizeRelayUrl, defaultRelayUrl, relayReachable } from "../lib/relayClient";
import { SyncTroubleshootingModal } from "./SyncTroubleshootingModal";

export type MobileFlowScreen = 
  | 'screen1' 
  | 'screen2' 
  | 'screen3' 
  | 'screen3b' 
  | 'screen4' 
  | 'screen5' 
  | 'status';

export type PairingErrorType = 'unreachable' | 'auth_rejected' | 'timeout';

interface PairCreds {
  host: string;
  port: number;
  token: string;
  /** Sync step 2: the secret that locks the data, taken from the QR code. */
  key?: string;
  /** Sync step 3: the PC's internet post box, so sync works away from home. */
  relayUrl?: string;
}

interface MobileSyncFlowProps {
  isOpen: boolean;
  onClose: () => void;
  syncStatus?: 'disconnected' | 'connecting' | 'connected' | 'syncing' | 'error';
  syncCredentials?: PairCreds | null;
  lastSyncedAt?: number | null;
  onPairSync: (creds: PairCreds) => Promise<void>;
  onDisconnectSync: () => void;
}

/**
 * Validates connection to the PC and maps errors to plain-language categories
 */
async function testPairingConnection(
  creds: PairCreds,
  timeoutMs = 8000
): Promise<{ success: boolean; errorType?: PairingErrorType }> {
  return new Promise((resolve) => {
    let resolved = false;
    let ws: WebSocket | null = null;

    const finish = (success: boolean, errorType?: PairingErrorType) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      try { ws?.close(); } catch {}
      resolve(errorType ? { success, errorType } : { success });
    };

    const timer = setTimeout(() => finish(false, 'timeout'), timeoutMs);

    try {
      ws = new WebSocket(`ws://${creds.host}:${creds.port}/ws?token=${creds.token}`);

      ws.onmessage = async (event) => {
        try {
          let msg = JSON.parse(event.data);
          if (isEnvelope(msg)) {
            if (!creds.key) return finish(false, 'auth_rejected');
            msg = await decryptJson(creds.key, msg);
          }
          if (msg.type === 'connected') {
            if (creds.key && ws && ws.readyState === WebSocket.OPEN) {
              // Send a locked hello: if the PC can unlock it, the code is right.
              ws.send(JSON.stringify(await encryptJson(creds.key, { type: 'ping' })));
            } else if (msg.secure) {
              finish(false, 'auth_rejected'); // PC needs the newer code
            } else {
              finish(true); // older PC that does not lock its data
            }
          } else if (msg.type === 'pong') {
            finish(true);
          }
        } catch {
          finish(false, 'auth_rejected');
        }
      };

      ws.onerror = () => {
        // Will trigger onclose or timeout
      };

      ws.onclose = async (event) => {
        if (resolved) return;

        // Explicit rejections from the PC
        if (event.code === 4001 || event.code === 4003) {
          return finish(false, 'auth_rejected');
        }

        // Check if host is reachable via lightweight ping
        try {
          const controller = new AbortController();
          const pingTimer = setTimeout(() => controller.abort(), 2000);
          const res = await fetch(`http://${creds.host}:${creds.port}/api/sync/ping`, {
            signal: controller.signal
          });
          clearTimeout(pingTimer);
          if (res.ok) return finish(false, 'auth_rejected');
        } catch (e: any) {
          if (e.name === 'AbortError') return finish(false, 'timeout');
        }

        finish(false, 'unreachable');
      };
    } catch {
      finish(false, 'unreachable');
    }
  });
}

/**
 * Sync step 3: can this pairing reach the PC through its internet post box?
 *
 * The check above only ever tries the PC's address on the local network, so
 * it can only succeed while both devices sit on the same Wi-Fi. Away from
 * home that address leads nowhere and pairing used to stop there and offer
 * "try again", even though the QR code had already handed over everything
 * needed to use the post box instead. This is the second chance: if the box
 * answers and we hold the pairing key, the two devices can reach each other,
 * so the pairing is good.
 */
async function postBoxUsable(creds: PairCreds): Promise<boolean> {
  const url = normalizeRelayUrl(creds.relayUrl);
  if (!url) return false;
  // Without the key there is no way to work out which box is ours, nor to
  // lock anything put in it, so a pairing without one cannot use the box.
  if (!creds.key || !isValidKeyText(creds.key)) return false;
  try {
    return await relayReachable(url);
  } catch {
    return false;
  }
}

export function MobileSyncFlow({
  isOpen,
  onClose,
  syncStatus = 'disconnected',
  syncCredentials = null,
  lastSyncedAt,
  onPairSync,
  onDisconnectSync,
}: MobileSyncFlowProps) {
  const t = syncStrings.mobile;

  // Active Screen
  const [screen, setScreen] = useState<MobileFlowScreen>(() => 
    syncCredentials ? 'status' : 'screen1'
  );

  // Sync flow states
  const [phoneWifi, setPhoneWifi] = useState<string>('');
  const [permissionDenied, setPermissionDenied] = useState<boolean>(false);
  const [showPermissionRationale, setShowPermissionRationale] = useState<boolean>(false);
  const [invalidCodeToast, setInvalidCodeToast] = useState<boolean>(false);
  const [showTroubleshooting, setShowTroubleshooting] = useState<boolean>(false);
  const [showDisconnectDialog, setShowDisconnectDialog] = useState<boolean>(false);

  // Manual entry fields & validation
  const [manualHost, setManualHost] = useState('');
  const [manualPort, setManualPort] = useState('3001');
  const [manualToken, setManualToken] = useState('');
  const [hostError, setHostError] = useState('');
  const [portError, setPortError] = useState('');
  const [tokenError, setTokenError] = useState('');

  // Connecting state & error
  const [isConnecting, setIsConnecting] = useState(false);
  const [pairingError, setPairingError] = useState<PairingErrorType | null>(null);
  const activeCredsRef = useRef<PairCreds | null>(null);

  // Camera scanner listener ref
  const scanListenerRef = useRef<any>(null);
  // The camera reports the same QR code many times per second. Only the first
  // valid read may start a connection, otherwise the phone floods the PC with
  // connection attempts (and the PC blocks it after 20 per minute).
  const scanHandledRef = useRef<boolean>(false);

  // Sync initial screen when syncCredentials prop changes
  useEffect(() => {
    if (syncCredentials && screen !== 'screen5') {
      setScreen('status');
    }
  }, [syncCredentials]);

  // Read current network state on mobile
  useEffect(() => {
    let isMounted = true;
    const checkNetwork = async () => {
      try {
        const status = await Network.getStatus();
        if (!isMounted) return;
        if (status.connected) {
          if (status.connectionType === 'wifi') {
            setPhoneWifi('Wi-Fi');
          } else if (status.connectionType === 'cellular') {
            setPhoneWifi('Mobile Data');
          } else {
            setPhoneWifi('Connected');
          }
        } else {
          setPhoneWifi('');
        }
      } catch {
        if (isMounted) setPhoneWifi('');
      }
    };

    checkNetwork();

    let handler: any = null;
    try {
      Network.addListener('networkStatusChange', (status) => {
        if (!isMounted) return;
        if (status.connected) {
          if (status.connectionType === 'wifi') {
            setPhoneWifi('Wi-Fi');
          } else if (status.connectionType === 'cellular') {
            setPhoneWifi('Mobile Data');
          } else {
            setPhoneWifi('Connected');
          }
        } else {
          setPhoneWifi('');
        }
      }).then((h) => { handler = h; });
    } catch {}

    return () => {
      isMounted = false;
      handler?.remove?.();
    };
  }, []);

  // Format last synced time cleanly
  const formatLastSynced = (timestamp?: number | null) => {
    if (!timestamp) return syncStrings.desktop.justNow;
    const diff = Date.now() - timestamp;
    if (diff < 60000) return syncStrings.desktop.justNow;
    if (diff < 3600000) {
      const mins = Math.floor(diff / 60000);
      return `${mins}m ago`;
    }
    return new Date(timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Safe camera scanner cleanup
  const stopScannerCleanly = async () => {
    document.documentElement.classList.remove('barcode-scanner-active');
    document.body.classList.remove('barcode-scanner-active');
    try {
      if (scanListenerRef.current) {
        await scanListenerRef.current.remove();
        scanListenerRef.current = null;
      }
      await BarcodeScanner.removeAllListeners();
      await BarcodeScanner.stopScan();
    } catch (e) {
      console.warn('Error stopping scanner:', e);
    }
  };

  // Close modal cleanup
  const handleClose = async () => {
    await stopScannerCleanly();
    onClose();
  };

  // Screen 2: "Open Camera" clicked
  const handleOpenCameraButton = async () => {
    setPermissionDenied(false);

    if (!Capacitor.isNativePlatform()) {
      // In browser testing: start scan UI simulation or go to manual
      setScreen('screen3');
      return;
    }

    try {
      const status = await BarcodeScanner.checkPermissions();
      if (status.camera === 'granted' || status.camera === 'limited') {
        startScanner();
      } else if (status.camera === 'denied') {
        setPermissionDenied(true);
      } else {
        setShowPermissionRationale(true);
      }
    } catch (e) {
      console.error('Camera permission check failed:', e);
      setShowPermissionRationale(true);
    }
  };

  // Confirm rationale and request permission
  const handleGrantPermission = async () => {
    setShowPermissionRationale(false);
    try {
      const status = await BarcodeScanner.requestPermissions();
      if (status.camera === 'granted' || status.camera === 'limited') {
        startScanner();
      } else {
        setPermissionDenied(true);
      }
    } catch (e) {
      setPermissionDenied(true);
    }
  };

  // Open native app system settings
  const handleOpenSystemSettings = async () => {
    try {
      await BarcodeScanner.openSettings();
    } catch (e) {
      console.error('Failed to open app system settings:', e);
    }
  };

  // Start MLKit Barcode scanner overlay
  const startScanner = async () => {
    scanHandledRef.current = false;
    setScreen('screen3');
    try {
      if (Capacitor.getPlatform() === 'android') {
        try {
          const mod = await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable();
          if (!mod.available) {
            await BarcodeScanner.installGoogleBarcodeScannerModule();
          }
        } catch {}
      }

      document.documentElement.classList.add('barcode-scanner-active');
      document.body.classList.add('barcode-scanner-active');

      const listener = await BarcodeScanner.addListener('barcodesScanned', async (result) => {
        if (result.barcodes && result.barcodes.length > 0) {
          const raw = result.barcodes[0].rawValue || result.barcodes[0].displayValue;
          if (raw) {
            processScannedContent(raw);
          }
        }
      });
      scanListenerRef.current = listener;

      await BarcodeScanner.startScan({
        formats: [BarcodeFormat.QrCode],
      });
    } catch (err: any) {
      console.warn('startScan failed, falling back to Google Code Scanner dialog:', err);
      try {
        const { barcodes } = await BarcodeScanner.scan({
          formats: [BarcodeFormat.QrCode],
        });
        if (barcodes && barcodes.length > 0) {
          const raw = barcodes[0].rawValue || barcodes[0].displayValue;
          if (raw) {
            processScannedContent(raw);
            return;
          }
        }
        await stopScannerCleanly();
        setScreen('screen2');
      } catch {
        await stopScannerCleanly();
        setScreen('screen2');
      }
    }
  };

  // Cancel scanner view
  const handleCancelScanner = async () => {
    await stopScannerCleanly();
    setScreen('screen2');
  };

  // Process QR string scanned by camera
  const processScannedContent = async (raw: string) => {
    if (scanHandledRef.current) return;
    let parsed: any = null;
    try {
      parsed = JSON.parse(raw);
    } catch {}

    const host = parsed?.ip || parsed?.host;
    const port = Number(parsed?.port) || 3001;
    const token = parsed?.token;
    const key = typeof parsed?.k === 'string' && isValidKeyText(parsed.k) ? parsed.k : undefined;
    const relayUrl = typeof parsed?.r === 'string' ? parsed.r : undefined;

    if (!host || !token) {
      // Unrecognized QR code: show non-blocking toast and keep scanning
      setInvalidCodeToast(true);
      setTimeout(() => setInvalidCodeToast(false), 2500);
      return;
    }

    // Valid code: stop scanner and begin connection (only once)
    scanHandledRef.current = true;
    await stopScannerCleanly();
    beginConnecting({ host, port, token, key, relayUrl });
  };

  // Validate manual input
  const handleManualSubmit = () => {
    setHostError('');
    setPortError('');
    setTokenError('');

    let hasError = false;

    // IP validation
    const ipTrimmed = manualHost.trim();
    const ipv4Regex = /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;

    if (!ipTrimmed) {
      setHostError(t.screen3bIpRequired);
      hasError = true;
    } else if (!ipv4Regex.test(ipTrimmed)) {
      setHostError(t.screen3bIpInvalid);
      hasError = true;
    }

    // Port validation
    const portNum = Number(manualPort);
    if (!portNum || portNum < 1 || portNum > 65535) {
      setPortError(t.screen3bPortInvalid);
      hasError = true;
    }

    // Code validation
    const tokenTrimmed = manualToken.trim();
    if (!tokenTrimmed) {
      setTokenError(t.screen3bCodeRequired);
      hasError = true;
    }

    if (hasError) return;

    // The code shown on the PC is "<token>.<key>"; split it back apart here.
    // A typed code has no room for a post box address, so none is passed:
    // beginConnecting fills in this app's own address, which is what lets a
    // hand-typed pairing work away from the PC's network just like a scanned
    // one. Before that it was Wi-Fi only, with no way to say otherwise.
    const { token: parsedToken, key: parsedKey } = splitPairingCode(tokenTrimmed);
    beginConnecting({
      host: ipTrimmed,
      port: portNum,
      token: parsedToken,
      key: parsedKey && isValidKeyText(parsedKey) ? parsedKey : undefined,
    });
  };

  // Screen 4: Connect to PC
  const beginConnecting = async (creds: PairCreds) => {
    // Settle the post box address once, here, so every route into pairing -
    // a scanned code, a typed one, or Try again - carries the same one, and
    // so it is stored with the pairing for the sync that follows. A QR code
    // from this PC brings its own address and that is kept; anything else
    // falls back to the address built into this app.
    const pairing: PairCreds = {
      ...creds,
      relayUrl: normalizeRelayUrl(creds.relayUrl) || defaultRelayUrl()
    };

    activeCredsRef.current = pairing;
    setScreen('screen4');
    setIsConnecting(true);
    setPairingError(null);

    const result = await testPairingConnection(pairing);

    // The direct route over Wi-Fi is the quick one, but it exists only while
    // both devices are on the same network. When it fails the PC may still
    // be within reach through its post box, so try that before giving up -
    // otherwise pairing from mobile data always ended in "try again".
    // Not when the PC answered and turned the code down, though: that means
    // the code itself is wrong, and the post box would only hide that.
    const connected =
      result.success ||
      (result.errorType !== 'auth_rejected' && (await postBoxUsable(pairing)));

    if (connected) {
      try {
        await onPairSync(pairing);
        setIsConnecting(false);
        setScreen('screen5');
      } catch (err) {
        setIsConnecting(false);
        setPairingError('unreachable');
      }
    } else {
      setIsConnecting(false);
      setPairingError(result.errorType || 'unreachable');
    }
  };

  // Try again on failure
  const handleTryAgain = () => {
    if (activeCredsRef.current) {
      beginConnecting(activeCredsRef.current);
    } else {
      setScreen('screen2');
    }
  };

  // Disconnect from paired status
  const handleConfirmDisconnect = () => {
    setShowDisconnectDialog(false);
    onDisconnectSync();
    setScreen('screen1');
  };

  // Always turn the camera off if this screen goes away while scanning
  useEffect(() => {
    return () => {
      stopScannerCleanly();
    };
  }, []);

  // Phone's Back button: behave like the on-screen back arrow instead of
  // leaving the camera running behind the app.
  const backHandlerRef = useRef<() => void>(() => {});
  backHandlerRef.current = () => {
    if (screen === 'screen3') handleCancelScanner();
    else if (screen === 'screen2') setScreen('screen1');
    else if (screen === 'screen3b') setScreen('screen2');
    else if (screen === 'screen4' && !isConnecting) setScreen('screen2');
    else if (screen === 'screen4') { /* still connecting: ignore */ }
    else handleClose();
  };

  useEffect(() => {
    if (!isOpen || !Capacitor.isNativePlatform()) return;
    // While this flow is open it owns the back button, so the main app does
    // not also act on the same press and drag the user out of Settings.
    const releaseBackButton = claimBackButton();
    let cancelled = false;
    let handle: any = null;
    CapApp.addListener('backButton', () => {
      backHandlerRef.current();
    }).then((h) => {
      if (cancelled) h.remove();
      else handle = h;
    }).catch(() => {});
    return () => {
      cancelled = true;
      handle?.remove?.();
      releaseBackButton();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  // ----------------------------------------------------
  // Screen 3: SCANNER VIEW (Full screen transparent overlay)
  // ----------------------------------------------------
  if (screen === 'screen3') {
    return (
      <div className="barcode-scanner-modal fixed inset-0 z-[400] flex flex-col justify-between items-center p-6 select-none bg-transparent">
        {/* Top Header */}
        <div className="w-full flex items-center justify-between z-20 pt-4">
          <button
            type="button"
            onClick={handleCancelScanner}
            className="w-10 h-10 rounded-full bg-black/60 border border-white/20 text-white flex items-center justify-center cursor-pointer shadow-lg active:scale-95 transition-transform"
          >
            <X size={20} />
          </button>
          <span className="text-sm font-semibold text-white drop-shadow-md">
            Budget Secure
          </span>
          <div className="w-10" />
        </div>

        {/* Invalid QR Toast (non-blocking notification) */}
        {invalidCodeToast && (
          <div className="fixed top-20 left-1/2 -translate-x-1/2 z-30 bg-rose-900/90 border border-rose-500/50 text-rose-100 px-4 py-2.5 rounded-full text-xs font-semibold shadow-2xl flex items-center gap-2 animate-[slideUp_0.15s_ease-out]">
            <AlertTriangle size={15} className="text-rose-300 shrink-0" />
            <span>{t.screen3InvalidToast}</span>
          </div>
        )}

        {/* Viewfinder Target Frame (cutout via 9999px box shadow) */}
        <div className="relative flex flex-col items-center justify-center my-auto z-10">
          <div className="w-64 h-64 sm:w-72 sm:h-72 border-2 border-emerald-400 rounded-2xl relative shadow-[0_0_0_9999px_rgba(0,0,0,0.65)]">
            {/* Corner accents */}
            <div className="absolute -top-1 -left-1 w-6 h-6 border-t-4 border-l-4 border-emerald-400 rounded-tl-lg" />
            <div className="absolute -top-1 -right-1 w-6 h-6 border-t-4 border-r-4 border-emerald-400 rounded-tr-lg" />
            <div className="absolute -bottom-1 -left-1 w-6 h-6 border-b-4 border-l-4 border-emerald-400 rounded-bl-lg" />
            <div className="absolute -bottom-1 -right-1 w-6 h-6 border-b-4 border-r-4 border-emerald-400 rounded-br-lg" />

            {/* Scanning beam animation */}
            <div className="absolute inset-x-2 h-0.5 bg-gradient-to-r from-transparent via-emerald-400 to-transparent top-1/2 animate-pulse" />
          </div>

          <p className="text-white text-xs sm:text-sm font-medium drop-shadow-md text-center mt-6 px-4">
            {t.screen3Caption}
          </p>
        </div>

        {/* Bottom Cancel Button */}
        <div className="w-full flex justify-center z-20 pb-4">
          <button
            type="button"
            onClick={handleCancelScanner}
            className="px-8 py-3 bg-zinc-900/90 hover:bg-zinc-800 text-white font-semibold text-sm rounded-full border border-white/20 shadow-2xl active:scale-95 transition-all cursor-pointer"
          >
            {t.screen3Cancel}
          </button>
        </div>
      </div>
    );
  }

  // ----------------------------------------------------
  // Full-screen Modal Container for All Other Screens
  // ----------------------------------------------------
  return (
    <div className="fixed inset-0 z-[300] bg-[var(--color-background)] flex flex-col overflow-hidden animate-[fadeIn_0.15s_ease-out]">
      {/* Top App Header */}
      <div className="h-14 px-4 border-b border-[var(--color-outline)] bg-[var(--color-surface)] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              if (screen === 'screen2') setScreen('screen1');
              else if (screen === 'screen3b') setScreen('screen2');
              else if (screen === 'screen4' && !isConnecting) setScreen('screen2');
              else handleClose();
            }}
            className="p-2 -ml-2 text-[var(--color-on-surface-variant)] hover:text-[var(--color-on-surface)] rounded-lg cursor-pointer"
            aria-label="Back"
          >
            <ArrowLeft size={20} />
          </button>
          <h2 className="text-base font-bold text-[var(--color-on-surface)] tracking-tight">
            {screen === 'status'
              ? t.statusTitle
              : screen === 'screen3b'
              ? t.screen3bTitle
              : t.entryLabel}
          </h2>
        </div>

        <button
          type="button"
          onClick={handleClose}
          className="text-xs text-[var(--color-on-surface-variant)] hover:text-[var(--color-on-surface)] font-medium p-2 rounded cursor-pointer"
        >
          {screen === 'status' || screen === 'screen5' ? 'Close' : 'Cancel'}
        </button>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-6 flex flex-col justify-between max-w-md mx-auto w-full">
        {/* ==================================================== */}
        {/* SCREEN 1: Connect to your computer */}
        {/* ==================================================== */}
        {screen === 'screen1' && (
          <div className="space-y-6 my-auto">
            {/* Visual Phone & PC Illustration */}
            <div className="flex items-center justify-center gap-4 py-4">
              <div className="w-16 h-16 rounded-2xl bg-[var(--color-surface-variant)] border border-[var(--color-outline)] flex items-center justify-center text-[var(--color-primary)] shadow-md">
                <Smartphone size={32} />
              </div>
              <div className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-[var(--color-primary)] animate-ping" />
                <span className="w-6 h-0.5 bg-[var(--color-outline-variant)] border-t border-dashed border-[var(--color-primary)]" />
                <span className="w-2 h-2 rounded-full bg-[var(--color-primary)]" />
              </div>
              <div className="w-16 h-16 rounded-2xl bg-[var(--color-surface-variant)] border border-[var(--color-outline)] flex items-center justify-center text-[var(--color-primary)] shadow-md">
                <Laptop size={32} />
              </div>
            </div>

            <div>
              <h3 className="text-xl font-bold text-[var(--color-on-surface)] text-center">
                {t.screen1Title}
              </h3>
            </div>

            {/* Three bullet lines */}
            <div className="p-4 bg-[var(--color-surface-variant)] border border-[var(--color-outline)] rounded-2xl space-y-3 shadow-inner">
              <div className="flex items-start gap-3">
                <span className="w-5 h-5 rounded-full bg-[var(--color-primary)]/15 text-[var(--color-primary)] font-bold text-xs flex items-center justify-center shrink-0 mt-0.5">
                  1
                </span>
                <span className="text-xs sm:text-sm text-[var(--color-on-surface)] font-medium leading-relaxed">
                  {t.screen1Bullet1}
                </span>
              </div>
              <div className="flex items-start gap-3">
                <span className="w-5 h-5 rounded-full bg-[var(--color-primary)]/15 text-[var(--color-primary)] font-bold text-xs flex items-center justify-center shrink-0 mt-0.5">
                  2
                </span>
                <span className="text-xs sm:text-sm text-[var(--color-on-surface)] font-medium leading-relaxed">
                  {t.screen1Bullet2}
                </span>
              </div>
              <div className="flex items-start gap-3">
                <span className="w-5 h-5 rounded-full bg-[var(--color-primary)]/15 text-[var(--color-primary)] font-bold text-xs flex items-center justify-center shrink-0 mt-0.5">
                  3
                </span>
                <span className="text-xs sm:text-sm text-[var(--color-on-surface)] font-medium leading-relaxed">
                  {t.screen1Bullet3}
                </span>
              </div>
            </div>

            {/* Phone Wi-Fi Status Comparison */}
            <div className="p-3 bg-[var(--color-surface)] border border-[var(--color-outline)] rounded-xl flex items-center gap-3">
              {phoneWifi ? (
                <>
                  <Wifi size={18} className="text-emerald-400 shrink-0" />
                  <span className="text-xs text-[var(--color-on-surface)] font-medium">
                    {t.screen1PhoneOn}{" "}
                    <span className="text-emerald-400 font-bold">{phoneWifi}</span>
                  </span>
                </>
              ) : (
                <>
                  <WifiOff size={18} className="text-amber-400 shrink-0" />
                  <span className="text-xs text-amber-200 font-medium">
                    {t.screen1WifiUnknown}
                  </span>
                </>
              )}
            </div>

            {/* Primary Action Button */}
            <div className="pt-2">
              <button
                type="button"
                onClick={() => setScreen('screen2')}
                className="w-full h-12 bg-[var(--color-primary)] hover:bg-[var(--color-secondary-variant)] text-white font-bold text-sm rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-[var(--color-primary)]/20 cursor-pointer active:scale-[0.99]"
              >
                <span>{t.screen1Next}</span>
              </button>
            </div>
          </div>
        )}

        {/* ==================================================== */}
        {/* SCREEN 2: Scan the code on your PC */}
        {/* ==================================================== */}
        {screen === 'screen2' && (
          <div className="space-y-6 my-auto">
            <div className="w-16 h-16 rounded-full bg-[var(--color-primary)]/10 border border-[var(--color-primary)]/30 mx-auto flex items-center justify-center text-[var(--color-primary)] shadow-inner">
              <Camera size={32} />
            </div>

            <div className="text-center space-y-1">
              <h3 className="text-xl font-bold text-[var(--color-on-surface)]">
                {t.screen2Title}
              </h3>
              <p className="text-xs text-[var(--color-on-surface-variant)] leading-relaxed max-w-xs mx-auto">
                {t.screen2PermissionExplain}
              </p>
            </div>

            {/* Permission Denied Callout */}
            {permissionDenied && (
              <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-2xl space-y-3">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle size={18} className="text-amber-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-200 font-medium leading-relaxed">
                    {t.screen2PermissionDenied}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleOpenSystemSettings}
                  className="w-full py-2.5 bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-black font-bold text-xs rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow"
                >
                  <ExternalLink size={14} />
                  {t.screen2OpenSettings}
                </button>
              </div>
            )}

            {/* Permission explanation rationale modal / prompt */}
            {showPermissionRationale && (
              <div className="p-4 bg-[var(--color-surface-variant)] border border-[var(--color-outline)] rounded-2xl space-y-3 shadow-lg">
                <p className="text-xs text-[var(--color-on-surface)] leading-relaxed">
                  {t.screen2PermissionExplain}
                </p>
                <button
                  type="button"
                  onClick={handleGrantPermission}
                  className="w-full py-2.5 bg-[var(--color-primary)] text-white font-bold text-xs rounded-lg transition-colors flex items-center justify-center cursor-pointer shadow"
                >
                  {t.screen2Continue}
                </button>
              </div>
            )}

            {/* Action Buttons */}
            <div className="space-y-3 pt-2">
              <button
                type="button"
                onClick={handleOpenCameraButton}
                className="w-full h-12 bg-[var(--color-primary)] hover:bg-[var(--color-secondary-variant)] text-white font-bold text-sm rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-[var(--color-primary)]/20 cursor-pointer active:scale-[0.99]"
              >
                <Camera size={18} />
                <span>{t.screen2OpenCamera}</span>
              </button>

              <button
                type="button"
                onClick={() => setScreen('screen3b')}
                className="w-full py-2.5 text-xs font-semibold text-[var(--color-primary)] hover:underline flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Edit3 size={14} />
                <span>{t.screen2ManualLink}</span>
              </button>
            </div>
          </div>
        )}

        {/* ==================================================== */}
        {/* SCREEN 3b: Enter code manually */}
        {/* ==================================================== */}
        {screen === 'screen3b' && (
          <div className="space-y-5 my-auto">
            <div className="space-y-1">
              <h3 className="text-lg font-bold text-[var(--color-on-surface)]">
                {t.screen3bTitle}
              </h3>
              <p className="text-xs text-[var(--color-on-surface-variant)]">
                {syncStrings.desktop.step5ManualHeading}
              </p>
            </div>

            <div className="space-y-3.5">
              {/* IP Address Field */}
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-on-surface-variant)] block mb-1">
                  {t.screen3bIpLabel}
                </label>
                <input
                  type="text"
                  value={manualHost}
                  onChange={(e) => {
                    setManualHost(e.target.value.trim());
                    setHostError('');
                  }}
                  placeholder={t.screen3bIpPlaceholder}
                  className="w-full bg-[var(--color-surface)] border border-[var(--color-outline)] text-[var(--color-on-surface)] rounded-xl px-3.5 py-2.5 font-mono text-sm outline-none focus:border-[var(--color-primary)] transition-colors"
                  autoFocus
                />
                {hostError && (
                  <p className="text-[11px] text-[var(--color-error)] font-medium mt-1">
                    {hostError}
                  </p>
                )}
              </div>

              {/* Port Field */}
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-on-surface-variant)] block mb-1">
                  {t.screen3bPortLabel}
                </label>
                <input
                  type="number"
                  value={manualPort}
                  onChange={(e) => {
                    setManualPort(e.target.value.trim());
                    setPortError('');
                  }}
                  placeholder="3001"
                  className="w-full bg-[var(--color-surface)] border border-[var(--color-outline)] text-[var(--color-on-surface)] rounded-xl px-3.5 py-2.5 font-mono text-sm outline-none focus:border-[var(--color-primary)] transition-colors"
                />
                {portError && (
                  <p className="text-[11px] text-[var(--color-error)] font-medium mt-1">
                    {portError}
                  </p>
                )}
              </div>

              {/* Code Field */}
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-on-surface-variant)] block mb-1">
                  {t.screen3bCodeLabel}
                </label>
                <input
                  type="text"
                  value={manualToken}
                  onChange={(e) => {
                    setManualToken(e.target.value.trim());
                    setTokenError('');
                  }}
                  placeholder={t.screen3bCodeLabel}
                  className="w-full bg-[var(--color-surface)] border border-[var(--color-outline)] text-[var(--color-on-surface)] rounded-xl px-3.5 py-2.5 font-mono text-sm outline-none focus:border-[var(--color-primary)] transition-colors"
                />
                {tokenError && (
                  <p className="text-[11px] text-[var(--color-error)] font-medium mt-1">
                    {tokenError}
                  </p>
                )}
              </div>
            </div>

            {/* Submit and Back Buttons */}
            <div className="space-y-2.5 pt-2">
              <button
                type="button"
                onClick={handleManualSubmit}
                className="w-full h-12 bg-[var(--color-primary)] hover:bg-[var(--color-secondary-variant)] text-white font-bold text-sm rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-[var(--color-primary)]/20 cursor-pointer active:scale-[0.99]"
              >
                <span>{t.screen3bConnect}</span>
              </button>

              <button
                type="button"
                onClick={() => setScreen('screen2')}
                className="w-full py-2 text-xs font-semibold text-[var(--color-on-surface-variant)] hover:text-[var(--color-on-surface)] flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Camera size={14} />
                <span>{t.screen3bBackToScan}</span>
              </button>
            </div>
          </div>
        )}

        {/* ==================================================== */}
        {/* SCREEN 4: Connecting & Mapped Error States */}
        {/* ==================================================== */}
        {screen === 'screen4' && (
          <div className="space-y-6 my-auto text-center">
            {isConnecting ? (
              <div className="space-y-5 py-8">
                <div className="w-16 h-16 rounded-full border-4 border-[var(--color-primary)] border-t-transparent animate-spin mx-auto shadow-inner" />
                <div className="space-y-1">
                  <h3 className="text-lg font-bold text-[var(--color-on-surface)]">
                    {t.screen4Connecting}
                  </h3>
                  <p className="text-xs text-[var(--color-on-surface-variant)]">
                    Talking with your computer over Wi-Fi...
                  </p>
                </div>
              </div>
            ) : pairingError ? (
              <div className="space-y-5 py-4">
                <div className="w-16 h-16 rounded-full bg-rose-500/20 border border-rose-500/40 text-rose-300 mx-auto flex items-center justify-center shadow-inner">
                  <AlertTriangle size={32} />
                </div>

                <div className="p-4 bg-rose-500/10 border border-rose-500/30 rounded-2xl text-left">
                  <p className="text-xs sm:text-sm text-rose-200 leading-relaxed font-medium">
                    {pairingError === 'unreachable'
                      ? t.screen4Unreachable
                      : pairingError === 'auth_rejected'
                      ? t.screen4AuthRejected
                      : t.screen4Timeout}
                  </p>
                </div>

                <div className="space-y-2.5 pt-2">
                  <button
                    type="button"
                    onClick={handleTryAgain}
                    className="w-full h-12 bg-[var(--color-primary)] hover:bg-[var(--color-secondary-variant)] text-white font-bold text-sm rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-[var(--color-primary)]/20 cursor-pointer active:scale-[0.99]"
                  >
                    <RefreshCw size={16} />
                    <span>{t.screen4TryAgain}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setScreen('screen2')}
                    className="w-full py-2.5 text-xs font-semibold text-[var(--color-on-surface-variant)] hover:text-[var(--color-on-surface)] cursor-pointer"
                  >
                    {t.screen4Back}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        )}

        {/* ==================================================== */}
        {/* SCREEN 5: SUCCESS */}
        {/* ==================================================== */}
        {screen === 'screen5' && (
          <div className="space-y-6 my-auto text-center">
            <div className="w-20 h-20 rounded-full bg-emerald-500/20 border-2 border-emerald-500/50 text-emerald-400 mx-auto flex items-center justify-center shadow-xl shadow-emerald-950/40 animate-[scaleIn_0.2s_ease-out]">
              <Check size={44} className="stroke-[3]" />
            </div>

            <div className="space-y-2">
              <h3 className="text-2xl font-bold text-[var(--color-on-surface)]">
                {t.screen5Title}
              </h3>
              <p className="text-xs sm:text-sm text-[var(--color-on-surface-variant)] leading-relaxed max-w-xs mx-auto">
                {t.screen5Desc}
              </p>
            </div>

            <div className="pt-4">
              <button
                type="button"
                onClick={handleClose}
                className="w-full h-12 bg-[var(--color-primary)] hover:bg-[var(--color-secondary-variant)] text-white font-bold text-sm rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-[var(--color-primary)]/20 cursor-pointer active:scale-[0.99]"
              >
                <span>{t.screen5Done}</span>
              </button>
            </div>
          </div>
        )}

        {/* ==================================================== */}
        {/* PAIRED STATUS SCREEN */}
        {/* ==================================================== */}
        {screen === 'status' && syncCredentials && (
          <div className="space-y-5 my-auto">
            {/* Connection Status Card */}
            <div className="p-5 rounded-2xl bg-[var(--color-surface-variant)] border border-[var(--color-outline)] space-y-4 shadow-xl">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
                    <Laptop size={20} />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-[var(--color-on-surface)]">
                      {t.statusTitle}
                    </h4>
                    <p className="text-xs text-[var(--color-on-surface-variant)] font-mono">
                      {syncCredentials.host}:{syncCredentials.port}
                    </p>
                  </div>
                </div>

                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  {syncStatus === 'connected'
                    ? t.statusConnectedState
                    : syncStatus === 'syncing'
                    ? t.statusSyncingState
                    : syncStatus === 'connecting'
                    ? t.statusConnectingState
                    : t.statusOfflineState}
                </span>
              </div>

              <div className="border-t border-[var(--color-outline)]/60 pt-3 flex items-center justify-between text-xs text-[var(--color-on-surface-variant)]">
                <span>{t.statusLastSynced}</span>
                <span className="font-mono text-[var(--color-on-surface)] font-medium">
                  {formatLastSynced(lastSyncedAt)}
                </span>
              </div>

              <p className="text-xs text-[var(--color-on-surface-variant)] leading-relaxed pt-1">
                {t.statusAutoSyncNote}
              </p>
            </div>

            {/* Disconnect Action */}
            <div className="pt-2">
              <button
                type="button"
                onClick={() => setShowDisconnectDialog(true)}
                className="w-full py-3 bg-[var(--color-surface-variant)] hover:bg-rose-500/10 border border-[var(--color-outline)] hover:border-rose-500/40 text-rose-300 font-semibold text-xs rounded-xl transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-sm"
              >
                <Unlink size={15} />
                <span>{t.disconnectButton}</span>
              </button>
            </div>

            {/* Confirmation Dialog Modal */}
            {showDisconnectDialog && (
              <div
                className="fixed inset-0 z-[500] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-[fadeIn_0.15s_ease-out]"
                onClick={() => setShowDisconnectDialog(false)}
              >
                <div
                  className="w-full max-w-sm bg-[var(--color-surface-variant)] border border-[var(--color-outline)] rounded-2xl p-5 space-y-4 shadow-2xl"
                  onClick={(e) => e.stopPropagation()}
                >
                  <h4 className="text-base font-bold text-[var(--color-on-surface)]">
                    {t.disconnectDialogTitle}
                  </h4>
                  <p className="text-xs text-[var(--color-on-surface-variant)] leading-relaxed">
                    {t.disconnectDialogMessage}
                  </p>
                  <div className="flex items-center justify-end gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => setShowDisconnectDialog(false)}
                      className="px-4 py-2 text-xs font-semibold text-[var(--color-on-surface-variant)] hover:text-white"
                    >
                      {t.disconnectCancel}
                    </button>
                    <button
                      type="button"
                      onClick={handleConfirmDisconnect}
                      className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs rounded-lg transition-colors cursor-pointer"
                    >
                      {t.disconnectConfirm}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ==================================================== */}
        {/* Bottom "Having trouble?" link on all screens */}
        {/* ==================================================== */}
        <div className="pt-6 pb-2 text-center shrink-0">
          <button
            type="button"
            onClick={() => setShowTroubleshooting(true)}
            className="text-xs text-[var(--color-on-surface-variant)] hover:text-[var(--color-primary)] font-medium underline inline-flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <HelpCircle size={14} />
            <span>{syncStrings.troubleshooting.linkText}</span>
          </button>
        </div>
      </div>

      <SyncTroubleshootingModal
        isOpen={showTroubleshooting}
        onClose={() => setShowTroubleshooting(false)}
        isMobile={true}
      />
    </div>
  );
}
