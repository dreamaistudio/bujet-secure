import { Globe, Save, ShieldCheck, ShieldAlert, Building2, Check, Trash2, Eye, EyeOff, Copy } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { getCurrentAppVersion, getAppPlatform, checkAndroidUpdate } from "../lib/appUpdater";
import { triggerAppUpdate } from "../components/UpdateNotification";

interface SettingsProps {
  authPin: string;
  biometricEnabled: boolean;
  currency: string;
  lockTimer: string;
  businessLedgerName: string;
  personalLedgerName: string;
  onSave: (settings: {
    authPin: string;
    biometricEnabled: boolean;
    currency: string;
    lockTimer: string;
    businessLedgerName: string;
    personalLedgerName: string;
  }) => void;
  onStartFresh: () => void;
  
  // Desktop app props
  autoStart?: boolean;
  onToggleAutoStart?: (val: boolean) => void;
}

export function Settings({
  authPin,
  biometricEnabled,
  currency,
  lockTimer,
  businessLedgerName,
  personalLedgerName,
  onSave,
  onStartFresh,
  autoStart,
  onToggleAutoStart,
}: SettingsProps) {
  // Draft state for form
  const [draftPin, setDraftPin] = useState(authPin);
  const [draftBio, setDraftBio] = useState(biometricEnabled);
  const [draftCurrency, setDraftCurrency] = useState(currency);
  const [draftLockTimer, setDraftLockTimer] = useState(lockTimer);
  const [draftBusinessLedgerName, setDraftBusinessLedgerName] = useState(businessLedgerName);
  const [draftPersonalLedgerName, setDraftPersonalLedgerName] = useState(personalLedgerName);
  const [saved, setSaved] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [appVersion, setAppVersion] = useState("Loading...");
  const [updateStatus, setUpdateStatus] = useState<string>('');
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    getCurrentAppVersion()
      .then((ver) => {
        setAppVersion(`Version ${ver}`);
      })
      .catch(() => {
        setAppVersion("Version 1.0");
      });
  }, []);

  useEffect(() => {
    const api = (window as any).electronAPI;
    if (api?.onUpdateStatus) {
      api.onUpdateStatus((data: any) => {
        if (data.status === 'not-available') {
          setUpdateStatus('You are on the latest version!');
          setChecking(false);
        } else if (data.status === 'downloading') {
          setUpdateStatus(`Downloading update: ${Math.round(data.percent || 0)}%`);
        } else if (data.status === 'downloaded') {
          setUpdateStatus(`Version ${data.version} downloaded! Restart the app to install.`);
          setChecking(false);
        } else if (data.status === 'error') {
          setUpdateStatus('Update check failed. Try again later.');
          setChecking(false);
        }
      });
    }
  }, []);

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
          setUpdateStatus(`You are on the latest version (${result.currentVersion})!`);
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
    setDraftPin(authPin);
    setDraftBio(biometricEnabled);
    setDraftCurrency(currency);
    setDraftLockTimer(lockTimer);
    setDraftBusinessLedgerName(businessLedgerName);
    setDraftPersonalLedgerName(personalLedgerName);
  }, [authPin, biometricEnabled, currency, lockTimer, businessLedgerName, personalLedgerName]);

  const pinError = draftPin.length > 0 && draftPin.length < 4 ? "PIN must be exactly 4 digits." : "";
  const bLedgerError = draftBusinessLedgerName.trim().length === 0 ? "Business ledger name cannot be empty." : "";
  const pLedgerError = draftPersonalLedgerName.trim().length === 0 ? "Personal ledger name cannot be empty." : "";
  const canSave = !pinError && !bLedgerError && !pLedgerError;

  const handleDiscard = useCallback(() => {
    setDraftPin(authPin);
    setDraftBio(biometricEnabled);
    setDraftCurrency(currency);
    setDraftLockTimer(lockTimer);
    setDraftBusinessLedgerName(businessLedgerName);
    setDraftPersonalLedgerName(personalLedgerName);
    setSaved(false);
  }, [authPin, biometricEnabled, currency, lockTimer, businessLedgerName, personalLedgerName]);

  const handleSave = () => {
    if (!canSave) return;
    onSave({
      authPin: draftPin,
      biometricEnabled: draftBio,
      currency: draftCurrency,
      lockTimer: draftLockTimer,
      businessLedgerName: draftBusinessLedgerName.trim(),
      personalLedgerName: draftPersonalLedgerName.trim(),
    });
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
                  <p className="text-[11px] text-[var(--color-secondary)] mt-1.5 font-medium leading-normal animate-pulse">
                    * Saving will automatically convert your ledger balances (1 USD = 300 LKR).
                  </p>
                )}
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
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
              <div>
                <h4 className="font-semibold text-base text-[var(--color-on-surface)]">App PIN Code</h4>
                <p className="text-[13px] text-[var(--color-on-surface-variant)] mt-1 max-w-sm">Set a 4-digit PIN to secure your ledger. Leave empty to disable PIN lock.</p>
              </div>
              <div className="w-full sm:w-64">
                <input
                  type="password"
                  maxLength={4}
                  value={draftPin}
                  onChange={(e) => setDraftPin(e.target.value.replace(/\D/g, ""))}
                  placeholder="e.g. 1234"
                  className="w-full bg-[var(--color-background)] border border-[var(--color-outline)] text-[var(--color-on-surface)] font-mono tracking-widest text-[13px] rounded px-3 py-2 outline-none focus:border-[var(--color-primary)]"
                />
                {pinError && <p className="text-[var(--color-error)] text-xs mt-1">{pinError}</p>}
              </div>
            </div>
            <div className="h-px bg-[var(--color-outline)]/50 w-full"></div>
            <div className="flex items-start justify-between gap-4">
              <div>
                <label className="font-semibold text-base text-[var(--color-on-surface)] cursor-pointer">Biometric Authentication</label>
                <p className="text-[13px] text-[var(--color-on-surface-variant)] mt-1">Enable fingerprint/face ID as a secure and fast unlock method.</p>
              </div>
              <div className="pt-1">
                <button
                  onClick={() => setDraftBio(!draftBio)}
                  className={`w-10 h-5 rounded-full relative transition-colors ${draftBio ? "bg-[var(--color-primary)]" : "bg-[var(--color-outline)]"}`}
                >
                  <div className={`absolute top-0.5 bottom-0.5 w-4 bg-white rounded-full transition-all ${draftBio ? "left-[22px]" : "left-[2px]"}`}></div>
                </button>
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
        {onToggleAutoStart && (
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
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h4 className="font-semibold text-base text-[var(--color-on-surface)]">Local Data Encryption Key</h4>
                <p className="text-[13px] text-[var(--color-on-surface-variant)]">Rotate or export your master encryption key.</p>
              </div>
              <div className="flex gap-2">
                <button className="px-4 py-2 bg-[var(--color-background)] border border-[var(--color-outline)] text-[var(--color-on-surface)] text-sm rounded hover:bg-[var(--color-outline)] transition-colors">Export Key</button>
                <button className="px-4 py-2 bg-[var(--color-error)]/10 border border-[var(--color-error)]/30 text-[var(--color-error)] text-sm rounded hover:bg-[var(--color-error)]/20 transition-colors">Rotate Key</button>
              </div>
            </div>

            <div className="h-px bg-[var(--color-outline)]/50 w-full"></div>

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

            <div className="h-px bg-[var(--color-outline)]/50 w-full"></div>

            <div className="text-[13px] text-[var(--color-on-surface-variant)] leading-relaxed">
              To get the latest version with new features and bug fixes, download the newest installer from Thisara and simply run it - your data will NOT be lost. The installer automatically updates the app without needing to uninstall first.
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
