interface ElectronAPI {
  getAppVersion: () => Promise<string>;
  checkForUpdates: () => Promise<boolean>;
  onUpdateStatus: (callback: (data: any) => void) => void;
  downloadUpdate: () => Promise<void>;
  restartApp: () => Promise<void>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
