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
  try {
    fs.mkdirSync(userDataPath, { recursive: true });
  } catch (err) {
    console.error('Failed to create user data path:', err);
  }
}

// --- Database Paths ---

const dbPath = path.join(userDataPath, 'finance_vault.db');
const jsonDbPath = path.join(userDataPath, 'finance_vault_db.json');

let dbType = 'json'; // Defaults to JSON fallback, changes to 'sqlite' if sql.js loads successfully
let dbInstance = null;
let jsonDbData = { transactions: [], settings: {}, loans: [], savings: [] };

/**
 * Save in-memory SQLite database state to the physical file on disk
 */
function saveDbToFile() {
  if (dbType === 'sqlite' && dbInstance) {
    try {
      const binaryArray = dbInstance.export();
      fs.writeFileSync(dbPath, Buffer.from(binaryArray));
    } catch (err) {
      console.error('Failed to export and write sql.js database to disk:', err);
    }
  }
}

/**
 * Save in-memory JSON fallback state to local JSON file
 */
function saveJsonDb() {
  try {
    fs.writeFileSync(jsonDbPath, JSON.stringify(jsonDbData, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save JSON database:', err);
  }
}

/**
 * Create a safety backup of active database files on startup
 */
function backupDatabase() {
  try {
    if (fs.existsSync(dbPath)) {
      fs.copyFileSync(dbPath, dbPath + '.backup');
      console.log('Database backup created at:', dbPath + '.backup');
    }
    if (fs.existsSync(jsonDbPath)) {
      fs.copyFileSync(jsonDbPath, jsonDbPath + '.backup');
      console.log('JSON database backup created at:', jsonDbPath + '.backup');
    }
  } catch (err) {
    console.error('Failed to create database backup:', err.message);
  }
}

/**
 * Asynchronous initialization function to load Wasm SQLite binary via sql.js
 */
async function init() {
  if (dbInstance) return;

  // Create safety backups before startup/schema migrations
  backupDatabase();
  
  try {
    const initSqlJs = require('sql.js');
    const SQL = await initSqlJs();
    
    if (fs.existsSync(dbPath)) {
      try {
        dbInstance = new SQL.Database(fs.readFileSync(dbPath));
        dbType = 'sqlite';
        console.log('Opened sql.js SQLite database from:', dbPath);
      } catch (dbErr) {
        console.error('Failed to parse existing sqlite file, initializing fresh:', dbErr);
      }
    }
    
    if (!dbInstance) {
      dbInstance = new SQL.Database();
      dbType = 'sqlite';
      console.log('Created new in-memory sql.js SQLite database');
    }

    // Initialize/migrate schema for all tables
    dbInstance.run(`
      CREATE TABLE IF NOT EXISTS transactions (
        id TEXT PRIMARY KEY,
        date TEXT,
        time TEXT,
        description TEXT,
        category TEXT,
        amount REAL,
        status TEXT,
        deleted INTEGER DEFAULT 0,
        updated_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS loans (
        id TEXT PRIMARY KEY,
        type TEXT,
        personName TEXT,
        reason TEXT,
        amount REAL,
        date TEXT,
        status TEXT DEFAULT 'unpaid',
        deleted INTEGER DEFAULT 0,
        updated_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS savings (
        id TEXT PRIMARY KEY,
        keeperName TEXT,
        amount REAL,
        date TEXT,
        notes TEXT,
        status TEXT DEFAULT 'kept',
        deleted INTEGER DEFAULT 0,
        updated_at INTEGER
      );
    `);
    saveDbToFile();

    // Alter table for existing databases
    try {
      dbInstance.run('ALTER TABLE transactions ADD COLUMN time TEXT;');
      saveDbToFile();
      console.log('Added time column to transactions table successfully.');
    } catch (e) {
      if (!e.message.includes('duplicate column name') && !e.message.includes('already exists')) {
        console.warn('Altering transactions table failed:', e.message);
      }
    }
  } catch (error) {
    dbType = 'json';
    console.warn('Could not load sql.js, falling back to JSON storage at:', jsonDbPath, '\nError:', error.message);
    
    // Load JSON file database
    if (fs.existsSync(jsonDbPath)) {
      try {
        jsonDbData = JSON.parse(fs.readFileSync(jsonDbPath, 'utf8'));
        if (!jsonDbData.transactions) jsonDbData.transactions = [];
        if (!jsonDbData.settings) jsonDbData.settings = {};
        if (!jsonDbData.loans) jsonDbData.loans = [];
        if (!jsonDbData.savings) jsonDbData.savings = [];
      } catch (e) {
        console.error('Failed to read JSON database, resetting:', e);
        jsonDbData = { transactions: [], settings: {}, loans: [] };
      }
    } else {
      saveJsonDb();
    }
  }
}

// --- DATABASE API WRAPPERS ---

/**
 * Get all active (non-deleted) transactions
 */
function getTransactions() {
  if (dbType === 'sqlite' && dbInstance) {
    try {
      const stmt = dbInstance.prepare('SELECT * FROM transactions WHERE deleted = 0 ORDER BY date DESC');
      const rows = [];
      while (stmt.step()) {
        rows.push(stmt.getAsObject());
      }
      stmt.free();
      return rows;
    } catch (err) {
      console.error('sql.js getTransactions failed:', err);
      return [];
    }
  } else {
    return jsonDbData.transactions
      .filter(tx => !tx.deleted)
      .sort((a, b) => b.date.localeCompare(a.date));
  }
}

/**
 * Get all transactions (including soft-deleted ones) - for sync purposes
 */
function getAllTransactionsRaw() {
  if (dbType === 'sqlite' && dbInstance) {
    try {
      const stmt = dbInstance.prepare('SELECT * FROM transactions');
      const rows = [];
      while (stmt.step()) {
        rows.push(stmt.getAsObject());
      }
      stmt.free();
      return rows;
    } catch (err) {
      console.error('sql.js getAllTransactionsRaw failed:', err);
      return [];
    }
  } else {
    return jsonDbData.transactions;
  }
}

/**
 * Save or update a single transaction (inserts if not exists, updates if exists)
 */
function saveTransaction(tx) {
  const now = Date.now();
  const txData = {
    id: tx.id,
    date: tx.date,
    time: tx.time || null,
    description: tx.description,
    category: tx.category,
    amount: parseFloat(tx.amount),
    status: tx.status || 'CLEARED',
    deleted: tx.deleted ? 1 : 0,
    updated_at: tx.updated_at || now
  };

  if (dbType === 'sqlite' && dbInstance) {
    try {
      const stmt = dbInstance.prepare(`
        INSERT INTO transactions (id, date, time, description, category, amount, status, deleted, updated_at)
        VALUES ($id, $date, $time, $description, $category, $amount, $status, $deleted, $updated_at)
        ON CONFLICT(id) DO UPDATE SET
          date = excluded.date,
          time = excluded.time,
          description = excluded.description,
          category = excluded.category,
          amount = excluded.amount,
          status = excluded.status,
          deleted = excluded.deleted,
          updated_at = excluded.updated_at
      `);
      stmt.run({
        $id: txData.id,
        $date: txData.date,
        $time: txData.time,
        $description: txData.description,
        $category: txData.category,
        $amount: txData.amount,
        $status: txData.status,
        $deleted: txData.deleted,
        $updated_at: txData.updated_at
      });
      stmt.free();
      saveDbToFile();
    } catch (err) {
      console.error('sql.js saveTransaction failed:', err);
    }
  } else {
    const idx = jsonDbData.transactions.findIndex(t => t.id === tx.id);
    if (idx > -1) {
      jsonDbData.transactions[idx] = { ...jsonDbData.transactions[idx], ...txData };
    } else {
      jsonDbData.transactions.push(txData);
    }
    saveJsonDb();
  }
  return txData;
}

/**
 * Soft delete a transaction by updating its deleted flag
 */
function deleteTransaction(id) {
  const now = Date.now();
  if (dbType === 'sqlite' && dbInstance) {
    try {
      dbInstance.run('UPDATE transactions SET deleted = 1, updated_at = ? WHERE id = ?', [now, id]);
      saveDbToFile();
    } catch (err) {
      console.error('sql.js deleteTransaction failed:', err);
    }
  } else {
    const idx = jsonDbData.transactions.findIndex(t => t.id === id);
    if (idx > -1) {
      jsonDbData.transactions[idx].deleted = 1;
      jsonDbData.transactions[idx].updated_at = now;
      saveJsonDb();
    }
  }
}

/**
 * Hard delete a transaction (used if restoring or purging)
 */
function hardDeleteTransaction(id) {
  if (dbType === 'sqlite' && dbInstance) {
    try {
      dbInstance.run('DELETE FROM transactions WHERE id = ?', [id]);
      saveDbToFile();
    } catch (err) {
      console.error('sql.js hardDeleteTransaction failed:', err);
    }
  } else {
    jsonDbData.transactions = jsonDbData.transactions.filter(t => t.id !== id);
    saveJsonDb();
  }
}

/**
 * Get settings as key-value pairs
 */
function getSettings() {
  if (dbType === 'sqlite' && dbInstance) {
    try {
      const stmt = dbInstance.prepare('SELECT * FROM settings');
      const settingsMap = {};
      while (stmt.step()) {
        const r = stmt.getAsObject();
        try {
          settingsMap[r.key] = JSON.parse(r.value);
        } catch {
          settingsMap[r.key] = r.value;
        }
      }
      stmt.free();
      return settingsMap;
    } catch (err) {
      console.error('sql.js getSettings failed:', err);
      return {};
    }
  } else {
    return jsonDbData.settings;
  }
}

/**
 * Save settings values
 */
function saveSettings(settingsObj) {
  const now = Date.now();
  if (dbType === 'sqlite' && dbInstance) {
    try {
      const stmt = dbInstance.prepare(`
        INSERT INTO settings (key, value, updated_at)
        VALUES ($key, $value, $updated_at)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
      `);
      
      for (const [key, val] of Object.entries(settingsObj)) {
        const stringified = JSON.stringify(val);
        stmt.run({
          $key: key,
          $value: stringified,
          $updated_at: now
        });
      }
      stmt.free();
      saveDbToFile();
    } catch (err) {
      console.error('sql.js saveSettings failed:', err);
    }
  } else {
    jsonDbData.settings = { ...jsonDbData.settings, ...settingsObj };
    saveJsonDb();
  }
}

/**
 * Sync and merge transactions using Last-Write-Wins logic
 * @param {Array} clientTransactions - Transactions from mobile client
 */
function syncTransactions(clientTransactions) {
  if (!Array.isArray(clientTransactions)) return [];
  const localTransactions = getAllTransactionsRaw();
  const localMap = new Map(localTransactions.map(tx => [tx.id, tx]));
  const mergedList = [];

  for (const clientTx of clientTransactions) {
    const localTx = localMap.get(clientTx.id);
    const clientUpdatedAt = clientTx.updated_at || 0;
    const localUpdatedAt = localTx ? (localTx.updated_at || 0) : 0;

    if (!localTx || clientUpdatedAt > localUpdatedAt) {
      const saved = saveTransaction(clientTx);
      mergedList.push(saved);
      localMap.set(clientTx.id, saved);
    } else {
      mergedList.push(localTx);
    }
  }

  const clientIds = new Set(clientTransactions.map(tx => tx.id));
  for (const localTx of localTransactions) {
    if (!clientIds.has(localTx.id)) {
      mergedList.push(localTx);
    }
  }

  return mergedList;
}

// --- LOANS CRUD ---

/**
 * Get all active (non-deleted) loans
 */
function getLoans() {
  if (dbType === 'sqlite' && dbInstance) {
    try {
      const stmt = dbInstance.prepare('SELECT * FROM loans WHERE deleted = 0 ORDER BY date DESC');
      const rows = [];
      while (stmt.step()) {
        rows.push(stmt.getAsObject());
      }
      stmt.free();
      return rows;
    } catch (err) {
      console.error('sql.js getLoans failed:', err);
      return [];
    }
  } else {
    return (jsonDbData.loans || [])
      .filter(l => !l.deleted)
      .sort((a, b) => b.date.localeCompare(a.date));
  }
}

/**
 * Save or update a single loan (inserts if not exists, updates if exists)
 */
function saveLoan(loan) {
  const now = Date.now();
  const loanData = {
    id: loan.id,
    type: loan.type,
    personName: loan.personName,
    reason: loan.reason || '',
    amount: parseFloat(loan.amount),
    date: loan.date,
    status: loan.status || 'unpaid',
    deleted: loan.deleted ? 1 : 0,
    updated_at: loan.updated_at || now
  };

  if (dbType === 'sqlite' && dbInstance) {
    try {
      const stmt = dbInstance.prepare(`
        INSERT INTO loans (id, type, personName, reason, amount, date, status, deleted, updated_at)
        VALUES ($id, $type, $personName, $reason, $amount, $date, $status, $deleted, $updated_at)
        ON CONFLICT(id) DO UPDATE SET
          type = excluded.type,
          personName = excluded.personName,
          reason = excluded.reason,
          amount = excluded.amount,
          date = excluded.date,
          status = excluded.status,
          deleted = excluded.deleted,
          updated_at = excluded.updated_at
      `);
      stmt.run({
        $id: loanData.id,
        $type: loanData.type,
        $personName: loanData.personName,
        $reason: loanData.reason,
        $amount: loanData.amount,
        $date: loanData.date,
        $status: loanData.status,
        $deleted: loanData.deleted,
        $updated_at: loanData.updated_at
      });
      stmt.free();
      saveDbToFile();
    } catch (err) {
      console.error('sql.js saveLoan failed:', err);
    }
  } else {
    if (!jsonDbData.loans) jsonDbData.loans = [];
    const idx = jsonDbData.loans.findIndex(l => l.id === loan.id);
    if (idx > -1) {
      jsonDbData.loans[idx] = { ...jsonDbData.loans[idx], ...loanData };
    } else {
      jsonDbData.loans.push(loanData);
    }
    saveJsonDb();
  }
  return loanData;
}

/**
 * Soft delete a loan by updating its deleted flag
 */
function deleteLoan(id) {
  const now = Date.now();
  if (dbType === 'sqlite' && dbInstance) {
    try {
      dbInstance.run('UPDATE loans SET deleted = 1, updated_at = ? WHERE id = ?', [now, id]);
      saveDbToFile();
    } catch (err) {
      console.error('sql.js deleteLoan failed:', err);
    }
  } else {
    if (!jsonDbData.loans) jsonDbData.loans = [];
    const idx = jsonDbData.loans.findIndex(l => l.id === id);
    if (idx > -1) {
      jsonDbData.loans[idx].deleted = 1;
      jsonDbData.loans[idx].updated_at = now;
      saveJsonDb();
    }
  }
}

// --- SAVINGS CRUD ---

/**
 * Get all active (non-deleted) savings entries
 */
function getSavings() {
  if (dbType === 'sqlite' && dbInstance) {
    try {
      const stmt = dbInstance.prepare('SELECT * FROM savings WHERE deleted = 0 ORDER BY date DESC');
      const rows = [];
      while (stmt.step()) {
        rows.push(stmt.getAsObject());
      }
      stmt.free();
      return rows;
    } catch (err) {
      console.error('sql.js getSavings failed:', err);
      return [];
    }
  } else {
    return (jsonDbData.savings || [])
      .filter(s => !s.deleted)
      .sort((a, b) => b.date.localeCompare(a.date));
  }
}

/**
 * Save or update a single savings entry (inserts if not exists, updates if exists)
 */
function saveSaving(saving) {
  const now = Date.now();
  const savingData = {
    id: saving.id,
    keeperName: saving.keeperName,
    amount: parseFloat(saving.amount),
    date: saving.date,
    notes: saving.notes || '',
    status: saving.status || 'kept',
    deleted: saving.deleted ? 1 : 0,
    updated_at: saving.updated_at || now
  };

  if (dbType === 'sqlite' && dbInstance) {
    try {
      const stmt = dbInstance.prepare(`
        INSERT INTO savings (id, keeperName, amount, date, notes, status, deleted, updated_at)
        VALUES ($id, $keeperName, $amount, $date, $notes, $status, $deleted, $updated_at)
        ON CONFLICT(id) DO UPDATE SET
          keeperName = excluded.keeperName,
          amount = excluded.amount,
          date = excluded.date,
          notes = excluded.notes,
          status = excluded.status,
          deleted = excluded.deleted,
          updated_at = excluded.updated_at
      `);
      stmt.run({
        $id: savingData.id,
        $keeperName: savingData.keeperName,
        $amount: savingData.amount,
        $date: savingData.date,
        $notes: savingData.notes,
        $status: savingData.status,
        $deleted: savingData.deleted,
        $updated_at: savingData.updated_at
      });
      stmt.free();
      saveDbToFile();
    } catch (err) {
      console.error('sql.js saveSaving failed:', err);
    }
  } else {
    if (!jsonDbData.savings) jsonDbData.savings = [];
    const idx = jsonDbData.savings.findIndex(s => s.id === saving.id);
    if (idx > -1) {
      jsonDbData.savings[idx] = { ...jsonDbData.savings[idx], ...savingData };
    } else {
      jsonDbData.savings.push(savingData);
    }
    saveJsonDb();
  }
  return savingData;
}

/**
 * Soft delete a savings entry by updating its deleted flag
 */
function deleteSaving(id) {
  const now = Date.now();
  if (dbType === 'sqlite' && dbInstance) {
    try {
      dbInstance.run('UPDATE savings SET deleted = 1, updated_at = ? WHERE id = ?', [now, id]);
      saveDbToFile();
    } catch (err) {
      console.error('sql.js deleteSaving failed:', err);
    }
  } else {
    if (!jsonDbData.savings) jsonDbData.savings = [];
    const idx = jsonDbData.savings.findIndex(s => s.id === id);
    if (idx > -1) {
      jsonDbData.savings[idx].deleted = 1;
      jsonDbData.savings[idx].updated_at = now;
      saveJsonDb();
    }
  }
}

/**
 * Reset all data - clear all transactions, loans, savings, and reset settings to empty defaults
 */
function resetAll() {
  if (dbType === 'sqlite' && dbInstance) {
    try {
      dbInstance.run('DELETE FROM transactions');
      dbInstance.run('DELETE FROM settings');
      try { dbInstance.run('DELETE FROM loans'); } catch (e) { /* table may not exist yet */ }
      try { dbInstance.run('DELETE FROM savings'); } catch (e) { /* table may not exist yet */ }
      saveDbToFile();
      console.log('Database reset: all transactions, loans, savings, and settings cleared.');
    } catch (err) {
      console.error('sql.js resetAll failed:', err);
    }
  } else {
    jsonDbData.transactions = [];
    jsonDbData.settings = {};
    jsonDbData.loans = [];
    jsonDbData.savings = [];
    saveJsonDb();
    console.log('JSON database reset: all transactions, loans, savings, and settings cleared.');
  }
}

/**
 * Get all loans (including soft-deleted ones) - for sync purposes
 */
function getAllLoansRaw() {
  if (dbType === 'sqlite' && dbInstance) {
    try {
      const stmt = dbInstance.prepare('SELECT * FROM loans');
      const rows = [];
      while (stmt.step()) {
        rows.push(stmt.getAsObject());
      }
      stmt.free();
      return rows;
    } catch (err) {
      console.error('sql.js getAllLoansRaw failed:', err);
      return [];
    }
  } else {
    return jsonDbData.loans || [];
  }
}

/**
 * Get all savings entries (including soft-deleted ones) - for sync purposes
 */
function getAllSavingsRaw() {
  if (dbType === 'sqlite' && dbInstance) {
    try {
      const stmt = dbInstance.prepare('SELECT * FROM savings');
      const rows = [];
      while (stmt.step()) {
        rows.push(stmt.getAsObject());
      }
      stmt.free();
      return rows;
    } catch (err) {
      console.error('sql.js getAllSavingsRaw failed:', err);
      return [];
    }
  } else {
    return jsonDbData.savings || [];
  }
}

/**
 * Sync and merge loans using Last-Write-Wins logic
 */
function syncLoans(clientLoans) {
  if (!clientLoans || !Array.isArray(clientLoans)) return [];
  const localLoans = getAllLoansRaw();
  const localMap = new Map(localLoans.map(l => [l.id, l]));
  const mergedList = [];

  for (const clientLoan of clientLoans) {
    const localLoan = localMap.get(clientLoan.id);
    const clientUpdatedAt = clientLoan.updated_at || 0;
    const localUpdatedAt = localLoan ? (localLoan.updated_at || 0) : 0;

    if (!localLoan || clientUpdatedAt > localUpdatedAt) {
      const saved = saveLoan(clientLoan);
      mergedList.push(saved);
      localMap.set(clientLoan.id, saved);
    } else {
      mergedList.push(localLoan);
    }
  }

  const clientIds = new Set(clientLoans.map(l => l.id));
  for (const localLoan of localLoans) {
    if (!clientIds.has(localLoan.id)) {
      mergedList.push(localLoan);
    }
  }

  return mergedList;
}

/**
 * Sync and merge savings using Last-Write-Wins logic
 */
function syncSavings(clientSavings) {
  if (!clientSavings || !Array.isArray(clientSavings)) return [];
  const localSavings = getAllSavingsRaw();
  const localMap = new Map(localSavings.map(s => [s.id, s]));
  const mergedList = [];

  for (const clientSaving of clientSavings) {
    const localSaving = localMap.get(clientSaving.id);
    const clientUpdatedAt = clientSaving.updated_at || 0;
    const localUpdatedAt = localSaving ? (localSaving.updated_at || 0) : 0;

    if (!localSaving || clientUpdatedAt > localUpdatedAt) {
      const saved = saveSaving(clientSaving);
      mergedList.push(saved);
      localMap.set(clientSaving.id, saved);
    } else {
      mergedList.push(localSaving);
    }
  }

  const clientIds = new Set(clientSavings.map(s => s.id));
  for (const localSaving of localSavings) {
    if (!clientIds.has(localSaving.id)) {
      mergedList.push(localSaving);
    }
  }

  return mergedList;
}

module.exports = {
  dbType,
  dbPath,
  jsonDbPath,
  init,
  getTransactions,
  getAllTransactionsRaw,
  saveTransaction,
  deleteTransaction,
  hardDeleteTransaction,
  getSettings,
  saveSettings,
  syncTransactions,
  getLoans,
  getAllLoansRaw,
  saveLoan,
  deleteLoan,
  syncLoans,
  getSavings,
  getAllSavingsRaw,
  saveSaving,
  deleteSaving,
  syncSavings,
  resetAll
};

