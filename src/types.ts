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

export interface SavingsEntry {
  id: string;
  keeperName: string; // person/bank name holding the money
  amount: number;
  date: string; // YYYY-MM-DD
  notes?: string;
  status: 'kept' | 'withdrawn'; // kept = still with them, withdrawn = returned to me
  updated_at?: number;
}
