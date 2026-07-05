import { Lock, Plus, Menu } from "lucide-react";
import { cn } from "../lib/utils";

interface TopBarProps {
  title: string;
  onLock: () => void;
  showAddTransaction?: boolean;
  onAddTransactionClick?: () => void;
  onToggleSidebar?: () => void;
  syncStatus?: string;
}

export function TopBar({ title, onLock, showAddTransaction, onAddTransactionClick, onToggleSidebar, syncStatus }: TopBarProps) {
  return (
    <header className="flex justify-between items-center px-4 w-full h-12 sticky top-0 z-40 bg-[var(--color-surface)] border-b border-[var(--color-outline)]">
      <div className="flex items-center gap-3">
        <button
          onClick={onToggleSidebar}
          className="md:hidden text-[var(--color-on-surface-variant)] hover:text-[var(--color-on-surface)] p-1 -ml-2"
        >
          <Menu size={20} />
        </button>
        <span className="font-semibold text-lg text-[var(--color-on-surface)] tracking-tight truncate max-w-[120px] sm:max-w-none">
          {title}
        </span>
      </div>
      <div className="flex items-center gap-3">
        {syncStatus && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-[var(--color-surface-variant)] border border-[var(--color-outline)] rounded-full text-[10px] font-mono font-bold tracking-wide">
            <span className={cn(
              "w-1.5 h-1.5 rounded-full",
              syncStatus === "Synced" && "bg-[var(--color-secondary)]",
              syncStatus === "Offline" && "bg-[var(--color-error)]",
              syncStatus === "Syncing" && "bg-yellow-500 animate-pulse",
              syncStatus === "Local Only" && "bg-gray-500"
            )}></span>
            <span className="text-[var(--color-on-surface-variant)] uppercase">{syncStatus}</span>
          </div>
        )}
        {showAddTransaction && (
          <button
            onClick={onAddTransactionClick}
            className="bg-[var(--color-primary)] hover:bg-[var(--color-secondary-variant)] text-white px-2 sm:px-3 py-1 text-sm rounded transition-colors flex items-center gap-2"
          >
            <Plus size={16} />
            <span className="hidden sm:inline">Add Transaction</span>
          </button>
        )}
        <button
          onClick={onLock}
          className="bg-[var(--color-surface-variant)] text-[var(--color-on-surface)] text-xs flex items-center gap-2 border border-[var(--color-outline)] hover:bg-gray-800 transition-colors px-2 sm:px-3 py-1.5 rounded"
        >
          <Lock size={14} />
          <span className="hidden sm:inline">Lock App</span>
        </button>
      </div>
    </header>
  );
}

