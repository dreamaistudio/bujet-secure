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
let jsonDbData = { transactions: [], settings: {}, loans: [], savings: [], bills: [], billPayments: [] };

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
        keeper_id TEXT,
        amount REAL,
        date TEXT,
        notes TEXT,
        status TEXT DEFAULT 'kept',
        deleted INTEGER DEFAULT 0,
        updated_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS keepers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        created_at TEXT
      );
      CREATE TABLE IF NOT EXISTS bills (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        amount REAL NOT NULL,
        dueDay INTEGER NOT NULL,
        category TEXT NOT NULL DEFAULT 'Personal',
        notes TEXT,
        deleted INTEGER DEFAULT 0,
        updated_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS bill_payments (
        id TEXT PRIMARY KEY,
        bill_id TEXT NOT NULL,
        month TEXT NOT NULL,
        paid INTEGER DEFAULT 0,
        paid_date TEXT,
        linked_transaction_id TEXT,
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

    try {
      dbInstance.run('ALTER TABLE savings ADD COLUMN keeper_id TEXT;');
      saveDbToFile();
      console.log('Added keeper_id column to savings table successfully.');
    } catch (e) {
      if (!e.message.includes('duplicate column name') && !e.message.includes('already exists')) {
        console.warn('Altering savings table failed:', e.message);
      }
    }

    // Run migrations
    runSQLiteMigrations();
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
        if (!jsonDbData.bills) jsonDbData.bills = [];
        if (!jsonDbData.billPayments) jsonDbData.billPayments = [];
        if (!jsonDbData.keepers) jsonDbData.keepers = [];
        
        // Run migration for JSON
        runJsonMigrations();
      } catch (e) {
        console.error('Failed to read JSON database, resetting:', e);
        jsonDbData = { transactions: [], settings: {}, loans: [], savings: [], keepers: [], bills: [], billPayments: [] };
      }
    } else {
      jsonDbData = { transactions: [], settings: {}, loans: [], savings: [], keepers: [], bills: [], billPayments: [] };
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
 * @param {Array} clientTransactions - Transactions from frontend client
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
    keeper_id: saving.keeper_id || null,
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
        INSERT INTO savings (id, keeperName, keeper_id, amount, date, notes, status, deleted, updated_at)
        VALUES ($id, $keeperName, $keeper_id, $amount, $date, $notes, $status, $deleted, $updated_at)
        ON CONFLICT(id) DO UPDATE SET
          keeperName = excluded.keeperName,
          keeper_id = excluded.keeper_id,
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
        $keeper_id: savingData.keeper_id,
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
 * Get all keepers
 */
function getKeepers() {
  if (dbType === 'sqlite' && dbInstance) {
    try {
      const stmt = dbInstance.prepare('SELECT * FROM keepers ORDER BY name ASC');
      const rows = [];
      while (stmt.step()) {
        rows.push(stmt.getAsObject());
      }
      stmt.free();
      return rows;
    } catch (err) {
      console.error('sql.js getKeepers failed:', err);
      return [];
    }
  } else {
    return (jsonDbData.keepers || [])
      .sort((a, b) => a.name.localeCompare(b.name));
  }
}

/**
 * Save or update a single keeper (inserts if not exists, updates if exists)
 */
function saveKeeper(keeper) {
  const keeperData = {
    id: keeper.id,
    name: keeper.name,
    type: keeper.type,
    created_at: keeper.created_at || new Date().toISOString()
  };

  if (dbType === 'sqlite' && dbInstance) {
    try {
      const stmt = dbInstance.prepare(`
        INSERT INTO keepers (id, name, type, created_at)
        VALUES ($id, $name, $type, $created_at)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          type = excluded.type
      `);
      stmt.run({
        $id: keeperData.id,
        $name: keeperData.name,
        $type: keeperData.type,
        $created_at: keeperData.created_at
      });
      stmt.free();
      saveDbToFile();
    } catch (err) {
      console.error('sql.js saveKeeper failed:', err);
    }
  } else {
    if (!jsonDbData.keepers) jsonDbData.keepers = [];
    const idx = jsonDbData.keepers.findIndex(k => k.id === keeper.id);
    if (idx > -1) {
      jsonDbData.keepers[idx] = { ...jsonDbData.keepers[idx], ...keeperData };
    } else {
      jsonDbData.keepers.push(keeperData);
    }
    saveJsonDb();
  }
  return keeperData;
}

/**
 * Delete a keeper
 */
function deleteKeeper(id) {
  if (dbType === 'sqlite' && dbInstance) {
    try {
      dbInstance.run('DELETE FROM keepers WHERE id = ?', [id]);
      saveDbToFile();
    } catch (err) {
      console.error('sql.js deleteKeeper failed:', err);
    }
  } else {
    if (!jsonDbData.keepers) jsonDbData.keepers = [];
    jsonDbData.keepers = jsonDbData.keepers.filter(k => k.id !== id);
    saveJsonDb();
  }
}

/**
 * Check if a keeper is referenced by any active savings entries
 */
function isKeeperReferenced(id) {
  if (dbType === 'sqlite' && dbInstance) {
    try {
      const stmt = dbInstance.prepare('SELECT COUNT(*) as count FROM savings WHERE keeper_id = ? AND deleted = 0');
      let count = 0;
      if (stmt.step()) {
        count = stmt.getAsObject().count;
      }
      stmt.free();
      return count > 0;
    } catch (err) {
      console.error('sql.js isKeeperReferenced failed:', err);
      return false;
    }
  } else {
    return (jsonDbData.savings || [])
      .some(s => s.keeper_id === id && !s.deleted);
  }
}

/**
 * Sync and merge keepers using simple merge
 */
function syncKeepers(clientKeepers) {
  if (!clientKeepers || !Array.isArray(clientKeepers)) return [];
  const localKeepers = getKeepers();
  const localMap = new Map(localKeepers.map(k => [k.id, k]));
  const mergedList = [];

  for (const clientKeeper of clientKeepers) {
    const localKeeper = localMap.get(clientKeeper.id);
    if (!localKeeper) {
      const saved = saveKeeper(clientKeeper);
      mergedList.push(saved);
      localMap.set(clientKeeper.id, saved);
    } else {
      mergedList.push(localKeeper);
    }
  }

  const clientIds = new Set(clientKeepers.map(k => k.id));
  for (const localKeeper of localKeepers) {
    if (!clientIds.has(localKeeper.id)) {
      mergedList.push(localKeeper);
    }
  }

  return mergedList;
}

/**
 * Idempotent startup migration for SQLite
 */
function runSQLiteMigrations() {
  if (dbType !== 'sqlite' || !dbInstance) return;

  try {
    // 1. Check if keepers table is empty
    let keepersCount = 0;
    const stmtKeepers = dbInstance.prepare('SELECT COUNT(*) as count FROM keepers');
    if (stmtKeepers.step()) {
      keepersCount = stmtKeepers.getAsObject().count;
    }
    stmtKeepers.free();

    // 2. Check if savings table has rows
    let savingsCount = 0;
    const stmtSavings = dbInstance.prepare('SELECT COUNT(*) as count FROM savings');
    if (stmtSavings.step()) {
      savingsCount = stmtSavings.getAsObject().count;
    }
    stmtSavings.free();

    if (keepersCount === 0 && savingsCount > 0) {
      console.log('Running SQLite savings-to-keepers migration...');
      
      // Find all distinct non-empty keeperName values from savings
      const stmtDistinct = dbInstance.prepare("SELECT DISTINCT keeperName FROM savings WHERE keeperName IS NOT NULL AND keeperName != ''");
      const names = [];
      while (stmtDistinct.step()) {
        names.push(stmtDistinct.getAsObject().keeperName);
      }
      stmtDistinct.free();

      let keepersCreated = 0;
      let savingsMigrated = 0;

      for (const name of names) {
        // Idempotency: Double check check if a keeper with this name already exists (case-insensitive)
        const stmtCheck = dbInstance.prepare('SELECT id FROM keepers WHERE LOWER(name) = LOWER(?)');
        stmtCheck.bind([name]);
        let existingId = null;
        if (stmtCheck.step()) {
          existingId = stmtCheck.getAsObject().id;
        }
        stmtCheck.free();


        let id = existingId;
        const createdAt = new Date().toISOString();
        if (!id) {
          id = 'keeper_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
          const insertStmt = dbInstance.prepare('INSERT INTO keepers (id, name, type, created_at) VALUES (?, ?, ?, ?)');
          insertStmt.run([id, name, 'person', createdAt]);
          insertStmt.free();
          keepersCreated++;
        }

        // Update matching savings rows where keeper_id is NULL
        const updateStmt = dbInstance.prepare('UPDATE savings SET keeper_id = ? WHERE keeperName = ? AND keeper_id IS NULL');
        updateStmt.run([id, name]);
        updateStmt.free();
      }

      // Count savings rows that now have a keeper_id
      const stmtMigratedCount = dbInstance.prepare("SELECT COUNT(*) as count FROM savings WHERE keeper_id IS NOT NULL");
      if (stmtMigratedCount.step()) {
        savingsMigrated = stmtMigratedCount.getAsObject().count;
      }
      stmtMigratedCount.free();

      saveDbToFile();
      console.log(`[MIGRATION LOG] SQLite migration complete: Created ${keepersCreated} keepers. Migrated ${savingsMigrated} savings rows.`);
    }
  } catch (err) {
    console.error('Failed SQLite migration:', err);
  }
}

/**
 * Idempotent startup migration for JSON fallback
 */
function runJsonMigrations() {
  if (dbType !== 'json') return;

  if (!jsonDbData.keepers) jsonDbData.keepers = [];
  if (!jsonDbData.savings) jsonDbData.savings = [];

  const keepersCount = jsonDbData.keepers.length;
  const savingsCount = jsonDbData.savings.length;

  if (keepersCount === 0 && savingsCount > 0) {
    console.log('Running JSON savings-to-keepers migration...');
    const distinctNames = [...new Set(jsonDbData.savings
      .map(s => s.keeperName)
      .filter(name => name && name.trim() !== '')
    )];

    let keepersCreated = 0;
    let savingsMigrated = 0;

    for (const name of distinctNames) {
      // Idempotency: check if keeper with name already exists (case-insensitive)
      let existingKeeper = jsonDbData.keepers.find(k => k.name.toLowerCase() === name.toLowerCase());
      let id = existingKeeper ? existingKeeper.id : null;

      const createdAt = new Date().toISOString();

      if (!id) {
        id = 'keeper_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
        jsonDbData.keepers.push({
          id,
          name,
          type: 'person',
          created_at: createdAt
        });
        keepersCreated++;
      }

      // Update saving records where keeper_id is not set
      jsonDbData.savings.forEach(s => {
        if (s.keeperName === name && !s.keeper_id) {
          s.keeper_id = id;
          savingsMigrated++;
        }
      });
    }

    if (keepersCreated > 0 || savingsMigrated > 0) {
      saveJsonDb();
    }
    console.log(`[MIGRATION LOG] JSON migration complete: Created ${keepersCreated} keepers. Migrated ${savingsMigrated} savings rows.`);
  }
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
      try { dbInstance.run('DELETE FROM bills'); } catch (e) { /* table may not exist yet */ }
      try { dbInstance.run('DELETE FROM bill_payments'); } catch (e) { /* table may not exist yet */ }
      saveDbToFile();
      console.log('Database reset: all transactions, loans, savings, bills, and settings cleared.');
    } catch (err) {
      console.error('sql.js resetAll failed:', err);
    }
  } else {
    jsonDbData.transactions = [];
    jsonDbData.settings = {};
    jsonDbData.loans = [];
    jsonDbData.savings = [];
    jsonDbData.bills = [];
    jsonDbData.billPayments = [];
    saveJsonDb();
    console.log('JSON database reset: all transactions, loans, savings, bills, and settings cleared.');
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

// --- BILLS CRUD ---

/**
 * Get all active (non-deleted) bills
 */
function getBills() {
  if (dbType === 'sqlite' && dbInstance) {
    try {
      const stmt = dbInstance.prepare('SELECT * FROM bills WHERE deleted = 0 ORDER BY name ASC');
      const rows = [];
      while (stmt.step()) {
        rows.push(stmt.getAsObject());
      }
      stmt.free();
      return rows;
    } catch (err) {
      console.error('sql.js getBills failed:', err);
      return [];
    }
  } else {
    return (jsonDbData.bills || [])
      .filter(b => !b.deleted)
      .sort((a, b) => a.name.localeCompare(b.name));
  }
}

/**
 * Save or update a single bill (inserts if not exists, updates if exists)
 */
function saveBill(bill) {
  const now = Date.now();
  const billData = {
    id: bill.id,
    name: bill.name,
    amount: parseFloat(bill.amount),
    dueDay: parseInt(bill.dueDay),
    category: bill.category || 'Personal',
    notes: bill.notes || '',
    deleted: bill.deleted ? 1 : 0,
    updated_at: bill.updated_at || now
  };

  if (dbType === 'sqlite' && dbInstance) {
    try {
      const stmt = dbInstance.prepare(`
        INSERT INTO bills (id, name, amount, dueDay, category, notes, deleted, updated_at)
        VALUES ($id, $name, $amount, $dueDay, $category, $notes, $deleted, $updated_at)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          amount = excluded.amount,
          dueDay = excluded.dueDay,
          category = excluded.category,
          notes = excluded.notes,
          deleted = excluded.deleted,
          updated_at = excluded.updated_at
      `);
      stmt.run({
        $id: billData.id,
        $name: billData.name,
        $amount: billData.amount,
        $dueDay: billData.dueDay,
        $category: billData.category,
        $notes: billData.notes,
        $deleted: billData.deleted,
        $updated_at: billData.updated_at
      });
      stmt.free();
      saveDbToFile();
    } catch (err) {
      console.error('sql.js saveBill failed:', err);
    }
  } else {
    if (!jsonDbData.bills) jsonDbData.bills = [];
    const idx = jsonDbData.bills.findIndex(b => b.id === bill.id);
    if (idx > -1) {
      jsonDbData.bills[idx] = { ...jsonDbData.bills[idx], ...billData };
    } else {
      jsonDbData.bills.push(billData);
    }
    saveJsonDb();
  }
  return billData;
}

/**
 * Soft delete a bill by updating its deleted flag.
 * Does NOT touch bill_payments (historical records preserved).
 */
function deleteBill(id) {
  const now = Date.now();
  if (dbType === 'sqlite' && dbInstance) {
    try {
      dbInstance.run('UPDATE bills SET deleted = 1, updated_at = ? WHERE id = ?', [now, id]);
      saveDbToFile();
    } catch (err) {
      console.error('sql.js deleteBill failed:', err);
    }
  } else {
    if (!jsonDbData.bills) jsonDbData.bills = [];
    const idx = jsonDbData.bills.findIndex(b => b.id === id);
    if (idx > -1) {
      jsonDbData.bills[idx].deleted = 1;
      jsonDbData.bills[idx].updated_at = now;
      saveJsonDb();
    }
  }
}

/**
 * Get all bills (including soft-deleted ones) - for sync purposes
 */
function getAllBillsRaw() {
  if (dbType === 'sqlite' && dbInstance) {
    try {
      const stmt = dbInstance.prepare('SELECT * FROM bills');
      const rows = [];
      while (stmt.step()) {
        rows.push(stmt.getAsObject());
      }
      stmt.free();
      return rows;
    } catch (err) {
      console.error('sql.js getAllBillsRaw failed:', err);
      return [];
    }
  } else {
    return jsonDbData.bills || [];
  }
}

/**
 * Sync and merge bills using Last-Write-Wins logic
 */
function syncBills(clientBills) {
  if (!clientBills || !Array.isArray(clientBills)) return [];
  const localBills = getAllBillsRaw();
  const localMap = new Map(localBills.map(b => [b.id, b]));
  const mergedList = [];

  for (const clientBill of clientBills) {
    const localBill = localMap.get(clientBill.id);
    const clientUpdatedAt = clientBill.updated_at || 0;
    const localUpdatedAt = localBill ? (localBill.updated_at || 0) : 0;

    if (!localBill || clientUpdatedAt > localUpdatedAt) {
      const saved = saveBill(clientBill);
      mergedList.push(saved);
      localMap.set(clientBill.id, saved);
    } else {
      mergedList.push(localBill);
    }
  }

  const clientIds = new Set(clientBills.map(b => b.id));
  for (const localBill of localBills) {
    if (!clientIds.has(localBill.id)) {
      mergedList.push(localBill);
    }
  }

  return mergedList;
}

// --- BILL PAYMENTS CRUD ---

/**
 * Get all active (non-deleted) bill payments
 */
function getBillPayments() {
  if (dbType === 'sqlite' && dbInstance) {
    try {
      const stmt = dbInstance.prepare('SELECT * FROM bill_payments WHERE deleted = 0 ORDER BY month DESC');
      const rows = [];
      while (stmt.step()) {
        rows.push(stmt.getAsObject());
      }
      stmt.free();
      return rows;
    } catch (err) {
      console.error('sql.js getBillPayments failed:', err);
      return [];
    }
  } else {
    return (jsonDbData.billPayments || [])
      .filter(bp => !bp.deleted)
      .sort((a, b) => b.month.localeCompare(a.month));
  }
}

/**
 * Save or update a single bill payment (inserts if not exists, updates if exists)
 */
function saveBillPayment(payment) {
  const now = Date.now();
  const paymentData = {
    id: payment.id,
    bill_id: payment.bill_id,
    month: payment.month,
    paid: payment.paid ? 1 : 0,
    paid_date: payment.paid_date || null,
    linked_transaction_id: payment.linked_transaction_id || null,
    deleted: payment.deleted ? 1 : 0,
    updated_at: payment.updated_at || now
  };

  if (dbType === 'sqlite' && dbInstance) {
    try {
      const stmt = dbInstance.prepare(`
        INSERT INTO bill_payments (id, bill_id, month, paid, paid_date, linked_transaction_id, deleted, updated_at)
        VALUES ($id, $bill_id, $month, $paid, $paid_date, $linked_transaction_id, $deleted, $updated_at)
        ON CONFLICT(id) DO UPDATE SET
          bill_id = excluded.bill_id,
          month = excluded.month,
          paid = excluded.paid,
          paid_date = excluded.paid_date,
          linked_transaction_id = excluded.linked_transaction_id,
          deleted = excluded.deleted,
          updated_at = excluded.updated_at
      `);
      stmt.run({
        $id: paymentData.id,
        $bill_id: paymentData.bill_id,
        $month: paymentData.month,
        $paid: paymentData.paid,
        $paid_date: paymentData.paid_date,
        $linked_transaction_id: paymentData.linked_transaction_id,
        $deleted: paymentData.deleted,
        $updated_at: paymentData.updated_at
      });
      stmt.free();
      saveDbToFile();
    } catch (err) {
      console.error('sql.js saveBillPayment failed:', err);
    }
  } else {
    if (!jsonDbData.billPayments) jsonDbData.billPayments = [];
    const idx = jsonDbData.billPayments.findIndex(bp => bp.id === payment.id);
    if (idx > -1) {
      jsonDbData.billPayments[idx] = { ...jsonDbData.billPayments[idx], ...paymentData };
    } else {
      jsonDbData.billPayments.push(paymentData);
    }
    saveJsonDb();
  }
  return paymentData;
}

/**
 * Soft delete a bill payment by updating its deleted flag
 */
function deleteBillPayment(id) {
  const now = Date.now();
  if (dbType === 'sqlite' && dbInstance) {
    try {
      dbInstance.run('UPDATE bill_payments SET deleted = 1, updated_at = ? WHERE id = ?', [now, id]);
      saveDbToFile();
    } catch (err) {
      console.error('sql.js deleteBillPayment failed:', err);
    }
  } else {
    if (!jsonDbData.billPayments) jsonDbData.billPayments = [];
    const idx = jsonDbData.billPayments.findIndex(bp => bp.id === id);
    if (idx > -1) {
      jsonDbData.billPayments[idx].deleted = 1;
      jsonDbData.billPayments[idx].updated_at = now;
      saveJsonDb();
    }
  }
}

/**
 * Get all bill payments (including soft-deleted ones) - for sync purposes
 */
function getAllBillPaymentsRaw() {
  if (dbType === 'sqlite' && dbInstance) {
    try {
      const stmt = dbInstance.prepare('SELECT * FROM bill_payments');
      const rows = [];
      while (stmt.step()) {
        rows.push(stmt.getAsObject());
      }
      stmt.free();
      return rows;
    } catch (err) {
      console.error('sql.js getAllBillPaymentsRaw failed:', err);
      return [];
    }
  } else {
    return jsonDbData.billPayments || [];
  }
}

/**
 * Sync and merge bill payments using Last-Write-Wins logic.
 * Additional dedup: if multiple active payments exist for the same
 * bill_id + month, only the latest (by updated_at) survives.
 */
function syncBillPayments(clientPayments) {
  if (!clientPayments || !Array.isArray(clientPayments)) return [];
  const localPayments = getAllBillPaymentsRaw();
  const localMap = new Map(localPayments.map(bp => [bp.id, bp]));

  // Standard LWW merge by id
  for (const clientBp of clientPayments) {
    const localBp = localMap.get(clientBp.id);
    const clientUpdatedAt = clientBp.updated_at || 0;
    const localUpdatedAt = localBp ? (localBp.updated_at || 0) : 0;

    if (!localBp || clientUpdatedAt > localUpdatedAt) {
      const saved = saveBillPayment(clientBp);
      localMap.set(clientBp.id, saved);
    }
  }

  // Dedup pass: group active payments by bill_id + month
  const allMerged = Array.from(localMap.values());
  const activeByKey = new Map();
  for (const bp of allMerged) {
    if (bp.deleted) continue;
    const key = `${bp.bill_id}|${bp.month}`;
    const existing = activeByKey.get(key);
    if (!existing) {
      activeByKey.set(key, bp);
    } else {
      const keepBp = (bp.updated_at || 0) > (existing.updated_at || 0) ? bp : existing;
      const loseBp = keepBp === bp ? existing : bp;
      deleteBillPayment(loseBp.id);
      activeByKey.set(key, keepBp);
    }
  }

  return getAllBillPaymentsRaw();
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
  getKeepers,
  saveKeeper,
  deleteKeeper,
  isKeeperReferenced,
  syncKeepers,
  getBills,
  getAllBillsRaw,
  saveBill,
  deleteBill,
  syncBills,
  getBillPayments,
  getAllBillPaymentsRaw,
  saveBillPayment,
  deleteBillPayment,
  syncBillPayments,
  resetAll
};

