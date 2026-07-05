import { CheckCircle, CheckCircle2, Clock, Download, Search, Trash2, FileDown, Pencil } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Transaction } from "../types";
import { cn, formatCurrency, formatDate } from "../lib/utils";
import { jsPDF } from "jspdf";

interface TransactionsProps {
  transactions: Transaction[];
  currency: string;
  onDelete: (id: string) => void;
  onRestore: (tx: Transaction) => void;
  onMarkCleared: (id: string) => void;
  businessLedgerName: string;
  personalLedgerName: string;
  onEditClick: (tx: Transaction) => void;
}

interface ClearedToast {
  id: string;
  description: string;
  amount: number;
  timer: ReturnType<typeof setTimeout>;
}

const UNDO_DURATION = 5000;
const CLEARED_TOAST_DURATION = 3000;

const formatTxTime = (timeStr?: string) => {
  if (!timeStr) return "";
  const parts = timeStr.split(":");
  if (parts.length < 2) return timeStr;
  const hours = parseInt(parts[0], 10);
  const minutes = parts[1];
  const ampm = hours >= 12 ? "PM" : "AM";
  const displayHours = hours % 12 || 12;
  return `${String(displayHours).padStart(2, "0")}:${minutes} ${ampm}`;
};

export function Transactions({
  transactions,
  currency,
  onDelete,
  onRestore,
  onMarkCleared,
  businessLedgerName,
  personalLedgerName,
  onEditClick,
}: TransactionsProps) {
  const [filter, setFilter] = useState<"All" | "Business" | "Personal">("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<
    'latest' | 'oldest' | 'income_only' | 'expense_only' | 'highest_income' | 'highest_expense'
  >('latest');
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [clearedToasts, setClearedToasts] = useState<ClearedToast[]>([]);
  const clearedToastsRef = useRef(clearedToasts);
  clearedToastsRef.current = clearedToasts;

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      clearedToastsRef.current.forEach((item) => clearTimeout(item.timer));
    };
  }, []);

  const filteredTxs = useMemo(() => {
    const filtered = transactions.filter((tx) => {
      const matchesFilter = filter === "All" ? true : tx.category === filter;
      const matchesSearch = tx.description.toLowerCase().includes(searchQuery.toLowerCase());
      const typeMatch = 
        sortBy === 'income_only' ? tx.amount > 0 :
        sortBy === 'expense_only' ? tx.amount < 0 :
        true;
      return matchesFilter && matchesSearch && typeMatch;
    });

    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'oldest':
          return a.date.localeCompare(b.date) || 
                 (a.time || '').localeCompare(b.time || '');
        case 'highest_income':
          return b.amount - a.amount;
        case 'highest_expense':
          return a.amount - b.amount;
        default: // latest
          return b.date.localeCompare(a.date) || 
                 (b.time || '').localeCompare(a.time || '');
      }
    });

    return filtered;
  }, [transactions, filter, searchQuery, sortBy]);

  const handleDelete = useCallback(
    (tx: Transaction) => {
      onDelete(tx.id);
    },
    [onDelete]
  );

  const handleMarkReceived = useCallback(
    (tx: Transaction) => {
      onMarkCleared(tx.id);
      setConfirmingId(null);

      const toastId = tx.id + "_cleared_" + Date.now();
      const timer = setTimeout(() => {
        setClearedToasts((prev) => prev.filter((t) => t.id !== toastId));
      }, CLEARED_TOAST_DURATION);

      setClearedToasts((prev) => [
        ...prev,
        { id: toastId, description: tx.description, amount: tx.amount, timer },
      ]);
    },
    [onMarkCleared]
  );

  const downloadFile = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportCSV = () => {
    if (filteredTxs.length === 0) return;
    const escapeCSV = (field: string): string => {
      const escaped = field.replace(/"/g, '""');
      return `"${escaped}"`;
    };
    const headers = ["Date", "Description", "Category", "Amount", "Status"];
    const rows = filteredTxs.map((tx) => [
      escapeCSV(tx.date),
      escapeCSV(tx.description),
      escapeCSV(tx.category),
      escapeCSV(tx.amount.toString()),
      escapeCSV(tx.status)
    ]);
    const csv = [headers.map(h => escapeCSV(h)).join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const filename = `transactions_${new Date().toISOString().slice(0, 10)}.csv`;
    downloadFile(blob, filename);
  };

  const loadImageAsBase64 = async (url: string): Promise<string> => {
    const response = await fetch(url);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  const handleExportPDF = async () => {
    if (filteredTxs.length === 0) {
      alert("No transactions to export with current filters.");
      return;
    }

    try {
      console.log('PDF Header: Starting generation');
      const doc = new jsPDF();
      const pageWidth = doc.internal.pageSize.width;
      const pageHeight = doc.internal.pageSize.height;

      // Draw real app logo at top-right
      try {
        const logoBase64 = await loadImageAsBase64('/icon.png');
        doc.addImage(logoBase64, 'PNG', 165, 12, 20, 20);
      } catch (err) {
        console.warn('Logo failed to load for PDF:', err);
        // Skip logo entirely, don't draw fake placeholder
      }

      // Title - Y=20
      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      doc.setTextColor(20, 20, 20);
      doc.text("BUJET SECURE - TRANSACTION STATEMENT", 14, 20);

      // Subtitle - Y=30 (Generated date, gray 100,100,100)
      doc.setFontSize(9);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(100, 100, 100);
      doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 30);

      // Info block - Y=38, 44, 50 (4mm gap after subtitle line)
      doc.setTextColor(110, 110, 110);
      doc.text(`Currency:  ${currency}`, 14, 38);
      doc.text(`Ledger:    ${filter === 'Business' ? businessLedgerName : filter === 'Personal' ? personalLedgerName : 'All'}`, 14, 44);
      doc.text(`Transactions: ${filteredTxs.length}`, 14, 50);

      // Thousands separators formatting
      const fmtNum = (n: number) =>
        Math.abs(n).toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });

      // Summary calculations
      let income = 0;
      let expense = 0;
      filteredTxs.forEach((t) => {
        if (t.amount > 0) income += t.amount;
        else expense += Math.abs(t.amount);
      });
      const net = income - expense;

      console.log('PDF Summary Box: Drawing values');
      // Summary box background - Light gray filled rounded rect (from y=58 to y=85)
      doc.setFillColor(248, 249, 250);
      doc.setDrawColor(225, 228, 232);
      doc.setLineWidth(0.5);
      doc.roundedRect(14, 58, 182, 27, 3, 3, "FD");

      // Summary box contents - y=66, 72, 80 (with minimum 6mm vertical gap)
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(40, 40, 40);
      doc.text(`Total Income:   ${currency} ${fmtNum(income)}`, 20, 66);
      doc.text(`Total Expenses: ${currency} ${fmtNum(expense)}`, 20, 72);

      if (net < 0) {
        doc.setTextColor(220, 38, 38); // Red
      } else {
        doc.setTextColor(22, 163, 74); // Green
      }
      doc.setFont("helvetica", "bold");
      doc.text(`Net Balance:    ${currency} ${net < 0 ? "-" : ""}${fmtNum(net)}`, 20, 80);

      // --- Column positions (Fix #1: Increased gap to prevent status/amount overlap) ---
      const colDate = 14;
      const colDesc = 48;
      const colCat = 112;
      const colStatus = 145; // Status starts at x=145, max width 30
      const colAmt = 195;    // Amount right-aligned at x=195

      console.log('PDF Table Headers: Drawing at Y:', 95);
      // Helper: draw table headers with lines above and below
      const drawTableHeaders = (yPos: number) => {
        doc.setDrawColor(200, 205, 210);
        doc.setLineWidth(0.5);
        // Horizontal line above header row
        doc.line(14, yPos - 4.5, 196, yPos - 4.5);

        // Header text elements - explicitly set to 10
        doc.setFontSize(10);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(20, 20, 20); // Reset header color
        doc.text("Date", colDate, yPos);
        doc.text("Description", colDesc, yPos);
        doc.text("Category", colCat, yPos);
        doc.text("Status", colStatus, yPos);
        doc.text("Amount", colAmt, yPos, { align: "right" });

        // Horizontal line below header row
        doc.line(14, yPos + 1.5, 196, yPos + 1.5);
      };

      // Draw first page table headers
      drawTableHeaders(95);

      // Table Rows (Row height >= 7mm, start y at 103)
      console.log('PDF Table Rows: Processing rows');
      let y = 103;
      let pageNum = 1;

      const hasNonLatin = (text: string) => /[^\u0000-\u024F]/.test(text);

      const safeText = (text: string, maxLen: number): string => {
        if (hasNonLatin(text)) {
          const safeChars = text.replace(/[^\u0000-\u024F]/g, "").trim();
          const preview = safeChars.length > 0 ? safeChars.slice(0, 15) + " " : "";
          return `${preview}[See app for full text]`;
        }
        if (text.length > maxLen) {
          return text.slice(0, maxLen - 3) + "...";
        }
        return text;
      };

      filteredTxs.forEach((tx) => {
        // Leave room for footer line at pageHeight - 25
        if (y > pageHeight - 32) {
          doc.addPage();
          pageNum++;
          drawTableHeaders(15);
          y = 23;
        }

        doc.setFontSize(9);  // RESET every row
        doc.setFont('helvetica', 'normal');  // RESET font weight too

        const formattedDate = formatDate(tx.date);
        const timeStr = tx.time ? ` ${formatTxTime(tx.time)}` : "";
        const dateTimeStr = `${formattedDate}${timeStr}`;

        const shortDesc = safeText(tx.description, 40);
        const shortCat = tx.category.length > 13 ? tx.category.slice(0, 10) + "..." : tx.category;
        const amtStr = `${tx.amount < 0 ? "-" : ""}${currency} ${fmtNum(tx.amount)}`;

        // Row output - reset font size and weight to standard row style (9pt, normal, gray)
        doc.setFontSize(9);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(60, 60, 60);
        doc.text(dateTimeStr, colDate, y);
        doc.text(shortDesc, colDesc, y);
        doc.text(shortCat, colCat, y);

        doc.setFontSize(9);  // RESET again before status
        doc.setFontSize(8);  // Set to 8 to print status at smaller font size
        if (tx.status === "PENDING") {
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(200, 150, 0); // Amber/yellow
        } else {
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(34, 197, 94); // Green
        }
        const statusText = tx.status === "PENDING" ? "PENDING" : "CLEARED";
        doc.text(statusText, colStatus, y);

        doc.setFontSize(9);  // RESET again before amount
        doc.setFont('helvetica', 'normal');
        if (tx.amount < 0) {
          doc.setFont("helvetica", "bold");
          doc.setTextColor(220, 38, 38); // Red
        } else {
          doc.setFont("helvetica", "bold");
          doc.setTextColor(22, 163, 74); // Green
        }
        doc.text(amtStr, colAmt, y, { align: "right" });

        // Reset text color for safety
        doc.setTextColor(60, 60, 60);
        doc.setFont("helvetica", "normal");

        y += 8; // Row height >= 7mm
      });

      // Footer - always runs once at the end across all generated pages
      console.log('Drawing footer');
      const totalPages = doc.getNumberOfPages();
      for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.setDrawColor(200, 200, 200);
        doc.setLineWidth(0.5);
        doc.line(14, pageHeight - 25, 196, pageHeight - 25);

        doc.setFontSize(9);
        doc.setTextColor(120, 120, 120);
        doc.setFont('helvetica', 'normal');
        // Centered at X=105 (approx center of 14 to 196 width)
        doc.text('By Dream AI Studio', 105, pageHeight - 18, { align: 'center' });
        // Page number opposite of footer text
        doc.text(`Page ${i}`, 196, pageHeight - 18, { align: 'right' });
      }

      // Save using download helper
      const now = new Date();
      const timestamp = `${now.toISOString().slice(0, 10)}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
      const filename = `finance_statement_${timestamp}.pdf`;
      console.log("Saving PDF as:", filename);
      const blob = doc.output("blob");
      downloadFile(blob, filename);
    } catch (err) {
      console.error("PDF export failed:", err);
      alert("Failed to export PDF. Please try again.");
    }
  };

  const ledgerTxs = useMemo(() => {
    return transactions.filter((t) => filter === "All" ? true : t.category === filter);
  }, [transactions, filter]);

  const summaryTotals = useMemo(() => {
    const clearedTxs = ledgerTxs.filter((t) => t.status === "CLEARED");
    const pendingTxs = ledgerTxs.filter((t) => t.status === "PENDING");

    let income = 0;
    let expense = 0;
    clearedTxs.forEach((t) => {
      if (t.amount > 0) income += t.amount;
      else expense += Math.abs(t.amount);
    });
    const net = income - expense;

    let pendingNet = 0;
    pendingTxs.forEach((t) => {
      pendingNet += t.amount;
    });

    return {
      income,
      expense,
      net,
      pendingNet,
      hasPending: pendingTxs.length > 0
    };
  }, [ledgerTxs]);

  return (
    <div className="p-6 h-full flex flex-col gap-6 relative">
      {/* TABS NAVIGATION */}
      <div className="flex border-b border-[var(--color-outline)] shrink-0 bg-[var(--color-surface-variant)] rounded-t overflow-hidden">
        {[
          { key: "All", label: "All", count: transactions.length },
          { key: "Business", label: `💼 ${businessLedgerName}`, count: transactions.filter(t => t.category === "Business").length },
          { key: "Personal", label: `👤 ${personalLedgerName}`, count: transactions.filter(t => t.category === "Personal").length }
        ].map(({ key, label, count }) => {
          const isActive = filter === key;
          return (
            <button
              key={key}
              onClick={() => setFilter(key as any)}
              className={cn(
                "flex-1 py-4 text-center text-sm font-bold transition-all border-b-4 cursor-pointer flex items-center justify-center gap-2",
                isActive
                  ? "text-[var(--color-secondary)] border-[var(--color-secondary)] bg-[var(--color-surface)]"
                  : "text-[var(--color-on-surface-variant)] border-transparent hover:text-white hover:bg-[var(--color-surface)]/50"
              )}
            >
              <span>{label}</span>
              <span className={cn(
                "px-2 py-0.5 rounded-full text-[10px] font-bold font-mono",
                isActive ? "bg-[var(--color-secondary)]/20 text-[var(--color-secondary)]" : "bg-[var(--color-outline)] text-[var(--color-on-surface-variant)]"
              )}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* FILTERED TOTALS SUMMARY BAR */}
      {filter !== "All" && (
        <div className="bg-[var(--color-surface-variant)] border border-[var(--color-outline)] p-4 rounded shrink-0 flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="text-sm font-bold text-[var(--color-on-surface)] flex items-center gap-1.5">
                {filter === "Business" ? "💼" : "👤"} {filter === "Business" ? businessLedgerName : personalLedgerName}
              </h3>
              <p className="text-[11px] text-[var(--color-on-surface-variant)] mt-0.5">
                Current ledger overview (all search queries match)
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-xs md:text-sm">
              <div>
                <span className="text-[var(--color-on-surface-variant)]">Income: </span>
                <span className="text-[var(--color-secondary)] font-bold">{formatCurrency(summaryTotals.income, currency).fullVal}</span>
              </div>
              <div>
                <span className="text-[var(--color-on-surface-variant)]">Expenses: </span>
                <span className="text-[var(--color-error)] font-bold">{formatCurrency(-summaryTotals.expense, currency).fullVal}</span>
              </div>
              <div className={cn("px-2 py-0.5 rounded border font-bold", summaryTotals.net >= 0 ? "bg-green-900/20 border-[#22c55e]/30 text-[#22c55e]" : "bg-red-900/20 border-[#ef4444]/30 text-[#ef4444]")}>
                <span>Net: </span>
                <span>{formatCurrency(summaryTotals.net, currency).fullVal}</span>
              </div>
            </div>
          </div>
          {summaryTotals.hasPending && (
            <div className="border-t border-[var(--color-outline)] pt-2.5 flex justify-end">
              <span className="text-xs font-mono text-[#f59e0b] font-bold flex items-center gap-1">
                ⏳ Pending: {formatCurrency(summaryTotals.pendingNet, currency).fullVal} (not included in balance)
              </span>
            </div>
          )}
        </div>
      )}

      {/* SEARCH & EXPORT ACTIONS */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 shrink-0 bg-[var(--color-surface-variant)] border border-[var(--color-outline)] p-4 rounded">
        <div className="flex flex-col sm:flex-row gap-4 w-full sm:w-auto">
          <div className="flex flex-col gap-1 w-full sm:w-auto">
            <label className="text-[10px] font-bold tracking-wider text-[var(--color-on-surface-variant)] uppercase">Search Description</label>
            <div className="flex border border-[var(--color-outline)] rounded bg-[var(--color-surface)] focus-within:border-[var(--color-primary)] items-center px-2 h-[34px] w-full sm:w-[280px]">
              <Search size={16} className="text-[var(--color-on-surface-variant)] mr-2 shrink-0" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search description..."
                className="bg-transparent border-none outline-none text-white font-mono text-[13px] w-full p-0 placeholder:text-[var(--color-outline-variant)]"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1 w-full sm:w-auto">
            <label className="text-[10px] font-bold tracking-wider text-[var(--color-on-surface-variant)] uppercase">SORT BY</label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="bg-[#09090b] border border-[#27272a] text-[#fafafa] rounded px-3 py-1.5 text-sm h-[34px] outline-none cursor-pointer"
            >
              <option value="latest">Latest First</option>
              <option value="oldest">Oldest First</option>
              <option value="income_only">Income Only</option>
              <option value="expense_only">Expenses Only</option>
              <option value="highest_income">Highest Income</option>
              <option value="highest_expense">Highest Expense</option>
            </select>
          </div>
        </div>

        <div className="flex gap-2 w-full sm:w-auto justify-end">
          <button
            onClick={handleExportCSV}
            className="bg-[var(--color-surface-variant)] border border-[var(--color-outline)] px-3 py-1.5 text-sm rounded hover:bg-[var(--color-outline)] transition-colors flex items-center gap-2 cursor-pointer text-white"
          >
            <Download size={16} />
            Export CSV
          </button>
          <button
            onClick={handleExportPDF}
            className="bg-[var(--color-surface-variant)] border border-[var(--color-secondary)]/30 text-[var(--color-secondary)] px-3 py-1.5 text-sm rounded hover:bg-[var(--color-secondary)]/10 transition-colors flex items-center gap-2 cursor-pointer"
          >
            <FileDown size={16} />
            Export PDF
          </button>
        </div>
      </div>

      {/* TABLE CONTAINER */}
      <div className="bg-[var(--color-surface-variant)] border border-[var(--color-outline)] rounded overflow-hidden flex-1 flex flex-col min-h-0">
        <div className="overflow-auto flex-1 flex flex-col">
          <table className="w-full text-left border-collapse min-w-[800px]">
            <thead className="sticky top-0 bg-[var(--color-surface-variant)] z-10 shadow-sm border-b border-[var(--color-outline)]">
              <tr>
                <th className="py-3 px-4 text-[10px] font-bold tracking-wider text-[var(--color-on-surface-variant)] uppercase border-r border-[var(--color-outline)] w-[140px]">Date</th>
                <th className="py-3 px-4 text-[10px] font-bold tracking-wider text-[var(--color-on-surface-variant)] uppercase border-r border-[var(--color-outline)]">Description</th>
                <th className="py-3 px-4 text-[10px] font-bold tracking-wider text-[var(--color-on-surface-variant)] uppercase border-r border-[var(--color-outline)] w-[140px]">Category</th>
                <th className="py-3 px-4 text-[10px] font-bold tracking-wider text-[var(--color-on-surface-variant)] uppercase border-r border-[var(--color-outline)] w-[160px] text-right">Amount ({currency})</th>
                <th className="py-3 px-4 text-[10px] font-bold tracking-wider text-[var(--color-on-surface-variant)] uppercase border-r border-[var(--color-outline)] w-[120px]">Status</th>
                <th className="py-3 px-4 text-[10px] font-bold tracking-wider text-[var(--color-on-surface-variant)] uppercase w-[140px] text-center">Action</th>
              </tr>
            </thead>
            <tbody className="font-mono text-[13px] text-[var(--color-on-surface)]">
              {filteredTxs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-[var(--color-on-surface-variant)]">
                    No transactions found.
                  </td>
                </tr>
              ) : (
                filteredTxs.map((tx, idx) => {
                  const amt = formatCurrency(tx.amount, currency);
                  return (
                    <tr
                      key={tx.id}
                      className={cn(
                        "hover:bg-[var(--color-surface-variant)] transition-colors cursor-default border-b border-[var(--color-outline)] group",
                        idx % 2 === 0 ? "bg-[var(--color-surface)]" : "bg-[var(--color-surface-lowest)]"
                      )}
                    >
                      <td className={cn(
                        "py-3 px-4 border-r border-[var(--color-outline)] text-[var(--color-on-surface-variant)] border-l-4",
                        tx.category === "Business" ? "border-l-[#22c55e]" : "border-l-[#3b82f6]"
                      )}>
                        {formatDate(tx.date)}{tx.time ? ` ${formatTxTime(tx.time)}` : ""}
                      </td>
                      <td className="py-3 px-4 border-r border-[var(--color-outline)]">
                        <div className="flex items-center gap-1.5">
                          {tx.status === 'PENDING' && (
                            <span className="inline-flex items-center gap-0.5 text-[#ef4444] text-[10px] font-bold uppercase shrink-0">
                              <Clock size={10} className="text-[#ef4444]" />
                              PENDING
                            </span>
                          )}
                          <span className="truncate">{tx.description}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4 border-r border-[var(--color-outline)]">{tx.category}</td>
                      <td
                        className={cn(
                          "py-3 px-4 border-r border-[var(--color-outline)] text-right",
                          tx.amount < 0 ? "text-[var(--color-error)]" : "text-[var(--color-secondary)]"
                        )}
                      >
                        {amt.value}
                      </td>
                      <td className="py-3 px-4 border-r border-[var(--color-outline)]">
                        {tx.status === "CLEARED" ? (
                          <span className="inline-block px-2 py-0.5 bg-[var(--color-surface-variant)] border border-[var(--color-secondary)] text-[var(--color-secondary)] text-[10px] uppercase font-bold tracking-wider">
                            Cleared
                          </span>
                        ) : (
                          <span className="inline-block px-2 py-0.5 bg-[var(--color-surface-variant)] border border-yellow-500 text-yellow-500 text-[10px] uppercase font-bold tracking-wider">
                            Pending
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <div className="flex items-center justify-center gap-1">
                          {tx.status === 'PENDING' && confirmingId !== tx.id && (
                            <button
                              onClick={() => setConfirmingId(tx.id)}
                              title="Mark as received"
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#22c55e] text-black text-xs font-bold hover:bg-[#16a34a] active:scale-95 transition-all shadow-sm hover:shadow-md cursor-pointer pulse-action"
                            >
                              <CheckCircle2 size={14} />
                              Mark Received
                            </button>
                          )}
                          {tx.status === 'PENDING' && confirmingId === tx.id && (
                            <div className="flex flex-col items-center gap-1">
                              <span className="text-[10px] text-[var(--color-on-surface-variant)] whitespace-nowrap">
                                Confirm {formatCurrency(Math.abs(tx.amount), currency).fullVal} received?
                              </span>
                              <div className="flex gap-1">
                                <button
                                  onClick={() => handleMarkReceived(tx)}
                                  className="text-[10px] px-2.5 py-0.5 rounded bg-[#22c55e] text-black font-bold cursor-pointer hover:bg-[#16a34a] transition-colors"
                                >
                                  Yes
                                </button>
                                <button
                                  onClick={() => setConfirmingId(null)}
                                  className="text-[10px] px-2.5 py-0.5 rounded border border-[var(--color-outline)] text-[var(--color-on-surface-variant)] cursor-pointer hover:text-white hover:border-[var(--color-on-surface-variant)] transition-colors"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}
                          <button
                            onClick={() => onEditClick(tx)}
                            className="p-1.5 rounded-md opacity-0 group-hover:opacity-100 hover:bg-[#27272a] text-[#a1a1aa] hover:text-[#fafafa] transition-all cursor-pointer flex items-center justify-center shrink-0"
                            title="Edit transaction"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            onClick={() => handleDelete(tx)}
                            title="Delete transaction"
                            className="text-[var(--color-on-surface-variant)] opacity-0 group-hover:opacity-100 hover:text-[var(--color-error)] transition-all p-1 rounded cursor-pointer flex items-center justify-center shrink-0"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="bg-[var(--color-surface-variant)] border-t border-[var(--color-outline)] p-3 flex justify-between items-center shrink-0">
          <span className="text-sm text-[var(--color-on-surface-variant)]">
            {filteredTxs.length === 0 ? "No transactions" : `Showing ${filteredTxs.length} transaction${filteredTxs.length !== 1 ? "s" : ""}`}
          </span>
        </div>
      </div>

      {/* Cleared Success Toast Stack */}
      {clearedToasts.length > 0 && (
        <div className="fixed bottom-6 left-6 z-[200] flex flex-col gap-2">
          {clearedToasts.map((item) => (
            <div
              key={item.id}
              className="bg-[#052e16] border border-[#22c55e]/40 rounded-lg shadow-2xl px-4 py-3 flex items-center gap-3 min-w-[340px] animate-[slideUp_0.25s_ease-out]"
            >
              <CheckCircle size={16} className="text-[#22c55e] shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-[#22c55e] font-semibold truncate">
                  ✓ Marked as received
                </p>
                <p className="text-xs text-[#86efac] truncate">
                  {formatCurrency(Math.abs(item.amount), currency).fullVal} added to balance
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
