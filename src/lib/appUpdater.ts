import { Capacitor, registerPlugin } from '@capacitor/core';
import { App } from '@capacitor/app';

export type AppPlatform = 'electron' | 'android' | 'web';

export interface UpdateCheckResult {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion?: string;
  downloadUrl?: string;
  releaseNotes?: string;
}

export interface DownloadProgressEvent {
  status: 'downloading' | 'downloaded' | 'failed';
  progress?: number;
  bytesDownloaded?: number;
  totalBytes?: number;
  error?: string;
}

interface AppUpdatePluginInterface {
  startDownload(options: { url: string; version?: string }): Promise<{ downloadId: number; status: string }>;
  canRequestPackageInstalls(): Promise<{ canInstall: boolean }>;
  openInstallPermissionSettings(): Promise<void>;
  installUpdate(): Promise<{ launched?: boolean; requiresPermission?: boolean }>;
  addListener(
    eventName: 'downloadProgress',
    listenerFunc: (data: DownloadProgressEvent) => void
  ): Promise<{ remove: () => Promise<void> }>;
}

export const NativeAppUpdate = registerPlugin<AppUpdatePluginInterface>('AppUpdatePlugin');

export function getAppPlatform(): AppPlatform {
  if (typeof window !== 'undefined' && (window as any).electronAPI) {
    return 'electron';
  }
  if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
    return 'android';
  }
  return 'web';
}

/**
 * Compares two semantic version strings numerically.
 * Handles prefixes (e.g. "android-v1.0.1", "v1.0.1") and different segment counts ("1.0.1" vs "1.0").
 * Returns:
 *   1 if v1 > v2 (v1 is newer)
 *  -1 if v1 < v2 (v1 is older)
 *   0 if v1 == v2
 */
export function compareSemver(v1: string, v2: string): number {
  const clean1 = (v1 || '').replace(/^(android-)?v/i, '').trim();
  const clean2 = (v2 || '').replace(/^(android-)?v/i, '').trim();

  const parts1 = clean1.split('.').map((p) => parseInt(p, 10) || 0);
  const parts2 = clean2.split('.').map((p) => parseInt(p, 10) || 0);

  const maxLen = Math.max(parts1.length, parts2.length);
  for (let i = 0; i < maxLen; i++) {
    const num1 = parts1[i] ?? 0;
    const num2 = parts2[i] ?? 0;
    if (num1 > num2) return 1;
    if (num1 < num2) return -1;
  }
  return 0;
}

export function isNewerVersion(remoteVersion: string, currentVersion: string): boolean {
  return compareSemver(remoteVersion, currentVersion) > 0;
}

export async function getCurrentAppVersion(): Promise<string> {
  const platform = getAppPlatform();
  if (platform === 'electron') {
    try {
      const ver = await (window as any).electronAPI.getAppVersion();
      return ver || '1.0.0';
    } catch {
      return '1.0.0';
    }
  }

  if (platform === 'android') {
    try {
      const info = await App.getInfo();
      return info.version || '1.0';
    } catch {
      return '1.0';
    }
  }

  return 'Web Preview';
}

export async function checkAndroidUpdate(): Promise<UpdateCheckResult> {
  const currentVersion = await getCurrentAppVersion();

  try {
    const response = await fetch(
      'https://api.github.com/repos/dreamaistudio/bujet-secure/releases?per_page=20',
      {
        headers: {
          Accept: 'application/vnd.github.v3+json',
        },
      }
    );

    if (!response.ok) {
      throw new Error(`GitHub API returned status ${response.status}`);
    }

    const releases: any[] = await response.json();

    // Filter releases targeting Android tags and not drafts
    const androidReleases = releases.filter(
      (r) => typeof r.tag_name === 'string' && r.tag_name.toLowerCase().startsWith('android-v') && !r.draft
    );

    if (androidReleases.length === 0) {
      return { hasUpdate: false, currentVersion };
    }

    // Sort descending by semver
    androidReleases.sort((a, b) => compareSemver(b.tag_name, a.tag_name));
    const latestRelease = androidReleases[0];
    const latestTag = latestRelease.tag_name;
    const latestVer = latestTag.replace(/^android-v/i, '');

    if (!isNewerVersion(latestTag, currentVersion)) {
      return { hasUpdate: false, currentVersion, latestVersion: latestVer };
    }

    // Locate the .apk asset
    const apkAsset = latestRelease.assets?.find(
      (asset: any) => typeof asset.name === 'string' && asset.name.endsWith('.apk')
    );

    if (!apkAsset || !apkAsset.browser_download_url) {
      return { hasUpdate: false, currentVersion, latestVersion: latestVer };
    }

    return {
      hasUpdate: true,
      currentVersion,
      latestVersion: latestVer,
      downloadUrl: apkAsset.browser_download_url,
      releaseNotes: latestRelease.body || '',
    };
  } catch (error) {
    console.error('Failed to check Android updates:', error);
    throw error;
  }
}
