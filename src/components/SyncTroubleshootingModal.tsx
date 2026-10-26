import { useState } from "react";
import { ChevronDown, ChevronUp, CircleHelp, X, ShieldCheck } from "lucide-react";
import { syncStrings } from "../lib/syncStrings";

interface SyncTroubleshootingModalProps {
  isOpen: boolean;
  onClose: () => void;
  isMobile?: boolean;
}

export function SyncTroubleshootingModal({
  isOpen,
  onClose,
  isMobile = false,
}: SyncTroubleshootingModalProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(0); // First item open by default

  if (!isOpen) return null;

  const t = syncStrings.troubleshooting;

  const items = [
    {
      q: t.q1,
      a: isMobile ? t.a1Mobile : t.a1Desktop,
    },
    {
      q: t.q2,
      a: t.a2,
    },
    {
      q: t.q3,
      a: t.a3,
    },
    {
      q: t.q4,
      a: t.a4,
    },
  ];

  const toggle = (idx: number) => {
    setOpenIndex(openIndex === idx ? null : idx);
  };

  return (
    <div
      className="fixed inset-0 z-[350] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-[fadeIn_0.15s_ease-out]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-[var(--color-surface-variant)] border border-[var(--color-outline)] rounded-2xl overflow-hidden shadow-2xl flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-[var(--color-outline)] bg-[var(--color-surface)] shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-[var(--color-primary)]/10 border border-[var(--color-primary)]/30 flex items-center justify-center text-[var(--color-primary)]">
              <CircleHelp size={18} />
            </div>
            <div>
              <h3 className="text-base font-bold text-[var(--color-on-surface)] tracking-tight">
                {t.title}
              </h3>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[var(--color-on-surface-variant)] hover:text-[var(--color-on-surface)] p-1 rounded-lg hover:bg-[var(--color-surface-variant)] transition-colors cursor-pointer"
            aria-label={t.closeText}
          >
            <X size={20} />
          </button>
        </div>

        {/* Q&A List */}
        <div className="overflow-y-auto p-5 space-y-3 flex-1">
          {items.map((item, idx) => {
            const isOpen = openIndex === idx;
            return (
              <div
                key={idx}
                className="border border-[var(--color-outline)] bg-[var(--color-surface)] rounded-xl overflow-hidden transition-colors"
              >
                <button
                  type="button"
                  onClick={() => toggle(idx)}
                  className="w-full px-4 py-3.5 flex justify-between items-center text-left text-sm font-semibold text-[var(--color-on-surface)] hover:bg-[var(--color-surface-variant)]/60 transition-colors gap-3 cursor-pointer"
                >
                  <span>{item.q}</span>
                  {isOpen ? (
                    <ChevronUp size={17} className="text-[var(--color-primary)] shrink-0" />
                  ) : (
                    <ChevronDown size={17} className="text-[var(--color-on-surface-variant)] shrink-0" />
                  )}
                </button>
                {isOpen && (
                  <div className="px-4 pb-4 pt-1 border-t border-[var(--color-outline)]/40 text-xs sm:text-[13px] text-[var(--color-on-surface-variant)] leading-relaxed space-y-2 bg-[var(--color-background)]/40">
                    {item.a.map((line, lIdx) => (
                      <div key={lIdx} className="flex items-start gap-2">
                        <span className="text-[var(--color-primary)] font-bold shrink-0 mt-0.5">•</span>
                        <span>{line}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[var(--color-outline)] bg-[var(--color-surface)] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 text-xs text-[var(--color-on-surface-variant)]">
            <ShieldCheck size={15} className="text-emerald-400 shrink-0" />
            <span>Locked before it leaves your device • Readable only by your phone and PC</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-[var(--color-surface-variant)] border border-[var(--color-outline)] hover:border-[var(--color-primary)] text-[var(--color-on-surface)] text-xs font-medium rounded-lg transition-colors cursor-pointer"
          >
            {t.closeText}
          </button>
        </div>
      </div>
    </div>
  );
}
