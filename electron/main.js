const { app, BrowserWindow, Menu, Tray, ipcMain, dialog } = require('electron');

// Start the log file before anything else loads, so even a failure while the
// database or sync server starts up is written down.
// File: %APPDATA%\Budget Secure\logs\budget-secure.log
const logger = require('./logger');
logger.init(app.getPath('userData'), { version: app.getVersion() });

const { autoUpdater } = require('electron-updater');
const path = require('path');
const express = require('express');
const cors = require('cors');
const apiRouter = require('../src/server/api');
const db = require('../src/server/database');
const wsService = require('../src/server/websocket');

process.on('uncaughtException', (err) => {
  console.error('[Electron Main Process Uncaught Exception]:', err);
  logger.flush();
});
process.on('unhandledRejection', (reason) => {
  console.error('[Electron Main Process Unhandled Rejection]:', reason);
  logger.flush();
});

let firewallStatus = 'ok'; // 'ok' | 'needs_permission' | 'failed'
let serverStartupError = null; // null | 'port_in_use' | 'server_error'

// ---------------------------------------------------------------------------
// Windows Firewall
//
// For a phone on the same Wi-Fi to reach this PC directly, Windows must let it
// in on port 3001. Two things used to get in the way:
//
//  1. Our rule covered only Private and Domain networks. Windows marks every
//     NEW Wi-Fi network as Public until told otherwise, so on a new network the
//     phone was turned away and sync fell back to the slower internet route.
//
//  2. The first time the app opens, Windows itself asks "Allow on Private /
//     Public networks?". A network type left unticked gets a BLOCK rule for
//     the app, and a block rule wins over any allow rule - so even a correct
//     rule of ours could not help.
//
// The check below looks at both (reading the firewall needs no admin rights).
// The fix - our rule for every network type, plus an allow rule for the app
// in place of Windows' own allow/block rules for it - needs admin rights, so
// it runs when the user clicks Allow and says Yes to the Windows prompt.
// ---------------------------------------------------------------------------

const FIREWALL_RULE = 'Budget Secure Sync';
const FIREWALL_APP_RULE = 'Budget Secure Sync (app)';
let firewallDetail = 'unchecked'; // what the last check found, for the log
let firewallCheckedAt = 0;

function psQuote(text) {
  return `'${String(text).replace(/'/g, "''")}'`;
}

/**
 * Ask Windows how the firewall treats this app. Resolves to
 * 'ok' | 'missing' | 'private_only' | 'blocked' | 'unknown' (could not ask).
 */
function inspectFirewall() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve('ok');
    const { execFile } = require('child_process');
    // Windows allows an incoming connection when ANY enabled Allow rule
    // matches and no Block rule does, so the answer has to be worked out
    // over ALL the rules together: our own port rule AND any rule Windows
    // made for this app (its first-run "Allow on Private / Public?" popup
    // writes one per network type). Judging each rule on its own called a
    // working setup broken, because no single rule covered both types.
    const script = [
      "$ErrorActionPreference = 'SilentlyContinue'",
      `$exe = ${psQuote(process.execPath)}`,
      `$named = @(Get-NetFirewallRule -DisplayName ${psQuote(FIREWALL_RULE)} | Where-Object { $_.Enabled -eq 'True' -and $_.Direction -eq 'Inbound' })`,
      "$byApp = @(Get-NetFirewallApplicationFilter -Program $exe | Get-NetFirewallRule | Where-Object { $_.Enabled -eq 'True' -and $_.Direction -eq 'Inbound' })",
      "$all = @($named) + @($byApp)",
      "$blocks = @($all | Where-Object { $_.Action -eq 'Block' })",
      "$allows = @($all | Where-Object { $_.Action -eq 'Allow' })",
      "$profiles = (@($allows | ForEach-Object { $_.Profile.ToString() }) -join ',')",
      "$pub = ($profiles -match 'Public') -or ($profiles -match 'Any')",
      "$priv = ($profiles -match 'Private') -or ($profiles -match 'Any')",
      "if ($blocks.Count -gt 0) { 'blocked' } elseif ($allows.Count -eq 0) { 'missing' } elseif (-not ($pub -and $priv)) { 'private_only' } else { 'ok' }"
    ].join('; ');
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { timeout: 20000, windowsHide: true },
      (err, stdout) => {
        const lines = String(stdout || '').trim().split(/\r?\n/);
        const answer = (lines[lines.length - 1] || '').trim();
        resolve(['ok', 'missing', 'private_only', 'blocked'].includes(answer) ? answer : 'unknown');
      }
    );
  });
}

/** Old, simpler check: is our rule there at all? Used only if PowerShell cannot answer. */
function ourRuleExists() {
  const { execSync } = require('child_process');
  try {
    execSync(`netsh advfirewall firewall show rule name="${FIREWALL_RULE}"`, { stdio: 'ignore', windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

async function refreshFirewallStatus() {
  if (process.platform !== 'win32') return 'ok';
  const found = await inspectFirewall();
  firewallDetail = found;
  firewallCheckedAt = Date.now();
  if (found === 'unknown') {
    firewallStatus = ourRuleExists() ? 'ok' : 'needs_permission';
  } else {
    firewallStatus = found === 'ok' ? 'ok' : 'needs_permission';
  }
  console.log(`[Firewall] Check: ${found} -> ${firewallStatus}`);
  return firewallStatus;
}

/**
 * Write the fix as a small .cmd file (exact quoting, no PowerShell argument
 * splitting - that once broke the rule name). Returns its path.
 */
function writeFirewallFixScript() {
  const fs = require('fs');
  const os = require('os');
  // %% so a "%" in a folder name is not read as a cmd variable.
  const exe = process.execPath.replace(/%/g, '%%');
  const cmdFile = path.join(os.tmpdir(), `budget-secure-firewall-${Date.now()}.cmd`);
  fs.writeFileSync(
    cmdFile,
    '@echo off\r\n' +
    'chcp 65001 >nul\r\n' +
    `netsh advfirewall firewall delete rule name="${FIREWALL_RULE}" >nul 2>&1\r\n` +
    `netsh advfirewall firewall delete rule name="${FIREWALL_APP_RULE}" >nul 2>&1\r\n` +
    // Windows' own rules for this app, including any "block" for a network
    // type that was left unticked in its first-run popup.
    `netsh advfirewall firewall delete rule name=all dir=in program="${exe}" >nul 2>&1\r\n` +
    `netsh advfirewall firewall add rule name="${FIREWALL_RULE}" dir=in action=allow protocol=TCP localport=3001 profile=any\r\n` +
    // An allow rule for the app itself, so Windows does not ask again (and
    // create new block rules) the next time the app opens.
    `netsh advfirewall firewall add rule name="${FIREWALL_APP_RULE}" dir=in action=allow program="${exe}" enable=yes profile=any\r\n`,
    'utf8'
  );
  return cmdFile;
}

/** Start-up: check, and quietly fix if this app happens to run as administrator. */
async function ensureFirewallRule() {
  if (process.platform !== 'win32') return;
  const status = await refreshFirewallStatus();
  if (status === 'ok') return;
  const fs = require('fs');
  const { execFile } = require('child_process');
  let cmdFile = null;
  try {
    cmdFile = writeFirewallFixScript();
    // Without admin rights netsh simply refuses; the Allow button in Settings
    // then asks Windows for permission.
    await new Promise((resolve) => execFile('cmd.exe', ['/c', cmdFile], { windowsHide: true, timeout: 20000 }, () => resolve()));
  } catch (err) {
    console.warn('[Firewall] Quiet fix not possible:', err?.message || err);
  } finally {
    if (cmdFile) { try { fs.unlinkSync(cmdFile); } catch {} }
  }
  await refreshFirewallStatus();
}

ipcMain.handle('get-firewall-status', async () => {
  // The check takes a moment, so a recent answer is reused.
  if (Date.now() - firewallCheckedAt < 15000 && firewallDetail !== 'unchecked') return firewallStatus;
  return refreshFirewallStatus();
});

ipcMain.handle('request-firewall-rule', async () => {
  if (process.platform !== 'win32') return 'ok';
  const { exec } = require('child_process');
  const util = require('util');
  const execAsync = util.promisify(exec);
  const fs = require('fs');
  let cmdFile = null;
  try {
    cmdFile = writeFirewallFixScript();
    const psPath = cmdFile.replace(/'/g, "''");
    await execAsync(`powershell -NoProfile -Command "Start-Process -FilePath '${psPath}' -Verb RunAs -Wait -WindowStyle Hidden"`);
  } catch (err) {
    console.warn('[Firewall] Elevated firewall request failed or was cancelled:', err?.message || err);
  } finally {
    if (cmdFile) { try { fs.unlinkSync(cmdFile); } catch {} }
  }

  const status = await refreshFirewallStatus();
  if (status !== 'ok') {
    firewallStatus = 'failed';
    console.warn(`[Firewall] Still not allowed after the permission request (${firewallDetail}).`);
  } else {
    console.log('[Firewall] Allowed on every network type.');
  }
  return firewallStatus;
});

ipcMain.handle('get-server-startup-error', () => {
  return serverStartupError;
});

ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

// Configure autoUpdater
const { GitHubProvider } = require('electron-updater/out/providers/GitHubProvider');

class DesktopGitHubProvider extends GitHubProvider {
  async getLatestTagName(cancellationToken) {
    try {
      const url = new URL(`https://api.github.com/repos/${this.options.owner}/${this.options.repo}/releases?per_page=20`);
      const rawData = await this.httpRequest(url, { Accept: 'application/vnd.github.v3+json' }, cancellationToken);
      if (rawData) {
        const releases = JSON.parse(rawData);
        // Find latest desktop release: not draft, not prerelease, tag does not start with android-, and has .yml asset
        const desktopRelease = releases.find(r => 
          !r.draft && 
          !r.prerelease && 
          !r.tag_name.toLowerCase().startsWith('android-') && 
          Array.isArray(r.assets) && 
          r.assets.some(a => a.name.endsWith('.yml'))
        );
        if (desktopRelease) {
          console.log('DesktopGitHubProvider: detected latest desktop release tag:', desktopRelease.tag_name);
          return desktopRelease.tag_name;
        }
      }
    } catch (err) {
      console.warn('DesktopGitHubProvider: failed to query GitHub releases API, falling back:', err?.message || err);
    }
    return super.getLatestTagName(cancellationToken);
  }
}

autoUpdater.autoDownload = false; // ask user before downloading
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.forceDevUpdateConfig = !app.isPackaged;

autoUpdater.setFeedURL({
  provider: 'custom',
  updateProvider: DesktopGitHubProvider,
  owner: 'dreamaistudio',
  repo: 'bujet-secure'
});

let updateCheckInProgress = false;
let updateStage = 'idle'; // 'checking' | 'downloading' | 'idle'

function checkForUpdates(manual = false) {
  if (updateCheckInProgress) return;
  updateCheckInProgress = true;
  updateStage = 'checking';
  console.log('=== CHECK FOR UPDATES CALLED ===, manual:', manual);
  autoUpdater.checkForUpdates().finally(() => {
    updateCheckInProgress = false;
  });
  if (manual && mainWindow) {
    mainWindow.webContents.send('update-status', { status: 'checking', stage: 'checking' });
  }
}

autoUpdater.on('update-available', (info) => {
  updateStage = 'idle';
  console.log('=== UPDATE AVAILABLE ===', info.version);
  if (mainWindow) {
    mainWindow.webContents.send('update-status', { status: 'available', version: info.version });
  }
});

autoUpdater.on('update-not-available', (info) => {
  updateStage = 'idle';
  const latestVer = info?.version || app.getVersion();
  console.log('=== UPDATE NOT AVAILABLE ===, version:', latestVer);
  if (mainWindow) {
    mainWindow.webContents.send('update-status', { 
      status: 'not-available', 
      version: latestVer 
    });
  }
});

autoUpdater.on('download-progress', (progress) => {
  console.log(`=== DOWNLOAD PROGRESS: ${progress.percent}% (${progress.transferred}/${progress.total} bytes, speed: ${progress.bytesPerSecond} B/s) ===`);
  if (mainWindow) {
    mainWindow.webContents.send('update-status', { 
      status: 'downloading', 
      stage: 'downloading',
      percent: progress.percent 
    });
  }
});

autoUpdater.on('update-downloaded', (info) => {
  updateStage = 'idle';
  console.log('=== UPDATE DOWNLOADED EVENT FIRED ===');
  if (mainWindow) {
    mainWindow.webContents.send('update-status', { 
      status: 'downloaded', 
      version: info.version 
    });
  }
});

autoUpdater.on('error', (err) => {
  const currentStage = updateStage;
  updateStage = 'idle';
  console.error('=== AUTO-UPDATE ERROR DETAILS ===');
  console.error('Stage:', currentStage);
  console.error('Message:', err.message);
  console.error('Stack:', err.stack);
  console.error('Full error:', JSON.stringify(err, null, 2));
  if (mainWindow) {
    mainWindow.webContents.send('update-status', { 
      status: 'error', 
      stage: currentStage,
      message: currentStage === 'downloading'
        ? 'Could not download update. Check your internet connection and try again.'
        : (err.message || 'Update check failed. Try again later.')
    });
  }
});

// IPC handler for manual "Check for Updates" button
ipcMain.handle('manual-check-updates', () => {
  checkForUpdates(true);
  return true;
});

ipcMain.handle('download-update', () => {
  console.log('=== IPC DOWNLOAD UPDATE CALLED ===');
  updateStage = 'downloading';
  autoUpdater.downloadUpdate().catch((err) => {
    console.error('autoUpdater.downloadUpdate failed:', err);
    updateStage = 'idle';
    if (mainWindow) {
      mainWindow.webContents.send('update-status', {
        status: 'error',
        stage: 'downloading',
        message: 'Could not download update. Check your internet connection and try again.'
      });
    }
  });
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
  ensureFirewallRule();

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

  // Listen on port 3001 on all network interfaces (0.0.0.0) for LAN sync
  server = expressApp.listen(3001, '0.0.0.0', () => {
    console.log('Express sync server running on http://0.0.0.0:3001');
    serverStartupError = null;
    const lanIp = apiRouter.getLanIp ? apiRouter.getLanIp() : '127.0.0.1';
    console.log(`[LAN Sync] Connectable via Wi-Fi at ws://${lanIp}:3001/ws`);
  }).on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log('Port 3001 already in use, probing http://127.0.0.1:3001/api/system-info...');
      const http = require('http');
      const req = http.get('http://127.0.0.1:3001/api/system-info', { timeout: 3000 }, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed && (parsed.app === 'budget-secure' || parsed.dbType)) {
              console.log('[Sync Server] Port 3001 is in use by a healthy existing Budget Secure instance.');
              serverStartupError = null;
            } else {
              console.warn('[Sync Server] Port 3001 responded with unexpected payload:', data);
              serverStartupError = 'port_in_use';
            }
          } catch {
            console.warn('[Sync Server] Port 3001 responded with non-JSON data.');
            serverStartupError = 'port_in_use';
          }
        });
      });
      req.on('error', (probeErr) => {
        console.error('[Sync Server] Failed to probe port 3001:', probeErr.message);
        serverStartupError = 'port_in_use';
      });
      req.on('timeout', () => {
        req.destroy();
        console.error('[Sync Server] Probe of port 3001 timed out.');
        serverStartupError = 'port_in_use';
      });
    } else {
      console.error('Server error:', err);
      serverStartupError = 'server_error';
    }
  });

  if (server) {
    wsService.initWebSocketServer(server, () => (apiRouter.getSyncToken ? apiRouter.getSyncToken() : ''));
  }
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
    mainWindow.webContents.openDevTools();
  }

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error(`[Electron] Failed to load ${validatedURL}: ${errorCode} - ${errorDescription}`);
  });

  mainWindow.webContents.on('console-message', (event, level, message) => {
    // Newer Electron puts the details on the event; older versions passed them
    // as separate arguments. Read either, so the log never shows "undefined".
    const text = event && event.message !== undefined ? event.message : message;
    const lvl = event && event.level !== undefined ? event.level : level;
    if (lvl === 'error' || lvl === 3) {
      console.error(`[Renderer] ${text}`);
    } else if (lvl === 'warning' || lvl === 2) {
      console.warn(`[Renderer] ${text}`);
    } else {
      console.log(`[Renderer] ${text}`);
    }
  });

  mainWindow.on('close', (event) => {
    // Only minimize to tray in packaged mode. In dev mode, quit cleanly on close.
    if (app.isPackaged && !app.isQuitting) {
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
  console.warn('[Electron] Another instance of Budget Secure is already running. Quitting this instance.');
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    try {
      await db.init();
      startExpressServer();
      createWindow();
      createTrayIcon();
      setTimeout(() => checkForUpdates(false), 5000);
    } catch (err) {
      console.error('[Electron] Startup error during whenReady:', err);
    }
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
  console.log('===== Budget Secure closing =====');
  logger.flush();
});
