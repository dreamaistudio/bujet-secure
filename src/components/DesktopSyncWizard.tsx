import { useState, useMemo } from "react";
import { 
  Wifi, 
  WifiOff, 
  ShieldCheck, 
  ShieldAlert, 
  Smartphone, 
  QrCode, 
  Check, 
  Copy, 
  ChevronDown, 
  ChevronUp, 
  RefreshCw, 
  HelpCircle, 
  Unlink, 
  CheckCircle2, 
  AlertTriangle,
  ArrowRight
} from "lucide-react";
import { syncStrings } from "../lib/syncStrings";
import { SyncTroubleshootingModal } from "./SyncTroubleshootingModal";

interface DesktopSyncWizardProps {
  ip: string;
  availableIps?: Array<{ ip: string; name: string }>;
  selectedIp?: string;
  onSelectIp?: (ip: string) => void;
  port: number;
  token: string;
  qrCodeDataUrl: string;
  connectedCount: number;
  /** A phone is paired but away from this Wi-Fi, reached through the internet post box. */
  phonePairedAway?: boolean;
  /** When a phone last got in touch (shown while it is away). */
  phoneSeenAt?: number | null;
  lastSyncedAt?: number | null;
  firewallStatus: string | null;
  isAllowingFirewall: boolean;
  onAllowFirewall: () => Promise<void>;
  onDisconnectAll: () => Promise<void>;
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

export function DesktopSyncWizard({
  ip,
  availableIps = [],
  selectedIp,
  onSelectIp,
  port,
  token,
  qrCodeDataUrl,
  connectedCount,
  phonePairedAway = false,
  phoneSeenAt = null,
  lastSyncedAt,
  firewallStatus,
  isAllowingFirewall,
  onAllowFirewall,
  onDisconnectAll,
  onRefresh,
  isRefreshing = false,
}: DesktopSyncWizardProps) {
  const t = syncStrings.desktop;

  const [showAddAnother, setShowAddAnother] = useState(false);
  const [showManualDetails, setShowManualDetails] = useState(false);
  const [showTroubleshooting, setShowTroubleshooting] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  // Determine active IP
  const effectiveIp = useMemo(() => {
    if (selectedIp && availableIps.some((a) => a.ip === selectedIp)) {
      return selectedIp;
    }
    return ip || "";
  }, [ip, selectedIp, availableIps]);

  const activeAdapter = useMemo(() => {
    return availableIps.find((a) => a.ip === effectiveIp);
  }, [availableIps, effectiveIp]);

  const networkDisplayName = activeAdapter
    ? `${activeAdapter.name} (${effectiveIp})`
    : effectiveIp;

  const hasLanConnection = Boolean(
    effectiveIp && effectiveIp !== "127.0.0.1" && effectiveIp !== "0.0.0.0"
  );

  // A phone that is connected right now proves the firewall lets it through,
  // even if Windows allowed the app with its own rule instead of ours.
  const isFirewallAllowed = firewallStatus === "ok" || connectedCount > 0;

  const handleCopy = async (field: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch (e) {
      console.error("Failed to copy:", e);
    }
  };

  const handleDisconnect = async () => {
    try {
      setIsDisconnecting(true);
      await onDisconnectAll();
      setConfirmDisconnect(false);
    } catch (e) {
      console.error("Failed to disconnect:", e);
    } finally {
      setIsDisconnecting(false);
    }
  };

  const formatLastSyncTime = (timestamp?: number | null) => {
    if (!timestamp) return t.justNow;
    const diffMs = Date.now() - timestamp;
    if (diffMs < 60000) return t.justNow;
    if (diffMs < 3600000) {
      const mins = Math.floor(diffMs / 60000);
      return `${mins}m ago`;
    }
    return new Date(timestamp).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  // Paired, but the phone is not on this Wi-Fi: it is reached through the
  // internet post box. Shown with the same card as a Wi-Fi connection (same
  // buttons, same place), only the wording says how the two are linked.
  const isAway = connectedCount === 0 && phonePairedAway;

  // A phone is paired but cannot reach this PC directly, and Windows Firewall
  // is the reason. Shown above the paired card, in the same amber style and
  // with the same Allow button as the firewall step of the setup. Only while
  // the firewall needs fixing (and never while a phone is connected over
  // Wi-Fi, which proves the way in is open).
  const showFirewallFix =
    isAway && Boolean(firewallStatus) && firewallStatus !== "ok";

  // Connected state: clean green card
  if ((connectedCount > 0 || isAway) && !showAddAnother) {
    return (
      <div className="space-y-4">
        {showFirewallFix && (
          <div className="p-4 rounded-xl bg-amber-500/10 border-2 border-amber-500/40 shadow-md">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="w-7 h-7 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 flex items-center justify-center shrink-0 mt-0.5">
                  <ShieldAlert size={14} />
                </div>
                <div className="space-y-1">
                  <h5 className="text-sm font-semibold text-amber-200">
                    {t.firewallAwayTitle}
                  </h5>
                  <p className="text-xs text-amber-200/90 leading-relaxed max-w-xl">
                    {t.firewallAwayInstruction}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={onAllowFirewall}
                disabled={isAllowingFirewall}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-black font-bold text-xs rounded-lg transition-colors flex items-center justify-center gap-1.5 shrink-0 shadow disabled:opacity-50 cursor-pointer"
              >
                {isAllowingFirewall ? (
                  <>
                    <RefreshCw size={14} className="animate-spin" />
                    {t.step2Allowing}
                  </>
                ) : (
                  <>
                    <ShieldCheck size={14} />
                    {t.step2Button}
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        <div className="p-6 rounded-2xl bg-emerald-950/40 border-2 border-emerald-500/40 shadow-xl shadow-emerald-950/30 flex flex-col sm:flex-row sm:items-center justify-between gap-6">
          <div className="flex items-start sm:items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shrink-0 shadow-inner">
              <CheckCircle2 size={26} className="animate-pulse" />
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <h4 className="text-base font-bold text-emerald-200">
                  {isAway ? t.awayTitle : t.connectedTitle}
                </h4>
                {!isAway && (
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                    {connectedCount === 1
                      ? t.deviceCountSingle
                      : `${connectedCount} ${t.deviceCountMultiple}`}
                  </span>
                )}
              </div>
              <p className="text-xs text-emerald-200/90 leading-relaxed max-w-md">
                {isAway ? t.awayNotice : t.autoUpdateNotice}
              </p>
              <p className="text-[11px] text-emerald-400/80 font-mono pt-0.5">
                {isAway
                  ? `${t.awayLastHeard}: ${formatLastSyncTime(phoneSeenAt)}`
                  : `${t.lastSynced}: ${formatLastSyncTime(lastSyncedAt)}`}
              </p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 shrink-0">
            {!confirmDisconnect ? (
              <button
                type="button"
                onClick={() => setConfirmDisconnect(true)}
                className="px-4 py-2 rounded-lg bg-zinc-900/80 hover:bg-zinc-800 border border-zinc-700 hover:border-rose-500/50 text-rose-300 text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-sm"
              >
                <Unlink size={14} />
                {t.disconnectButton}
              </button>
            ) : (
              <div className="flex items-center gap-2 p-1.5 bg-black/60 rounded-lg border border-rose-500/40">
                <span className="text-[11px] text-rose-200 px-1 font-medium">
                  Disconnect?
                </span>
                <button
                  type="button"
                  onClick={() => setConfirmDisconnect(false)}
                  className="px-2 py-1 text-xs text-zinc-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDisconnect}
                  disabled={isDisconnecting}
                  className="px-3 py-1 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold rounded transition-colors disabled:opacity-50"
                >
                  {isDisconnecting ? "..." : "Yes"}
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between px-2 pt-1">
          <button
            type="button"
            onClick={() => setShowAddAnother(true)}
            className="text-xs text-[var(--color-primary)] hover:underline font-medium flex items-center gap-1 cursor-pointer"
          >
            <Smartphone size={14} />
            <span>{t.connectAnotherPhone}</span>
          </button>

          <button
            type="button"
            onClick={() => setShowTroubleshooting(true)}
            className="text-xs text-[var(--color-on-surface-variant)] hover:text-[var(--color-on-surface)] flex items-center gap-1 cursor-pointer"
          >
            <HelpCircle size={14} />
            <span>{syncStrings.troubleshooting.linkText}</span>
          </button>
        </div>

        <SyncTroubleshootingModal
          isOpen={showTroubleshooting}
          onClose={() => setShowTroubleshooting(false)}
          isMobile={false}
        />
      </div>
    );
  }

  // Not connected (or "Connect another phone" clicked): Show numbered step-by-step wizard
  return (
    <div className="space-y-4">
      {/* Optional banner when in "Connect another phone" mode */}
      {showAddAnother && (
        <div className="flex items-center justify-between p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-300">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={15} />
            <span>
              {isAway ? (
                t.awayAddAnotherBanner
              ) : (
                <>
                  {connectedCount === 1
                    ? t.deviceCountSingle
                    : `${connectedCount} ${t.deviceCountMultiple}`}{" "}
                  active. Pair an additional device below:
                </>
              )}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setShowAddAnother(false)}
            className="text-emerald-200 hover:underline font-medium ml-2 cursor-pointer"
          >
            {t.backToStatus}
          </button>
        </div>
      )}

      {/* Step 1: Wi-Fi Detection */}
      <div
        className={`p-4 rounded-xl border transition-all ${
          hasLanConnection
            ? "bg-[var(--color-surface)] border-emerald-500/30"
            : "bg-amber-500/10 border-amber-500/40"
        }`}
      >
        <div className="flex items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs shrink-0 ${
                hasLanConnection
                  ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                  : "bg-amber-500/20 text-amber-400 border border-amber-500/40"
              }`}
            >
              {hasLanConnection ? <Check size={14} /> : 1}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-[var(--color-on-surface)]">
                  Step 1
                </span>
                <span className="text-xs text-[var(--color-on-surface-variant)]">•</span>
                <h5 className="text-sm font-semibold text-[var(--color-on-surface)]">
                  {t.step1Title}
                </h5>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                {hasLanConnection ? (
                  <>
                    <span className="text-emerald-300 font-medium">
                      {t.step1PcOn}{" "}
                      <span className="font-mono text-emerald-200">
                        {networkDisplayName}
                      </span>
                    </span>
                    <span className="text-[var(--color-on-surface-variant)]">
                      — {t.step1SameWifiNote}
                    </span>
                  </>
                ) : (
                  <span className="text-amber-200 font-medium">
                    {t.step1Warning}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="shrink-0 flex items-center gap-2">
            {availableIps.length > 1 && onSelectIp && (
              <select
                value={effectiveIp}
                onChange={(e) => onSelectIp(e.target.value)}
                className="bg-[var(--color-surface-variant)] border border-[var(--color-outline)] rounded px-2 py-1 text-xs text-[var(--color-on-surface)] font-mono focus:outline-none focus:border-[var(--color-primary)]"
                title="Select network adapter"
              >
                {availableIps.map((adapter) => (
                  <option key={adapter.ip} value={adapter.ip}>
                    {adapter.name} ({adapter.ip})
                  </option>
                ))}
              </select>
            )}
            {onRefresh && (
              <button
                type="button"
                onClick={onRefresh}
                disabled={isRefreshing}
                className="p-1.5 text-[var(--color-on-surface-variant)] hover:text-white rounded hover:bg-[var(--color-outline)] transition-colors cursor-pointer"
                title="Refresh network status"
              >
                <RefreshCw
                  size={14}
                  className={isRefreshing ? "animate-spin" : ""}
                />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Step 2: Windows Firewall (Hidden once confirmed present/allowed) */}
      {!isFirewallAllowed && (
        <div className="p-4 rounded-xl bg-amber-500/10 border-2 border-amber-500/40 shadow-md">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="w-7 h-7 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">
                2
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-amber-200">
                    Step 2
                  </span>
                  <span className="text-xs text-amber-200/60">•</span>
                  <h5 className="text-sm font-semibold text-amber-200">
                    {t.step2Title}
                  </h5>
                </div>
                <p className="text-xs text-amber-200/90 leading-relaxed max-w-xl">
                  {t.step2Instruction}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onAllowFirewall}
              disabled={isAllowingFirewall}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-black font-bold text-xs rounded-lg transition-colors flex items-center justify-center gap-1.5 shrink-0 shadow disabled:opacity-50 cursor-pointer"
            >
              {isAllowingFirewall ? (
                <>
                  <RefreshCw size={14} className="animate-spin" />
                  {t.step2Allowing}
                </>
              ) : (
                <>
                  <ShieldCheck size={14} />
                  {t.step2Button}
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Open Budget Secure on your phone */}
      <div
        className={`p-4 rounded-xl border transition-all ${
          !hasLanConnection
            ? "opacity-50 pointer-events-none bg-[var(--color-surface)] border-[var(--color-outline)]"
            : "bg-[var(--color-surface)] border-[var(--color-outline)]"
        }`}
      >
        <div className="flex items-start sm:items-center gap-3">
          <div className="w-7 h-7 rounded-full bg-[var(--color-outline)]/40 text-[var(--color-on-surface)] border border-[var(--color-outline)] flex items-center justify-center font-bold text-xs shrink-0">
            {isFirewallAllowed ? 2 : 3}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-[var(--color-on-surface-variant)]">
                Step {isFirewallAllowed ? 2 : 3}
              </span>
              <span className="text-xs text-[var(--color-on-surface-variant)]">•</span>
              <h5 className="text-sm font-semibold text-[var(--color-on-surface)]">
                {t.step3Title}
              </h5>
            </div>
            <p className="text-xs text-[var(--color-on-surface-variant)] mt-1">
              {t.step3Instruction}
            </p>
          </div>
        </div>
      </div>

      {/* Step 4: Phone navigation taps */}
      <div
        className={`p-4 rounded-xl border transition-all ${
          !hasLanConnection
            ? "opacity-50 pointer-events-none bg-[var(--color-surface)] border-[var(--color-outline)]"
            : "bg-[var(--color-surface)] border-[var(--color-outline)]"
        }`}
      >
        <div className="flex items-start sm:items-center gap-3">
          <div className="w-7 h-7 rounded-full bg-[var(--color-outline)]/40 text-[var(--color-on-surface)] border border-[var(--color-outline)] flex items-center justify-center font-bold text-xs shrink-0">
            {isFirewallAllowed ? 3 : 4}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-[var(--color-on-surface-variant)]">
                Step {isFirewallAllowed ? 3 : 4}
              </span>
              <span className="text-xs text-[var(--color-on-surface-variant)]">•</span>
              <h5 className="text-sm font-semibold text-[var(--color-on-surface)]">
                {t.step4Title}
              </h5>
            </div>
            <p className="text-xs text-[var(--color-on-surface-variant)] mt-1">
              {t.step4Instruction}
            </p>
          </div>
        </div>
      </div>

      {/* Step 5: Point camera at QR code */}
      <div
        className={`p-6 rounded-2xl border transition-all ${
          !hasLanConnection
            ? "opacity-50 pointer-events-none bg-[var(--color-surface)] border-[var(--color-outline)]"
            : "bg-[var(--color-surface)] border-emerald-500/30 shadow-lg"
        }`}
      >
        <div className="flex items-center gap-3 mb-5">
          <div className="w-7 h-7 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 flex items-center justify-center font-bold text-xs shrink-0">
            {isFirewallAllowed ? 4 : 5}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-[var(--color-primary)]">
                Step {isFirewallAllowed ? 4 : 5}
              </span>
              <span className="text-xs text-[var(--color-on-surface-variant)]">•</span>
              <h5 className="text-base font-bold text-[var(--color-on-surface)]">
                {t.step5Title}
              </h5>
            </div>
          </div>
        </div>

        {/* QR Code and Instructions Layout */}
        <div className="flex flex-col md:flex-row items-center md:items-start gap-8">
          {/* QR Code Card */}
          <div className="flex flex-col items-center shrink-0">
            <div className="p-4 bg-white rounded-2xl shadow-2xl border-4 border-zinc-200 flex flex-col items-center">
              {qrCodeDataUrl ? (
                <img
                  src={qrCodeDataUrl}
                  alt="Pairing QR Code"
                  className="w-52 h-52 block rounded-lg select-none"
                />
              ) : (
                <div className="w-52 h-52 flex flex-col items-center justify-center text-xs text-zinc-500 gap-2">
                  <RefreshCw className="animate-spin text-zinc-400" size={20} />
                  <span>Preparing code...</span>
                </div>
              )}
            </div>
            <p className="text-xs text-[var(--color-on-surface-variant)] mt-3 font-medium text-center">
              {t.step5Distance}
            </p>
          </div>

          {/* Right side helper / Collapsible Manual Details */}
          <div className="flex-1 w-full space-y-4">
            <div className="p-4 rounded-xl bg-[var(--color-background)]/80 border border-[var(--color-outline)] space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-[var(--color-on-surface)]">
                <CheckCircle2 size={16} className="text-emerald-400" />
                <span>Ready to pair</span>
              </div>
              <p className="text-xs text-[var(--color-on-surface-variant)] leading-relaxed">
                Hold your phone camera steady facing this QR code. Once read, your phone will connect and sync automatically.
              </p>
            </div>

            {/* Collapsible "Can't scan the code?" */}
            <div className="border border-[var(--color-outline)] rounded-xl overflow-hidden bg-[var(--color-background)]">
              <button
                type="button"
                onClick={() => setShowManualDetails(!showManualDetails)}
                className="w-full px-4 py-3 flex items-center justify-between text-left text-xs font-semibold text-[var(--color-on-surface)] hover:bg-[var(--color-surface-variant)]/60 transition-colors cursor-pointer"
              >
                <span className="text-[var(--color-primary)] hover:underline">
                  {t.step5CantScan}
                </span>
                {showManualDetails ? (
                  <ChevronUp size={16} className="text-[var(--color-on-surface-variant)]" />
                ) : (
                  <ChevronDown size={16} className="text-[var(--color-on-surface-variant)]" />
                )}
              </button>

              {showManualDetails && (
                <div className="p-4 pt-2 border-t border-[var(--color-outline)]/40 space-y-3.5 text-xs bg-[var(--color-surface-variant)]/40">
                  <p className="text-xs text-[var(--color-on-surface-variant)] font-medium">
                    {t.step5ManualHeading}
                  </p>

                  {/* IP Address Field */}
                  <div className="flex items-center justify-between gap-2 p-2.5 bg-[var(--color-surface)] border border-[var(--color-outline)] rounded-lg">
                    <div className="min-w-0">
                      <span className="text-[10px] uppercase font-bold text-[var(--color-on-surface-variant)] block">
                        {t.step5IpLabel}
                      </span>
                      <span className="font-mono text-sm font-semibold text-[var(--color-on-surface)] select-all truncate block">
                        {effectiveIp}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleCopy("ip", effectiveIp)}
                      className="px-2.5 py-1.5 rounded bg-[var(--color-surface-variant)] hover:bg-[var(--color-outline)] text-[var(--color-on-surface)] border border-[var(--color-outline)] text-xs font-medium flex items-center gap-1 shrink-0 cursor-pointer transition-colors"
                    >
                      {copiedField === "ip" ? (
                        <>
                          <Check size={12} className="text-emerald-400" />
                          <span className="text-emerald-400">{t.copied}</span>
                        </>
                      ) : (
                        <>
                          <Copy size={12} />
                          <span>{t.copy}</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* Port Field */}
                  <div className="flex items-center justify-between gap-2 p-2.5 bg-[var(--color-surface)] border border-[var(--color-outline)] rounded-lg">
                    <div className="min-w-0">
                      <span className="text-[10px] uppercase font-bold text-[var(--color-on-surface-variant)] block">
                        {t.step5PortLabel}
                      </span>
                      <span className="font-mono text-sm font-semibold text-[var(--color-on-surface)] select-all truncate block">
                        {port || 3001}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleCopy("port", String(port || 3001))}
                      className="px-2.5 py-1.5 rounded bg-[var(--color-surface-variant)] hover:bg-[var(--color-outline)] text-[var(--color-on-surface)] border border-[var(--color-outline)] text-xs font-medium flex items-center gap-1 shrink-0 cursor-pointer transition-colors"
                    >
                      {copiedField === "port" ? (
                        <>
                          <Check size={12} className="text-emerald-400" />
                          <span className="text-emerald-400">{t.copied}</span>
                        </>
                      ) : (
                        <>
                          <Copy size={12} />
                          <span>{t.copy}</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* Code Field */}
                  <div className="flex items-center justify-between gap-2 p-2.5 bg-[var(--color-surface)] border border-[var(--color-outline)] rounded-lg">
                    <div className="min-w-0 flex-1">
                      <span className="text-[10px] uppercase font-bold text-[var(--color-on-surface-variant)] block">
                        {t.step5CodeLabel}
                      </span>
                      <span className="font-mono text-xs font-semibold text-[var(--color-on-surface)] select-all break-all block">
                        {token}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleCopy("code", token)}
                      className="px-2.5 py-1.5 rounded bg-[var(--color-surface-variant)] hover:bg-[var(--color-outline)] text-[var(--color-on-surface)] border border-[var(--color-outline)] text-xs font-medium flex items-center gap-1 shrink-0 cursor-pointer transition-colors"
                    >
                      {copiedField === "code" ? (
                        <>
                          <Check size={12} className="text-emerald-400" />
                          <span className="text-emerald-400">{t.copied}</span>
                        </>
                      ) : (
                        <>
                          <Copy size={12} />
                          <span>{t.copy}</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Footer "Having trouble?" link */}
      <div className="flex items-center justify-between pt-2 px-1">
        <button
          type="button"
          onClick={() => setShowTroubleshooting(true)}
          className="text-xs text-[var(--color-on-surface-variant)] hover:text-[var(--color-primary)] flex items-center gap-1.5 transition-colors cursor-pointer"
        >
          <HelpCircle size={15} />
          <span className="underline">{syncStrings.troubleshooting.linkText}</span>
        </button>
      </div>

      <SyncTroubleshootingModal
        isOpen={showTroubleshooting}
        onClose={() => setShowTroubleshooting(false)}
        isMobile={false}
      />
    </div>
  );
}
