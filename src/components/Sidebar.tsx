import { 
  Building2, 
  CalendarCheck,
  CircleHelp,
  HandCoins,
  LayoutDashboard, 
  LogOut, 
  PiggyBank,
  ReceiptText, 
  Settings, 
  User 
} from "lucide-react";
import { cn } from "../lib/utils";

interface SidebarProps {
  currentView: string;
  onNavigate: (view: string) => void;
  businessName: string;
  isOpen: boolean;
  onClose: () => void;
  onSupportClick: () => void;
}

export function Sidebar({ currentView, onNavigate, businessName, isOpen, onClose, onSupportClick }: SidebarProps) {
  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'transactions', label: 'Transactions', icon: ReceiptText },
    { id: 'business', label: 'Business', icon: Building2 },
    { id: 'personal', label: 'Personal', icon: User },
    { id: 'loans', label: 'Loans', icon: HandCoins },
    { id: 'savings', label: 'Savings', icon: PiggyBank },
    { id: 'bills', label: 'Bills', icon: CalendarCheck },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  return (
    <>
      {/* Mobile Backdrop */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black/60 z-40 md:hidden backdrop-blur-sm transition-opacity"
          onClick={onClose}
        />
      )}
      
      <nav 
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-[280px] md:w-[240px] shrink-0 h-screen flex flex-col bg-[var(--color-surface)] border-r border-[var(--color-outline)] transition-transform duration-300 md:relative md:translate-x-0 shadow-2xl md:shadow-none",
          isOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
      <div className="p-6 border-b border-[var(--color-outline)] text-left flex items-center justify-between">
        <div>
          <h1 className="font-bold text-lg text-[var(--color-on-surface)] uppercase tracking-wider">
            {businessName}
          </h1>
          <p className="text-xs text-[var(--color-on-surface-variant)] mt-1 font-medium">LKR Portfolio</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-3">
        <ul className="space-y-1 px-2">
          {navItems.map((item) => {
            const isActive = currentView === item.id;
            const Icon = item.icon;
            return (
              <li key={item.id}>
                <button
                  onClick={() => {
                    onNavigate(item.id);
                    onClose();
                  }}
                  className={cn(
                    "w-full flex items-center gap-3.5 px-4 py-3 min-h-[46px] rounded text-sm font-medium transition-colors cursor-pointer text-left",
                    isActive 
                      ? "text-[var(--color-secondary)] bg-[var(--color-surface-variant)] border-l-3 border-[var(--color-secondary)] font-semibold" 
                      : "text-[var(--color-on-surface-variant)] hover:bg-[var(--color-surface-variant)] hover:text-[var(--color-on-surface)] border-l-3 border-transparent"
                  )}
                >
                  <Icon size={20} className={isActive ? "text-[var(--color-secondary)]" : ""} />
                  <span className="truncate">{item.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="mt-auto border-t border-[var(--color-outline)] py-3 px-2">
        <ul className="space-y-1">
          <li>
            <button 
              onClick={() => {
                onSupportClick();
                onClose();
              }}
              className="w-full flex items-center gap-3.5 px-4 py-3 min-h-[46px] rounded text-sm font-medium text-[var(--color-on-surface-variant)] hover:bg-[var(--color-surface-variant)] hover:text-[var(--color-on-surface)] transition-colors cursor-pointer text-left"
            >
              <CircleHelp size={20} />
              <span>Support</span>
            </button>
          </li>
          <li>
            <button 
              onClick={() => {
                onNavigate('lock');
                onClose();
              }}
              className="w-full flex items-center gap-3.5 px-4 py-3 min-h-[46px] rounded text-sm font-medium text-[var(--color-on-surface-variant)] hover:bg-[var(--color-surface-variant)] hover:text-[var(--color-on-surface)] transition-colors cursor-pointer text-left"
            >
              <LogOut size={20} />
              <span>Sign Out</span>
            </button>
          </li>
        </ul>
      </div>
    </nav>
    </>
  );
}
