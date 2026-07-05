import { X } from "lucide-react";
import { useState } from "react";
import { Transaction, LedgerType } from "../types";
import { cn, generateId, getTodayString } from "../lib/utils";

interface AddTransactionModalProps {
  onClose: () => void;
  onAdd: (tx: Transaction) => void;
  onEdit?: (tx: Transaction) => void;
  editingTransaction?: Transaction | null;
}

export function AddTransactionModal({ onClose, onAdd, onEdit, editingTransaction }: AddTransactionModalProps) {
  const [description, setDescription] = useState(editingTransaction ? editingTransaction.description : "");
  const [amount, setAmount] = useState(editingTransaction ? Math.abs(editingTransaction.amount).toString() : "");
  const [category, setCategory] = useState<LedgerType>(editingTransaction ? editingTransaction.category : "Business");
  const [txType, setTxType] = useState<"income" | "expense">(
    editingTransaction ? (editingTransaction.amount < 0 ? "expense" : "income") : "income"
  );
  const [date, setDate] = useState(editingTransaction ? editingTransaction.date : getTodayString());
  const [status, setStatus] = useState<"CLEARED" | "PENDING">(editingTransaction ? editingTransaction.status : "CLEARED");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = () => {
    const e: Record<string, string> = {};
    if (!description.trim()) e.description = "Description is required.";
    const numAmt = parseFloat(amount);
    if (!amount || isNaN(numAmt) || numAmt <= 0) e.amount = "Enter a valid positive amount.";
    
    if (!date) {
      e.date = "Date is required.";
    } else {
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(date)) {
        e.date = "Format must be YYYY-MM-DD.";
      } else {
        const parsed = new Date(date);
        if (isNaN(parsed.getTime())) {
          e.date = "Invalid date.";
        } else if (parsed.getFullYear() < 2000 || parsed.getFullYear() > 2100) {
          e.date = "Year must be between 2000 and 2100.";
        }
      }
    }

    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = () => {
    if (!validate()) return;
    const numAmt = parseFloat(amount);
    const finalAmount = txType === "expense" ? -Math.abs(numAmt) : Math.abs(numAmt);
    
    if (editingTransaction && onEdit) {
      onEdit({
        ...editingTransaction,
        description: description.trim(),
        amount: finalAmount,
        category,
        date,
        status,
        updated_at: Date.now(),
      });
    } else {
      const now = new Date();
      const time = now.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit',
        second: '2-digit',
        hour12: false 
      });
      onAdd({
        id: generateId(),
        description: description.trim(),
        amount: finalAmount,
        category,
        date,
        time,
        status,
        updated_at: Date.now(),
      });
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#09090b]/80 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-[var(--color-surface-variant)] border border-[var(--color-outline)] rounded-lg overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-[var(--color-outline)] bg-[var(--color-surface)]">
          <h2 className="text-lg font-bold text-[var(--color-on-surface)] tracking-tight">
            {editingTransaction ? "Edit Transaction" : "New Transaction"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-[var(--color-on-surface-variant)] hover:text-[var(--color-error)] transition-colors p-1 cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-5">
          {/* Type Selector */}
          <div>
            <div className="flex border border-[var(--color-outline)] rounded overflow-hidden bg-[var(--color-surface)]">
              <button
                type="button"
                onClick={() => setTxType("income")}
                className={cn(
                  "flex-1 py-2.5 text-sm font-bold transition-colors cursor-pointer",
                  txType === "income"
                    ? "bg-[#22c55e] text-black"
                    : "bg-[#18181b] text-[#a1a1aa] hover:text-[#fafafa]"
                )}
              >
                Income
              </button>
              <button
                type="button"
                onClick={() => setTxType("expense")}
                className={cn(
                  "flex-1 py-2.5 text-sm font-bold transition-colors cursor-pointer",
                  txType === "expense"
                    ? "bg-[#ef4444] text-white"
                    : "bg-[#18181b] text-[#a1a1aa] hover:text-[#fafafa]"
                )}
              >
                Expense
              </button>
            </div>
          </div>

          {/* Amount */}
          <div>
            <label className="text-[10px] font-bold tracking-wider text-[var(--color-on-surface-variant)] uppercase block mb-1.5">Amount</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => { setAmount(e.target.value); setErrors(prev => ({...prev, amount: ''})); }}
              placeholder="0.00"
              className="w-full bg-[var(--color-background)] border border-[var(--color-outline)] text-[var(--color-on-surface)] text-lg font-bold rounded px-3 py-2.5 outline-none focus:border-[var(--color-primary)] font-mono"
            />
            {errors.amount && <p className="text-[var(--color-error)] text-xs mt-1">{errors.amount}</p>}
          </div>

          {/* Description */}
          <div>
            <label className="text-[10px] font-bold tracking-wider text-[var(--color-on-surface-variant)] uppercase block mb-1.5">Description</label>
            <input
              type="text"
              value={description}
              onChange={(e) => { setDescription(e.target.value); setErrors(prev => ({...prev, description: ''})); }}
              placeholder="e.g. Client Invoice #1042"
              className="w-full bg-[var(--color-background)] border border-[var(--color-outline)] text-[var(--color-on-surface)] text-[13px] rounded px-3 py-2 outline-none focus:border-[var(--color-primary)] font-mono"
            />
            {errors.description && <p className="text-[var(--color-error)] text-xs mt-1">{errors.description}</p>}
          </div>

          {/* Category & Date Grid */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-bold tracking-wider text-[var(--color-on-surface-variant)] uppercase block mb-1.5">Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as LedgerType)}
                className="w-full bg-[var(--color-background)] border border-[var(--color-outline)] text-[var(--color-on-surface)] font-mono text-[13px] rounded px-3 py-2 outline-none focus:border-[var(--color-primary)]"
              >
                <option value="Business">Business</option>
                <option value="Personal">Personal</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold tracking-wider text-[var(--color-on-surface-variant)] uppercase block mb-1.5">Date</label>
              <input
                type="date"
                value={date}
                onChange={(e) => { setDate(e.target.value); setErrors(prev => ({...prev, date: ''})); }}
                className="w-full bg-[var(--color-background)] border border-[var(--color-outline)] text-[var(--color-on-surface)] font-mono text-[13px] rounded px-3 py-2 outline-none focus:border-[var(--color-primary)]"
              />
              {errors.date && <p className="text-[var(--color-error)] text-xs mt-1">{errors.date}</p>}
            </div>
          </div>

          {/* Status */}
          <div>
            <div className="flex border border-[var(--color-outline)] rounded overflow-hidden bg-[var(--color-surface)]">
              <button
                type="button"
                onClick={() => setStatus("CLEARED")}
                className={cn(
                  "flex-1 py-2 text-sm font-medium transition-colors cursor-pointer",
                  status === "CLEARED"
                    ? "bg-white text-black font-semibold"
                    : "bg-[#18181b] text-[#a1a1aa] hover:text-[#fafafa]"
                )}
              >
                Cleared
              </button>
              <button
                type="button"
                onClick={() => setStatus("PENDING")}
                className={cn(
                  "flex-1 py-2 text-sm font-medium transition-colors cursor-pointer",
                  status === "PENDING"
                    ? "bg-white text-black font-semibold"
                    : "bg-[#18181b] text-[#a1a1aa] hover:text-[#fafafa]"
                )}
              >
                Pending
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-between gap-3 p-5 border-t border-[var(--color-outline)] bg-[var(--color-surface)]">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 bg-[var(--color-background)] border border-[var(--color-outline)] text-[var(--color-on-surface)] text-sm rounded hover:bg-[var(--color-outline)] transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            className="px-5 py-2 bg-[#22c55e] text-black font-bold text-sm rounded hover:opacity-90 transition-opacity cursor-pointer"
          >
            {editingTransaction ? "Save Changes" : "Add Transaction"}
          </button>
        </div>
      </div>
    </div>
  );
}
