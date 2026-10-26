import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State;
  public props: Props;

  constructor(props: Props) {
    super(props);
    this.props = props;
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[var(--color-background)] text-[var(--color-on-background)] flex flex-col items-center justify-center p-6 select-none">
          <div className="max-w-md w-full bg-[var(--color-surface-variant)] border border-[var(--color-outline)] rounded-2xl p-6 shadow-2xl flex flex-col items-center text-center">
            <div className="w-14 h-14 rounded-full bg-[var(--color-error)]/10 border border-[var(--color-error)]/20 flex items-center justify-center text-[var(--color-error)] mb-4">
              <AlertTriangle size={28} />
            </div>
            
            <h1 className="text-xl font-bold text-[var(--color-on-surface)] mb-2">Something went wrong</h1>
            <p className="text-sm text-[var(--color-on-surface-variant)] mb-4 leading-relaxed">
              Budget Secure encountered an unexpected error and could not complete rendering.
            </p>

            {this.state.error?.message && (
              <div className="w-full bg-[var(--color-surface)] border border-[var(--color-error)]/30 rounded-xl p-3 mb-6 text-left overflow-auto max-h-36">
                <p className="text-xs font-mono text-[var(--color-error)] break-words">
                  {this.state.error.message}
                </p>
              </div>
            )}

            <button
              onClick={this.handleReload}
              className="w-full py-2.5 px-4 bg-[var(--color-primary)] hover:bg-[var(--color-secondary-variant)] text-[var(--color-on-primary)] font-medium rounded-xl text-sm transition-colors flex items-center justify-center gap-2 shadow-lg"
            >
              <RefreshCw size={16} />
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
