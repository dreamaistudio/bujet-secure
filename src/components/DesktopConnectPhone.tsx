import { useEffect, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import QRCode from "qrcode";
import { joinPairingCode } from "../lib/syncCrypto";
import { DesktopSyncWizard } from "./DesktopSyncWizard";
import { syncStrings } from "../lib/syncStrings";

/**
 * "Connect to mobile" on the PC's very first screen (before a PIN is set).
 *
 * Shows the same pairing code as Settings -> Connect Your Phone. Once the
 * phone scans it, this PC takes over the phone's PIN, ledger names and data,
 * so there is nothing to set up a second time: the first screen goes away on
 * its own and the app asks for the phone's PIN.
 */
interface DesktopConnectPhoneProps {
  onClose: () => void;
}

type SyncStatusData = {
  connectedClients?: number;
  connectedCount?: number;
  ip: string;
  availableIps?: Array<{ ip: string; name: string }>;
  port: number;
  token: string;
  key?: string;
  relayUrl?: string;
  relay?: { configured?: boolean; phoneSeenAt?: number };
};

export function DesktopConnectPhone({ onClose }: DesktopConnectPhoneProps) {
  const t = syncStrings.desktop;
  const [syncStatusData, setSyncStatusData] = useState<SyncStatusData | null>(null);
  const [selectedIp, setSelectedIp] = useState<string>(() => localStorage.getItem('bs_selected_sync_ip') || '');
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string>('');
  const [firewallStatus, setFirewallStatus] = useState<string | null>(null);
  const [isAllowingFirewall, setIsAllowingFirewall] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [fetchFailed, setFetchFailed] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const generateQrForIp = async (ipToEncode: string, token: string, port = 3001, key?: string, relayUrl?: string) => {
    if (!ipToEncode || ipToEncode === '127.0.0.1' || !token) {
      setQrCodeDataUrl('');
      return;
    }
    try {
      const qrPayload = JSON.stringify({
        v: key ? 2 : 1,
        ip: ipToEncode,
        port,
        token,
        k: key || undefined,
        r: relayUrl || undefined
      });
      setQrCodeDataUrl(await QRCode.toDataURL(qrPayload, { margin: 2, width: 192, color: { dark: '#000000', light: '#ffffff' } }));
    } catch (e) {
      console.error('Failed to generate QR code:', e);
      setQrCodeDataUrl('');
    }
  };

  const effectiveIpFor = (data: SyncStatusData) => {
    const stored = localStorage.getItem('bs_selected_sync_ip');
    if (stored && data.availableIps?.some((a) => a.ip === stored)) return stored;
    if (data.availableIps && data.availableIps.length > 0 && !data.availableIps.some((a) => a.ip === data.ip)) {
      return data.availableIps[0].ip;
    }
    return data.ip;
  };

  const fetchSyncStatus = async (background = false) => {
    if (!background) setIsFetching(true);
    const api = (window as any).electronAPI;
    if (api?.getFirewallStatus) {
      api.getFirewallStatus().then((s: string) => setFirewallStatus(s)).catch(() => {});
    }
    try {
      const res = await fetch('http://localhost:3001/api/sync/status');
      if (!res.ok) throw new Error('status ' + res.status);
      const data: SyncStatusData = await res.json();
      setSyncStatusData(data);
      setFetchFailed(false);
      const ip = effectiveIpFor(data);
      if (ip && ip !== '127.0.0.1' && data.token) {
        await generateQrForIp(ip, data.token, data.port || 3001, data.key, data.relayUrl);
      } else {
        setQrCodeDataUrl('');
      }
    } catch {
      setFetchFailed(true);
    } finally {
      if (!background) setIsFetching(false);
    }
  };

  useEffect(() => {
    fetchSyncStatus(false);
    pollRef.current = setInterval(() => fetchSyncStatus(true), 10000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live count of phones connected over Wi-Fi.
  useEffect(() => {
    const handleClientCount = (e: any) => {
      if (typeof e.detail === 'number') {
        setSyncStatusData((prev) => (prev ? { ...prev, connectedClients: e.detail, connectedCount: e.detail } : prev));
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
      setFirewallStatus(await api.requestFirewallRule());
    } catch (e) {
      console.error('Failed to request firewall rule:', e);
    } finally {
      setIsAllowingFirewall(false);
    }
  };

  // "Disconnect" here makes a new pairing code, the same as in Settings.
  const handleNewCode = async () => {
    try {
      const res = await fetch('http://localhost:3001/api/token/regenerate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${syncStatusData?.token || ''}` }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.token) {
          sessionStorage.setItem('sync_auth_token', data.token);
          window.dispatchEvent(new CustomEvent('auth_token_updated', { detail: data.token }));
        }
      }
    } catch (err) {
      console.error('Failed to make a new pairing code:', err);
    }
    await fetchSyncStatus(false);
  };

  const connectedCount = (syncStatusData?.connectedCount ?? syncStatusData?.connectedClients) || 0;
  const phonePairedAway =
    connectedCount === 0 && Boolean(syncStatusData?.relayUrl) && (syncStatusData?.relay?.phoneSeenAt || 0) > 0;
  const manualPairingCode = syncStatusData?.token ? joinPairingCode(syncStatusData.token, syncStatusData.key || '') : '';
  const shownIp =
    selectedIp && syncStatusData?.availableIps?.some((a) => a.ip === selectedIp) ? selectedIp : syncStatusData?.ip || '';

  return (
    <div className="fixed inset-0 z-[300] bg-[var(--color-background)] flex flex-col overflow-hidden animate-[fadeIn_0.15s_ease-out]">
      <div className="h-14 px-4 border-b border-[var(--color-outline)] bg-[var(--color-surface)] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onClose}
            className="p-2 -ml-2 text-[var(--color-on-surface-variant)] hover:text-[var(--color-on-surface)] rounded-lg cursor-pointer"
            aria-label="Back"
          >
            <ArrowLeft size={20} />
          </button>
          <h2 className="text-base font-bold text-[var(--color-on-surface)] tracking-tight">{t.firstRunConnectTitle}</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-[var(--color-on-surface-variant)] hover:text-[var(--color-on-surface)] font-medium p-2 rounded cursor-pointer"
        >
          Cancel
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto w-full space-y-4">
          <p className="text-xs text-[var(--color-on-surface-variant)] leading-relaxed bg-[var(--color-surface-variant)] border border-[var(--color-outline)] rounded-lg p-4">
            {t.firstRunConnectNote}
          </p>
          {fetchFailed && !syncStatusData ? (
            <p className="text-xs text-[var(--color-error)] text-center bg-[var(--color-error)]/10 border border-[var(--color-error)]/20 py-2 px-3 rounded-lg">
              {t.firstRunConnectNotReady}
            </p>
          ) : (
            <section className="bg-[var(--color-surface-variant)] border border-[var(--color-outline)] rounded-lg p-6">
              <DesktopSyncWizard
                ip={shownIp}
                availableIps={syncStatusData?.availableIps || []}
                selectedIp={selectedIp}
                onSelectIp={handleSelectIp}
                port={syncStatusData?.port || 3001}
                token={manualPairingCode}
                qrCodeDataUrl={qrCodeDataUrl}
                connectedCount={connectedCount}
                phonePairedAway={phonePairedAway}
                phoneSeenAt={syncStatusData?.relay?.phoneSeenAt || null}
                lastSyncedAt={null}
                firewallStatus={firewallStatus}
                isAllowingFirewall={isAllowingFirewall}
                onAllowFirewall={handleAllowFirewall}
                onDisconnectAll={handleNewCode}
                onRefresh={() => fetchSyncStatus(false)}
                isRefreshing={isFetching}
              />
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
