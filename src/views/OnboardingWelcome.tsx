import { useState, FormEvent } from "react";
import { Lock, ShieldCheck, ArrowRight, Laptop, Smartphone } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { MobileSyncFlow } from "../components/MobileSyncFlow";
import { DesktopConnectPhone } from "../components/DesktopConnectPhone";
import { syncStrings } from "../lib/syncStrings";

interface OnboardingWelcomeProps {
  onSetPin: (pin: string) => void;
  onPairSync?: (creds: { host: string; port: number; token: string; key?: string; relayUrl?: string }) => Promise<void>;
  syncStatus?: 'disconnected' | 'connecting' | 'connected' | 'syncing' | 'error';
  syncCredentials?: { host: string; port: number; token: string; key?: string; relayUrl?: string } | null;
  onDisconnectSync?: () => void;
}

export function OnboardingWelcome({
  onSetPin,
  onPairSync,
  syncStatus = 'disconnected',
  syncCredentials = null,
  onDisconnectSync,
}: OnboardingWelcomeProps) {
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState("");
  const [showMobileSync, setShowMobileSync] = useState(false);
  const [showDesktopConnect, setShowDesktopConnect] = useState(false);
  // The Windows app (the phone app is the native one).
  const isDesktopApp = !Capacitor.isNativePlatform() && typeof window !== 'undefined' && Boolean((window as any).electronAPI);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError("");

    if (pin.length !== 4 || !/^\d{4}$/.test(pin)) {
      setError("PIN must be exactly 4 numeric digits.");
      return;
    }

    if (pin !== confirmPin) {
      setError("PIN and confirmation do not match.");
      return;
    }

    onSetPin(pin);
  };

  return (
    <div className="min-h-screen flex flex-col bg-[var(--color-background)] items-center justify-center relative select-none p-4">
      {/* Background radial gradient accent */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,var(--color-primary-variant)_0%,transparent_70%)] opacity-20 pointer-events-none" />

      <div className="w-full max-w-[460px] bg-[var(--color-surface-variant)] border border-[var(--color-outline)] rounded-2xl flex flex-col overflow-hidden relative z-10 p-8 shadow-2xl backdrop-blur-sm">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-[var(--color-primary)]/10 border border-[var(--color-primary)]/30 mx-auto mb-5 text-[var(--color-primary)] shadow-inner">
          <ShieldCheck size={34} />
        </div>

        <h1 className="text-2xl font-bold text-[var(--color-on-surface)] text-center tracking-tight mb-2">
          Welcome to Budget Secure
        </h1>
        <p className="text-xs text-[var(--color-on-surface-variant)] text-center leading-relaxed mb-6">
          Set a 4-digit PIN to protect your personal and business financial vaults.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-[10px] font-bold tracking-wider text-[var(--color-on-surface-variant)] uppercase block mb-1.5">
              Enter 4-Digit PIN
            </label>
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={pin}
              onChange={(e) => {
                setPin(e.target.value.replace(/\D/g, ""));
                setError("");
              }}
              className="w-full bg-[var(--color-surface)] border border-[var(--color-outline)] text-[var(--color-on-surface)] text-center font-mono tracking-[0.5em] text-xl rounded-xl px-4 py-3 outline-none focus:border-[var(--color-primary)] transition-colors"
              autoFocus
            />
          </div>

          <div>
            <label className="text-[10px] font-bold tracking-wider text-[var(--color-on-surface-variant)] uppercase block mb-1.5">
              Confirm 4-Digit PIN
            </label>
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={confirmPin}
              onChange={(e) => {
                setConfirmPin(e.target.value.replace(/\D/g, ""));
                setError("");
              }}
              className="w-full bg-[var(--color-surface)] border border-[var(--color-outline)] text-[var(--color-on-surface)] text-center font-mono tracking-[0.5em] text-xl rounded-xl px-4 py-3 outline-none focus:border-[var(--color-primary)] transition-colors"
            />
          </div>

          {error && (
            <p className="text-[var(--color-error)] text-xs text-center font-medium bg-[var(--color-error)]/10 border border-[var(--color-error)]/20 py-2 px-3 rounded-lg">
              {error}
            </p>
          )}

          <button
            type="submit"
            className="w-full h-12 bg-[var(--color-secondary)] text-[var(--color-on-secondary)] text-xs font-bold uppercase tracking-wider rounded-xl hover:opacity-95 active:scale-[0.99] transition-all flex items-center justify-center gap-2 cursor-pointer mt-4 shadow-lg shadow-[var(--color-secondary)]/20"
          >
            <span>Set PIN & Get Started</span>
            <ArrowRight size={16} />
          </button>
        </form>

        {/* First run mobile pairing option */}
        {Capacitor.isNativePlatform() && onPairSync && (
          <div className="mt-6 pt-5 border-t border-[var(--color-outline)]/60 text-center">
            <p className="text-xs text-[var(--color-on-surface-variant)] mb-3">
              Already using Budget Secure on your computer?
            </p>
            <button
              type="button"
              onClick={() => setShowMobileSync(true)}
              className="w-full py-2.5 bg-[var(--color-surface)] border border-[var(--color-outline)] hover:border-[var(--color-primary)] text-[var(--color-on-surface)] text-xs font-semibold rounded-xl transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-sm"
            >
              <Laptop size={15} className="text-[var(--color-primary)]" />
              <span>{syncStrings.mobile.entryLabel}</span>
            </button>
          </div>
        )}

        {/* First run on the PC: take the phone's setup instead of a new one */}
        {isDesktopApp && (
          <div className="mt-6 pt-5 border-t border-[var(--color-outline)]/60 text-center">
            <p className="text-xs text-[var(--color-on-surface-variant)] mb-3">
              {syncStrings.desktop.firstRunEntryQuestion}
            </p>
            <button
              type="button"
              onClick={() => setShowDesktopConnect(true)}
              className="w-full py-2.5 bg-[var(--color-surface)] border border-[var(--color-outline)] hover:border-[var(--color-primary)] text-[var(--color-on-surface)] text-xs font-semibold rounded-xl transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-sm"
            >
              <Smartphone size={15} className="text-[var(--color-primary)]" />
              <span>{syncStrings.desktop.firstRunEntryLabel}</span>
            </button>
          </div>
        )}
      </div>

      <div className="mt-6 flex items-center gap-2 text-xs text-[var(--color-on-surface-variant)]/60">
        <Lock size={12} />
        <span>Your data is stored locally on your device</span>
      </div>

      {showMobileSync && (
        <MobileSyncFlow
          isOpen={showMobileSync}
          onClose={() => setShowMobileSync(false)}
          syncStatus={syncStatus}
          syncCredentials={syncCredentials}
          onPairSync={onPairSync || (async () => {})}
          onDisconnectSync={onDisconnectSync || (() => {})}
        />
      )}

      {showDesktopConnect && <DesktopConnectPhone onClose={() => setShowDesktopConnect(false)} />}
    </div>
  );
}

