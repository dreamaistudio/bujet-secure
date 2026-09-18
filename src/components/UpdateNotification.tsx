import { useState, useEffect } from "react";
import { Download, RotateCcw, X, AlertCircle, Settings as SettingsIcon } from "lucide-react";
import { getAppPlatform, NativeAppUpdate, getDistributionFlavor } from "../lib/appUpdater";

export interface AppUpdateEventData {
  status: 'available' | 'downloading' | 'downloaded' | 'failed' | 'permission_required';
  version?: string;
  downloadUrl?: string;
  progress?: number;
  error?: string;
}

export function triggerAppUpdate(data: AppUpdateEventData) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('app-update-event', { detail: data }));
  }
}

export function UpdateNotification() {
  const [show, setShow] = useState(false);
  const [status, setStatus] = useState<'available' | 'downloading' | 'downloaded' | 'failed' | 'permission_required' | null>(null);
  const [version, setVersion] = useState<string>('');
  const [downloadUrl, setDownloadUrl] = useState<string>('');
  const [progress, setProgress] = useState<number>(0);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [isStoreBuild, setIsStoreBuild] = useState<boolean>(false);

  useEffect(() => {
    let unmounted = false;
    let removeListener: (() => void) | null = null;

    getDistributionFlavor().then((flavor) => {
      if (unmounted) return;
      if (flavor === 'store') {
        setIsStoreBuild(true);
        return;
      }

      // Listen for Android native download progress only on direct builds
      if (getAppPlatform() === 'android') {
        NativeAppUpdate.addListener('downloadProgress', (data) => {
          if (data.status === 'downloading') {
            setStatus('downloading');
            setProgress(typeof data.progress === 'number' ? data.progress : 0);
            setShow(true);
          } else if (data.status === 'downloaded') {
            setStatus('downloaded');
            setProgress(100);
            setShow(true);
          } else if (data.status === 'failed') {
            setStatus('failed');
            setErrorMessage(data.error || 'Download failed');
            setShow(true);
          }
        }).then((handle) => {
          removeListener = () => handle.remove();
        }).catch((err) => {
          console.warn('Could not register Android update listener:', err);
        });
      }
    });

    // 1. Listen for custom in-app update events (from direct builds or manual triggers)
    const handleCustomEvent = (e: Event) => {
      const detail = (e as CustomEvent<AppUpdateEventData>).detail;
      if (!detail) return;

      if (detail.status) setStatus(detail.status);
      if (detail.version) setVersion(detail.version);
      if (detail.downloadUrl) setDownloadUrl(detail.downloadUrl);
      if (typeof detail.progress === 'number') setProgress(detail.progress);
      if (detail.error) setErrorMessage(detail.error);
      setShow(true);
    };

    window.addEventListener('app-update-event', handleCustomEvent);

    // 2. Listen for Electron updates
    const api = (window as any).electronAPI;
    if (api?.onUpdateStatus) {
      api.onUpdateStatus((data: any) => {
        if (data.status === 'available') {
          setStatus('available');
          setVersion(data.version || '');
          setShow(true);
        } else if (data.status === 'downloading') {
          setStatus('downloading');
          setProgress(Math.round(data.percent || 0));
          setShow(true);
        } else if (data.status === 'downloaded') {
          setStatus('downloaded');
          setVersion(data.version || '');
          setProgress(100);
          setShow(true);
        } else if (data.status === 'error') {
          setStatus('failed');
          setErrorMessage('Failed to download update.');
          setShow(true);
        }
      });
    }

    // Developer mock test helper
    (window as any).__triggerMockUpdate = (mockStatus: any, mockVersion: string) => {
      setStatus(mockStatus);
      setVersion(mockVersion);
      setProgress(mockStatus === 'downloaded' ? 100 : 45);
      setShow(true);
    };

    return () => {
      unmounted = true;
      window.removeEventListener('app-update-event', handleCustomEvent);
      if (removeListener) removeListener();
      delete (window as any).__triggerMockUpdate;
    };
  }, []);

  const handleDownload = async () => {
    const platform = getAppPlatform();
    if (platform === 'android') {
      if (!downloadUrl) {
        setErrorMessage('Download URL is missing.');
        setStatus('failed');
        return;
      }
      setStatus('downloading');
      setProgress(0);
      try {
        await NativeAppUpdate.startDownload({ url: downloadUrl, version });
      } catch (err: any) {
        console.error('Android startDownload error:', err);
        setErrorMessage(err?.message || 'Failed to start download');
        setStatus('failed');
      }
    } else if (platform === 'electron') {
      setStatus('downloading');
      if ((window as any).electronAPI?.downloadUpdate) {
        await (window as any).electronAPI.downloadUpdate();
      }
    }
  };

  const handleInstall = async () => {
    const platform = getAppPlatform();
    if (platform === 'android') {
      try {
        const res = await NativeAppUpdate.installUpdate();
        if (res?.requiresPermission) {
          setStatus('permission_required');
          return;
        }
        setShow(false);
      } catch (err: any) {
        console.error('Android installUpdate error:', err);
        setErrorMessage(err?.message || 'Failed to launch installer');
        setStatus('failed');
      }
    } else if (platform === 'electron') {
      setShow(false);
      if ((window as any).electronAPI?.restartApp) {
        await (window as any).electronAPI.restartApp();
      }
    }
  };

  const handleOpenPermissionSettings = async () => {
    try {
      await NativeAppUpdate.openInstallPermissionSettings();
      // Keep modal in downloaded state so user can tap install after granting permission
      setStatus('downloaded');
    } catch (err) {
      console.error('Error opening settings:', err);
    }
  };

  if (isStoreBuild || !show || !status) return null;

  return (
    <div 
      className="fixed inset-0 z-[200] flex items-center justify-center bg-[#09090b]/80 backdrop-blur-sm p-4"
      onClick={() => {
        if (status !== 'downloading') setShow(false);
      }}
    >
      <div 
        className="w-full max-w-md bg-[var(--color-surface-variant)] border border-[var(--color-outline)] rounded-lg overflow-hidden shadow-2xl p-6 flex flex-col gap-4 animate-[slideUp_0.2s_ease-out]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-[var(--color-primary)]/10 rounded-lg text-[var(--color-primary)] shrink-0">
              {status === 'available' && <Download size={20} />}
              {status === 'downloading' && <Download size={20} className="animate-bounce" />}
              {status === 'downloaded' && <RotateCcw size={20} />}
              {status === 'failed' && <AlertCircle size={20} className="text-[var(--color-error)]" />}
              {status === 'permission_required' && <SettingsIcon size={20} className="text-amber-400" />}
            </div>
            <div>
              <h3 className="font-bold text-sm text-[var(--color-on-surface)]">
                {status === 'available' && 'Software Update Available'}
                {status === 'downloading' && 'Downloading Update...'}
                {status === 'downloaded' && 'Update Ready to Install'}
                {status === 'failed' && 'Download Failed'}
                {status === 'permission_required' && 'Permission Required'}
              </h3>
            </div>
          </div>
          {status !== 'downloading' && (
            <button 
              onClick={() => setShow(false)} 
              className="text-[var(--color-on-surface-variant)] hover:text-[var(--color-error)] transition-colors p-1"
            >
              <X size={18} />
            </button>
          )}
        </div>

        {/* Content */}
        <div className="text-[13px] text-[var(--color-on-surface-variant)] leading-relaxed">
          {status === 'available' && (
            <span>
              Version <span className="font-mono text-[var(--color-primary)] font-bold">{version}</span> is available. Would you like to download it now?
            </span>
          )}

          {status === 'downloading' && (
            <div className="space-y-3">
              <div className="flex justify-between text-xs font-medium">
                <span>Downloading package...</span>
                <span className="font-mono text-[var(--color-primary)]">{progress}%</span>
              </div>
              <div className="w-full h-2 bg-[var(--color-background)] rounded-full overflow-hidden border border-[var(--color-outline)]">
                <div 
                  className="h-full bg-[var(--color-primary)] transition-all duration-300 rounded-full"
                  style={{ width: `${Math.min(Math.max(progress, 2), 100)}%` }}
                />
              </div>
              <p className="text-[11px] text-[var(--color-on-surface-variant)]">
                Please keep the application open until the download completes.
              </p>
            </div>
          )}

          {status === 'downloaded' && (
            <span>
              Version <span className="font-mono text-[var(--color-primary)] font-bold">{version}</span> has been downloaded successfully. Install the update now?
            </span>
          )}

          {status === 'failed' && (
            <span className="text-[var(--color-error)] font-medium">
              {errorMessage || 'Failed to download the update. Please check your internet connection.'}
            </span>
          )}

          {status === 'permission_required' && (
            <span>
              Android requires permission to install updates from within Budget Secure. Tap <strong>Grant Permission</strong> to enable unknown app installation, then return to install.
            </span>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex justify-end gap-3 pt-2">
          {status !== 'downloading' && (
            <button
              onClick={() => setShow(false)}
              className="px-4 py-2 bg-[var(--color-background)] border border-[var(--color-outline)] text-[var(--color-on-surface)] text-sm rounded hover:bg-[var(--color-outline)] transition-colors font-medium"
            >
              Later
            </button>
          )}

          {status === 'available' && (
            <button
              onClick={handleDownload}
              className="px-4 py-2 bg-[var(--color-primary)] hover:bg-[var(--color-secondary-variant)] text-white text-sm font-medium rounded transition-colors flex items-center justify-center gap-2"
            >
              <Download size={16} />
              Download Now
            </button>
          )}

          {status === 'downloaded' && (
            <button
              onClick={handleInstall}
              className="px-4 py-2 bg-[var(--color-primary)] hover:bg-[var(--color-secondary-variant)] text-white text-sm font-medium rounded transition-colors flex items-center justify-center gap-2"
            >
              <RotateCcw size={16} />
              Install Now
            </button>
          )}

          {status === 'failed' && (
            <button
              onClick={handleDownload}
              className="px-4 py-2 bg-[var(--color-primary)] hover:bg-[var(--color-secondary-variant)] text-white text-sm font-medium rounded transition-colors flex items-center justify-center gap-2"
            >
              <RotateCcw size={16} />
              Retry Download
            </button>
          )}

          {status === 'permission_required' && (
            <button
              onClick={handleOpenPermissionSettings}
              className="px-4 py-2 bg-[var(--color-primary)] hover:bg-[var(--color-secondary-variant)] text-white text-sm font-medium rounded transition-colors flex items-center justify-center gap-2"
            >
              <SettingsIcon size={16} />
              Grant Permission
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
