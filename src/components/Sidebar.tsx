import { 
  Building2, 
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
          "fixed inset-y-0 left-0 z-50 w-[240px] shrink-0 h-screen flex flex-col bg-[var(--color-surface)] border-r border-[var(--color-outline)] transition-transform duration-300 md:relative md:translate-x-0",
          isOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
      <div className="p-6 border-b border-[var(--color-outline)] text-left">
        <h1 className="font-bold text-lg text-[var(--color-on-surface)] uppercase tracking-wider">
          {businessName}
        </h1>
        <p className="text-xs text-[var(--color-on-surface-variant)] mt-1 font-medium">LKR Portfolio</p>
      </div>

      <div className="flex-1 overflow-y-auto py-4">
        <ul className="space-y-1">
          {navItems.map((item) => {
            const isActive = currentView === item.id;
            const Icon = item.icon;
            return (
              <li key={item.id}>
                <button
                  onClick={() => onNavigate(item.id)}
                  className={cn(
                    "w-full flex items-center gap-3 px-4 py-2 text-sm transition-colors",
                    isActive 
                      ? "text-[var(--color-secondary)] bg-[var(--color-surface-variant)] border-l-2 border-[var(--color-secondary)]" 
                      : "text-[var(--color-on-surface-variant)] hover:bg-[var(--color-surface-variant)] hover:text-[var(--color-on-surface)] border-l-2 border-transparent"
                  )}
                >
                  <Icon size={20} className={isActive ? "text-[var(--color-secondary)]" : ""} />
                  {item.label}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="mt-auto border-t border-[var(--color-outline)] py-4">
        <ul className="space-y-1">
          <li>
            <button 
              onClick={onSupportClick}
              className="w-full flex items-center gap-3 px-4 py-2 text-sm text-[var(--color-on-surface-variant)] hover:bg-[var(--color-surface-variant)] hover:text-[var(--color-on-surface)] transition-colors"
            >
              <CircleHelp size={20} />
              Support
            </button>
          </li>
          <li>
            <button 
              onClick={() => onNavigate('lock')}
              className="w-full flex items-center gap-3 px-4 py-2 text-sm text-[var(--color-on-surface-variant)] hover:bg-[var(--color-surface-variant)] hover:text-[var(--color-on-surface)] transition-colors"
            >
              <LogOut size={20} />
              Sign Out
            </button>
          </li>
        </ul>
      </div>
    </nav>
    </>
  );
}
