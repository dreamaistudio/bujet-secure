export type LedgerType = 'Business' | 'Personal';

export interface Transaction {
  id: string;
  date: string; // YYYY-MM-DD
  time?: string; // HH:MM:SS
  description: string;
  category: LedgerType;
  amount: number;
  status: 'CLEARED' | 'PENDING';
  updated_at?: number;
}

export interface LedgerSummary {
  totalIncome: number;
  totalExpenses: number;
  netBalance: number;
  growthTrend: number;
}

export interface LoanEntry {
  id: string;
  type: 'lent' | 'borrowed'; // lent = I gave money, borrowed = I received money
  personName: string;
  reason: string; // reason
  amount: number;
  date: string; // YYYY-MM-DD
  status: 'unpaid' | 'paid'; // whether settled
  updated_at?: number;
}

export interface Keeper {
  id: string;
  name: string;
  type: 'bank' | 'wallet' | 'person';
  created_at?: string;
}

export interface SavingsEntry {
  id: string;
  keeperName: string; // person/bank name holding the money
  keeper_id?: string | null;
  amount: number;
  date: string; // YYYY-MM-DD
  notes?: string;
  status: 'kept' | 'withdrawn'; // kept = still with them, withdrawn = returned to me
  updated_at?: number;
}

export interface Bill {
  id: string;
  name: string;             // e.g. "Rent", "WiFi", "Netflix"
  amount: number;           // monthly amount
  dueDay: number;           // day of month (1–31)
  category: LedgerType;     // 'Business' | 'Personal'
  notes?: string;
  deleted?: number;
  updated_at?: number;
}

export interface BillPayment {
  id: string;
  bill_id: string;                // FK → Bill.id
  month: string;                  // 'YYYY-MM' format
  paid: number;                   // 0 = pending, 1 = paid
  paid_date?: string;             // YYYY-MM-DD when actually paid
  linked_transaction_id?: string; // FK → Transaction.id (if user opted in)
  deleted?: number;
  updated_at?: number;
}
