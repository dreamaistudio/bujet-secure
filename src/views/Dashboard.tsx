import { Building2, Clock, HandCoins, Info, PiggyBank, Plus, User } from "lucide-react";
import { useMemo, useState } from "react";
import { Line, LineChart, ReferenceLine, ResponsiveContainer, XAxis, YAxis, Tooltip } from "recharts";
import { LoanEntry, SavingsEntry, Transaction } from "../types";
import { cn, formatCurrency, formatDate } from "../lib/utils";

interface DashboardProps {
  transactions: Transaction[];
  currency: string;
  onAddTransactionClick: () => void;
  businessLedgerName: string;
  personalLedgerName: string;
  loans?: LoanEntry[];
  savings?: SavingsEntry[];
}

type TimePeriod = "1W" | "1M" | "3M" | "6M" | "1Y" | "ALL";

function getCutoffDateString(period: TimePeriod): string {
  const days = { "1W": 7, "1M": 30, "3M": 90, "6M": 180, "1Y": 365 };
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days[period]);
  cutoff.setHours(0, 0, 0, 0); // Start of day local time
  const offset = cutoff.getTimezoneOffset();
  const localCutoff = new Date(cutoff.getTime() - (offset * 60 * 1000));
  return localCutoff.toISOString().split("T")[0];
}

function filterByPeriod(txs: Transaction[], period: TimePeriod) {
  if (period === "ALL") return txs;
  const cutoffStr = getCutoffDateString(period);
  return txs.filter((tx) => tx.date >= cutoffStr);
}

const formatTxTime = (timeStr?: string) => {
  if (!timeStr) return "";
  const parts = timeStr.split(":");
  if (parts.length < 2) return timeStr;
  const hours = parseInt(parts[0], 10);
  const minutes = parts[1];
  const ampm = hours >= 12 ? "PM" : "AM";
  const displayHours = hours % 12 || 12;
  return `${String(displayHours).padStart(2, "0")}:${minutes} ${ampm}`;
};

const ChartTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  if (!d.description || d.description === 'Start') 
    return null;
  return (
    <div className="bg-[#18181b] border border-[#27272a] rounded-lg px-3 py-2 text-xs shadow-xl">
      <p className="text-[#a1a1aa] mb-1">
        {d.date}
        {d.time && (
          <span className="text-[#71717a]"> {formatTxTime(d.time)}</span>
        )}
      </p>
      <p className="text-[#fafafa] font-medium truncate max-w-[160px]">{d.description}</p>
      <p className={`font-mono font-bold mt-1 ${d.amount >= 0 ? 'text-[#22c55e]' : 'text-[#ef4444]'}`}>
        {d.amount >= 0 ? '+' : ''}{d.amount.toLocaleString()} {d.currency}
      </p>
      <p className="text-[#a1a1aa] text-[10px] mt-1">
        Balance: {d.value.toLocaleString()} {d.currency}
      </p>
    </div>
  );
};

export function Dashboard({
  transactions,
  currency,
  onAddTransactionClick,
  businessLedgerName,
  personalLedgerName,
  loans = [],
  savings = [],
}: DashboardProps) {
  const computeSummary = (txs: Transaction[]) => {
    const totalIncome = txs.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
    const totalExpenses = txs.filter((t) => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
    const netBalance = totalIncome - totalExpenses;

    // Actual balance: only CLEARED transactions
    const clearedTxs = txs.filter((t) => t.status === 'CLEARED');
    const clearedIncome = clearedTxs.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
    const clearedExpenses = clearedTxs.filter((t) => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
    const actualBalance = clearedIncome - clearedExpenses;

    const hasPending = txs.some((t) => t.status === 'PENDING');

    // Growth trend: compare last 15 days vs prior 15 days (using safe local date strings to prevent timezone shifts)
    const nowStr = new Date().toISOString().split('T')[0];
    const midDate = new Date();
    midDate.setDate(midDate.getDate() - 15);
    const midStr = midDate.toISOString().split('T')[0];
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 30);
    const startStr = startDate.toISOString().split('T')[0];

    const recentSum = txs
      .filter((t) => t.date >= midStr && t.date <= nowStr)
      .reduce((s, t) => s + t.amount, 0);
    const priorSum = txs
      .filter((t) => t.date >= startStr && t.date < midStr)
      .reduce((s, t) => s + t.amount, 0);

    const growthTrend = priorSum === 0 ? (recentSum > 0 ? 100 : 0) : Math.round(((recentSum - priorSum) / Math.abs(priorSum)) * 100);

    return { totalIncome, totalExpenses, netBalance, growthTrend, actualBalance, hasPending };
  };

  const computeChartData = (txs: Transaction[], allTxs: Transaction[], period: TimePeriod) => {
    // Only include CLEARED transactions in the chart
    const clearedTxs = txs.filter(tx => tx.status === 'CLEARED');
    const allClearedTxs = allTxs.filter(tx => tx.status === 'CLEARED');

    if (clearedTxs.length === 0) {
      return [{ value: 0 }, { value: 0 }]; // flat line at 0 for empty state
    }

    const sorted = [...clearedTxs].sort((a, b) => {
      const dateCompare = a.date.localeCompare(b.date);
      if (dateCompare !== 0) return dateCompare;
      if (a.time && b.time) return a.time.localeCompare(b.time);
      return 0;
    });

    let baseline = 0;
    if (period !== 'ALL') {
      const cutoffStr = getCutoffDateString(period);
      baseline = allClearedTxs
        .filter(tx => tx.date < cutoffStr)
        .reduce((sum, tx) => sum + tx.amount, 0);
    }

    let cumulative = baseline;
    const points: Array<{
      value: number;
      description: string;
      amount: number;
      date: string;
      time?: string;
      currency?: string;
    }> = [{ value: baseline, description: 'Start', amount: 0, date: '', time: '' }];

    for (const tx of sorted) {
      cumulative += tx.amount;
      points.push({ 
        value: cumulative,
        description: tx.description,
        amount: tx.amount,
        date: tx.date,
        time: tx.time,
        currency: currency
      });
    }

    return points;
  };

  const [businessPeriod, setBusinessPeriod] = useState<TimePeriod>("ALL");
  const [personalPeriod, setPersonalPeriod] = useState<TimePeriod>("ALL");

  const bTxs = useMemo(() => transactions.filter((t) => t.category === "Business"), [transactions]);
  const pTxs = useMemo(() => transactions.filter((t) => t.category === "Personal"), [transactions]);

  const businessSummary = useMemo(() => computeSummary(bTxs), [bTxs]);
  const personalSummary = useMemo(() => computeSummary(pTxs), [pTxs]);

  const filteredBTxs = useMemo(() => filterByPeriod(bTxs, businessPeriod), [bTxs, businessPeriod]);
  const filteredPTxs = useMemo(() => filterByPeriod(pTxs, personalPeriod), [pTxs, personalPeriod]);

  const chartDataBusiness = useMemo(() => computeChartData(filteredBTxs, bTxs, businessPeriod), [filteredBTxs, bTxs, businessPeriod]);
  const chartDataPersonal = useMemo(() => computeChartData(filteredPTxs, pTxs, personalPeriod), [filteredPTxs, pTxs, personalPeriod]);

  const recentBTxs = useMemo(
    () => [...bTxs].sort((a, b) => 
      b.date.localeCompare(a.date) || 
      (b.time || '').localeCompare(a.time || '')
    ).slice(0, 8),
    [bTxs]
  );
  const recentPTxs = useMemo(
    () => [...pTxs].sort((a, b) => 
      b.date.localeCompare(a.date) || 
      (b.time || '').localeCompare(a.time || '')
    ).slice(0, 8),
    [pTxs]
  );

  const renderLedgerCard = (
    title: string,
    type: "Business" | "Personal",
    summary: ReturnType<typeof computeSummary>,
    chartData: { value: number }[],
    txs: Transaction[],
    period: TimePeriod,
    setPeriod: (p: TimePeriod) => void,
    filteredTxs: Transaction[]
  ) => {
    const Icon = type === "Business" ? Building2 : User;
    const filteredNetBalance = chartData.length > 1 
      ? chartData[chartData.length - 1].value - chartData[0].value
      : summary.netBalance;

    return (
      <div className="bg-[var(--color-surface-variant)] border border-[var(--color-outline)] rounded flex flex-col">
        {/* Header */}
        <div className="bg-[var(--color-surface)] p-4 border-b border-[var(--color-outline)] flex justify-between items-center shrink-0">
          <div className="flex items-center gap-2">
            <Icon size={20} className={type === "Business" ? "text-[var(--color-secondary)]" : "text-[var(--color-primary)]"} />
            <h2 className="font-semibold text-[var(--color-on-surface)]">{title}</h2>
          </div>
          <span className="bg-[var(--color-secondary-variant)] text-[var(--color-on-secondary)] text-[10px] uppercase font-bold px-2 py-1 tracking-wider rounded-sm">
            ACTIVE
          </span>
        </div>

        <div className="p-3.5 sm:p-4 flex flex-col gap-4 sm:gap-6">
          {/* Key Stats */}
          <div className="flex flex-col gap-2 shrink-0">
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-[var(--color-surface)] border border-[var(--color-outline)] p-3 rounded min-w-0">
                <p className="text-[10px] font-bold tracking-wider text-[var(--color-on-surface-variant)] uppercase mb-1 truncate">TOTAL INCOME</p>
                <p className="font-mono text-[11px] sm:text-[13px] text-[var(--color-secondary)] truncate" title={formatCurrency(summary.totalIncome, currency).fullVal}>
                  {formatCurrency(summary.totalIncome, currency).fullVal}
                </p>
              </div>
              <div className="bg-[var(--color-surface)] border border-[var(--color-outline)] p-3 rounded min-w-0">
                <p className="text-[10px] font-bold tracking-wider text-[var(--color-on-surface-variant)] uppercase mb-1 truncate">TOTAL EXPENSES</p>
                <p className="font-mono text-[11px] sm:text-[13px] text-[var(--color-error)] truncate" title={formatCurrency(summary.totalExpenses * -1, currency).fullVal}>
                  {formatCurrency(summary.totalExpenses * -1, currency).fullVal}
                </p>
              </div>
              <div className="bg-[var(--color-surface)] border border-[var(--color-outline)] p-3 rounded min-w-0">
                <p className="text-[10px] font-bold tracking-wider text-[var(--color-on-surface-variant)] uppercase mb-1 truncate">ACTUAL BALANCE</p>
                <p className="font-mono text-[11px] sm:text-[13px] text-[var(--color-on-surface)] truncate" title={formatCurrency(summary.actualBalance, currency).fullVal}>
                  {formatCurrency(summary.actualBalance, currency).fullVal}
                </p>
                <p className="text-[9px] text-[var(--color-on-surface-variant)] mt-0.5 truncate">Cleared only</p>
              </div>
            </div>
            {summary.hasPending && (
              <div className="bg-[var(--color-surface)] border border-[var(--color-outline)] px-3 py-2 rounded flex items-center gap-2">
                <Info size={13} className="text-[#71717a] shrink-0" />
                <p className="text-[11px] text-[#71717a] font-mono">
                  <span className="uppercase font-bold tracking-wider text-[10px]">Projected Balance</span>
                  <span className="text-[#a1a1aa] mx-1.5">{'(incl. pending):'}</span>
                  <span className="text-[var(--color-on-surface-variant)] font-semibold">{formatCurrency(summary.netBalance, currency).fullVal}</span>
                </p>
              </div>
            )}
          </div>

          {/* Chart Area */}
          <div className="bg-[var(--color-surface)] border border-[var(--color-outline)] h-56 sm:h-52 min-h-[200px] rounded relative overflow-hidden flex flex-col p-3.5 sm:p-4 shrink-0">
            <div className="absolute inset-0 flex flex-col justify-between p-4 pointer-events-none opacity-20">
              <div className="w-full border-t border-[var(--color-outline)] border-dashed"></div>
              <div className="w-full border-t border-[var(--color-outline)] border-dashed"></div>
              <div className="w-full border-t border-[var(--color-outline)] border-dashed"></div>
              <div className="w-full border-t border-[var(--color-outline)] border-dashed"></div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2 relative z-10">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-bold tracking-wider text-[var(--color-on-surface-variant)] uppercase shrink-0">
                  CUMULATIVE TREND
                </p>
                <div className={cn("sm:hidden px-2 py-0.5 border rounded", summary.growthTrend >= 0 ? "bg-green-900/30 border-[var(--color-secondary)]" : "bg-red-900/30 border-[var(--color-error)]")}>
                  <p className={cn("font-mono text-[10px]", summary.growthTrend >= 0 ? "text-[var(--color-secondary)]" : "text-[var(--color-error)]")}>
                    {summary.growthTrend >= 0 ? "+" : ""}{summary.growthTrend}%
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-between sm:justify-end gap-2 overflow-x-auto no-scrollbar">
                <div className="flex gap-0.5 sm:gap-1 bg-[var(--color-surface-lowest)] border border-[var(--color-outline)] p-0.5 rounded-full shrink-0">
                  {(["1W", "1M", "3M", "6M", "1Y", "ALL"] as const).map((p) => {
                    const isActive = period === p;
                    return (
                      <button
                        key={p}
                        onClick={() => setPeriod(p)}
                        className={cn(
                          "px-2 sm:px-2.5 py-1 rounded-full text-[9px] sm:text-[10px] font-bold tracking-wide transition-all uppercase cursor-pointer min-w-[28px] text-center",
                          isActive
                            ? "bg-[var(--color-secondary)] text-[var(--color-on-secondary)]"
                            : "text-[var(--color-on-surface-variant)] hover:text-[var(--color-on-surface)]"
                        )}
                      >
                        {p}
                      </button>
                    );
                  })}
                </div>
                <div className={cn("hidden sm:block px-2 py-1 border rounded shrink-0", summary.growthTrend >= 0 ? "bg-green-900/30 border-[var(--color-secondary)]" : "bg-red-900/30 border-[var(--color-error)]")}>
                  <p className={cn("font-mono text-[11px]", summary.growthTrend >= 0 ? "text-[var(--color-secondary)]" : "text-[var(--color-error)]")}>
                    {summary.growthTrend >= 0 ? "+" : ""}{summary.growthTrend}%
                  </p>
                </div>
              </div>
            </div>

            {filteredTxs.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/10 pointer-events-none z-20">
                <span className="text-[11px] font-semibold text-[var(--color-on-surface-variant)] uppercase tracking-wider bg-[var(--color-surface)] px-3 py-1.5 border border-[var(--color-outline)] rounded shadow-md">No transactions in this period</span>
              </div>
            )}

            <div className="flex-1 mt-2 relative z-10 w-full h-full -ml-[10px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <XAxis hide />
                  <YAxis 
                    hide 
                    domain={([dataMin, dataMax]) => {
                      const min = Math.min(dataMin, 0);
                      const max = Math.max(dataMax, 0);
                      const padding = (max - min) * 0.1 || 1;
                      return [min - padding, max + padding];
                    }} 
                  />
                  <ReferenceLine y={0} stroke="#444" strokeDasharray="3 3" />
                  <Tooltip 
                    content={<ChartTooltip />}
                    cursor={{ stroke: '#27272a', strokeWidth: 1 }}
                  />
                  <Line
                    type="linear"
                    dataKey="value"
                    stroke={filteredNetBalance < 0 ? "var(--color-error)" : "var(--color-secondary)"}
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                    activeDot={{ 
                      r: 5, 
                      fill: filteredNetBalance < 0 
                        ? 'var(--color-error)' 
                        : 'var(--color-secondary)',
                      stroke: '#09090b',
                      strokeWidth: 2
                    }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Recent Transactions */}
          <div className="flex-1 max-h-64 overflow-y-auto flex flex-col border border-[var(--color-outline)] rounded">
            <div className="bg-[var(--color-surface-variant)] border-b border-[var(--color-outline)] grid grid-cols-4 px-3 py-2 shrink-0">
              <div className="text-[10px] font-bold tracking-wider text-[var(--color-on-surface-variant)] uppercase col-span-2">DESCRIPTION</div>
              <div className="text-[10px] font-bold tracking-wider text-[var(--color-on-surface-variant)] uppercase text-right">DATE</div>
              <div className="text-[10px] font-bold tracking-wider text-[var(--color-on-surface-variant)] uppercase text-right">AMOUNT</div>
            </div>
            <div className="flex-1 overflow-y-auto bg-[var(--color-surface)]">
              {txs.length === 0 ? (
                <div className="p-4 text-center text-sm text-[var(--color-on-surface-variant)]">No transactions yet.</div>
              ) : (
                txs.map((tx) => {
                  const amt = formatCurrency(tx.amount, currency);
                  return (
                    <div key={tx.id} className="grid grid-cols-4 px-3 py-2 border-b border-[var(--color-surface-variant)] hover:bg-[var(--color-surface-variant)] transition-colors">
                      <div className="text-[13px] text-[var(--color-on-surface)] col-span-2 truncate flex items-center gap-1.5">
                        {tx.status === 'PENDING' && (
                          <span className="inline-flex items-center gap-0.5 text-[#ef4444] text-[10px] font-bold uppercase shrink-0">
                            <Clock size={10} className="text-[#ef4444]" />
                            PENDING
                          </span>
                        )}
                        <span className="truncate">{tx.description}</span>
                      </div>
                      <div className="font-mono text-[11px] text-[var(--color-on-surface-variant)] text-right pt-[2px]">{formatDate(tx.date)}</div>
                      <div className={cn("font-mono text-[13px] text-right", tx.amount < 0 ? "text-[var(--color-error)]" : "text-[var(--color-secondary)]")}>
                        {amt.fullVal}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="p-4 md:p-6 h-full flex flex-col gap-4 md:gap-6 overflow-y-auto md:overflow-hidden">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 shrink-0">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-[var(--color-on-surface)] mb-1 tracking-tight">Financial Overview</h1>
          <p className="text-xs md:text-sm text-[var(--color-on-surface-variant)]">System Status: Active</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onAddTransactionClick}
            className="h-8 px-4 bg-[var(--color-primary)] text-white text-sm hover:bg-[var(--color-secondary-variant)] transition-colors rounded font-medium flex items-center gap-2"
          >
            <Plus size={16} />
            New Transaction
          </button>
        </div>
      </div>

      {/* Net Loan Position Card */}
      {loans.length > 0 && (() => {
        const totalLent = loans.filter(l => l.type === 'lent' && l.status === 'unpaid').reduce((s, l) => s + l.amount, 0);
        const totalBorrowed = loans.filter(l => l.type === 'borrowed' && l.status === 'unpaid').reduce((s, l) => s + l.amount, 0);
        const netPosition = totalLent - totalBorrowed;
        const isPositive = netPosition >= 0;

        return (
          <div className={cn(
            "shrink-0 border rounded flex items-center justify-between px-4 py-3 gap-4",
            isPositive
              ? "bg-emerald-900/10 border-emerald-900/30"
              : "bg-red-900/10 border-red-900/30"
          )}>
            <div className="flex items-center gap-3">
              <div className={cn(
                "w-9 h-9 rounded-full flex items-center justify-center shrink-0",
                isPositive ? "bg-emerald-500/10" : "bg-red-500/10"
              )}>
                <HandCoins size={18} className={isPositive ? "text-emerald-400" : "text-red-400"} />
              </div>
              <div>
                <p className="text-[10px] font-bold tracking-wider text-[var(--color-on-surface-variant)] uppercase">Net Loan Position</p>
                <p className="text-[11px] text-[var(--color-on-surface-variant)]">
                  Owed to me: {formatCurrency(totalLent, currency).fullVal} · I owe: {formatCurrency(totalBorrowed, currency).fullVal}
                </p>
              </div>
            </div>
            <p className={cn(
              "font-mono text-base font-bold shrink-0",
              isPositive ? "text-emerald-400" : "text-red-400"
            )}>
              {isPositive ? '+' : ''}{formatCurrency(netPosition, currency).fullVal}
            </p>
          </div>
        );
      })()}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 pb-6">
        {renderLedgerCard(businessLedgerName, "Business", businessSummary, chartDataBusiness, recentBTxs, businessPeriod, setBusinessPeriod, filteredBTxs)}
        {renderLedgerCard(personalLedgerName, "Personal", personalSummary, chartDataPersonal, recentPTxs, personalPeriod, setPersonalPeriod, filteredPTxs)}
      </div>

      {/* Kept Safe Elsewhere Info */}
      {(() => {
        const totalKeptSafe = savings.filter(s => s.status === 'kept').reduce((sum, s) => sum + s.amount, 0);
        if (totalKeptSafe <= 0) return null;
        return (
          <div className="shrink-0 border rounded flex items-center justify-between px-4 py-3 gap-4 bg-blue-900/10 border-blue-900/30">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 bg-blue-500/10">
                <PiggyBank size={18} className="text-blue-400" />
              </div>
              <div>
                <p className="text-[10px] font-bold tracking-wider text-[var(--color-on-surface-variant)] uppercase">💰 Kept Safe Elsewhere</p>
                <p className="text-[11px] text-[var(--color-on-surface-variant)]">
                  Money held by others or in separate accounts
                </p>
              </div>
            </div>
            <p className="font-mono text-base font-bold shrink-0 text-blue-400">
              {formatCurrency(totalKeptSafe, currency).fullVal}
            </p>
          </div>
        );
      })()}
    </div>
  );
}
