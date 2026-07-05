export type LedgerType = 'Business' | 'Personal';

export interface Transaction {
  id: string;
  date: string; // YYYY-MM-DD
  description: string;
  category: LedgerType;
  amount: number;
  status: 'CLEARED' | 'PENDING';
  deleted?: boolean | number; // boolean or 0/1 integer
  updated_at?: number; // timestamp
}

export interface LedgerSummary {
  totalIncome: number;
  totalExpenses: number;
  netBalance: number;
  growthTrend: number;
}
