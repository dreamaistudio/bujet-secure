import { useState, useMemo, type FormEvent } from "react";
import {
  CalendarCheck,
  Plus,
  Check,
  Trash2,
  X,
  Undo2,
  FileText,
  Calendar,
  Building2,
  User,
  AlertTriangle,
} from "lucide-react";
import { Bill, BillPayment, LedgerType } from "../types";
import { cn, formatCurrency, generateId } from "../lib/utils";

interface BillsProps {
  bills: Bill[];
  billPayments: BillPayment[];
  currency: string;
  onAddBill: (bill: Bill) => void;
  onDeleteBill: (id: string) => void;
  onMarkPaid: (billId: string, addAsTransaction: boolean) => void;
  onUnpay: (paymentId: string) => void;
}

/* ─── Helpers ─── */

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function getBillStatus(
  bill: Bill,
  payment: BillPayment | undefined,
  currentYear: number,
  currentMonth: number, // 1-indexed
  currentDay: number
): "paid" | "overdue" | "pending" {
  if (payment && payment.paid) return "paid";
  const lastDay = getDaysInMonth(currentYear, currentMonth);
  const effectiveDueDay = Math.min(bill.dueDay, lastDay);
  if (currentDay > effectiveDueDay) return "overdue";
  return "pending";
}

const statusConfig = {
  paid: {
    label: "Paid",
    textClass: "text-emerald-400",
    bgClass: "bg-emerald-500/10",
    borderClass: "border-emerald-500/20",
  },
  overdue: {
    label: "Overdue",
    textClass: "text-red-400",
    bgClass: "bg-red-500/10",
    borderClass: "border-red-500/20",
  },
  pending: {
    label: "Pending",
    textClass: "text-amber-400",
    bgClass: "bg-amber-500/10",
    borderClass: "border-amber-500/20",
  },
};

/* ─── Main Component ─── */

export function Bills({
  bills,
  billPayments,
  currency,
  onAddBill,
  onDeleteBill,
  onMarkPaid,
  onUnpay,
}: BillsProps) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [confirmPaidId, setConfirmPaidId] = useState<string | null>(null);
  const [confirmUnpayId, setConfirmUnpayId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Current date components — 1-indexed month (Refinement 6)
  const today = new Date();
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth() + 1; // CRITICAL: 0-indexed → 1-indexed
  const currentDay = today.getDate();
  const currentMonthStr = `${currentYear}-${String(currentMonth).padStart(2, "0")}`;

  // Map of bill_id → current month's active payment
  const paymentMap = useMemo(() => {
    const map = new Map<string, BillPayment>();
    for (const bp of billPayments) {
      if (bp.month === currentMonthStr && !bp.deleted) {
        map.set(bp.bill_id, bp);
      }
    }
    return map;
  }, [billPayments, currentMonthStr]);

  // Computed stats
  const totalMonthly = useMemo(
    () => bills.reduce((s, b) => s + b.amount, 0),
    [bills]
  );

  const paidCount = useMemo(
    () =>
      bills.filter((b) => {
        const payment = paymentMap.get(b.id);
        return getBillStatus(b, payment, currentYear, currentMonth, currentDay) === "paid";
      }).length,
    [bills, paymentMap, currentYear, currentMonth, currentDay]
  );

  const overdueCount = useMemo(
    () =>
      bills.filter((b) => {
        const payment = paymentMap.get(b.id);
        return getBillStatus(b, payment, currentYear, currentMonth, currentDay) === "overdue";
      }).length,
    [bills, paymentMap, currentYear, currentMonth, currentDay]
  );

  // Sort: overdue first, then pending, then paid
  const sortedBills = useMemo(() => {
    const order = { overdue: 0, pending: 1, paid: 2 };
    return [...bills].sort((a, b) => {
      const sa = getBillStatus(a, paymentMap.get(a.id), currentYear, currentMonth, currentDay);
      const sb = getBillStatus(b, paymentMap.get(b.id), currentYear, currentMonth, currentDay);
      return order[sa] - order[sb];
    });
  }, [bills, paymentMap, currentYear, currentMonth, currentDay]);

  const monthLabel = new Date(currentYear, currentMonth - 1).toLocaleString("default", {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="p-4 md:p-6 h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 shrink-0 mb-6">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-[var(--color-on-surface)] mb-1 tracking-tight flex items-center gap-2">
            <CalendarCheck size={24} className="text-[var(--color-primary)]" />
            Bills
          </h1>
          <p className="text-xs md:text-sm text-[var(--color-on-surface-variant)]">
            Monthly Recurring Expenses — {monthLabel}
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="h-9 px-4 bg-[var(--color-primary)] text-white text-sm hover:bg-[var(--color-secondary-variant)] transition-colors rounded font-medium flex items-center gap-2 shrink-0"
        >
          <Plus size={16} />
          New Bill
        </button>
      </div>

      {/* Summary Bar */}
      <div className="grid grid-cols-3 gap-3 mb-4 shrink-0">
        <div className="bg-[var(--color-surface-variant)] border border-[var(--color-outline)] rounded-lg px-4 py-3">
          <p className="text-[10px] font-bold tracking-wider uppercase text-[var(--color-on-surface-variant)]">
            Total Monthly
          </p>
          <p className="font-mono text-base font-bold text-[var(--color-on-surface)] mt-1">
            {formatCurrency(-totalMonthly, currency).fullVal}
          </p>
        </div>
        <div className="bg-[var(--color-surface-variant)] border border-[var(--color-outline)] rounded-lg px-4 py-3">
          <p className="text-[10px] font-bold tracking-wider uppercase text-[var(--color-on-surface-variant)]">
            Paid This Month
          </p>
          <p className="font-mono text-base font-bold text-emerald-400 mt-1">
            {paidCount} / {bills.length}
          </p>
        </div>
        <div className="bg-[var(--color-surface-variant)] border border-[var(--color-outline)] rounded-lg px-4 py-3">
          <p className="text-[10px] font-bold tracking-wider uppercase text-[var(--color-on-surface-variant)]">
            Overdue
          </p>
          <p
            className={cn(
              "font-mono text-base font-bold mt-1",
              overdueCount > 0 ? "text-red-400" : "text-[var(--color-on-surface-variant)]"
            )}
          >
            {overdueCount}
          </p>
        </div>
      </div>

      {/* Bill List */}
      <div className="flex-1 overflow-y-auto border border-[var(--color-outline)] rounded bg-[var(--color-surface)]">
        {sortedBills.length === 0 ? (
          <div className="p-12 text-center flex flex-col items-center gap-3">
            <CalendarCheck size={48} className="text-[var(--color-on-surface-variant)] opacity-20" />
            <p className="text-sm text-[var(--color-on-surface-variant)]">
              No recurring bills added yet.
            </p>
            <button
              onClick={() => setShowAddModal(true)}
              className="mt-2 text-xs text-[var(--color-primary)] hover:underline font-medium"
            >
              + Add first bill
            </button>
          </div>
        ) : (
          <>
            {/* Desktop Table Header */}
            <div className="hidden md:grid grid-cols-12 px-4 py-2.5 border-b border-[var(--color-outline)] bg-[var(--color-surface-variant)] text-[10px] font-bold tracking-wider text-[var(--color-on-surface-variant)] uppercase sticky top-0 z-10">
              <div className="col-span-3">Bill Name</div>
              <div className="col-span-2 text-right">Amount</div>
              <div className="col-span-2 text-center">Due Day</div>
              <div className="col-span-1 text-center">Ledger</div>
              <div className="col-span-2 text-center">Status</div>
              <div className="col-span-2 text-right">Actions</div>
            </div>

            {/* Desktop Rows */}
            <div className="hidden md:block">
              {sortedBills.map((bill) => {
                const payment = paymentMap.get(bill.id);
                const status = getBillStatus(bill, payment, currentYear, currentMonth, currentDay);
                const sc = statusConfig[status];
                const isPaid = status === "paid";
                const lastDay = getDaysInMonth(currentYear, currentMonth);
                const effectiveDueDay = Math.min(bill.dueDay, lastDay);

                return (
                  <div
                    key={bill.id}
                    className={cn(
                      "grid grid-cols-12 px-4 py-3 border-b border-[var(--color-surface-variant)] hover:bg-[var(--color-surface-variant)] transition-colors items-center",
                      isPaid && "opacity-50"
                    )}
                  >
                    {/* Bill Name */}
                    <div
                      className={cn(
                        "col-span-3 text-[13px] text-[var(--color-on-surface)] font-medium truncate flex items-center gap-1.5",
                        isPaid && "line-through"
                      )}
                    >
                      <CalendarCheck size={14} className="text-[var(--color-on-surface-variant)] shrink-0" />
                      {bill.name}
                    </div>

                    {/* Amount */}
                    <div
                      className={cn(
                        "col-span-2 font-mono text-[13px] text-right font-semibold",
                        isPaid ? "text-[var(--color-on-surface-variant)]" : "text-red-400"
                      )}
                    >
                      {formatCurrency(-bill.amount, currency).fullVal}
                    </div>

                    {/* Due Day */}
                    <div className="col-span-2 text-center">
                      <span className="text-[12px] font-mono text-[var(--color-on-surface-variant)]">
                        {effectiveDueDay !== bill.dueDay ? (
                          <span title={`Clamped from day ${bill.dueDay}`}>
                            {effectiveDueDay}<sup className="text-[9px] opacity-50">*</sup>
                          </span>
                        ) : (
                          effectiveDueDay
                        )}
                      </span>
                    </div>

                    {/* Ledger */}
                    <div className="col-span-1 flex justify-center">
                      {bill.category === "Business" ? (
                        <Building2 size={14} className="text-[var(--color-secondary)]" title="Business" />
                      ) : (
                        <User size={14} className="text-[var(--color-primary)]" title="Personal" />
                      )}
                    </div>

                    {/* Status */}
                    <div className="col-span-2 flex justify-center">
                      <span
                        className={cn(
                          "text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded border",
                          sc.textClass,
                          sc.bgClass,
                          sc.borderClass
                        )}
                      >
                        {sc.label}
                      </span>
                    </div>

                    {/* Actions */}
                    <div className="col-span-2 flex items-center justify-end gap-1.5">
                      {isPaid ? (
                        <button
                          onClick={() => setConfirmUnpayId(payment?.id || null)}
                          className="text-[10px] font-bold uppercase tracking-wider text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 px-2 py-1 rounded transition-colors flex items-center gap-1"
                        >
                          <Undo2 size={12} />
                          Revert
                        </button>
                      ) : (
                        <button
                          onClick={() => setConfirmPaidId(bill.id)}
                          disabled={isSubmitting}
                          className={cn(
                            "text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded transition-colors flex items-center gap-1",
                            "text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20",
                            isSubmitting && "opacity-50 cursor-not-allowed"
                          )}
                        >
                          <Check size={12} />
                          Pay
                        </button>
                      )}
                      <button
                        onClick={() => onDeleteBill(bill.id)}
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
              {sortedBills.map((bill) => {
                const payment = paymentMap.get(bill.id);
                const status = getBillStatus(bill, payment, currentYear, currentMonth, currentDay);
                const sc = statusConfig[status];
                const isPaid = status === "paid";
                const lastDay = getDaysInMonth(currentYear, currentMonth);
                const effectiveDueDay = Math.min(bill.dueDay, lastDay);

                return (
                  <div
                    key={bill.id}
                    className={cn(
                      "bg-[var(--color-surface-variant)] border border-[var(--color-outline)] rounded-lg p-3.5 flex flex-col gap-2.5",
                      isPaid && "opacity-50"
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 text-sm font-semibold text-[var(--color-on-surface)] truncate">
                          <CalendarCheck size={15} className="text-[var(--color-on-surface-variant)] shrink-0" />
                          <span className={cn(isPaid && "line-through")}>{bill.name}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[11px] font-mono text-[var(--color-on-surface-variant)]">
                            Due day: {effectiveDueDay}
                          </span>
                          <span className="text-[var(--color-outline-variant)]">•</span>
                          <span className="flex items-center gap-1 text-[11px] font-mono text-[var(--color-on-surface-variant)]">
                            {bill.category === "Business" ? <Building2 size={12} className="text-[var(--color-secondary)]" /> : <User size={12} className="text-[var(--color-primary)]" />}
                            {bill.category}
                          </span>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className={cn("font-mono text-sm font-bold", isPaid ? "text-[var(--color-on-surface-variant)]" : "text-red-400")}>
                          {formatCurrency(-bill.amount, currency).fullVal}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-[var(--color-outline)]/50">
                      <div>
                        <span
                          className={cn(
                            "text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border",
                            sc.textClass,
                            sc.bgClass,
                            sc.borderClass
                          )}
                        >
                          {sc.label}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        {isPaid ? (
                          <button
                            onClick={() => setConfirmUnpayId(payment?.id || null)}
                            className="text-xs font-bold uppercase tracking-wider text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 px-3 py-1.5 rounded transition-colors flex items-center gap-1 min-h-[34px] border border-amber-500/30"
                          >
                            <Undo2 size={13} />
                            <span>Revert</span>
                          </button>
                        ) : (
                          <button
                            onClick={() => setConfirmPaidId(bill.id)}
                            disabled={isSubmitting}
                            className={cn(
                              "text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded transition-colors flex items-center gap-1 min-h-[34px]",
                              "text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30",
                              isSubmitting && "opacity-50 cursor-not-allowed"
                            )}
                          >
                            <Check size={13} />
                            <span>Pay</span>
                          </button>
                        )}
                        <button
                          onClick={() => onDeleteBill(bill.id)}
                          className="text-[var(--color-on-surface-variant)] hover:text-[var(--color-error)] transition-colors p-2 rounded hover:bg-[var(--color-error)]/10 min-h-[36px] min-w-[36px] flex items-center justify-center"
                          title="Delete bill"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Payment History */}
      <div className="h-48 border border-[var(--color-outline)] rounded bg-[var(--color-surface)] mt-4 flex flex-col overflow-hidden shrink-0">
        <div className="px-4 py-2 border-b border-[var(--color-outline)] bg-[var(--color-surface-variant)] flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-on-surface)]">
            Recent Payments (This Month)
          </h3>
        </div>
        <div className="flex-1 overflow-y-auto">
          {billPayments.filter(bp => bp.month === currentMonthStr && !bp.deleted).length === 0 ? (
            <div className="p-8 text-center text-xs text-[var(--color-on-surface-variant)]">
              No payments recorded yet for this month.
            </div>
          ) : (
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[var(--color-surface-variant)]/50 border-b border-[var(--color-outline)] text-[10px] font-bold uppercase tracking-wider text-[var(--color-on-surface-variant)]">
                  <th className="px-4 py-2">Bill Name</th>
                  <th className="px-4 py-2">Date Paid</th>
                  <th className="px-4 py-2 text-right">Amount</th>
                  <th className="px-4 py-2 text-center">Ledger</th>
                  <th className="px-4 py-2 text-center">Transaction</th>
                </tr>
              </thead>
              <tbody>
                {billPayments
                  .filter(bp => bp.month === currentMonthStr && !bp.deleted)
                  .map(bp => {
                    const bill = bills.find(b => b.id === bp.bill_id);
                    const billName = bill ? bill.name : "Deleted Bill";
                    const billCategory = bill ? bill.category : "Personal";
                    const billAmount = bill ? bill.amount : 0;

                    return (
                      <tr key={bp.id} className="border-b border-[var(--color-surface-variant)] hover:bg-[var(--color-surface-variant)]/50">
                        <td className="px-4 py-2 font-medium text-[var(--color-on-surface)]">{billName}</td>
                        <td className="px-4 py-2 font-mono text-[var(--color-on-surface-variant)]">{bp.paid_date}</td>
                        <td className="px-4 py-2 font-mono text-right text-emerald-400 font-semibold">
                          {bill ? formatCurrency(-billAmount, currency).fullVal : "—"}
                        </td>
                        <td className="px-4 py-2 text-center">
                          {billCategory === "Business" ? (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">Biz</span>
                          ) : (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-500/10 text-blue-400 border border-blue-500/20">Pers</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-center text-[10px] text-[var(--color-on-surface-variant)] font-mono">
                          {bp.linked_transaction_id ? "Linked" : "No"}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Add Bill Modal */}
      {showAddModal && (
        <AddBillModal onClose={() => setShowAddModal(false)} onAdd={onAddBill} />
      )}

      {/* Confirm Mark as Paid Dialog */}
      {confirmPaidId && (
        <ConfirmPaidDialog
          onClose={() => setConfirmPaidId(null)}
          isSubmitting={isSubmitting}
          onConfirm={async (addTx) => {
            setIsSubmitting(true);
            try {
              onMarkPaid(confirmPaidId, addTx);
            } finally {
              setIsSubmitting(false);
              setConfirmPaidId(null);
            }
          }}
        />
      )}

      {/* Confirm Unpay Dialog */}
      {confirmUnpayId && (
        <ConfirmUnpayDialog
          hasLinkedTransaction={
            !!billPayments.find((bp) => bp.id === confirmUnpayId)?.linked_transaction_id
          }
          onClose={() => setConfirmUnpayId(null)}
          onConfirm={() => {
            onUnpay(confirmUnpayId);
            setConfirmUnpayId(null);
          }}
        />
      )}
    </div>
  );
}

/* ─── Add Bill Modal ─── */

interface AddBillModalProps {
  onClose: () => void;
  onAdd: (bill: Bill) => void;
}

function AddBillModal({ onClose, onAdd }: AddBillModalProps) {
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDay, setDueDay] = useState("1");
  const [category, setCategory] = useState<LedgerType>("Personal");
  const [notes, setNotes] = useState("");

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !amount || parseFloat(amount) <= 0) return;
    const dueDayNum = parseInt(dueDay);
    if (isNaN(dueDayNum) || dueDayNum < 1 || dueDayNum > 31) return;

    const bill: Bill = {
      id: generateId(),
      name: name.trim(),
      amount: parseFloat(amount),
      dueDay: dueDayNum,
      category,
      notes: notes.trim() || undefined,
      updated_at: Date.now(),
    };

    onAdd(bill);
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
            <CalendarCheck size={20} className="text-[var(--color-primary)]" />
            New Recurring Bill
          </h2>
          <button
            onClick={onClose}
            className="text-[var(--color-on-surface-variant)] hover:text-[var(--color-on-surface)] transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Bill Name */}
          <div>
            <label className="text-[10px] font-bold tracking-wider text-[var(--color-on-surface-variant)] uppercase block mb-1.5">
              <FileText size={12} className="inline mr-1 -mt-0.5" />
              Bill Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Rent, WiFi, Netflix..."
              required
              className="w-full px-3 py-2.5 bg-[var(--color-surface)] border border-[var(--color-outline)] rounded text-sm text-[var(--color-on-surface)] placeholder:text-[var(--color-on-surface-variant)]/50 focus:border-[var(--color-primary)] focus:outline-none transition-colors"
            />
          </div>

          {/* Amount + Due Day row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-bold tracking-wider text-[var(--color-on-surface-variant)] uppercase block mb-1.5">
                Monthly Amount
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
                Due Day (1–31)
              </label>
              <input
                type="number"
                value={dueDay}
                onChange={(e) => setDueDay(e.target.value)}
                min="1"
                max="31"
                required
                className="w-full px-3 py-2.5 bg-[var(--color-surface)] border border-[var(--color-outline)] rounded text-sm text-[var(--color-on-surface)] font-mono focus:border-[var(--color-primary)] focus:outline-none transition-colors"
              />
            </div>
          </div>

          {/* Category + Notes row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-bold tracking-wider text-[var(--color-on-surface-variant)] uppercase block mb-1.5">
                Ledger
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as LedgerType)}
                className="w-full px-3 py-2.5 bg-[var(--color-surface)] border border-[var(--color-outline)] rounded text-sm text-[var(--color-on-surface)] font-mono focus:border-[var(--color-primary)] focus:outline-none transition-colors"
              >
                <option value="Personal">Personal</option>
                <option value="Business">Business</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold tracking-wider text-[var(--color-on-surface-variant)] uppercase block mb-1.5">
                <FileText size={12} className="inline mr-1 -mt-0.5" />
                Notes
              </label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional..."
                className="w-full px-3 py-2.5 bg-[var(--color-surface)] border border-[var(--color-outline)] rounded text-sm text-[var(--color-on-surface)] placeholder:text-[var(--color-on-surface-variant)]/50 focus:border-[var(--color-primary)] focus:outline-none transition-colors"
              />
            </div>
          </div>

          {/* Submit */}
          <button
            type="submit"
            className="w-full py-3 rounded font-bold text-sm transition-all flex items-center justify-center gap-2 bg-[var(--color-primary)] hover:bg-[var(--color-secondary-variant)] text-white"
          >
            <CalendarCheck size={16} />
            Add Recurring Bill
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
  isSubmitting: boolean;
}

function ConfirmPaidDialog({ onClose, onConfirm, isSubmitting }: ConfirmPaidDialogProps) {
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
                This bill will be marked as paid for the current month.
              </p>
            </div>
          </div>

          <div className="bg-[var(--color-surface)] border border-[var(--color-outline)] rounded p-3">
            <p className="text-xs text-[var(--color-on-surface-variant)]">
              Would you also like to add this as an expense transaction in your ledger?
            </p>
            <p className="text-[10px] text-[var(--color-on-surface-variant)] mt-1 opacity-70">
              The transaction will be categorized under the bill's ledger (Business or Personal).
            </p>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => onConfirm(true)}
              disabled={isSubmitting}
              className={cn(
                "flex-1 py-2.5 rounded bg-[var(--color-primary)] text-white text-xs font-bold hover:bg-[var(--color-secondary-variant)] transition-colors",
                isSubmitting && "opacity-50 cursor-not-allowed"
              )}
            >
              Yes, Add Transaction
            </button>
            <button
              onClick={() => onConfirm(false)}
              disabled={isSubmitting}
              className={cn(
                "flex-1 py-2.5 rounded bg-[var(--color-surface)] border border-[var(--color-outline)] text-[var(--color-on-surface-variant)] text-xs font-bold hover:bg-[var(--color-surface-variant)] transition-colors",
                isSubmitting && "opacity-50 cursor-not-allowed"
              )}
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

/* ─── Confirm Unpay Dialog ─── */

interface ConfirmUnpayDialogProps {
  onClose: () => void;
  onConfirm: () => void;
  hasLinkedTransaction: boolean;
}

function ConfirmUnpayDialog({ onClose, onConfirm, hasLinkedTransaction }: ConfirmUnpayDialogProps) {
  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-[var(--color-surface-variant)] border border-[var(--color-outline)] rounded-xl shadow-2xl w-full max-w-sm mx-4 animate-[slideUp_0.2s_ease-out]">
        <div className="p-5 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-amber-500/10 flex items-center justify-center">
              <AlertTriangle size={20} className="text-amber-400" />
            </div>
            <div>
              <h3 className="font-bold text-[var(--color-on-surface)]">Revert to Unpaid</h3>
              <p className="text-xs text-[var(--color-on-surface-variant)]">
                This bill will be marked as unpaid again.
              </p>
            </div>
          </div>

          {hasLinkedTransaction && (
            <div className="bg-amber-500/5 border border-amber-500/20 rounded p-3">
              <p className="text-xs text-amber-300 font-medium mb-1">⚠ Warning</p>
              <p className="text-xs text-[var(--color-on-surface-variant)]">
                The transaction created when you originally marked this bill as paid will NOT be
                deleted automatically.
              </p>
              <p className="text-[10px] text-[var(--color-on-surface-variant)] mt-1.5 opacity-70">
                If you mark this bill as paid again later, a second transaction may be created. To
                avoid duplicates, remove the original transaction manually from the Transactions page
                first.
              </p>
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={onConfirm}
              className="flex-1 py-2.5 rounded bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold transition-colors"
            >
              Revert to Unpaid
            </button>
            <button
              onClick={onClose}
              className="flex-1 py-2.5 rounded bg-[var(--color-surface)] border border-[var(--color-outline)] text-[var(--color-on-surface-variant)] text-xs font-bold hover:bg-[var(--color-surface-variant)] transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
