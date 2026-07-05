import { Transaction } from '../types';

const DB_NAME = 'bujet_mobile_db';
const DB_VERSION = 1;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('transactions')) {
        db.createObjectStore('transactions', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };
  });
}

export async function getTransactions(): Promise<Transaction[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('transactions', 'readonly');
    const store = transaction.objectStore(transaction.objectStoreNames[0] || 'transactions');
    const request = store.getAll();

    request.onsuccess = () => {
      // Return sorted by date descending, filtering out deleted ones for normal consumption
      const list = (request.result as Transaction[]) || [];
      resolve(list.sort((a, b) => b.date.localeCompare(a.date)));
    };
    request.onerror = () => reject(request.error);
  });
}

export async function getRawTransactions(): Promise<Transaction[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('transactions', 'readonly');
    const store = transaction.objectStore('transactions');
    const request = store.getAll();

    request.onsuccess = () => {
      resolve((request.result as Transaction[]) || []);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function saveTransactions(txs: Transaction[]): Promise<void> {
  if (txs.length === 0) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('transactions', 'readwrite');
    const store = transaction.objectStore('transactions');

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);

    for (const tx of txs) {
      // Normalize amount as a number
      const txCopy = {
        ...tx,
        amount: Number(tx.amount),
        deleted: tx.deleted ? 1 : 0
      };
      store.put(txCopy);
    }
  });
}

export async function saveTransaction(tx: Transaction): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('transactions', 'readwrite');
    const store = transaction.objectStore('transactions');

    // Normalize amount as a number
    const txCopy = {
      ...tx,
      amount: Number(tx.amount),
      deleted: tx.deleted ? 1 : 0
    };

    const request = store.put(txCopy);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function clearTransactions(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('transactions', 'readwrite');
    const store = transaction.objectStore('transactions');
    const request = store.clear();

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function getSetting<T = any>(key: string): Promise<T | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('settings', 'readonly');
    const store = transaction.objectStore('settings');
    const request = store.get(key);

    request.onsuccess = () => {
      if (request.result) {
        resolve(request.result.value as T);
      } else {
        resolve(null);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

export async function saveSetting(key: string, value: any): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('settings', 'readwrite');
    const store = transaction.objectStore('settings');
    const request = store.put({ key, value });

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function getSettings(): Promise<Record<string, any>> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('settings', 'readonly');
    const store = transaction.objectStore('settings');
    const request = store.getAll();

    request.onsuccess = () => {
      const list = request.result || [];
      const map: Record<string, any> = {};
      for (const item of list) {
        map[item.key] = item.value;
      }
      resolve(map);
    };
    request.onerror = () => reject(request.error);
  });
}
