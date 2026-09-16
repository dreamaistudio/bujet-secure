import { X, ChevronDown, ChevronUp, Send, CheckCircle2, Loader2, Mail, PhoneCall } from "lucide-react";
import { useState } from "react";
import { cn } from "../lib/utils";

interface SupportModalProps {
  onClose: () => void;
}

interface FAQItem {
  q: string;
  a: string;
}

const faqs: FAQItem[] = [
  {
    q: "How secure is my budget ledger data?",
    a: "Your data is stored completely locally in a secure SQLite database (with local JSON fallback) on your machine. We do not upload your financial data to external servers, giving you 100% control and ownership over your ledger."
  },
  {
    q: "How does database synchronization work?",
    a: "On startup, the app synchronizes its session cache with the local SQLite database. Synchronization uses a 'Last-Write-Wins' mechanism evaluating timestamps on edits to ensure that both layers align correctly."
  },
  {
    q: "Can I undo or restore deleted transactions?",
    a: "Yes! Whenever you delete a transaction from the list, an 'Undo' option will pop up at the bottom of the screen. You have 5 seconds to click it and restore the deleted item. Under the hood, the transaction is soft-deleted, allowing it to sync with the database server before being permanently removed."
  },
  {
    q: "How do I secure the app with a PIN?",
    a: "Navigate to Preferences/Settings and enter a 4-digit numeric code under 'App PIN Code'. Once configured, the app will automatically prompt you for this PIN upon boot or after a period of idle inactivity."
  }
];

export function SupportModal({ onClose }: SupportModalProps) {
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(null);
  
  // Form State
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<"idle" | "loading" | "success">("idle");
  const [ticketId, setTicketId] = useState("");

  const toggleFaq = (idx: number) => {
    setOpenFaqIndex(openFaqIndex === idx ? null : idx);
  };

  const handleSend = () => {
    const err: Record<string, string> = {};
    if (!name.trim()) err.name = "Name is required.";
    if (!email.trim() || !email.includes("@")) err.email = "Enter a valid email.";
    if (!subject.trim()) err.subject = "Subject is required.";
    if (!message.trim()) err.message = "Message details are required.";

    if (Object.keys(err).length > 0) {
      setErrors(err);
      return;
    }

    setErrors({});
    setStatus("loading");

    // Simulate network submission
    setTimeout(() => {
      setStatus("success");
      const id = "FS-" + Math.floor(100000 + Math.random() * 900000);
      setTicketId(id);
    }, 1500);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#09090b]/80 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl bg-[var(--color-surface-variant)] border border-[var(--color-outline)] rounded-lg overflow-hidden shadow-2xl flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-[var(--color-outline)] bg-[var(--color-surface)] shrink-0">
          <div>
            <h2 className="text-lg font-bold text-[var(--color-on-surface)] tracking-tight">Help & Support Desk</h2>
            <p className="text-xs text-[var(--color-on-surface-variant)] mt-0.5">Find answers or message our help desk team.</p>
          </div>
          <button onClick={onClose} className="text-[var(--color-on-surface-variant)] hover:text-[var(--color-error)] transition-colors p-1">
            <X size={20} />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="overflow-y-auto p-6 space-y-6 flex-1">
          {status !== "success" ? (
            <>
              {/* FAQ Section */}
              <div className="space-y-3">
                <h3 className="text-xs font-bold text-[var(--color-primary)] uppercase tracking-wider">Frequently Asked Questions</h3>
                <div className="space-y-2">
                  {faqs.map((faq, idx) => {
                    const isOpen = openFaqIndex === idx;
                    return (
                      <div key={idx} className="border border-[var(--color-outline)] bg-[var(--color-surface)] rounded overflow-hidden transition-all duration-200">
                        <button
                          onClick={() => toggleFaq(idx)}
                          className="w-full px-4 py-3 flex justify-between items-center text-left text-sm font-semibold text-[var(--color-on-surface)] hover:bg-[var(--color-surface-variant)] transition-colors"
                        >
                          <span>{faq.q}</span>
                          {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        </button>
                        {isOpen && (
                          <div className="px-4 pb-4 pt-1 text-[13px] leading-relaxed text-[var(--color-on-surface-variant)] border-t border-[var(--color-outline)]/50">
                            {faq.a}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="h-px bg-[var(--color-outline)] w-full"></div>

              {/* Direct Support Details */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex items-center gap-3 p-3 bg-[var(--color-surface)] border border-[var(--color-outline)] rounded">
                  <Mail className="text-[var(--color-secondary)] shrink-0" size={20} />
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-on-surface-variant)]">Email Support</p>
                    <p className="text-sm font-mono text-[var(--color-on-surface)]">support@financesecure.com</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 bg-[var(--color-surface)] border border-[var(--color-outline)] rounded">
                  <PhoneCall className="text-[var(--color-primary)] shrink-0" size={20} />
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-on-surface-variant)]">Toll-Free Hotline</p>
                    <p className="text-sm font-mono text-[var(--color-on-surface)]">+1 (800) 555-VAULT</p>
                  </div>
                </div>
              </div>

              <div className="h-px bg-[var(--color-outline)] w-full"></div>

              {/* Message Form */}
              <div className="space-y-4">
                <h3 className="text-xs font-bold text-[var(--color-primary)] uppercase tracking-wider">Send a Secure Support Ticket</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] font-bold tracking-wider text-[var(--color-on-surface-variant)] uppercase block mb-1">Your Name</label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => { setName(e.target.value); if (errors.name) setErrors(prev => ({...prev, name: ""})); }}
                      placeholder="Enter your name"
                      className="w-full bg-[var(--color-background)] border border-[var(--color-outline)] text-[var(--color-on-surface)] text-[13px] rounded px-3 py-2 outline-none focus:border-[var(--color-primary)]"
                    />
                    {errors.name && <p className="text-[var(--color-error)] text-xs mt-1">{errors.name}</p>}
                  </div>
                  <div>
                    <label className="text-[10px] font-bold tracking-wider text-[var(--color-on-surface-variant)] uppercase block mb-1">Your Email</label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => { setEmail(e.target.value); if (errors.email) setErrors(prev => ({...prev, email: ""})); }}
                      placeholder="email@example.com"
                      className="w-full bg-[var(--color-background)] border border-[var(--color-outline)] text-[var(--color-on-surface)] text-[13px] rounded px-3 py-2 outline-none focus:border-[var(--color-primary)]"
                    />
                    {errors.email && <p className="text-[var(--color-error)] text-xs mt-1">{errors.email}</p>}
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-bold tracking-wider text-[var(--color-on-surface-variant)] uppercase block mb-1">Subject</label>
                  <input
                    type="text"
                    value={subject}
                    onChange={(e) => { setSubject(e.target.value); if (errors.subject) setErrors(prev => ({...prev, subject: ""})); }}
                    placeholder="Brief summary of the issue"
                    className="w-full bg-[var(--color-background)] border border-[var(--color-outline)] text-[var(--color-on-surface)] text-[13px] rounded px-3 py-2 outline-none focus:border-[var(--color-primary)]"
                  />
                  {errors.subject && <p className="text-[var(--color-error)] text-xs mt-1">{errors.subject}</p>}
                </div>

                <div>
                  <label className="text-[10px] font-bold tracking-wider text-[var(--color-on-surface-variant)] uppercase block mb-1">Message Details</label>
                  <textarea
                    rows={4}
                    value={message}
                    onChange={(e) => { setMessage(e.target.value); if (errors.message) setErrors(prev => ({...prev, message: ""})); }}
                    placeholder="Describe how we can assist you..."
                    className="w-full bg-[var(--color-background)] border border-[var(--color-outline)] text-[var(--color-on-surface)] text-[13px] rounded px-3 py-2 outline-none focus:border-[var(--color-primary)] resize-none"
                  />
                  {errors.message && <p className="text-[var(--color-error)] text-xs mt-1">{errors.message}</p>}
                </div>
              </div>
            </>
          ) : (
            /* Success State */
            <div className="flex flex-col items-center justify-center py-12 text-center space-y-4">
              <CheckCircle2 className="text-[var(--color-secondary)] animate-bounce" size={64} />
              <h3 className="text-xl font-bold text-[var(--color-on-surface)]">Support Ticket Sent!</h3>
              <div className="max-w-md bg-[var(--color-surface)] border border-[var(--color-outline)] p-4 rounded text-sm text-[var(--color-on-surface-variant)] leading-relaxed">
                <p className="font-mono text-xs text-[var(--color-primary)] font-bold mb-2">TICKET ID: {ticketId}</p>
                We have securely registered your inquiry. A response will be dispatched to <span className="font-bold text-[var(--color-on-surface)]">{email}</span> within the next 24 business hours.
              </div>
              <button
                onClick={onClose}
                className="mt-6 px-6 py-2 bg-[var(--color-primary)] hover:bg-[var(--color-secondary-variant)] text-white text-sm font-medium rounded transition-colors"
              >
                Return to Ledger
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        {status !== "success" && (
          <div className="flex justify-end gap-3 p-5 border-t border-[var(--color-outline)] bg-[var(--color-surface)] shrink-0">
            <button
              onClick={onClose}
              disabled={status === "loading"}
              className="px-5 py-2 bg-[var(--color-background)] border border-[var(--color-outline)] text-[var(--color-on-surface)] text-sm rounded hover:bg-[var(--color-outline)] transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSend}
              disabled={status === "loading"}
              className="px-5 py-2 bg-[var(--color-primary)] hover:bg-[var(--color-secondary-variant)] text-white text-sm font-medium rounded transition-colors flex items-center gap-2 disabled:opacity-50"
            >
              {status === "loading" ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Send size={16} />
                  Submit Ticket
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
