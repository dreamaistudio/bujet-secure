interface ElectronAPI {
  getAppVersion: () => Promise<string>;
  checkForUpdates: () => Promise<boolean>;
  onUpdateStatus: (callback: (data: any) => void) => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
