import { Fingerprint, GripHorizontal, Lock, Terminal, ShieldAlert, AlertTriangle } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { cn } from "../lib/utils";
import { STORAGE_KEYS } from "../data";

interface LockScreenProps {
  onUnlock: () => void;
  authPin: string;
  biometricEnabled: boolean;
}

const MAX_ATTEMPTS = 3;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

function getLockoutState(): { lockedUntil: number; failedCount: number } {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.lockout);
    if (raw) return JSON.parse(raw);
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

export function LockScreen({ onUnlock, authPin, biometricEnabled }: LockScreenProps) {
  const [pin, setPin] = useState("");
  const [tab, setTab] = useState<"pin" | "bio">(authPin ? "pin" : "bio");
  const [errorHighlight, setErrorHighlight] = useState(false);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState(0);
  const [remainingSeconds, setRemainingSeconds] = useState(0);

  const hasSecuritySetup = authPin.length > 0 || biometricEnabled;
  const isLockedOut = lockedUntil > Date.now();

  // Load lockout state on mount
  useEffect(() => {
    const state = getLockoutState();
    setFailedAttempts(state.failedCount);
    setLockedUntil(state.lockedUntil);
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
            Please navigate to Settings after signing in to configure a secure unlocking method (PIN or Biometric).
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

        {/* Tabs */}
        <div className="flex border-b border-[var(--color-outline)] bg-[var(--color-surface)]">
          <button
            onClick={() => authPin && setTab("pin")}
            className={cn(
              "flex-1 py-3 text-sm flex items-center justify-center gap-2 font-medium transition-colors",
              tab === "pin"
                ? "text-[var(--color-primary)] border-b-2 border-[var(--color-primary)] bg-[var(--color-surface-variant)] cursor-default"
                : "text-[var(--color-on-surface-variant)] hover:bg-[var(--color-outline)] opacity-50"
            )}
            disabled={!authPin}
          >
            <GripHorizontal size={18} /> PIN Entry {!authPin && "(Not Set)"}
          </button>
          <button
            onClick={() => biometricEnabled && !isLockedOut && setTab("bio")}
            className={cn(
              "flex-1 py-3 text-sm flex items-center justify-center gap-2 font-medium transition-colors",
              tab === "bio"
                ? "text-[var(--color-primary)] border-b-2 border-[var(--color-primary)] bg-[var(--color-surface-variant)] cursor-default"
                : "text-[var(--color-on-surface-variant)] hover:bg-[var(--color-outline)] opacity-50",
              isLockedOut && "opacity-30 cursor-not-allowed"
            )}
            disabled={!biometricEnabled || isLockedOut}
          >
            <Fingerprint size={18} /> Biometrics {!biometricEnabled && "(Not Set)"}
          </button>
        </div>

        {/* Auth Area */}
        {tab === "pin" && (
          <div className="p-8 bg-[var(--color-surface-variant)] flex flex-col items-center justify-center">
            <div className="flex items-start gap-3 w-full bg-[var(--color-surface-lowest)] border border-[var(--color-outline)] p-4 rounded mb-6">
              <Terminal className="text-[var(--color-on-surface-variant)] shrink-0" size={20} />
              <div>
                <p className="text-xs font-semibold text-[var(--color-on-surface)] uppercase tracking-wider">Terminal Security Active</p>
                <p className="text-xs text-[var(--color-on-surface-variant)] mt-1 font-mono">
                  {MAX_ATTEMPTS - failedAttempts} attempt{MAX_ATTEMPTS - failedAttempts !== 1 ? "s" : ""} remaining before 15-minute lockout.
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
        )}

        {tab === "bio" && (
          <div className="p-8 bg-[var(--color-surface-variant)] flex flex-col items-center justify-center text-center h-[380px]">
            <Fingerprint size={64} className="text-[var(--color-on-surface-variant)] mb-6" />
            <p className="text-[var(--color-on-surface)] font-medium mb-8">Scan to authenticate</p>

            <div className="w-full max-w-[320px]">
              <button
                disabled={isLockedOut}
                onClick={() => {
                  if (isLockedOut) return;
                  clearLockoutState();
                  onUnlock();
                }}
                className={cn(
                  "w-full h-12 text-sm font-bold rounded border border-transparent transition-colors flex items-center justify-center gap-2",
                  isLockedOut
                    ? "bg-[var(--color-outline)] text-[var(--color-on-surface-variant)] opacity-50 cursor-not-allowed"
                    : "bg-[var(--color-secondary)] text-[var(--color-on-secondary)] hover:opacity-80"
                )}
              >
                SIMULATE SCAN SUCCESS
              </button>
            </div>
          </div>
        )}

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
