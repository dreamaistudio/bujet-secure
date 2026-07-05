import { Transaction } from "./types";

export const initialTransactions: Transaction[] = [
  { id: "tx001", date: "2026-05-28", description: "Client Invoice #1042 — Web Dev", category: "Business", amount: 850000, status: "CLEARED" },
  { id: "tx002", date: "2026-05-29", description: "AWS Cloud Hosting — May", category: "Business", amount: -45000, status: "CLEARED" },
  { id: "tx003", date: "2026-05-30", description: "Freelance Logo Design", category: "Business", amount: 125000, status: "CLEARED" },
  { id: "tx004", date: "2026-05-31", description: "Office Rent — June", category: "Business", amount: -180000, status: "CLEARED" },
  { id: "tx005", date: "2026-06-01", description: "Google Workspace Subscription", category: "Business", amount: -8500, status: "PENDING" },
  { id: "tx006", date: "2026-06-01", description: "Client Payment — SEO Audit", category: "Business", amount: 320000, status: "CLEARED" },
  { id: "tx007", date: "2026-06-02", description: "Domain & SSL Renewal", category: "Business", amount: -12500, status: "CLEARED" },
  { id: "tx008", date: "2026-06-03", description: "Consultation Fee — Strategy", category: "Business", amount: 275000, status: "PENDING" },

  { id: "tx009", date: "2026-05-27", description: "Monthly Salary Deposit", category: "Personal", amount: 450000, status: "CLEARED" },
  { id: "tx010", date: "2026-05-28", description: "Grocery Shopping — Keells", category: "Personal", amount: -18500, status: "CLEARED" },
  { id: "tx011", date: "2026-05-29", description: "Electricity Bill — May", category: "Personal", amount: -7200, status: "CLEARED" },
  { id: "tx012", date: "2026-05-30", description: "Freelance Side Gig", category: "Personal", amount: 75000, status: "CLEARED" },
  { id: "tx013", date: "2026-06-01", description: "Fuel — Petrol", category: "Personal", amount: -12000, status: "CLEARED" },
  { id: "tx014", date: "2026-06-02", description: "Netflix + Spotify Subs", category: "Personal", amount: -4500, status: "PENDING" },
  { id: "tx015", date: "2026-06-03", description: "Birthday Gift for Mom", category: "Personal", amount: -15000, status: "CLEARED" },
];

export const STORAGE_KEYS = {
  transactions: "finance_vault_transactions",
  settings: "finance_vault_settings",
  lockout: "finance_vault_lockout",
  loans: "finance_vault_loans",
  savings: "finance_vault_savings",
};
