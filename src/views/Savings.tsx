import { useState, useMemo, type FormEvent } from "react";
import {
  PiggyBank,
  Plus,
  ArrowDownToLine,
  Trash2,
  X,
  Calendar,
  Landmark,
  FileText,
  Check,
} from "lucide-react";
import { SavingsEntry } from "../types";
import { cn, formatCurrency, formatDate, generateId, getTodayString } from "../lib/utils";

interface SavingsProps {
  savings: SavingsEntry[];
  currency: string;
  onAddSaving: (saving: SavingsEntry) => void;
  onDeleteSaving: (id: string) => void;
  onWithdraw: (id: string, addAsTransaction: boolean) => void;
}

export function Savings({ savings, currency, onAddSaving, onDeleteSaving, onWithdraw }: SavingsProps) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [confirmWithdrawId, setConfirmWithdrawId] = useState<string | null>(null);

  const sortedSavings = useMemo(() => {
    const kept = savings.filter((s) => s.status === "kept");
    const withdrawn = savings.filter((s) => s.status === "withdrawn");
    return [...kept, ...withdrawn];
  }, [savings]);

  const totalKept = useMemo(
    () => savings.filter((s) => s.status === "kept").reduce((sum, s) => sum + s.amount, 0),
    [savings]
  );

  const keptCount = useMemo(
    () => savings.filter((s) => s.status === "kept").length,
    [savings]
  );

  return (
    <div className="p-4 md:p-6 h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 shrink-0 mb-6">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-[var(--color-on-surface)] mb-1 tracking-tight flex items-center gap-2">
            <PiggyBank size={24} className="text-blue-400" />
            Savings / Money Kept with Others
          </h1>
          <p className="text-xs md:text-sm text-[var(--color-on-surface-variant)]">
            Track money you've kept safe with others or in other accounts
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="h-9 px-4 bg-blue-600 text-white text-sm hover:bg-blue-700 transition-colors rounded font-medium flex items-center gap-2 shrink-0"
        >
          <Plus size={16} />
          New Savings Entry
        </button>
      </div>

      {/* Summary Bar */}
      <div className="px-4 py-3 border border-[var(--color-outline)] rounded-t bg-blue-900/10 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <PiggyBank size={16} className="text-blue-400" />
          <p className="text-xs font-bold tracking-wider uppercase text-[var(--color-on-surface-variant)]">
            Total Amount Kept Safe
          </p>
          {keptCount > 0 && (
            <span className="bg-blue-500/20 text-blue-400 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
              {keptCount}
            </span>
          )}
        </div>
        <p className="font-mono text-base font-bold text-blue-400">
          {formatCurrency(totalKept, currency).fullVal}
        </p>
      </div>

      {/* Savings List */}
      <div className="flex-1 overflow-y-auto border border-t-0 border-[var(--color-outline)] rounded-b bg-[var(--color-surface)]">
        {sortedSavings.length === 0 ? (
          <div className="p-12 text-center flex flex-col items-center gap-3">
            <PiggyBank size={48} className="text-blue-400 opacity-20" />
            <p className="text-sm text-[var(--color-on-surface-variant)]">
              No savings entries yet. Start tracking money kept safe elsewhere.
            </p>
            <button
              onClick={() => setShowAddModal(true)}
              className="mt-2 text-xs text-blue-400 hover:underline font-medium"
            >
              + Add first entry
            </button>
          </div>
        ) : (
          <>
            {/* Table Header */}
            <div className="grid grid-cols-12 px-4 py-2.5 border-b border-[var(--color-outline)] bg-[var(--color-surface-variant)] text-[10px] font-bold tracking-wider text-[var(--color-on-surface-variant)] uppercase sticky top-0 z-10">
              <div className="col-span-3">Keeper</div>
              <div className="col-span-3">Notes</div>
              <div className="col-span-2 text-right">Amount</div>
              <div className="col-span-2 text-right">Date</div>
              <div className="col-span-2 text-right">Actions</div>
            </div>

            {/* Rows */}
            {sortedSavings.map((entry) => {
              const isWithdrawn = entry.status === "withdrawn";
              return (
                <div
                  key={entry.id}
                  className={cn(
                    "grid grid-cols-12 px-4 py-3 border-b border-[var(--color-surface-variant)] hover:bg-[var(--color-surface-variant)] transition-colors items-center",
                    isWithdrawn && "opacity-40"
                  )}
                >
                  {/* Keeper */}
                  <div className={cn("col-span-3 text-[13px] text-[var(--color-on-surface)] font-medium truncate flex items-center gap-1.5", isWithdrawn && "line-through")}>
                    <Landmark size={14} className="text-blue-400 shrink-0" />
                    {entry.keeperName}
                  </div>

                  {/* Notes */}
                  <div className={cn("col-span-3 text-[12px] text-[var(--color-on-surface-variant)] truncate", isWithdrawn && "line-through")}>
                    {entry.notes || "—"}
                  </div>

                  {/* Amount */}
                  <div
                    className={cn(
                      "col-span-2 font-mono text-[13px] text-right font-semibold",
                      isWithdrawn
                        ? "text-[var(--color-on-surface-variant)]"
                        : "text-blue-400"
                    )}
                  >
                    {formatCurrency(entry.amount, currency).fullVal}
                  </div>

                  {/* Date */}
                  <div className="col-span-2 font-mono text-[11px] text-[var(--color-on-surface-variant)] text-right">
                    {formatDate(entry.date)}
                  </div>

                  {/* Actions */}
                  <div className="col-span-2 flex items-center justify-end gap-1.5">
                    {isWithdrawn ? (
                      <span className="text-[10px] font-bold uppercase tracking-wider text-amber-500 bg-amber-500/10 px-2 py-1 rounded">
                        Withdrawn ✓
                      </span>
                    ) : (
                      <button
                        onClick={() => setConfirmWithdrawId(entry.id)}
                        className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded transition-colors flex items-center gap-1 text-amber-400 bg-amber-500/10 hover:bg-amber-500/20"
                      >
                        <ArrowDownToLine size={12} />
                        Withdraw
                      </button>
                    )}
                    <button
                      onClick={() => onDeleteSaving(entry.id)}
                      className="text-[var(--color-on-surface-variant)] hover:text-[var(--color-error)] transition-colors p-1 rounded hover:bg-[var(--color-error)]/10"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>

      {/* Add Savings Modal */}
      {showAddModal && (
        <AddSavingsModal
          onClose={() => setShowAddModal(false)}
          onAdd={onAddSaving}
        />
      )}

      {/* Confirm Withdraw Dialog */}
      {confirmWithdrawId && (
        <ConfirmWithdrawDialog
          onClose={() => setConfirmWithdrawId(null)}
          onConfirm={(addTx) => {
            onWithdraw(confirmWithdrawId, addTx);
            setConfirmWithdrawId(null);
          }}
        />
      )}
    </div>
  );
}

/* ─── Add Savings Modal ─── */

interface AddSavingsModalProps {
  onClose: () => void;
  onAdd: (saving: SavingsEntry) => void;
}

function AddSavingsModal({ onClose, onAdd }: AddSavingsModalProps) {
  const [keeperName, setKeeperName] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(getTodayString());
  const [notes, setNotes] = useState("");

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!keeperName.trim() || !amount || parseFloat(amount) <= 0) return;

    const saving: SavingsEntry = {
      id: generateId(),
      keeperName: keeperName.trim(),
      amount: parseFloat(amount),
      date,
      notes: notes.trim() || undefined,
      status: "kept",
      updated_at: Date.now(),
    };

    onAdd(saving);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-[var(--color-surface-variant)] border border-[var(--color-outline)] rounded-xl shadow-2xl w-full max-w-md mx-4 animate-[slideUp_0.2s_ease-out]">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-outline)]">
          <h2 className="font-bold text-[var(--color-on-surface)] flex items-center gap-2">
            <PiggyBank size={20} className="text-blue-400" />
            New Savings Entry
          </h2>
          <button onClick={onClose} className="text-[var(--color-on-surface-variant)] hover:text-[var(--color-on-surface)] transition-colors">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Keeper Name */}
          <div>
            <label className="text-[10px] font-bold tracking-wider text-[var(--color-on-surface-variant)] uppercase block mb-1.5">
              <Landmark size={12} className="inline mr-1 -mt-0.5" />
              Keeper Name
            </label>
            <input
              type="text"
              value={keeperName}
              onChange={(e) => setKeeperName(e.target.value)}
              placeholder="e.g. Mom, Sampath Bank, John"
              required
              className="w-full px-3 py-2.5 bg-[var(--color-surface)] border border-[var(--color-outline)] rounded text-sm text-[var(--color-on-surface)] placeholder:text-[var(--color-on-surface-variant)]/50 focus:border-blue-500 focus:outline-none transition-colors"
            />
          </div>

          {/* Amount + Date row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-bold tracking-wider text-[var(--color-on-surface-variant)] uppercase block mb-1.5">
                Amount
              </label>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                min="0.01"
                step="0.01"
                required
                className="w-full px-3 py-2.5 bg-[var(--color-surface)] border border-[var(--color-outline)] rounded text-sm text-[var(--color-on-surface)] font-mono placeholder:text-[var(--color-on-surface-variant)]/50 focus:border-blue-500 focus:outline-none transition-colors"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold tracking-wider text-[var(--color-on-surface-variant)] uppercase block mb-1.5">
                <Calendar size={12} className="inline mr-1 -mt-0.5" />
                Date
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
                className="w-full px-3 py-2.5 bg-[var(--color-surface)] border border-[var(--color-outline)] rounded text-sm text-[var(--color-on-surface)] focus:border-blue-500 focus:outline-none transition-colors"
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="text-[10px] font-bold tracking-wider text-[var(--color-on-surface-variant)] uppercase block mb-1.5">
              <FileText size={12} className="inline mr-1 -mt-0.5" />
              Notes (Optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Emergency fund, saving for laptop..."
              rows={2}
              className="w-full px-3 py-2.5 bg-[var(--color-surface)] border border-[var(--color-outline)] rounded text-sm text-[var(--color-on-surface)] placeholder:text-[var(--color-on-surface-variant)]/50 focus:border-blue-500 focus:outline-none transition-colors resize-none"
            />
          </div>

          {/* Submit */}
          <button
            type="submit"
            className="w-full py-3 rounded font-bold text-sm transition-all flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white"
          >
            <PiggyBank size={16} />
            Save Entry
          </button>
        </form>
      </div>
    </div>
  );
}

/* ─── Confirm Withdraw Dialog ─── */

interface ConfirmWithdrawDialogProps {
  onClose: () => void;
  onConfirm: (addAsTransaction: boolean) => void;
}

function ConfirmWithdrawDialog({ onClose, onConfirm }: ConfirmWithdrawDialogProps) {
  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-[var(--color-surface-variant)] border border-[var(--color-outline)] rounded-xl shadow-2xl w-full max-w-sm mx-4 animate-[slideUp_0.2s_ease-out]">
        <div className="p-5 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-amber-500/10 flex items-center justify-center">
              <ArrowDownToLine size={20} className="text-amber-400" />
            </div>
            <div>
              <h3 className="font-bold text-[var(--color-on-surface)]">Withdraw Savings</h3>
              <p className="text-xs text-[var(--color-on-surface-variant)]">
                This money will be marked as returned to you.
              </p>
            </div>
          </div>

          <div className="bg-[var(--color-surface)] border border-[var(--color-outline)] rounded p-3">
            <p className="text-xs text-[var(--color-on-surface-variant)]">
              Would you also like to add this as an income transaction in your personal ledger?
            </p>
            <p className="text-[10px] text-[var(--color-on-surface-variant)] mt-1 opacity-70">
              This will add an income transaction (money received back from savings).
            </p>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => onConfirm(true)}
              className="flex-1 py-2.5 rounded bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 transition-colors"
            >
              Yes, Add Transaction
            </button>
            <button
              onClick={() => onConfirm(false)}
              className="flex-1 py-2.5 rounded bg-[var(--color-surface)] border border-[var(--color-outline)] text-[var(--color-on-surface-variant)] text-xs font-bold hover:bg-[var(--color-surface-variant)] transition-colors"
            >
              Just Mark Withdrawn
            </button>
          </div>
          <button
            onClick={onClose}
            className="w-full py-2 text-xs text-[var(--color-on-surface-variant)] hover:text-[var(--color-on-surface)] transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
