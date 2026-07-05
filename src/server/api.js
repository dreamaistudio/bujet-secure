const express = require('express');
const router = express.Router();
const db = require('./database');
const os = require('os');
const path = require('path');
const fs = require('fs');

let userDataPath;
try {
  const { app } = require('electron');
  userDataPath = app.getPath('userData');
} catch (e) {
  userDataPath = path.join(process.cwd(), 'data');
}

if (!fs.existsSync(userDataPath)) {
  fs.mkdirSync(userDataPath, { recursive: true });
}

const tokenPath = path.join(userDataPath, 'sync_token.txt');
let syncToken = '';

// Retrieve or generate secret shared token for sync auth
try {
  if (fs.existsSync(tokenPath)) {
    syncToken = fs.readFileSync(tokenPath, 'utf8').trim();
  } else {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let token = '';
    for (let i = 0; i < 16; i++) {
      token += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    syncToken = token;
    fs.writeFileSync(tokenPath, syncToken, 'utf8');
  }
} catch (e) {
  console.error('Failed to read or create sync auth token:', e);
  syncToken = 'VaultSyncToken123'; // Static safe fallback
}

/**
 * Get current system local IP address on Wi-Fi/Ethernet network
 */
function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  const skipKeywords = ['tailscale', 'vethernet', 'wsl', 'bluetooth'];
  const preferKeywords = ['wi-fi', 'wifi', 'wireless', 'wlan'];
  
  let fallbackIp = null;
  
  for (const [name, ifaces] of Object.entries(interfaces)) {
    const nameLower = name.toLowerCase();
    if (skipKeywords.some(k => nameLower.includes(k))) continue;
    
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) {
        if (preferKeywords.some(k => nameLower.includes(k))) {
          return iface.address;
        }
        fallbackIp = iface.address;
      }
    }
  }
  return fallbackIp || '127.0.0.1';
}

/**
 * Express middleware to authenticate POST /api/sync requests using authorization token
 */
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing or invalid token format' });
  }
  const clientToken = authHeader.substring(7);
  if (clientToken !== syncToken) {
    return res.status(401).json({ error: 'Unauthorized: Token mismatch' });
  }
  next();
}

// GET /api/transactions
router.get('/transactions', (req, res) => {
  try {
    const txs = db.getTransactions();
    res.json(txs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/transactions
router.post('/transactions', (req, res) => {
  try {
    const tx = req.body;
    if (!tx.id || !tx.description || tx.amount === undefined) {
      return res.status(400).json({ error: 'Bad Request: Incomplete transaction object structure' });
    }
    const saved = db.saveTransaction(tx);
    res.json(saved);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/transactions/:id
router.delete('/transactions/:id', (req, res) => {
  try {
    db.deleteTransaction(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/settings
router.get('/settings', (req, res) => {
  try {
    const settings = db.getSettings();
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/settings
router.post('/settings', (req, res) => {
  try {
    db.saveSettings(req.body);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/loans
router.get('/loans', (req, res) => {
  try {
    const loans = db.getLoans();
    res.json(loans);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/loans
router.post('/loans', (req, res) => {
  try {
    const loan = req.body;
    if (!loan.id || !loan.personName || loan.amount === undefined) {
      return res.status(400).json({ error: 'Bad Request: Incomplete loan object structure' });
    }
    const saved = db.saveLoan(loan);
    res.json(saved);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/loans/:id
router.delete('/loans/:id', (req, res) => {
  try {
    db.deleteLoan(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/savings
router.get('/savings', (req, res) => {
  try {
    const savings = db.getSavings();
    res.json(savings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/savings
router.post('/savings', (req, res) => {
  try {
    const saving = req.body;
    if (!saving.id || !saving.keeperName || saving.amount === undefined) {
      return res.status(400).json({ error: 'Bad Request: Incomplete savings object structure' });
    }
    const saved = db.saveSaving(saving);
    res.json(saved);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/savings/:id
router.delete('/savings/:id', (req, res) => {
  try {
    db.deleteSaving(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sync - returns full database snapshot for mobile initial dump
router.get('/sync', (req, res) => {
  try {
    const txs = db.getAllTransactionsRaw();
    const settings = db.getSettings();
    const loans = db.getLoans();
    let savings = [];
    try { savings = db.getSavings(); } catch (e) { /* table may not exist yet */ }
    res.json({ transactions: txs, settings, loans, savings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/sync - receives mobile changes, merges with Last-Write-Wins and returns merged state
router.post('/sync', authMiddleware, (req, res) => {
  try {
    const { transactions, settings, loans, savings } = req.body;

    // Merge transactions if provided
    if (transactions && Array.isArray(transactions)) {
      db.syncTransactions(transactions);
    }

    // Merge settings if provided
    if (settings && typeof settings === 'object') {
      const current = db.getSettings();
      const mergedSettings = { ...current };
      for (const [key, val] of Object.entries(settings)) {
        // Prevent sync from overwriting a set server PIN with an empty string
        if (key === 'authPin' && !val && current.authPin) {
          continue;
        }
        mergedSettings[key] = val;
      }
      db.saveSettings(mergedSettings);
    }

    // Merge loans if provided
    if (loans && Array.isArray(loans)) {
      db.syncLoans(loans);
    }

    // Merge savings if provided
    if (savings && Array.isArray(savings)) {
      db.syncSavings(savings);
    }

    // Retrieve and respond with the fully merged unified database state
    const unifiedTxs = db.getAllTransactionsRaw();
    const unifiedSettings = db.getSettings();
    const unifiedLoans = db.getAllLoansRaw();
    const unifiedSavings = db.getAllSavingsRaw();

    res.json({
      transactions: unifiedTxs.filter(t => !t.deleted),
      settings: unifiedSettings,
      loans: unifiedLoans.filter(l => !l.deleted),
      savings: unifiedSavings.filter(s => !s.deleted)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ping - lightweight connection check (unauthenticated)
router.get('/ping', (req, res) => {
  try {
    const settings = db.getSettings() || {};
    res.json({
      status: 'ok',
      ip: getLocalIpAddress(),
      name: settings.businessName || 'Bujet Secure'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/system-info - exposes system details for client connection settings
router.get('/system-info', (req, res) => {
  try {
    res.json({
      localIp: getLocalIpAddress(),
      authToken: syncToken,
      dbType: db.dbType
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/autostart - check if auto-start on login is configured
router.get('/autostart', (req, res) => {
  try {
    const { app } = require('electron');
    res.json({ autoStart: app.getLoginItemSettings().openAtLogin });
  } catch (err) {
    res.json({ autoStart: false });
  }
});

// POST /api/autostart - update auto-start configuration
router.post('/autostart', (req, res) => {
  try {
    const { app } = require('electron');
    const { autoStart } = req.body;
    app.setLoginItemSettings({
      openAtLogin: !!autoStart,
      path: app.getPath('exe')
    });
    res.json({ success: true, autoStart: !!autoStart });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/reset - wipe all transactions and settings (Start Fresh)
router.delete('/reset', (req, res) => {
  try {
    db.resetAll();
    res.json({ success: true, message: 'All data has been permanently deleted.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
