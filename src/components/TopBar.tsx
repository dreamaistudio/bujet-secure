import { Lock, Menu } from "lucide-react";

interface TopBarProps {
  title: string;
  onLock: () => void;
  onToggleSidebar?: () => void;
  /**
   * A phone (on the PC) or the PC (on a phone) has been paired. Until then the
   * badge is not shown at all.
   */
  linkPaired?: boolean;
  /** The paired device is linked right now (over Wi-Fi or the internet). */
  linkConnected?: boolean;
  onOpenSync?: () => void;
}

export function TopBar({
  title,
  onLock,
  onToggleSidebar,
  linkPaired = false,
  linkConnected = false,
  onOpenSync
}: TopBarProps) {
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
        <span className="font-semibold text-lg text-[var(--color-on-surface)] tracking-tight truncate max-w-[180px] sm:max-w-none">
          {title}
        </span>
      </div>

      <div className="flex items-center gap-2.5">
        {/* Connection badge: only "Connected" or "Disconnected", and nothing
            at all until another device has been paired. */}
        {linkPaired && (
          linkConnected ? (
            <button
              type="button"
              onClick={onOpenSync}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20 active:scale-95 transition-all cursor-pointer"
            >
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span className="font-medium">Connected</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={onOpenSync}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-500/10 text-amber-300 border border-amber-500/30 hover:bg-amber-500/20 active:scale-95 transition-all cursor-pointer"
            >
              <span className="w-2 h-2 rounded-full bg-amber-400" />
              <span className="font-medium">Disconnected</span>
            </button>
          )
        )}

        <button
          onClick={onLock}
          className="bg-[var(--color-surface-variant)] text-[var(--color-on-surface)] text-xs flex items-center gap-2 border border-[var(--color-outline)] hover:bg-gray-800 transition-colors px-3 py-1.5 rounded min-h-[34px] cursor-pointer"
        >
          <Lock size={14} />
          <span className="hidden sm:inline">Lock App</span>
        </button>
      </div>
    </header>
  );
}
