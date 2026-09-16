import { Lock, Menu } from "lucide-react";
import { cn } from "../lib/utils";

interface TopBarProps {
  title: string;
  onLock: () => void;
  onToggleSidebar?: () => void;
  syncStatus?: string;
}

export function TopBar({ title, onLock, onToggleSidebar, syncStatus }: TopBarProps) {
  return (
    <header className="flex justify-between items-center px-4 w-full h-13 sticky top-0 z-40 bg-[var(--color-surface)] border-b border-[var(--color-outline)]">
      <div className="flex items-center gap-2">
        <button
          onClick={onToggleSidebar}
          className="md:hidden text-[var(--color-on-surface-variant)] hover:text-[var(--color-on-surface)] p-2 -ml-2 min-h-[44px] min-w-[44px] flex items-center justify-center cursor-pointer active:scale-95 transition-transform"
          aria-label="Open Navigation Menu"
        >
          <Menu size={22} />
        </button>
        <span className="font-semibold text-lg text-[var(--color-on-surface)] tracking-tight truncate max-w-[220px] sm:max-w-none">
          {title}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={onLock}
          className="bg-[var(--color-surface-variant)] text-[var(--color-on-surface)] text-xs flex items-center gap-2 border border-[var(--color-outline)] hover:bg-gray-800 transition-colors px-3 py-2 rounded min-h-[38px] cursor-pointer"
        >
          <Lock size={14} />
          <span className="hidden sm:inline">Lock App</span>
        </button>
      </div>
    </header>
  );
}
