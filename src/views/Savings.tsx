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
  User,
  Wallet,
  Edit2,
} from "lucide-react";
import { SavingsEntry, Keeper } from "../types";
import { cn, formatCurrency, formatDate, generateId, getTodayString } from "../lib/utils";

interface SavingsProps {
  savings: SavingsEntry[];
  keepers: Keeper[];
  currency: string;
  onAddSaving: (saving: SavingsEntry) => void;
  onDeleteSaving: (id: string) => void;
  onWithdraw: (id: string, addAsTransaction: boolean) => void;
  onAddKeeper: (keeper: Keeper) => void;
  onEditKeeper: (id: string, name: string, type: 'bank' | 'wallet' | 'person') => void;
  onDeleteKeeper: (id: string) => Promise<void>;
}

// Helpers for Icons and Type labels (utilizing Lucide components rather than emojis)
function getKeeperIcon(type: 'bank' | 'wallet' | 'person', size = 16) {
  switch (type) {
    case 'bank':
      return <Landmark size={size} className="text-emerald-400 shrink-0" />;
    case 'wallet':
      return <Wallet size={size} className="text-amber-400 shrink-0" />;
    case 'person':
      return <User size={size} className="text-blue-400 shrink-0" />;
  }
}

function getKeeperTypeLabel(type: 'bank' | 'wallet' | 'person') {
  switch (type) {
    case 'bank':
      return 'Bank';
    case 'wallet':
      return 'Wallet App';
    case 'person':
      return 'Person';
  }
}

export function Savings({
  savings,
  keepers,
  currency,
  onAddSaving,
  onDeleteSaving,
  onWithdraw,
  onAddKeeper,
  onEditKeeper,
  onDeleteKeeper,
}: SavingsProps) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [showManageKeepers, setShowManageKeepers] = useState(false);
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
        <div className="flex gap-2">
          <button
            onClick={() => setShowManageKeepers(true)}
            className="h-9 px-4 bg-[var(--color-surface)] border border-[var(--color-outline)] text-[var(--color-on-surface)] text-sm hover:bg-[var(--color-surface-variant)] transition-colors rounded font-medium flex items-center gap-2 shrink-0 shadow-sm"
          >
            <User size={16} className="text-blue-400" />
            Manage Keepers
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="h-9 px-4 bg-blue-600 text-white text-sm hover:bg-blue-700 transition-colors rounded font-medium flex items-center gap-2 shrink-0 shadow-sm"
          >
            <Plus size={16} />
            New Savings Entry
          </button>
        </div>
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
            {/* Desktop Table Header */}
            <div className="hidden md:grid grid-cols-12 px-4 py-2.5 border-b border-[var(--color-outline)] bg-[var(--color-surface-variant)] text-[10px] font-bold tracking-wider text-[var(--color-on-surface-variant)] uppercase sticky top-0 z-10">
              <div className="col-span-3">Keeper</div>
              <div className="col-span-3">Notes</div>
              <div className="col-span-2 text-right">Amount</div>
              <div className="col-span-2 text-right">Date</div>
              <div className="col-span-2 text-right">Actions</div>
            </div>

            {/* Desktop Rows */}
            <div className="hidden md:block">
              {sortedSavings.map((entry) => {
                const isWithdrawn = entry.status === "withdrawn";
                const keeper = (entry.keeper_id ? keepers.find((k) => k.id === entry.keeper_id) : null) ||
                               (entry.keeperName ? keepers.find((k) => k.name.toLowerCase() === entry.keeperName.toLowerCase()) : null);

                return (
                  <div
                    key={entry.id}
                    className={cn(
                      "grid grid-cols-12 px-4 py-3 border-b border-[var(--color-surface-variant)] hover:bg-[var(--color-surface-variant)]/10 transition-colors items-center",
                      isWithdrawn && "opacity-40"
                    )}
                  >
                    {/* Keeper */}
                    <div className={cn("col-span-3 text-[13px] text-[var(--color-on-surface)] font-medium truncate flex items-center gap-1.5", isWithdrawn && "line-through")}>
                      {keeper ? (
                        <>
                          {getKeeperIcon(keeper.type, 14)}
                          <span className="truncate">{keeper.name}</span>
                        </>
                      ) : (
                        <>
                          <Landmark size={14} className="text-blue-400 shrink-0" />
                          <span className="truncate">{entry.keeperName}</span>
                        </>
                      )}
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
            </div>

            {/* Mobile Card List */}
            <div className="md:hidden p-3 space-y-3">
              {sortedSavings.map((entry) => {
                const isWithdrawn = entry.status === "withdrawn";
                const keeper = (entry.keeper_id ? keepers.find((k) => k.id === entry.keeper_id) : null) ||
                               (entry.keeperName ? keepers.find((k) => k.name.toLowerCase() === entry.keeperName.toLowerCase()) : null);

                return (
                  <div
                    key={entry.id}
                    className={cn(
                      "bg-[var(--color-surface-variant)] border border-[var(--color-outline)] rounded-lg p-3.5 flex flex-col gap-2.5",
                      isWithdrawn && "opacity-50"
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 text-sm font-semibold text-[var(--color-on-surface)] truncate">
                          {keeper ? getKeeperIcon(keeper.type, 15) : <Landmark size={15} className="text-blue-400 shrink-0" />}
                          <span className={cn(isWithdrawn && "line-through")}>
                            {keeper ? keeper.name : entry.keeperName}
                          </span>
                        </div>
                        {entry.notes && (
                          <p className={cn("text-xs text-[var(--color-on-surface-variant)] mt-0.5", isWithdrawn && "line-through")}>
                            {entry.notes}
                          </p>
                        )}
                        <p className="text-[11px] font-mono text-[var(--color-on-surface-variant)]/80 mt-1">
                          {formatDate(entry.date)}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p
                          className={cn(
                            "font-mono text-sm font-bold",
                            isWithdrawn ? "text-[var(--color-on-surface-variant)]" : "text-blue-400"
                          )}
                        >
                          {formatCurrency(entry.amount, currency).fullVal}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-[var(--color-outline)]/50">
                      <div>
                        {isWithdrawn ? (
                          <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400 bg-amber-500/10 px-2.5 py-1 rounded border border-amber-500/20">
                            Withdrawn ✓
                          </span>
                        ) : (
                          <button
                            onClick={() => setConfirmWithdrawId(entry.id)}
                            className="text-xs font-bold px-3 py-1.5 rounded transition-colors flex items-center gap-1.5 min-h-[34px] text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30"
                          >
                            <ArrowDownToLine size={14} />
                            <span>Withdraw</span>
                          </button>
                        )}
                      </div>
                      <button
                        onClick={() => onDeleteSaving(entry.id)}
                        className="text-[var(--color-on-surface-variant)] hover:text-[var(--color-error)] transition-colors p-2 rounded hover:bg-[var(--color-error)]/10 min-h-[36px] min-w-[36px] flex items-center justify-center"
                        title="Delete savings entry"
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

      {/* Add Savings Modal */}
      {showAddModal && (
        <AddSavingsModal
          onClose={() => setShowAddModal(false)}
          onAdd={onAddSaving}
          keepers={keepers}
          onAddKeeper={onAddKeeper}
        />
      )}

      {/* Manage Keepers Modal */}
      {showManageKeepers && (
        <ManageKeepersModal
          onClose={() => setShowManageKeepers(false)}
          keepers={keepers}
          onAddKeeper={onAddKeeper}
          onEditKeeper={onEditKeeper}
          onDeleteKeeper={onDeleteKeeper}
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

/* ─── Manage Keepers Modal ─── */

interface ManageKeepersModalProps {
  onClose: () => void;
  keepers: Keeper[];
  onAddKeeper: (keeper: Keeper) => void;
  onEditKeeper: (id: string, name: string, type: 'bank' | 'wallet' | 'person') => void;
  onDeleteKeeper: (id: string) => Promise<void>;
}

function ManageKeepersModal({
  onClose,
  keepers,
  onAddKeeper,
  onEditKeeper,
  onDeleteKeeper,
}: ManageKeepersModalProps) {
  const [name, setName] = useState("");
  const [type, setType] = useState<'bank' | 'wallet' | 'person'>("person");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editType, setEditType] = useState<'bank' | 'wallet' | 'person'>("person");
  const [error, setError] = useState<string | null>(null);

  const handleAdd = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const newKeeper: Keeper = {
      id: "keeper_" + Date.now().toString(36) + Math.random().toString(36).substring(2, 8),
      name: name.trim(),
      type,
      created_at: new Date().toISOString(),
    };
    onAddKeeper(newKeeper);
    setName("");
    setType("person");
    setError(null);
  };

  const startEdit = (k: Keeper) => {
    setEditingId(k.id);
    setEditName(k.name);
    setEditType(k.type);
    setError(null);
  };

  const handleSaveEdit = (id: string) => {
    if (!editName.trim()) return;
    onEditKeeper(id, editName.trim(), editType);
    setEditingId(null);
    setError(null);
  };

  const handleDelete = async (id: string) => {
    try {
      setError(null);
      await onDeleteKeeper(id);
    } catch (err: any) {
      setError(err.message || "Failed to delete keeper");
    }
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-[var(--color-surface-variant)] border border-[var(--color-outline)] rounded-xl shadow-2xl w-full max-w-lg mx-4 animate-[slideUp_0.2s_ease-out] flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-outline)] shrink-0">
          <h2 className="font-bold text-[var(--color-on-surface)] flex items-center gap-2">
            <User size={20} className="text-blue-400" />
            Manage Keepers
          </h2>
          <button onClick={onClose} className="text-[var(--color-on-surface-variant)] hover:text-[var(--color-on-surface)] transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 overflow-y-auto space-y-5 flex-1">
          {/* Error Alert */}
          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-xs rounded flex items-center justify-between">
              <span>{error}</span>
              <button onClick={() => setError(null)} className="text-red-400 hover:text-red-300">
                <X size={14} />
              </button>
            </div>
          )}

          {/* Add form */}
          <form onSubmit={handleAdd} className="bg-[var(--color-surface)] border border-[var(--color-outline)] rounded-lg p-4 space-y-3 shadow-sm">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-on-surface-variant)]">Add New Keeper</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-bold tracking-wider text-[var(--color-on-surface-variant)] uppercase block mb-1">Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Keeper's name"
                  required
                  className="w-full px-3 py-2 bg-[var(--color-surface-variant)] border border-[var(--color-outline)] rounded text-xs text-[var(--color-on-surface)] focus:border-blue-500 focus:outline-none transition-colors"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold tracking-wider text-[var(--color-on-surface-variant)] uppercase block mb-1">Type</label>
                <div className="grid grid-cols-3 gap-1">
                  {(['bank', 'wallet', 'person'] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setType(t)}
                      className={cn(
                        "py-2 text-[10px] font-bold uppercase tracking-wider rounded border transition-all text-center flex items-center justify-center gap-1",
                        type === t
                          ? "bg-blue-600 border-blue-600 text-white font-semibold"
                          : "bg-[var(--color-surface-variant)] border-[var(--color-outline)] text-[var(--color-on-surface-variant)] hover:bg-[var(--color-surface-variant)]/80"
                      )}
                    >
                      {getKeeperTypeLabel(t)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <button
              type="submit"
              className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-bold text-xs transition-colors flex items-center justify-center gap-1.5 shadow-sm"
            >
              <Plus size={14} /> Add Keeper
            </button>
          </form>

          {/* List */}
          <div className="space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-on-surface-variant)]">Existing Keepers</h3>
            {keepers.length === 0 ? (
              <p className="text-xs text-[var(--color-on-surface-variant)] text-center py-6">No keepers configured yet.</p>
            ) : (
              <div className="border border-[var(--color-outline)] rounded-lg divide-y divide-[var(--color-outline)] bg-[var(--color-surface)]">
                {keepers.map((keeper) => {
                  const isEditing = editingId === keeper.id;

                  if (isEditing) {
                    return (
                      <div key={keeper.id} className="p-3 space-y-3 bg-[var(--color-surface-variant)]/40">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <input
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            required
                            className="px-2 py-1.5 bg-[var(--color-surface)] border border-[var(--color-outline)] rounded text-xs text-[var(--color-on-surface)] focus:border-blue-500 focus:outline-none"
                          />
                          <div className="grid grid-cols-3 gap-1">
                            {(['bank', 'wallet', 'person'] as const).map((t) => (
                              <button
                                key={t}
                                type="button"
                                onClick={() => setEditType(t)}
                                className={cn(
                                  "py-1 text-[9px] font-bold uppercase tracking-wider rounded border transition-all text-center flex items-center justify-center gap-1",
                                  editType === t
                                    ? "bg-blue-600 border-blue-600 text-white font-semibold"
                                    : "bg-[var(--color-surface)] border-[var(--color-outline)] text-[var(--color-on-surface-variant)] hover:bg-[var(--color-surface-variant)]"
                                )}
                              >
                                {getKeeperTypeLabel(t)}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="flex gap-2 justify-end">
                          <button
                            onClick={() => handleSaveEdit(keeper.id)}
                            className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-bold uppercase rounded flex items-center gap-1 shadow-sm"
                          >
                            <Check size={12} /> Save
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="px-3 py-1 bg-[var(--color-surface)] border border-[var(--color-outline)] text-[var(--color-on-surface-variant)] text-[10px] font-bold uppercase rounded flex items-center gap-1 shadow-sm"
                          >
                            <X size={12} /> Cancel
                          </button>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div key={keeper.id} className="flex items-center justify-between p-3 hover:bg-[var(--color-surface-variant)]/10 transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-[var(--color-surface-variant)] flex items-center justify-center shrink-0">
                          {getKeeperIcon(keeper.type)}
                        </div>
                        <div>
                          <div className="text-xs font-semibold text-[var(--color-on-surface)]">{keeper.name}</div>
                          <div className="text-[10px] text-[var(--color-on-surface-variant)] font-medium flex items-center gap-1 mt-0.5">
                            {getKeeperIcon(keeper.type, 12)}
                            <span>{getKeeperTypeLabel(keeper.type)}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => startEdit(keeper)}
                          className="p-1.5 text-[var(--color-on-surface-variant)] hover:text-blue-400 hover:bg-blue-400/10 rounded transition-colors"
                        >
                          <Edit2 size={12} />
                        </button>
                        <button
                          onClick={() => handleDelete(keeper.id)}
                          className="p-1.5 text-[var(--color-on-surface-variant)] hover:text-red-400 hover:bg-red-400/10 rounded transition-colors"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Add Savings Modal ─── */

interface AddSavingsModalProps {
  onClose: () => void;
  onAdd: (saving: SavingsEntry) => void;
  keepers: Keeper[];
  onAddKeeper: (keeper: Keeper) => void;
}

function AddSavingsModal({ onClose, onAdd, keepers, onAddKeeper }: AddSavingsModalProps) {
  const [selectedKeeperId, setSelectedKeeperId] = useState("");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(getTodayString());
  const [notes, setNotes] = useState("");

  // Mini-form state
  const [showMiniForm, setShowMiniForm] = useState(false);
  const [miniName, setMiniName] = useState("");
  const [miniType, setMiniType] = useState<'bank' | 'wallet' | 'person'>("person");

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!selectedKeeperId || !amount || parseFloat(amount) <= 0) return;

    const selectedKeeper = keepers.find((k) => k.id === selectedKeeperId);
    if (!selectedKeeper) return;

    const saving: SavingsEntry = {
      id: generateId(),
      keeperName: selectedKeeper.name,
      keeper_id: selectedKeeperId,
      amount: parseFloat(amount),
      date,
      notes: notes.trim() || undefined,
      status: "kept",
      updated_at: Date.now(),
    };

    onAdd(saving);
    onClose();
  };

  const handleCreateMiniKeeper = () => {
    if (!miniName.trim()) return;
    const newKeeper: Keeper = {
      id: "keeper_" + Date.now().toString(36) + Math.random().toString(36).substring(2, 8),
      name: miniName.trim(),
      type: miniType,
      created_at: new Date().toISOString(),
    };
    onAddKeeper(newKeeper);
    setSelectedKeeperId(newKeeper.id);
    setMiniName("");
    setShowMiniForm(false);
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
          {/* Keeper dropdown / mini form */}
          <div>
            <label className="text-[10px] font-bold tracking-wider text-[var(--color-on-surface-variant)] uppercase block mb-1.5">
              Keeper
            </label>
            <div className="relative">
              <button
                type="button"
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                className="w-full px-3 py-2.5 bg-[var(--color-surface)] border border-[var(--color-outline)] rounded text-sm text-[var(--color-on-surface)] text-left flex items-center justify-between focus:border-blue-500 focus:outline-none transition-colors shadow-sm"
              >
                {selectedKeeperId ? (
                  (() => {
                    const k = keepers.find((k) => k.id === selectedKeeperId);
                    return k ? (
                      <span className="flex items-center gap-2">
                        {getKeeperIcon(k.type, 16)}
                        <span className="font-medium">{k.name}</span>
                        <span className="text-[10px] text-[var(--color-on-surface-variant)] font-normal">
                          ({getKeeperTypeLabel(k.type)})
                        </span>
                      </span>
                    ) : (
                      <span className="text-[var(--color-on-surface-variant)]/50">Select a Keeper</span>
                    );
                  })()
                ) : (
                  <span className="text-[var(--color-on-surface-variant)]/50">Select a Keeper</span>
                )}
                <span className="text-[10px] text-[var(--color-on-surface-variant)]">▼</span>
              </button>

              {isDropdownOpen && (
                <div className="absolute left-0 right-0 mt-1 bg-[var(--color-surface-variant)] border border-[var(--color-outline)] rounded-lg shadow-xl z-50 max-h-60 overflow-y-auto divide-y divide-[var(--color-outline)]/20">
                  {keepers.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-[var(--color-on-surface-variant)] text-center">
                      No keepers configured
                    </div>
                  ) : (
                    keepers.map((k) => (
                      <button
                        key={k.id}
                        type="button"
                        onClick={() => {
                          setSelectedKeeperId(k.id);
                          setIsDropdownOpen(false);
                          setShowMiniForm(false);
                        }}
                        className="w-full px-3 py-2.5 text-left text-sm text-[var(--color-on-surface)] hover:bg-[var(--color-surface)] flex items-center gap-2 transition-colors"
                      >
                        {getKeeperIcon(k.type, 14)}
                        <span>{k.name}</span>
                        <span className="text-[10px] text-[var(--color-on-surface-variant)] ml-auto font-medium">
                          ({getKeeperTypeLabel(k.type)})
                        </span>
                      </button>
                    ))
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setShowMiniForm(true);
                      setIsDropdownOpen(false);
                      setSelectedKeeperId("");
                    }}
                    className="w-full px-3 py-3 text-left text-xs font-bold text-blue-400 hover:bg-[var(--color-surface)] flex items-center gap-2 transition-colors"
                  >
                    <Plus size={14} />
                    <span>+ Add New Keeper</span>
                  </button>
                </div>
              )}
            </div>

            {/* Inline Mini-Form */}
            {showMiniForm && (
              <div className="bg-[var(--color-surface)] border border-[var(--color-outline)] rounded-lg p-3 space-y-3 mt-3 shadow-inner animate-[slideUp_0.15s_ease-out]">
                <div className="text-[11px] font-bold text-blue-400 uppercase tracking-wider">
                  Create Keeper Inline
                </div>
                <div className="space-y-2.5">
                  <input
                    type="text"
                    placeholder="Keeper Name (e.g. Mom, Sampath Bank)"
                    value={miniName}
                    onChange={(e) => setMiniName(e.target.value)}
                    className="w-full px-2.5 py-1.5 bg-[var(--color-surface-variant)] border border-[var(--color-outline)] rounded text-xs text-[var(--color-on-surface)] focus:border-blue-500 focus:outline-none transition-colors"
                  />
                  <div className="grid grid-cols-3 gap-1">
                    {(['bank', 'wallet', 'person'] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setMiniType(t)}
                        className={cn(
                          "py-1.5 text-[9px] font-bold uppercase tracking-wider rounded border transition-all text-center flex items-center justify-center gap-1",
                          miniType === t
                            ? "bg-blue-600 border-blue-600 text-white font-semibold"
                            : "bg-[var(--color-surface-variant)] border-[var(--color-outline)] text-[var(--color-on-surface-variant)] hover:bg-[var(--color-surface-variant)]/80"
                        )}
                      >
                        {getKeeperTypeLabel(t)}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2 justify-end pt-1">
                    <button
                      type="button"
                      onClick={handleCreateMiniKeeper}
                      className="px-3 py-1 bg-blue-600 text-white text-[10px] font-bold uppercase rounded hover:bg-blue-700 transition-colors shadow-sm"
                    >
                      Create & Select
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowMiniForm(false);
                        setMiniName("");
                      }}
                      className="px-3 py-1 bg-[var(--color-surface-variant)] text-[var(--color-on-surface-variant)] text-[10px] font-bold uppercase rounded border border-[var(--color-outline)] hover:bg-[var(--color-surface-variant)]/80 transition-colors shadow-sm"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}
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
                className="w-full px-3 py-2.5 bg-[var(--color-surface)] border border-[var(--color-outline)] rounded text-sm text-[var(--color-on-surface)] font-mono placeholder:text-[var(--color-on-surface-variant)]/50 focus:border-blue-500 focus:outline-none transition-colors shadow-sm"
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
                className="w-full px-3 py-2.5 bg-[var(--color-surface)] border border-[var(--color-outline)] rounded text-sm text-[var(--color-on-surface)] focus:border-blue-500 focus:outline-none transition-colors shadow-sm"
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
              className="w-full px-3 py-2.5 bg-[var(--color-surface)] border border-[var(--color-outline)] rounded text-sm text-[var(--color-on-surface)] placeholder:text-[var(--color-on-surface-variant)]/50 focus:border-blue-500 focus:outline-none transition-colors resize-none shadow-sm"
            />
          </div>

          {/* Submit */}
          <button
            type="submit"
            className="w-full py-3 rounded font-bold text-sm transition-all flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white shadow-md font-semibold"
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
              className="flex-1 py-2.5 rounded bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 transition-colors shadow-sm"
            >
              Yes, Add Transaction
            </button>
            <button
              onClick={() => onConfirm(false)}
              className="flex-1 py-2.5 rounded bg-[var(--color-surface)] border border-[var(--color-outline)] text-[var(--color-on-surface-variant)] text-xs font-bold hover:bg-[var(--color-surface-variant)] transition-colors shadow-sm"
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
