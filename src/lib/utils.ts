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

/**
 * The same amount, shortened: "LKR 1.25M" rather than "LKR 1,250,000.00".
 *
 * The three figures at the top of the dashboard sit in tiles a third of a
 * phone screen wide. A full amount cannot be shown there at a size anyone can
 * read, so on a phone the figure is shortened instead of the type being
 * shrunk. The exact amount is still shown on wider screens, and is kept on the
 * element's title so it is never actually lost.
 */
export const formatCompactCurrency = (amount: number, currency: string = "LKR") => {
  const prefix = currencySymbols[currency] ?? currency;
  const sign = amount < 0 ? "-" : amount > 0 ? "+" : "";
  const abs = Math.abs(amount);

  const units: Array<[number, string]> = [
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"]
  ];

  for (const [size, suffix] of units) {
    if (abs >= size) {
      const scaled = abs / size;
      // One decimal is enough to tell 1.2M from 1.3M; past 100 it is noise.
      const shown = scaled >= 100 ? scaled.toFixed(0) : scaled.toFixed(1).replace(/\.0$/, "");
      return `${prefix} ${sign}${shown}${suffix}`;
    }
  }

  return `${prefix} ${sign}${abs.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
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
