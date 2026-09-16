import { useState, useMemo, type FormEvent } from "react";
import {
  HandCoins,
  Plus,
  Check,
  Trash2,
  X,
  ArrowUpRight,
  ArrowDownLeft,
  Calendar,
  User,
  FileText,
} from "lucide-react";
import { LoanEntry } from "../types";
import { cn, formatCurrency, formatDate, generateId, getTodayString } from "../lib/utils";

interface LoansProps {
  loans: LoanEntry[];
  currency: string;
  onAddLoan: (loan: LoanEntry) => void;
  onDeleteLoan: (id: string) => void;
  onMarkPaid: (id: string, addAsTransaction: boolean) => void;
}

type LoanTab = "lent" | "borrowed";

export function Loans({ loans, currency, onAddLoan, onDeleteLoan, onMarkPaid }: LoansProps) {
  const [activeTab, setActiveTab] = useState<LoanTab>("lent");
  const [showAddModal, setShowAddModal] = useState(false);
  const [confirmPaidId, setConfirmPaidId] = useState<string | null>(null);

  const lentLoans = useMemo(() => {
    const unpaid = loans.filter((l) => l.type === "lent" && l.status === "unpaid");
    const paid = loans.filter((l) => l.type === "lent" && l.status === "paid");
    return [...unpaid, ...paid];
  }, [loans]);

  const borrowedLoans = useMemo(() => {
    const unpaid = loans.filter((l) => l.type === "borrowed" && l.status === "unpaid");
    const paid = loans.filter((l) => l.type === "borrowed" && l.status === "paid");
    return [...unpaid, ...paid];
  }, [loans]);

  const totalLent = useMemo(
    () => loans.filter((l) => l.type === "lent" && l.status === "unpaid").reduce((s, l) => s + l.amount, 0),
    [loans]
  );

  const totalBorrowed = useMemo(
    () => loans.filter((l) => l.type === "borrowed" && l.status === "unpaid").reduce((s, l) => s + l.amount, 0),
    [loans]
  );

  const currentLoans = activeTab === "lent" ? lentLoans : borrowedLoans;
  const currentTotal = activeTab === "lent" ? totalLent : totalBorrowed;

  return (
    <div className="p-4 md:p-6 h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 shrink-0 mb-6">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-[var(--color-on-surface)] mb-1 tracking-tight flex items-center gap-2">
            <HandCoins size={24} className="text-[var(--color-primary)]" />
            Loans
          </h1>
          <p className="text-xs md:text-sm text-[var(--color-on-surface-variant)]">
            Loan Account — Track money lent & borrowed
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="h-9 px-4 bg-[var(--color-primary)] text-white text-sm hover:bg-[var(--color-secondary-variant)] transition-colors rounded font-medium flex items-center gap-2 shrink-0"
        >
          <Plus size={16} />
          New Loan Entry
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border border-[var(--color-outline)] rounded-t overflow-hidden shrink-0">
        <button
          onClick={() => setActiveTab("lent")}
          className={cn(
            "flex-1 py-3 px-4 text-sm font-semibold transition-all flex items-center justify-center gap-2",
            activeTab === "lent"
              ? "bg-emerald-900/30 text-emerald-400 border-b-2 border-emerald-400"
              : "bg-[var(--color-surface)] text-[var(--color-on-surface-variant)] hover:bg-[var(--color-surface-variant)]"
          )}
        >
          <ArrowUpRight size={16} />
          <span className="hidden sm:inline">Lent to Others</span>
          <span className="sm:hidden">Lent</span>
          {lentLoans.filter((l) => l.status === "unpaid").length > 0 && (
            <span className="ml-1 bg-emerald-500/20 text-emerald-400 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
              {lentLoans.filter((l) => l.status === "unpaid").length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab("borrowed")}
          className={cn(
            "flex-1 py-3 px-4 text-sm font-semibold transition-all flex items-center justify-center gap-2 border-l border-[var(--color-outline)]",
            activeTab === "borrowed"
              ? "bg-red-900/20 text-red-400 border-b-2 border-red-400"
              : "bg-[var(--color-surface)] text-[var(--color-on-surface-variant)] hover:bg-[var(--color-surface-variant)]"
          )}
        >
          <ArrowDownLeft size={16} />
          <span className="hidden sm:inline">Borrowed from Others</span>
          <span className="sm:hidden">Borrowed</span>
          {borrowedLoans.filter((l) => l.status === "unpaid").length > 0 && (
            <span className="ml-1 bg-red-500/20 text-red-400 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
              {borrowedLoans.filter((l) => l.status === "unpaid").length}
            </span>
          )}
        </button>
      </div>

      {/* Summary Bar */}
      <div
        className={cn(
          "px-4 py-3 border-x border-[var(--color-outline)] flex items-center justify-between shrink-0",
          activeTab === "lent" ? "bg-emerald-900/10" : "bg-red-900/10"
        )}
      >
        <p className="text-xs font-bold tracking-wider uppercase text-[var(--color-on-surface-variant)]">
          {activeTab === "lent" ? "Amount Owed to Me" : "Amount I Owe"}
        </p>
        <p
          className={cn(
            "font-mono text-base font-bold",
            activeTab === "lent" ? "text-emerald-400" : "text-red-400"
          )}
        >
          {formatCurrency(activeTab === "lent" ? currentTotal : -currentTotal, currency).fullVal}
        </p>
      </div>

      {/* Loan List */}
      <div className="flex-1 overflow-y-auto border border-t-0 border-[var(--color-outline)] rounded-b bg-[var(--color-surface)]">
        {currentLoans.length === 0 ? (
          <div className="p-12 text-center flex flex-col items-center gap-3">
            <HandCoins
              size={48}
              className={cn(
                "opacity-20",
                activeTab === "lent" ? "text-emerald-400" : "text-red-400"
              )}
            />
            <p className="text-sm text-[var(--color-on-surface-variant)]">
              {activeTab === "lent"
                ? "No money lent to anyone yet."
                : "No money borrowed from anyone yet."}
            </p>
            <button
              onClick={() => setShowAddModal(true)}
              className="mt-2 text-xs text-[var(--color-primary)] hover:underline font-medium"
            >
              + Add first entry
            </button>
          </div>
        ) : (
          <>
            {/* Desktop Table Header */}
            <div className="hidden md:grid grid-cols-12 px-4 py-2.5 border-b border-[var(--color-outline)] bg-[var(--color-surface-variant)] text-[10px] font-bold tracking-wider text-[var(--color-on-surface-variant)] uppercase sticky top-0 z-10">
              <div className="col-span-3">Person</div>
              <div className="col-span-3">Reason</div>
              <div className="col-span-2 text-right">Amount</div>
              <div className="col-span-2 text-right">Date</div>
              <div className="col-span-2 text-right">Actions</div>
            </div>

            {/* Desktop Rows */}
            <div className="hidden md:block">
              {currentLoans.map((loan) => {
                const isPaid = loan.status === "paid";
                return (
                  <div
                    key={loan.id}
                    className={cn(
                      "grid grid-cols-12 px-4 py-3 border-b border-[var(--color-surface-variant)] hover:bg-[var(--color-surface-variant)] transition-colors items-center",
                      isPaid && "opacity-40"
                    )}
                  >
                    {/* Person */}
                    <div className={cn("col-span-3 text-[13px] text-[var(--color-on-surface)] font-medium truncate flex items-center gap-1.5", isPaid && "line-through")}>
                      <User size={14} className="text-[var(--color-on-surface-variant)] shrink-0" />
                      {loan.personName}
                    </div>

                    {/* Reason */}
                    <div className={cn("col-span-3 text-[12px] text-[var(--color-on-surface-variant)] truncate", isPaid && "line-through")}>
                      {loan.reason || "—"}
                    </div>

                    {/* Amount */}
                    <div
                      className={cn(
                        "col-span-2 font-mono text-[13px] text-right font-semibold",
                        isPaid
                          ? "text-[var(--color-on-surface-variant)]"
                          : activeTab === "lent"
                          ? "text-emerald-400"
                          : "text-red-400"
                      )}
                    >
                      {formatCurrency(loan.amount, currency).fullVal}
                    </div>

                    {/* Date */}
                    <div className="col-span-2 font-mono text-[11px] text-[var(--color-on-surface-variant)] text-right">
                      {formatDate(loan.date)}
                    </div>

                    {/* Actions */}
                    <div className="col-span-2 flex items-center justify-end gap-1.5">
                      {isPaid ? (
                        <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-500 bg-emerald-500/10 px-2 py-1 rounded">
                          Paid ✓
                        </span>
                      ) : (
                        <button
                          onClick={() => setConfirmPaidId(loan.id)}
                          className={cn(
                            "text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded transition-colors flex items-center gap-1",
                            activeTab === "lent"
                              ? "text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20"
                              : "text-amber-400 bg-amber-500/10 hover:bg-amber-500/20"
                          )}
                        >
                          <Check size={12} />
                          Paid
                        </button>
                      )}
                      <button
                        onClick={() => onDeleteLoan(loan.id)}
                        className="text-[var(--color-on-surface-variant)] hover:text-[var(--color-error)] transition-colors p-1 rounded hover:bg-[var(--color-error)]/10"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Mobile Card List */}
            <div className="md:hidden p-3 space-y-3">
              {currentLoans.map((loan) => {
                const isPaid = loan.status === "paid";
                return (
                  <div
                    key={loan.id}
                    className={cn(
                      "bg-[var(--color-surface-variant)] border border-[var(--color-outline)] rounded-lg p-3.5 flex flex-col gap-2.5",
                      isPaid && "opacity-50"
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 text-sm font-semibold text-[var(--color-on-surface)] truncate">
                          <User size={15} className="text-[var(--color-on-surface-variant)] shrink-0" />
                          <span className={cn(isPaid && "line-through")}>{loan.personName}</span>
                        </div>
                        {loan.reason && (
                          <p className={cn("text-xs text-[var(--color-on-surface-variant)] mt-0.5", isPaid && "line-through")}>
                            {loan.reason}
                          </p>
                        )}
                        <p className="text-[11px] font-mono text-[var(--color-on-surface-variant)]/80 mt-1">
                          {formatDate(loan.date)}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p
                          className={cn(
                            "font-mono text-sm font-bold",
                            isPaid
                              ? "text-[var(--color-on-surface-variant)]"
                              : activeTab === "lent"
                              ? "text-emerald-400"
                              : "text-red-400"
                          )}
                        >
                          {formatCurrency(loan.amount, currency).fullVal}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-[var(--color-outline)]/50">
                      <div>
                        {isPaid ? (
                          <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded border border-emerald-500/20">
                            Paid ✓
                          </span>
                        ) : (
                          <button
                            onClick={() => setConfirmPaidId(loan.id)}
                            className={cn(
                              "text-xs font-bold px-3 py-1.5 rounded transition-colors flex items-center gap-1.5 min-h-[34px]",
                              activeTab === "lent"
                                ? "text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30"
                                : "text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30"
                            )}
                          >
                            <Check size={14} />
                            <span>Mark Paid</span>
                          </button>
                        )}
                      </div>
                      <button
                        onClick={() => onDeleteLoan(loan.id)}
                        className="text-[var(--color-on-surface-variant)] hover:text-[var(--color-error)] transition-colors p-2 rounded hover:bg-[var(--color-error)]/10 min-h-[36px] min-w-[36px] flex items-center justify-center"
                        title="Delete loan"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Add Loan Modal */}
      {showAddModal && (
        <AddLoanModal
          onClose={() => setShowAddModal(false)}
          onAdd={onAddLoan}
          defaultTab={activeTab}
        />
      )}

      {/* Confirm Mark as Paid Dialog */}
      {confirmPaidId && (
        <ConfirmPaidDialog
          onClose={() => setConfirmPaidId(null)}
          onConfirm={(addTx) => {
            onMarkPaid(confirmPaidId, addTx);
            setConfirmPaidId(null);
          }}
          loanType={loans.find((l) => l.id === confirmPaidId)?.type || "lent"}
        />
      )}
    </div>
  );
}

/* ─── Add Loan Modal ─── */

interface AddLoanModalProps {
  onClose: () => void;
  onAdd: (loan: LoanEntry) => void;
  defaultTab: LoanTab;
}

function AddLoanModal({ onClose, onAdd, defaultTab }: AddLoanModalProps) {
  const [type, setType] = useState<"lent" | "borrowed">(defaultTab);
  const [personName, setPersonName] = useState("");
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(getTodayString());

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!personName.trim() || !amount || parseFloat(amount) <= 0) return;

    const loan: LoanEntry = {
      id: generateId(),
      type,
      personName: personName.trim(),
      reason: reason.trim(),
      amount: parseFloat(amount),
      date,
      status: "unpaid",
      updated_at: Date.now(),
    };

    onAdd(loan);
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
            <HandCoins size={20} className="text-[var(--color-primary)]" />
            New Loan Entry
          </h2>
          <button onClick={onClose} className="text-[var(--color-on-surface-variant)] hover:text-[var(--color-on-surface)] transition-colors">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Type Toggle */}
          <div>
            <label className="text-[10px] font-bold tracking-wider text-[var(--color-on-surface-variant)] uppercase block mb-2">
              Loan Type
            </label>
            <div className="grid grid-cols-2 gap-0 border border-[var(--color-outline)] rounded overflow-hidden">
              <button
                type="button"
                onClick={() => setType("lent")}
                className={cn(
                  "py-2.5 text-xs font-bold transition-all flex items-center justify-center gap-1.5",
                  type === "lent"
                    ? "bg-emerald-900/30 text-emerald-400 border-b-2 border-emerald-400"
                    : "bg-[var(--color-surface)] text-[var(--color-on-surface-variant)] hover:bg-[var(--color-surface-variant)]"
                )}
              >
                <ArrowUpRight size={14} />
                I Lent Money
              </button>
              <button
                type="button"
                onClick={() => setType("borrowed")}
                className={cn(
                  "py-2.5 text-xs font-bold transition-all flex items-center justify-center gap-1.5 border-l border-[var(--color-outline)]",
                  type === "borrowed"
                    ? "bg-red-900/20 text-red-400 border-b-2 border-red-400"
                    : "bg-[var(--color-surface)] text-[var(--color-on-surface-variant)] hover:bg-[var(--color-surface-variant)]"
                )}
              >
                <ArrowDownLeft size={14} />
                I Borrowed
              </button>
            </div>
          </div>

          {/* Person Name */}
          <div>
            <label className="text-[10px] font-bold tracking-wider text-[var(--color-on-surface-variant)] uppercase block mb-1.5">
              <User size={12} className="inline mr-1 -mt-0.5" />
              Person Name
            </label>
            <input
              type="text"
              value={personName}
              onChange={(e) => setPersonName(e.target.value)}
              placeholder={type === "lent" ? "Who did you lend to?" : "Who did you borrow from?"}
              required
              className="w-full px-3 py-2.5 bg-[var(--color-surface)] border border-[var(--color-outline)] rounded text-sm text-[var(--color-on-surface)] placeholder:text-[var(--color-on-surface-variant)]/50 focus:border-[var(--color-primary)] focus:outline-none transition-colors"
            />
          </div>

          {/* Reason */}
          <div>
            <label className="text-[10px] font-bold tracking-wider text-[var(--color-on-surface-variant)] uppercase block mb-1.5">
              <FileText size={12} className="inline mr-1 -mt-0.5" />
              Reason
            </label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Emergency, Business, Personal..."
              className="w-full px-3 py-2.5 bg-[var(--color-surface)] border border-[var(--color-outline)] rounded text-sm text-[var(--color-on-surface)] placeholder:text-[var(--color-on-surface-variant)]/50 focus:border-[var(--color-primary)] focus:outline-none transition-colors"
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
                className="w-full px-3 py-2.5 bg-[var(--color-surface)] border border-[var(--color-outline)] rounded text-sm text-[var(--color-on-surface)] font-mono placeholder:text-[var(--color-on-surface-variant)]/50 focus:border-[var(--color-primary)] focus:outline-none transition-colors"
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
                className="w-full px-3 py-2.5 bg-[var(--color-surface)] border border-[var(--color-outline)] rounded text-sm text-[var(--color-on-surface)] focus:border-[var(--color-primary)] focus:outline-none transition-colors"
              />
            </div>
          </div>

          {/* Submit */}
          <button
            type="submit"
            className={cn(
              "w-full py-3 rounded font-bold text-sm transition-all flex items-center justify-center gap-2",
              type === "lent"
                ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                : "bg-red-600 hover:bg-red-700 text-white"
            )}
          >
            <HandCoins size={16} />
            {type === "lent" ? "Record Money Lent" : "Record Money Borrowed"}
          </button>
        </form>
      </div>
    </div>
  );
}

/* ─── Confirm Mark as Paid Dialog ─── */

interface ConfirmPaidDialogProps {
  onClose: () => void;
  onConfirm: (addAsTransaction: boolean) => void;
  loanType: "lent" | "borrowed";
}

function ConfirmPaidDialog({ onClose, onConfirm, loanType }: ConfirmPaidDialogProps) {
  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-[var(--color-surface-variant)] border border-[var(--color-outline)] rounded-xl shadow-2xl w-full max-w-sm mx-4 animate-[slideUp_0.2s_ease-out]">
        <div className="p-5 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center">
              <Check size={20} className="text-emerald-400" />
            </div>
            <div>
              <h3 className="font-bold text-[var(--color-on-surface)]">Mark as Paid</h3>
              <p className="text-xs text-[var(--color-on-surface-variant)]">
                This loan will be marked as settled.
              </p>
            </div>
          </div>

          <div className="bg-[var(--color-surface)] border border-[var(--color-outline)] rounded p-3">
            <p className="text-xs text-[var(--color-on-surface-variant)]">
              Would you also like to add this as a transaction in your main ledger?
            </p>
            <p className="text-[10px] text-[var(--color-on-surface-variant)] mt-1 opacity-70">
              {loanType === "lent"
                ? "This will add an income transaction (money received back)."
                : "This will add an expense transaction (money paid back)."}
            </p>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => onConfirm(true)}
              className="flex-1 py-2.5 rounded bg-[var(--color-primary)] text-white text-xs font-bold hover:bg-[var(--color-secondary-variant)] transition-colors"
            >
              Yes, Add Transaction
            </button>
            <button
              onClick={() => onConfirm(false)}
              className="flex-1 py-2.5 rounded bg-[var(--color-surface)] border border-[var(--color-outline)] text-[var(--color-on-surface-variant)] text-xs font-bold hover:bg-[var(--color-surface-variant)] transition-colors"
            >
              Just Mark Paid
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
