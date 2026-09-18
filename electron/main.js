const { app, BrowserWindow, Menu, Tray, ipcMain, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const express = require('express');
const cors = require('cors');
const apiRouter = require('../src/server/api');
const db = require('../src/server/database');

ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

// Configure autoUpdater
autoUpdater.autoDownload = false; // ask user before downloading
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.forceDevUpdateConfig = true;

let updateCheckInProgress = false;

function checkForUpdates(manual = false) {
  if (updateCheckInProgress) return;
  updateCheckInProgress = true;
  console.log('=== CHECK FOR UPDATES CALLED ===, manual:', manual);
  autoUpdater.checkForUpdates().finally(() => {
    updateCheckInProgress = false;
  });
  if (manual && mainWindow) {
    mainWindow.webContents.send('update-status', { status: 'checking' });
  }
}

autoUpdater.on('update-available', (info) => {
  console.log('=== UPDATE AVAILABLE ===', info.version);
  if (mainWindow) {
    mainWindow.webContents.send('update-status', { status: 'available', version: info.version });
  }
});

autoUpdater.on('update-not-available', () => {
  console.log('=== UPDATE NOT AVAILABLE ===');
  if (mainWindow) {
    mainWindow.webContents.send('update-status', 
      { status: 'not-available' });
  }
});

autoUpdater.on('download-progress', (progress) => {
  console.log(`=== DOWNLOAD PROGRESS: ${progress.percent}% (${progress.transferred}/${progress.total} bytes, speed: ${progress.bytesPerSecond} B/s) ===`);
  if (mainWindow) {
    mainWindow.webContents.send('update-status', 
      { status: 'downloading', percent: progress.percent });
  }
});

autoUpdater.on('update-downloaded', (info) => {
  console.log('=== UPDATE DOWNLOADED EVENT FIRED ===');
  if (mainWindow) {
    mainWindow.webContents.send('update-status', 
      { status: 'downloaded', version: info.version });
  }
});

autoUpdater.on('error', (err) => {
  console.error('=== AUTO-UPDATE ERROR DETAILS ===');
  console.error('Message:', err.message);
  console.error('Stack:', err.stack);
  console.error('Full error:', JSON.stringify(err, null, 2));
  if (mainWindow) {
    mainWindow.webContents.send('update-status', 
      { status: 'error', message: err.message });
  }
});

// IPC handler for manual "Check for Updates" button
ipcMain.handle('manual-check-updates', () => {
  checkForUpdates(true);
  return true;
});

ipcMain.handle('download-update', () => {
  console.log('=== IPC DOWNLOAD UPDATE CALLED ===');
  autoUpdater.downloadUpdate();
});

ipcMain.handle('restart-app', () => {
  console.log('=== IPC RESTART APP CALLED ===');
  autoUpdater.quitAndInstall();
});

let mainWindow = null;
let tray = null;
let server = null;

// Initialize and start local Express API server on port 3001
function startExpressServer() {
  const expressApp = express();
  
  expressApp.use(cors());
  expressApp.use(express.json());
  
  // Expose local REST endpoints
  expressApp.use('/api', apiRouter);

  // Serve static assets (welcome video, etc.)
  if (app.isPackaged) {
    const extraAssetsPath = path.join(process.resourcesPath, 'assets');
    expressApp.use('/assets', express.static(extraAssetsPath));
  } else {
    const devAssetsPath = path.join(__dirname, 'assets');
    expressApp.use('/assets', express.static(devAssetsPath));
  }

  // Serve compiled production files in packaged environment
  if (app.isPackaged) {
    const distPath = path.join(__dirname, '../dist');
    expressApp.use(express.static(distPath));
    expressApp.get('*', (req, res, next) => {
      // Fallback to index.html for React SPA router
      if (!req.path.startsWith('/api')) {
        res.sendFile(path.join(distPath, 'index.html'));
      } else {
        next();
      }
    });
  }

  // Listen on port 3001 on local loopback interface only
  server = expressApp.listen(3001, '127.0.0.1', () => {
    console.log('Express sync server running on http://127.0.0.1:3001');
  }).on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log('Port 3001 already in use, assuming server already running');
    } else {
      console.error('Server error:', err);
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    title: 'Budget Secure',
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      devTools: !app.isPackaged,
    },
    icon: path.join(__dirname, 'assets', 'icon.png')
  });

  // Load Vite Dev server in dev, local file in prod
  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  } else {
    mainWindow.loadURL('http://localhost:3000');
  }

  mainWindow.webContents.on('console-message', (event, level, message) => {
    console.log(`[Renderer] ${message}`);
  });

  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTrayIcon() {
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  tray = new Tray(iconPath);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open Dashboard',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
        }
      }
    },
    {
      label: 'Hide to Tray',
      click: () => {
        if (mainWindow) {
          mainWindow.hide();
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Quit Application',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setToolTip('Budget Secure');
  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
      }
    }
  });
}

// Single instance lock check
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.on('ready', async () => {
    await db.init();
    startExpressServer();
    createWindow();
    createTrayIcon();
    setTimeout(() => checkForUpdates(false), 5000);
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

app.on('will-quit', () => {
  if (server) {
    server.close();
  }
});
