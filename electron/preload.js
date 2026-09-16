const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  checkForUpdates: () => ipcRenderer.invoke('manual-check-updates'),
  onUpdateStatus: (callback) => 
    ipcRenderer.on('update-status', (event, data) => callback(data)),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  restartApp: () => ipcRenderer.invoke('restart-app')
});
