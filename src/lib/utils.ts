import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const currencySymbols: Record<string, string> = {
  LKR: "LKR",
  USD: "$",
};

export const formatCurrency = (amount: number, currency: string = "LKR") => {
  const isNegative = amount < 0;
  const absoluteAmount = Math.abs(amount);

  const formattedNumber = absoluteAmount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const sign = isNegative ? "-" : amount > 0 ? "+" : "";
  const prefix = currencySymbols[currency] ?? currency;

  return {
    value: `${sign}${formattedNumber}`,
    fullVal: `${prefix} ${sign}${formattedNumber}`,
    isNegative,
  };
};

export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}

export function getTodayString(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return "N/A";

  // Parse YYYY-MM-DD strings directly to avoid timezone shift from new Date()
  const isoMatch = dateString.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    return `${d}/${m}/${y}`;
  }

  // Fallback for other date formats
  const parsed = new Date(dateString);
  if (isNaN(parsed.getTime())) {
    return "Invalid Date";
  }

  const y = parsed.getFullYear();
  const m = String(parsed.getMonth() + 1).padStart(2, "0");
  const d = String(parsed.getDate()).padStart(2, "0");
  
  return `${d}/${m}/${y}`;
}
