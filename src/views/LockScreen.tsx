import { GripHorizontal, Lock, Terminal, ShieldAlert, AlertTriangle } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { cn } from "../lib/utils";
import { STORAGE_KEYS } from "../data";

interface LockScreenProps {
  onUnlock: () => void;
  authPin: string;
  biometricEnabled?: boolean;
}

const MAX_ATTEMPTS = 3;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

function getLockoutState(): { lockedUntil: number; failedCount: number } {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.lockout);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.lockedUntil > 0 && parsed.lockedUntil <= Date.now()) {
        localStorage.removeItem(STORAGE_KEYS.lockout);
        return { lockedUntil: 0, failedCount: 0 };
      }
      return parsed;
    }
  } catch {
    // ignore
  }
  return { lockedUntil: 0, failedCount: 0 };
}

function setLockoutState(state: { lockedUntil: number; failedCount: number }) {
  localStorage.setItem(STORAGE_KEYS.lockout, JSON.stringify(state));
}

function clearLockoutState() {
  localStorage.removeItem(STORAGE_KEYS.lockout);
}

export function LockScreen({ onUnlock, authPin }: LockScreenProps) {
  const [pin, setPin] = useState("");
  const [errorHighlight, setErrorHighlight] = useState(false);
  const [failedAttempts, setFailedAttempts] = useState(() => getLockoutState().failedCount);
  const [lockedUntil, setLockedUntil] = useState(() => getLockoutState().lockedUntil);
  const [remainingSeconds, setRemainingSeconds] = useState(0);

  const hasSecuritySetup = Boolean(authPin && authPin.length > 0);
  const isLockedOut = lockedUntil > Date.now();

  // Load lockout state on mount and immediately clear if expired
  useEffect(() => {
    const state = getLockoutState();
    if (state.lockedUntil > 0 && state.lockedUntil <= Date.now()) {
      clearLockoutState();
      setFailedAttempts(0);
      setLockedUntil(0);
    } else {
      setFailedAttempts(state.failedCount);
      setLockedUntil(state.lockedUntil);
    }
  }, []);

  // Countdown timer for lockout
  useEffect(() => {
    if (!isLockedOut) {
      setRemainingSeconds(0);
      return;
    }
    const update = () => {
      const diff = Math.max(0, Math.ceil((lockedUntil - Date.now()) / 1000));
      setRemainingSeconds(diff);
      if (diff <= 0) {
        // Lockout expired
        clearLockoutState();
        setFailedAttempts(0);
        setLockedUntil(0);
      }
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [lockedUntil, isLockedOut]);

  const handlePinEntry = useCallback(
    (val: string) => {
      if (isLockedOut) return;

      if (val === "back") {
        setPin((prev) => prev.slice(0, -1));
        setErrorHighlight(false);
      } else if (pin.length < 4) {
        const newPin = pin + val;
        setPin(newPin);
        if (newPin.length === 4) {
          if (newPin === authPin) {
            // Success
            clearLockoutState();
            setTimeout(onUnlock, 200);
          } else {
            // Wrong PIN
            const newFailed = failedAttempts + 1;
            setErrorHighlight(true);

            if (newFailed >= MAX_ATTEMPTS) {
              const until = Date.now() + LOCKOUT_DURATION_MS;
              setLockedUntil(until);
              setFailedAttempts(newFailed);
              setLockoutState({ lockedUntil: until, failedCount: newFailed });
            } else {
              setFailedAttempts(newFailed);
              setLockoutState({ lockedUntil: 0, failedCount: newFailed });
            }

            setTimeout(() => {
              setPin("");
              setErrorHighlight(false);
            }, 600);
          }
        }
      }
    },
    [pin, authPin, failedAttempts, isLockedOut, onUnlock]
  );

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  if (!hasSecuritySetup) {
    return (
      <div className="min-h-screen flex flex-col bg-[var(--color-background)] items-center justify-center relative select-none">
        <div className="w-full max-w-[520px] bg-[var(--color-surface-variant)] border border-[var(--color-outline)] rounded flex flex-col overflow-hidden relative z-10 p-8 text-center shadow-none">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded bg-[var(--color-surface-lowest)] border border-[var(--color-outline)] mx-auto shadow-inner relative mb-6">
            <ShieldAlert className="text-[var(--color-on-surface-variant)]" size={40} />
          </div>
          <h1 className="text-2xl font-bold text-[var(--color-on-surface)] mb-2">No Security Configured</h1>
          <p className="text-sm text-[var(--color-on-surface-variant)] mb-8">
            Please navigate to Settings after signing in to configure a secure unlocking PIN.
          </p>
          <button
            onClick={onUnlock}
            className="w-full h-12 bg-[var(--color-secondary)] text-[var(--color-on-secondary)] text-sm font-bold rounded border border-transparent hover:opacity-80 transition-colors flex items-center justify-center gap-2"
          >
            SIGN IN
          </button>
        </div>
      </div>
    );
  }

  const remainingAttempts = Math.max(0, MAX_ATTEMPTS - failedAttempts);

  return (
    <div className="min-h-screen flex flex-col bg-[var(--color-background)] items-center justify-center relative select-none">
      {/* Decorative Grid background */}
      <div
        className="absolute inset-0 pointer-events-none opacity-20"
        style={{
          backgroundImage: `linear-gradient(to right, var(--color-outline-variant) 1px, transparent 1px), linear-gradient(to bottom, var(--color-outline-variant) 1px, transparent 1px)`,
          backgroundSize: "32px 32px",
        }}
      />

      <div className="w-full max-w-[520px] bg-[var(--color-surface-variant)] border border-[var(--color-outline)] rounded flex flex-col overflow-hidden relative z-10 shadow-none">
        {/* Decorative Top Accent */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-[var(--color-error)]"></div>

        {/* Header */}
        <div className="p-8 border-b border-[var(--color-outline)] text-center space-y-4">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded bg-[var(--color-surface-lowest)] border border-[var(--color-outline)] mx-auto shadow-inner relative">
            <Lock className="text-[var(--color-error)]" size={40} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-[var(--color-on-surface)] mb-1">Vault Secured</h1>
            <p className="text-sm text-[var(--color-on-surface-variant)]">Authenticate to access your ledgers.</p>
          </div>
        </div>

        {/* Lockout Banner */}
        {isLockedOut && (
          <div className="bg-[var(--color-error)]/10 border-b border-[var(--color-error)]/30 p-4 flex items-center gap-3">
            <AlertTriangle className="text-[var(--color-error)] shrink-0" size={20} />
            <div>
              <p className="text-sm font-semibold text-[var(--color-error)]">Account Locked</p>
              <p className="text-xs text-[var(--color-on-surface-variant)] font-mono mt-0.5">
                Too many failed attempts. Try again in {formatTime(remainingSeconds)}
              </p>
            </div>
          </div>
        )}

        {/* Sub-header bar */}
        <div className="flex items-center justify-center gap-2 py-3 text-sm font-medium text-[var(--color-primary)] border-b border-[var(--color-outline)] bg-[var(--color-surface)]">
          <GripHorizontal size={18} />
          <span>PIN Verification</span>
        </div>

        {/* Auth Area */}
        <div className="p-8 bg-[var(--color-surface-variant)] flex flex-col items-center justify-center">
          <div className="flex items-start gap-3 w-full bg-[var(--color-surface-lowest)] border border-[var(--color-outline)] p-4 rounded mb-6">
            <Terminal className="text-[var(--color-on-surface-variant)] shrink-0" size={20} />
            <div>
              <p className="text-xs font-semibold text-[var(--color-on-surface)] uppercase tracking-wider">Terminal Security Active</p>
              <p className="text-xs text-[var(--color-on-surface-variant)] mt-1 font-mono">
                {remainingAttempts} attempt{remainingAttempts !== 1 ? "s" : ""} remaining before 15-minute lockout.
              </p>
            </div>
          </div>

          <div className="flex gap-4 mb-8">
            {[0, 1, 2, 3].map((index) => {
              const val = pin[index];
              return (
                <div
                  key={index}
                  className={cn(
                    "w-16 h-20 bg-[var(--color-surface-lowest)] border rounded flex items-center justify-center text-[var(--color-on-surface)] text-3xl font-mono shadow-inner transition-colors",
                    isLockedOut
                      ? "border-[var(--color-outline)] opacity-50"
                      : errorHighlight
                        ? "border-[var(--color-error)] text-[var(--color-error)]"
                        : val
                          ? "border-[var(--color-secondary)]"
                          : "border-[var(--color-outline)]"
                  )}
                >
                  {val ? "•" : "-"}
                </div>
              );
            })}
          </div>

          {/* Numpad */}
          <div className="grid grid-cols-3 gap-2 w-[240px]">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
              <button
                key={num}
                onClick={() => handlePinEntry(num.toString())}
                disabled={isLockedOut}
                className={cn(
                  "h-12 bg-[var(--color-surface)] border border-[var(--color-outline)] rounded font-mono text-[var(--color-on-surface)] transition-colors",
                  isLockedOut ? "opacity-30 cursor-not-allowed" : "hover:bg-[var(--color-outline-variant)]"
                )}
              >
                {num}
              </button>
            ))}
            <div className="h-12"></div>
            <button
              onClick={() => handlePinEntry("0")}
              disabled={isLockedOut}
              className={cn(
                "h-12 bg-[var(--color-surface)] border border-[var(--color-outline)] rounded font-mono text-[var(--color-on-surface)] transition-colors",
                isLockedOut ? "opacity-30 cursor-not-allowed" : "hover:bg-[var(--color-outline-variant)]"
              )}
            >
              0
            </button>
            <button
              onClick={() => handlePinEntry("back")}
              disabled={isLockedOut}
              className={cn(
                "h-12 bg-[var(--color-surface-lowest)] border border-[var(--color-outline)] rounded text-[var(--color-on-surface-variant)] transition-colors flex items-center justify-center",
                isLockedOut ? "opacity-30 cursor-not-allowed" : "hover:bg-[var(--color-error)] hover:text-white"
              )}
            >
              ⌫
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-[var(--color-surface)] border-t border-[var(--color-outline)] flex justify-between items-center font-mono text-[11px] text-[var(--color-on-surface-variant)]">
          <span>BUDGET SECURE v1.0</span>
          <span className="flex items-center gap-1">
            <span className={cn("w-1.5 h-1.5 rounded-full", isLockedOut ? "bg-[var(--color-error)]" : "bg-[var(--color-secondary)]")}></span>
            {isLockedOut ? "LOCKED" : "SECURE CONNECTION"}
          </span>
        </div>
      </div>
    </div>
  );
}
