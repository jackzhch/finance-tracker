import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SafeAreaTopScrim } from "@hatch/space-sdk/client";
import { Bar, CartesianGrid, Cell, ComposedChart, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, type ApiResponse } from "./api";

type Dashboard = ApiResponse<typeof api, "getDashboard">;
type Account = Dashboard["accounts"][number];
type Transaction = Dashboard["transactions"][number];
type Holding = Dashboard["holdings"][number];
type Snapshot = Dashboard["snapshots"][number];
type Tab = "overview" | "transactions" | "investments";
type Sheet = "account" | "transaction" | "holding" | "balance" | "holdingEdit" | null;
type PeriodMode = "month" | "quarter" | "year";

const CATEGORIES = ["住房", "餐饮", "交通", "购物", "账单", "娱乐", "健康", "教育", "工资", "投资收入", "转账", "其他"];
const ACCOUNT_TYPES = [
  ["checking", "支票账户"], ["savings", "储蓄账户"], ["investment", "投资账户"],
  ["retirement", "退休账户"], ["credit", "信用卡"], ["other", "其他"],
] as const;
const PIE_COLORS = ["#c94f47", "#e68a4a", "#d5ad3d", "#14866d", "#2a7594", "#7a6d9e", "#9d5c77", "#647780", "#a57a51", "#4c8a75", "#b55f55", "#71838b"];

function localDate() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function money(value: number, compact = false) {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", maximumFractionDigits: compact ? 0 : 2,
    notation: compact && Math.abs(value) >= 100000 ? "compact" : "standard",
  }).format(value);
}

function pct(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function getPeriod(mode: PeriodMode, offset: number) {
  const now = new Date();
  let start: Date;
  let end: Date;
  let label: string;
  if (mode === "month") {
    start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
    label = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long" }).format(start);
  } else if (mode === "quarter") {
    const currentQuarterMonth = Math.floor(now.getMonth() / 3) * 3;
    start = new Date(now.getFullYear(), currentQuarterMonth + offset * 3, 1);
    end = new Date(start.getFullYear(), start.getMonth() + 3, 1);
    label = `${start.getFullYear()} 年 · 第 ${Math.floor(start.getMonth() / 3) + 1} 季度`;
  } else {
    start = new Date(now.getFullYear() + offset, 0, 1);
    end = new Date(start.getFullYear() + 1, 0, 1);
    label = `${start.getFullYear()} 年`;
  }
  return { start, end, startKey: dateKey(start), endKey: dateKey(end), label };
}

function buildBalanceHistory(accounts: Account[], transactions: Transaction[], snapshots: Snapshot[], mode: PeriodMode, start: Date, end: Date, useSnapshots = true) {
  const now = new Date();
  const stop = now >= start && now < end ? now : end;
  const sampleDates: Date[] = [];
  if (mode === "month") {
    for (let cursor = new Date(start); cursor < stop; cursor.setDate(cursor.getDate() + 1)) {
      sampleDates.push(new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), 23, 59, 59));
    }
  } else {
    for (let cursor = new Date(start); cursor < stop; cursor.setMonth(cursor.getMonth() + 1)) {
      const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0, 23, 59, 59);
      sampleDates.push(monthEnd > now && now < end ? now : monthEnd);
    }
  }

  const latestSnapshotByDay = new Map<string, Snapshot>();
  if (useSnapshots) {
    for (const snapshot of snapshots) {
      const key = dateKey(new Date(snapshot.captured_at));
      const previous = latestSnapshotByDay.get(key);
      if (!previous || snapshot.captured_at > previous.captured_at) latestSnapshotByDay.set(key, snapshot);
    }
  }
  const transactionsByAccount = new Map<number, Transaction[]>();
  for (const transaction of transactions) {
    const rows = transactionsByAccount.get(transaction.account_id) ?? [];
    rows.push(transaction);
    transactionsByAccount.set(transaction.account_id, rows);
  }

  return sampleDates.map((sampleDate) => {
    const cutoff = dateKey(sampleDate);
    let cash = 0;
    let brokerage = 0;
    let retirement = 0;
    for (const account of accounts) {
      const after = (transactionsByAccount.get(account.id) ?? []).filter((transaction) => transaction.date > cutoff);
      const incomeAfter = after.filter((transaction) => transaction.type === "income").reduce((sum, transaction) => sum + transaction.amount, 0);
      const expenseAfter = after.filter((transaction) => transaction.type === "expense").reduce((sum, transaction) => sum + transaction.amount, 0);
      const historicalBalance = account.type === "credit"
        ? account.balance - expenseAfter + incomeAfter
        : account.balance - incomeAfter + expenseAfter;
      if (account.type === "investment") brokerage += historicalBalance;
      else if (account.type === "retirement") retirement += historicalBalance;
      else if (account.type !== "credit") cash += historicalBalance;
    }
    const snapshot = latestSnapshotByDay.get(cutoff);
    const reconstructedAssets = cash + brokerage + retirement;
    const reconstructedInvestments = brokerage + retirement;
    return {
      key: cutoff,
      label: mode === "month" ? `${sampleDate.getMonth() + 1}/${sampleDate.getDate()}` : `${sampleDate.getMonth() + 1}月`,
      assets: snapshot?.total_assets ?? reconstructedAssets,
      investments: snapshot?.total_investments ?? reconstructedInvestments,
      cash: snapshot?.cash_assets ?? cash,
      brokerage: snapshot?.brokerage_assets ?? brokerage,
      retirement: snapshot?.retirement_assets ?? retirement,
      source: snapshot ? "账户快照" : "交易反推",
    };
  });
}

function buildTrend(transactions: Transaction[], mode: PeriodMode, start: Date, end: Date) {
  const now = new Date();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const stop = start <= now && now < end ? (tomorrow < end ? tomorrow : end) : end;
  const rows: { key: string; label: string; income: number; expense: number }[] = [];
  if (mode === "month") {
    for (let cursor = new Date(start); cursor < stop; cursor.setDate(cursor.getDate() + 1)) {
      rows.push({ key: dateKey(cursor), label: `${cursor.getMonth() + 1}/${cursor.getDate()}`, income: 0, expense: 0 });
    }
  } else {
    for (let cursor = new Date(start); cursor < stop; cursor.setMonth(cursor.getMonth() + 1)) {
      rows.push({ key: `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`, label: `${cursor.getMonth() + 1}月`, income: 0, expense: 0 });
    }
  }
  const rowMap = new Map(rows.map((row) => [row.key, row]));
  for (const transaction of transactions) {
    const key = mode === "month" ? transaction.date : transaction.date.slice(0, 7);
    const row = rowMap.get(key);
    if (!row) continue;
    row[transaction.type] += transaction.amount;
  }
  return rows;
}

function buildCategorizedCashFlow(transactions: Transaction[], mode: PeriodMode, start: Date, end: Date) {
  const totals = new Map<string, number>();
  for (const transaction of transactions) {
    if (transaction.type === "expense") totals.set(transaction.category, (totals.get(transaction.category) ?? 0) + transaction.amount);
  }
  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  const categorySeries = ranked.slice(0, 5).map(([name], index) => ({ name, key: `category_${index}`, color: PIE_COLORS[index % PIE_COLORS.length] ?? PIE_COLORS[0] }));
  const remainderNames = new Set(ranked.slice(5).map(([name]) => name));
  if (remainderNames.size > 0) categorySeries.push({ name: "其他分类", key: "category_other", color: PIE_COLORS[5] ?? "#647780" });
  const rows: Array<Record<string, string | number>> = buildTrend(transactions, mode, start, end).map((row) => ({ ...row }));
  const rowMap = new Map(rows.map((row) => [String(row.key), row]));
  for (const transaction of transactions) {
    if (transaction.type !== "expense") continue;
    const periodKey = mode === "month" ? transaction.date : transaction.date.slice(0, 7);
    const row = rowMap.get(periodKey);
    if (!row) continue;
    const series = categorySeries.find((item) => item.name === transaction.category) ?? (remainderNames.has(transaction.category) ? categorySeries.find((item) => item.key === "category_other") : undefined);
    if (series) row[series.key] = Number(row[series.key] ?? 0) + transaction.amount;
  }
  return { rows, categorySeries };
}

function Icon({ name, size = 20 }: { name: "home" | "receipt" | "chart" | "plus" | "wallet" | "filter" | "close" | "edit" | "refresh" | "left" | "right"; size?: number }) {
  const paths: Record<string, ReactNode> = {
    home: <><path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9v11h13V9M9 20v-6h6v6"/></>,
    receipt: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2Z"/><path d="M9 8h6M9 12h6M9 16h3"/></>,
    chart: <><path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    wallet: <><path d="M3 7.5h17v12H3zM3 7.5V5h14v2.5M15 12h5"/></>,
    filter: <><path d="M4 6h16M7 12h10M10 18h4"/></>,
    close: <><path d="m6 6 12 12M18 6 6 18"/></>,
    edit: <><path d="m4 16-.8 4 4-.8L18 8.4 15.6 6Z"/><path d="m14 7.5 2.5 2.5"/></>,
    refresh: <><path d="M20 6v5h-5"/><path d="M4 18v-5h5"/><path d="M6.1 9a7 7 0 0 1 11.6-2.6L20 9M4 15l2.3 2.6A7 7 0 0 0 18 15"/></>,
    left: <path d="m15 18-6-6 6-6"/>,
    right: <path d="m9 18 6-6-6-6"/>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function Empty({ title, detail, action, onAction }: { title: string; detail: string; action: string; onAction: () => void }) {
  return <div className="empty-state"><div className="empty-mark"><span></span><span></span><span></span></div><h3>{title}</h3><p>{detail}</p><button className="text-action" onClick={onAction}>{action} <span>→</span></button></div>;
}

function MultiFilter({ label, allLabel, values, setValues, options }: { label: string; allLabel: string; values: string[]; setValues: (values: string[]) => void; options: Array<{ value: string; label: string }> }) {
  const toggle = (value: string) => setValues(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);
  const selectedLabels = options.filter((option) => values.includes(option.value)).map((option) => option.label);
  return <details className="multi-filter">
    <summary aria-label={label}>{values.length === 0 ? allLabel : values.length === 1 ? selectedLabels[0] : `已选 ${values.length} 项`}</summary>
    <div className="multi-filter-menu" role="group" aria-label={label}>
      <div className="multi-filter-head"><strong>{label}</strong>{values.length > 0 && <button type="button" onClick={() => setValues([])}>清除</button>}</div>
      {options.map((option) => <label key={option.value}><input aria-label={`${label}：${option.label}`} type="checkbox" checked={values.includes(option.value)} onChange={() => toggle(option.value)}/><span>{option.label}</span></label>)}
    </div>
  </details>;
}

function FilterBar({ accounts, account, setAccount, bank, setBank, accountType, setAccountType, category, setCategory, categoryOptions = CATEGORIES, showCategory = false }: { accounts: Account[]; account: string[]; setAccount: (v: string[]) => void; bank: string[]; setBank: (v: string[]) => void; accountType: string[]; setAccountType: (v: string[]) => void; category: string[]; setCategory: (v: string[]) => void; categoryOptions?: string[]; showCategory?: boolean }) {
  const banks = [...new Set(accounts.map((a) => a.institution))];
  const hasFilters = account.length + bank.length + accountType.length + category.length > 0;
  const clearAll = () => { setAccount([]); setBank([]); setAccountType([]); setCategory([]); };
  return <div className="filters" aria-label="筛选器">
    <div className="filter-icon"><Icon name="filter" size={17}/></div>
    <MultiFilter label="按账户类型筛选" allLabel="所有类型" values={accountType} setValues={setAccountType} options={ACCOUNT_TYPES.map(([value, label]) => ({ value, label }))}/>
    <MultiFilter label="按账户筛选" allLabel="所有账户" values={account} setValues={setAccount} options={accounts.map((item) => ({ value: String(item.id), label: item.name }))}/>
    <MultiFilter label="按银行筛选" allLabel="所有银行" values={bank} setValues={setBank} options={banks.map((item) => ({ value: item, label: item }))}/>
    {showCategory && <MultiFilter label="按分类筛选" allLabel="所有分类" values={category} setValues={setCategory} options={categoryOptions.map((item) => ({ value: item, label: item }))}/>} 
    {hasFilters && <button type="button" className="clear-filters" onClick={clearAll}>清除筛选</button>}
  </div>;
}

function PeriodSelector({ mode, setMode, offset, setOffset, label }: { mode: PeriodMode; setMode: (v: PeriodMode) => void; offset: number; setOffset: (v: number) => void; label: string }) {
  return <div className="period-control">
    <div className="period-tabs" role="group" aria-label="查看周期">
      {(["month", "quarter", "year"] as const).map((value) => <button key={value} className={mode === value ? "active" : ""} onClick={() => { setMode(value); setOffset(0); }}>{value === "month" ? "月" : value === "quarter" ? "季度" : "年"}</button>)}
    </div>
    <div className="period-stepper"><button aria-label="上一周期" onClick={() => setOffset(offset - 1)}><Icon name="left" size={17}/></button><strong>{label}</strong><button aria-label="下一周期" onClick={() => setOffset(offset + 1)} disabled={offset >= 0}><Icon name="right" size={17}/></button></div>
  </div>;
}

export function App() {
  const queryClient = useQueryClient();
  const dashboard = useQuery({ queryKey: ["dashboard"], queryFn: () => api.getDashboard({}) });
  const syncStatus = useQuery({ queryKey: ["syncStatus"], queryFn: () => api.getSyncStatus({}), refetchInterval: (query) => query.state.data?.status === "syncing" ? 4000 : false });
  const [tab, setTab] = useState<Tab>("overview");
  const [sheet, setSheet] = useState<Sheet>(null);
  const [accountFilter, setAccountFilter] = useState<string[]>([]);
  const [bankFilter, setBankFilter] = useState<string[]>([]);
  const [accountTypeFilter, setAccountTypeFilter] = useState<string[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<string[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [selectedHolding, setSelectedHolding] = useState<Holding | null>(null);
  const [periodMode, setPeriodMode] = useState<PeriodMode>("month");
  const [periodOffset, setPeriodOffset] = useState(0);
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);
  const previousSync = useRef<string | null>(null);

  const data = dashboard.data ?? { accounts: [], transactions: [], holdings: [], snapshots: [] };
  const period = useMemo(() => getPeriod(periodMode, periodOffset), [periodMode, periodOffset]);
  const periodTransactions = useMemo(() => data.transactions.filter((t) => t.date >= period.startKey && t.date < period.endKey), [data.transactions, period.startKey, period.endKey]);
  const filteredAccounts = useMemo(() => data.accounts.filter((a) => (accountFilter.length === 0 || accountFilter.includes(String(a.id))) && (bankFilter.length === 0 || bankFilter.includes(a.institution)) && (accountTypeFilter.length === 0 || accountTypeFilter.includes(a.type))), [data.accounts, accountFilter, bankFilter, accountTypeFilter]);
  const filteredAccountIds = useMemo(() => new Set(filteredAccounts.map((account) => account.id)), [filteredAccounts]);
  const accountFilteredTransactions = periodTransactions.filter((transaction) => filteredAccountIds.has(transaction.account_id));
  const transactions = accountFilteredTransactions.filter((transaction) => categoryFilter.length === 0 || categoryFilter.includes(transaction.category));
  const categoryOptions = useMemo(() => [...new Set(data.transactions.map((transaction) => transaction.category))].sort((a, b) => a.localeCompare(b, "zh-CN")), [data.transactions]);
  const holdings = data.holdings.filter((h) => filteredAccountIds.has(h.account_id));
  const income = transactions.filter((t) => t.type === "income").reduce((sum, t) => sum + t.amount, 0);
  const expenses = transactions.filter((t) => t.type === "expense").reduce((sum, t) => sum + t.amount, 0);
  const marketValue = holdings.reduce((sum, h) => sum + h.quantity * h.current_price, 0);
  const costBasis = holdings.reduce((sum, h) => sum + h.quantity * h.avg_cost, 0);
  const totalGain = marketValue - costBasis;
  const gainPct = costBasis > 0 ? totalGain / costBasis * 100 : 0;

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  const accountMutation = useMutation({ mutationFn: api.addAccount, onSuccess: () => { invalidate(); setSheet(null); } });
  const transactionMutation = useMutation({ mutationFn: api.addTransaction, onSuccess: () => { invalidate(); setSheet(null); } });
  const holdingMutation = useMutation({ mutationFn: api.addHolding, onSuccess: () => { invalidate(); setSheet(null); } });
  const balanceMutation = useMutation({ mutationFn: api.updateAccountBalance, onSuccess: () => { invalidate(); setSheet(null); } });
  const holdingEditMutation = useMutation({ mutationFn: api.updateHolding, onSuccess: () => { invalidate(); setSheet(null); } });
  const syncMutation = useMutation({
    mutationFn: api.syncNow,
    onSuccess: (result) => {
      previousSync.current = result.status;
      setSyncFeedback(result.message);
      queryClient.invalidateQueries({ queryKey: ["syncStatus"] });
    },
    onError: () => setSyncFeedback("无法启动同步，请稍后重试。"),
  });

  useEffect(() => {
    const status = syncStatus.data?.status;
    if (previousSync.current === "syncing" && (status === "success" || status === "error")) {
      setSyncFeedback(syncStatus.data?.message ?? (status === "success" ? "同步完成。" : "同步失败，请稍后重试。"));
      if (status === "success") invalidate();
    }
    if (status) previousSync.current = status;
  }, [syncStatus.data?.status, syncStatus.data?.message]);

  const openBalance = (account: Account) => { setSelectedAccount(account); setSheet("balance"); };
  const openHolding = (holding: Holding) => { setSelectedHolding(holding); setSheet("holdingEdit"); };
  const hasAccounts = data.accounts.length > 0;
  const isSyncing = syncMutation.isPending || syncStatus.data?.status === "syncing";
  const lastSynced = syncStatus.data?.synced_at ? new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(syncStatus.data.synced_at)) : null;

  if (dashboard.isPending) return <main className="loading" aria-label="正在加载财务数据"><div className="loading-head"><div className="loading-line"></div><div className="loading-line short"></div></div><div className="loading-card"></div><div className="loading-metrics"><span></span><span></span><span></span></div><div className="loading-chart"></div></main>;
  if (dashboard.error) return <main className="error-page"><p>暂时无法读取数据。</p><button onClick={() => dashboard.refetch()}>重试</button></main>;

  return <div className="app-shell">
    <SafeAreaTopScrim backgroundColor="var(--bg)" />
    <aside className="desktop-nav" aria-label="主导航">
      <div className="nav-stamp"><Icon name="wallet" size={22}/></div>
      <NavButton active={tab === "overview"} onClick={() => setTab("overview")} icon="home" label="总览" />
      <NavButton active={tab === "transactions"} onClick={() => setTab("transactions")} icon="receipt" label="收支" />
      <NavButton active={tab === "investments"} onClick={() => setTab("investments")} icon="chart" label="投资" />
    </aside>

    <main className="main-content">
      <header className="page-top">
        <div><p className="date-label">FINANCIAL LEDGER</p><h1>{tab === "overview" ? "资金全景" : tab === "transactions" ? "收入与支出" : "投资组合"}</h1></div>
        <div className="top-actions">
          <button className="sync-button" aria-label="手动刷新账户数据" onClick={() => syncMutation.mutate({})} disabled={isSyncing}><Icon name="refresh" size={17}/><span>{isSyncing ? "同步中…" : "刷新"}</span></button>
          <button className="add-button" aria-label={tab === "overview" ? "添加账户" : tab === "transactions" ? "添加交易" : "添加持仓"} onClick={() => setSheet(tab === "overview" ? "account" : tab === "transactions" ? "transaction" : "holding")} disabled={tab !== "overview" && !hasAccounts}><Icon name="plus" size={18}/><span>{tab === "overview" ? "账户" : tab === "transactions" ? "交易" : "持仓"}</span></button>
        </div>
      </header>
      <div className="sync-line" aria-live="polite">{syncFeedback ?? (lastSynced ? `每天自动同步 · 上次同步 ${lastSynced}` : "已连接账户每天自动同步，也可手动刷新")}</div>

      {tab === "overview" && <Overview accounts={data.accounts} transactions={periodTransactions} historicalTransactions={data.transactions} holdings={data.holdings} snapshots={data.snapshots} periodMode={periodMode} setPeriodMode={setPeriodMode} periodOffset={periodOffset} setPeriodOffset={setPeriodOffset} period={period} netWorth={data.accounts.reduce((s, a) => s + (a.type === "credit" ? -Math.abs(a.balance) : a.balance), 0)} marketValue={data.holdings.reduce((s,h)=>s+h.quantity*h.current_price,0)} totalGain={data.holdings.reduce((s,h)=>s+h.quantity*(h.current_price-h.avg_cost),0)} onAddAccount={() => setSheet("account")} onEditBalance={openBalance} />}

      {tab === "transactions" && <section>
        <PeriodSelector mode={periodMode} setMode={setPeriodMode} offset={periodOffset} setOffset={setPeriodOffset} label={period.label}/>
        <FilterBar accounts={data.accounts} account={accountFilter} setAccount={setAccountFilter} bank={bankFilter} setBank={setBankFilter} accountType={accountTypeFilter} setAccountType={setAccountTypeFilter} category={categoryFilter} setCategory={setCategoryFilter} categoryOptions={categoryOptions} showCategory />
        <div className="flow-tape"><div><span>收入</span><strong className="positive">{money(income)}</strong></div><div><span>支出</span><strong className="negative">{money(expenses)}</strong></div><div><span>净流入</span><strong>{money(income - expenses)}</strong></div></div>
        {data.transactions.length === 0 ? <Empty title="从第一笔收支开始" detail={hasAccounts ? "记录收入或消费，分类走势会自动形成。" : "先添加一个账户，再记录收入和支出。"} action={hasAccounts ? "添加交易" : "添加账户"} onAction={() => setSheet(hasAccounts ? "transaction" : "account")} /> : accountFilteredTransactions.length === 0 ? <div className="no-match">{period.label}没有符合当前账户筛选条件的交易</div> : <CashFlowWorkspace transactions={accountFilteredTransactions} accounts={data.accounts} periodMode={periodMode} period={period} selectedCategories={categoryFilter} setSelectedCategories={setCategoryFilter} />}
      </section>}

      {tab === "investments" && <section>
        <PeriodSelector mode={periodMode} setMode={setPeriodMode} offset={periodOffset} setOffset={setPeriodOffset} label={period.label}/>
        <FilterBar accounts={data.accounts} account={accountFilter} setAccount={setAccountFilter} bank={bankFilter} setBank={setBankFilter} accountType={accountTypeFilter} setAccountType={setAccountTypeFilter} category={categoryFilter} setCategory={setCategoryFilter} />
        <InvestmentDashboard holdings={holdings} allHoldings={data.holdings} transactions={data.transactions} accounts={data.accounts} trendAccounts={filteredAccounts} snapshots={data.snapshots} useSnapshots={accountFilter.length === 0 && bankFilter.length === 0 && accountTypeFilter.length === 0} periodMode={periodMode} period={period} marketValue={marketValue} totalGain={totalGain} gainPct={gainPct} onEdit={openHolding} onEmptyAction={() => setSheet(hasAccounts ? "holding" : "account")} hasAccounts={hasAccounts} />
      </section>}
    </main>

    <nav className="mobile-nav" aria-label="主导航"><NavButton active={tab === "overview"} onClick={() => setTab("overview")} icon="home" label="总览" /><NavButton active={tab === "transactions"} onClick={() => setTab("transactions")} icon="receipt" label="收支" /><NavButton active={tab === "investments"} onClick={() => setTab("investments")} icon="chart" label="投资" /></nav>

    {sheet && <Sheet title={sheet === "account" ? "添加账户" : sheet === "transaction" ? "记录交易" : sheet === "holding" ? "添加持仓" : sheet === "balance" ? "更新余额" : "更新持仓"} onClose={() => setSheet(null)}>
      {sheet === "account" && <AccountForm pending={accountMutation.isPending} error={accountMutation.error} onSubmit={(value) => accountMutation.mutate(value)} />}
      {sheet === "transaction" && <TransactionForm accounts={data.accounts} pending={transactionMutation.isPending} error={transactionMutation.error} onSubmit={(value) => transactionMutation.mutate(value)} />}
      {sheet === "holding" && <HoldingForm accounts={data.accounts} pending={holdingMutation.isPending} error={holdingMutation.error} onSubmit={(value) => holdingMutation.mutate(value)} />}
      {sheet === "balance" && selectedAccount && <BalanceForm account={selectedAccount} pending={balanceMutation.isPending} error={balanceMutation.error} onSubmit={(balance) => balanceMutation.mutate({ id: selectedAccount.id, balance })} />}
      {sheet === "holdingEdit" && selectedHolding && <HoldingEditForm holding={selectedHolding} pending={holdingEditMutation.isPending} error={holdingEditMutation.error} onSubmit={(value) => holdingEditMutation.mutate({ id: selectedHolding.id, ...value })} />}
    </Sheet>}
  </div>;
}

function NavButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: "home" | "receipt" | "chart"; label: string }) {
  return <button className={`nav-button ${active ? "active" : ""}`} onClick={onClick} aria-current={active ? "page" : undefined}><Icon name={icon}/><span>{label}</span></button>;
}

function Overview({ accounts, transactions, historicalTransactions, holdings, snapshots, periodMode, setPeriodMode, periodOffset, setPeriodOffset, period, netWorth, marketValue, totalGain, onAddAccount, onEditBalance }: { accounts: Account[]; transactions: Transaction[]; historicalTransactions: Transaction[]; holdings: Holding[]; snapshots: Snapshot[]; periodMode: PeriodMode; setPeriodMode: (v: PeriodMode) => void; periodOffset: number; setPeriodOffset: (v: number) => void; period: ReturnType<typeof getPeriod>; netWorth: number; marketValue: number; totalGain: number; onAddAccount: () => void; onEditBalance: (a: Account) => void }) {
  const assets = accounts.filter((a) => a.type !== "credit").reduce((s, a) => s + a.balance, 0);
  const liabilities = accounts.filter((a) => a.type === "credit").reduce((s, a) => s + Math.max(a.balance, 0), 0);
  const income = transactions.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
  const expenses = transactions.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
  const snapshotTrend = buildBalanceHistory(accounts, historicalTransactions, snapshots, periodMode, period.start, period.end);
  const accountGroups = ACCOUNT_TYPES.map(([type, label]) => ({ type, label, accounts: accounts.filter((account) => account.type === type) })).filter((group) => group.accounts.length > 0);
  return <>
    <section className="net-worth-panel">
      <div className="net-worth-copy"><span>当前净资产</span><strong>{money(netWorth, true)}</strong><p>{accounts.length ? `${accounts.length} 个账户` : "添加账户后显示"}</p></div>
      <div className="composition"><div className="composition-bar"><span style={{ width: `${assets + liabilities > 0 ? assets/(assets+liabilities)*100 : 50}%` }}></span></div><div className="composition-labels"><span><i className="asset-dot"></i>资产 {money(assets, true)}</span><span><i className="liability-dot"></i>负债 {money(liabilities, true)}</span></div></div>
    </section>
    <PeriodSelector mode={periodMode} setMode={setPeriodMode} offset={periodOffset} setOffset={setPeriodOffset} label={period.label}/>
    <section className="metric-row"><article><span>收入 · {period.label}</span><strong className="positive">{money(income, true)}</strong></article><article><span>支出 · {period.label}</span><strong className="negative">{money(expenses, true)}</strong></article><article><span>投资市值 · 当前</span><strong>{money(marketValue, true)}</strong><small className={totalGain >= 0 ? "positive" : "negative"}>{totalGain >= 0 ? "+" : ""}{money(totalGain, true)}</small></article></section>
    <section className="chart-section asset-trend-section"><div className="section-heading"><div><span>BALANCE HISTORY</span><h2>总资产与总投资趋势</h2><small>历史区间由当前余额与已同步交易反推；同步快照会自动替换对应日期。</small></div></div>{snapshotTrend.length === 0 ? <div className="mini-empty"><p>{period.label}暂无可用数据。</p></div> : <div className="trend-chart asset-trend" aria-label={`${period.label}总资产与总投资组合趋势图`}><ResponsiveContainer width="100%" height="100%"><ComposedChart data={snapshotTrend} margin={{ top: 18, right: 8, left: -10, bottom: 0 }}><CartesianGrid stroke="var(--border)" vertical={false}/><XAxis dataKey="label" tick={{ fill: "var(--dim)", fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={20}/><YAxis domain={[0, "auto"]} tickFormatter={(value) => money(Number(value), true)} tick={{ fill: "var(--dim)", fontSize: 9 }} tickLine={false} axisLine={false} width={62}/><Tooltip formatter={(value) => value == null ? "暂无" : money(Number(value))} labelStyle={{ color: "#172126" }} isAnimationActive={false}/><Bar dataKey="cash" name="现金及其他" stackId="assets" fill="var(--bar-cash)" isAnimationActive={false}/><Bar dataKey="brokerage" name="证券投资" stackId="assets" fill="var(--bar-brokerage)" isAnimationActive={false}/><Bar dataKey="retirement" name="退休账户" stackId="assets" fill="var(--bar-retirement)" radius={[2,2,0,0]} isAnimationActive={false}/><Line type="monotone" dataKey="assets" name="总资产" stroke="var(--accent-chart)" strokeWidth={2.8} dot={{ r: 3 }} connectNulls={false} isAnimationActive={false}/><Line type="monotone" dataKey="investments" name="总投资" stroke="var(--positive)" strokeWidth={2.8} dot={{ r: 3 }} connectNulls={false} isAnimationActive={false}/></ComposedChart></ResponsiveContainer><div className="chart-legend combo-legend"><span><i className="bar-cash"></i>现金及其他</span><span><i className="bar-brokerage"></i>证券投资</span><span><i className="bar-retirement"></i>退休账户</span><span><i className="asset-line"></i>总资产</span><span><i className="income-line"></i>总投资</span></div></div>}</section>
    <div className="overview-grid">
      <section className="ledger-section"><div className="section-heading"><div><span>ACCOUNTS BY TYPE</span><h2>账户分类</h2></div><button onClick={onAddAccount}>添加</button></div>{accounts.length === 0 ? <Empty title="先建立资金版图" detail="添加银行、信用卡或投资账户，余额由你掌控。" action="添加第一个账户" onAction={onAddAccount}/> : <div className="account-groups">{accountGroups.map((group) => <section className="account-group" key={group.type}><header><span>{group.label}</span><strong>{money(group.accounts.reduce((sum, account) => sum + account.balance, 0))}</strong></header><div className="account-list">{group.accounts.map((a) => <button key={a.id} className="account-row" onClick={() => onEditBalance(a)} aria-label={`更新 ${a.name} 余额`}><span className={`account-sigil ${a.type}`}>{a.institution.slice(0,1).toUpperCase()}</span><span className="account-name"><strong>{a.name}</strong><small>{a.institution}</small></span><strong className={a.type === "credit" ? "negative" : ""}>{money(a.balance)}</strong><Icon name="edit" size={15}/></button>)}</div></section>)}</div>}</section>
      <section className="ledger-section"><div className="section-heading"><div><span>HOLDINGS</span><h2>投资摘要</h2></div></div>{holdings.length === 0 ? <div className="mini-empty"><p>同步或添加持仓后，这里会显示当前市值与收益。</p></div> : <div className="investment-summary"><strong>{holdings.length}</strong><span>项持仓</span><small>当前收益 {totalGain >= 0 ? "+" : ""}{money(totalGain, true)}</small></div>}</section>
    </div>
  </>;
}

function CashFlowWorkspace({ transactions, accounts, periodMode, period, selectedCategories, setSelectedCategories }: { transactions: Transaction[]; accounts: Account[]; periodMode: PeriodMode; period: ReturnType<typeof getPeriod>; selectedCategories: string[]; setSelectedCategories: (values: string[]) => void }) {
  const categoryMap = new Map<string, number>();
  for (const transaction of transactions) {
    if (transaction.type === "expense") categoryMap.set(transaction.category, (categoryMap.get(transaction.category) ?? 0) + transaction.amount);
  }
  const categories = [...categoryMap.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  const visibleTransactions = selectedCategories.length > 0 ? transactions.filter((transaction) => selectedCategories.includes(transaction.category)) : transactions;
  const { rows, categorySeries } = buildCategorizedCashFlow(visibleTransactions, periodMode, period.start, period.end);
  const toggleCategory = (name: string) => setSelectedCategories(selectedCategories.includes(name) ? selectedCategories.filter((category) => category !== name) : [...selectedCategories, name]);

  return <>
    <div className="chart-grid cash-flow-grid">
      <section className="chart-section"><div className="section-heading"><div><span>CASH FLOW</span><h2>收支趋势</h2></div></div><div className="trend-chart combo-chart" aria-label={`${period.label}收支组合趋势图`}><ResponsiveContainer width="100%" height="100%"><ComposedChart data={rows} margin={{ top: 18, right: 8, left: -10, bottom: 0 }}><CartesianGrid stroke="var(--border)" vertical={false}/><XAxis dataKey="label" tick={{ fill: "var(--dim)", fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={20}/><YAxis domain={[0, "auto"]} tickFormatter={(value) => money(Number(value), true)} tick={{ fill: "var(--dim)", fontSize: 9 }} tickLine={false} axisLine={false} width={56}/><Tooltip formatter={(value) => money(Number(value))} labelStyle={{ color: "#172126" }} isAnimationActive={false}/>{categorySeries.map((series, index) => <Bar key={series.key} dataKey={series.key} name={series.name} stackId="expense" fill={series.color} radius={index === categorySeries.length - 1 ? [2,2,0,0] : undefined} isAnimationActive={false}/>)}<Line type="monotone" dataKey="income" name="收入" stroke="var(--positive)" strokeWidth={2.7} dot={false} isAnimationActive={false}/><Line type="monotone" dataKey="expense" name="支出" stroke="var(--negative)" strokeWidth={2.7} dot={false} isAnimationActive={false}/></ComposedChart></ResponsiveContainer><div className="chart-legend combo-legend">{categorySeries.map((series) => <span key={series.key}><i style={{ background: series.color }}></i>{series.name}</span>)}<span><i className="income-line"></i>收入趋势</span><span><i className="expense-line"></i>支出趋势</span></div></div></section>
      <section className="chart-section"><div className="section-heading"><div><span>SPENDING</span><h2>消费分类</h2></div></div>{categories.length === 0 ? <div className="mini-empty"><p>{period.label}暂无分类支出。</p></div> : <div className="pie-layout"><div className="pie-chart" aria-label={`${period.label}消费分类饼图`}><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={categories} dataKey="value" nameKey="name" innerRadius={48} outerRadius={78} paddingAngle={1} isAnimationActive={false}>{categories.map((category, index) => <Cell key={category.name} fill={PIE_COLORS[index % PIE_COLORS.length]} opacity={selectedCategories.length === 0 || selectedCategories.includes(category.name) ? 1 : 0.22} stroke={selectedCategories.includes(category.name) ? "var(--text)" : "none"} strokeWidth={selectedCategories.includes(category.name) ? 2 : 0} cursor="pointer" onClick={() => toggleCategory(category.name)}/>)}</Pie><Tooltip formatter={(value) => money(Number(value))} isAnimationActive={false}/></PieChart></ResponsiveContainer></div><div className="pie-legend">{categories.map((category, index) => <button type="button" className={selectedCategories.includes(category.name) ? "selected" : ""} key={category.name} onClick={() => toggleCategory(category.name)} aria-pressed={selectedCategories.includes(category.name)}><span><i style={{ background: PIE_COLORS[index % PIE_COLORS.length] }}></i>{category.name}</span><strong>{money(category.value)}</strong></button>)}</div></div>}</section>
    </div>
    <section className="records-section"><div className="drilldown-header"><div><span>{selectedCategories.length > 0 ? "消费筛选" : "交易记录"}</span><strong>{selectedCategories.length > 0 ? `${selectedCategories.join("、")} · ${visibleTransactions.length} 笔` : `${visibleTransactions.length} 笔`}</strong></div>{selectedCategories.length > 0 && <button type="button" onClick={() => setSelectedCategories([])}>清除筛选</button>}</div>{visibleTransactions.length === 0 ? <div className="no-match">没有符合分类筛选的交易</div> : <TransactionList transactions={visibleTransactions} accounts={accounts} />}</section>
  </>;
}

function InvestmentDashboard({ holdings, allHoldings, transactions, accounts, trendAccounts, snapshots, useSnapshots, periodMode, period, marketValue, totalGain, gainPct, onEdit, onEmptyAction, hasAccounts }: { holdings: Holding[]; allHoldings: Holding[]; transactions: Transaction[]; accounts: Account[]; trendAccounts: Account[]; snapshots: Snapshot[]; useSnapshots: boolean; periodMode: PeriodMode; period: ReturnType<typeof getPeriod>; marketValue: number; totalGain: number; gainPct: number; onEdit: (holding: Holding) => void; onEmptyAction: () => void; hasAccounts: boolean }) {
  const [selectedSlice, setSelectedSlice] = useState<string | null>(null);
  const symbolMap = new Map<string, number>();
  for (const holding of holdings) symbolMap.set(holding.symbol, (symbolMap.get(holding.symbol) ?? 0) + holding.quantity * holding.current_price);
  const ranked = [...symbolMap.entries()].map(([name, value]) => ({ name, value, symbols: [name] })).sort((a, b) => b.value - a.value);
  const allocation = ranked.length <= 8 ? ranked : [...ranked.slice(0, 7), { name: "其他", value: ranked.slice(7).reduce((sum, item) => sum + item.value, 0), symbols: ranked.slice(7).map((item) => item.name) }];
  useEffect(() => {
    if (selectedSlice && !allocation.some((item) => item.name === selectedSlice)) setSelectedSlice(null);
  }, [selectedSlice, holdings]);
  const selectedSymbols = allocation.find((item) => item.name === selectedSlice)?.symbols ?? [];
  const visibleHoldings = selectedSlice ? holdings.filter((holding) => selectedSymbols.includes(holding.symbol)) : holdings;
  const relatedTransactions = selectedSlice ? transactions.filter((transaction) => {
    const terms = transaction.description.toUpperCase().split(/[^A-Z0-9.]+/).filter(Boolean);
    return selectedSymbols.some((symbol) => terms.includes(symbol.toUpperCase()));
  }) : [];
  const selectSlice = (name: string) => setSelectedSlice((current) => current === name ? null : name);
  const investmentAccounts = trendAccounts.filter((account) => account.type === "investment" || account.type === "retirement");
  const investmentAccountIds = new Set(investmentAccounts.map((account) => account.id));
  const investmentTransactions = transactions.filter((transaction) => investmentAccountIds.has(transaction.account_id));
  const investmentTrend = buildBalanceHistory(investmentAccounts, investmentTransactions, snapshots, periodMode, period.start, period.end, useSnapshots);
  const firstPoint = investmentTrend[0];
  const lastPoint = investmentTrend[investmentTrend.length - 1];
  const periodChange = firstPoint && lastPoint && firstPoint.key !== lastPoint.key ? lastPoint.investments - firstPoint.investments : null;
  const periodChangePct = periodChange != null && firstPoint && firstPoint.investments !== 0 ? periodChange / Math.abs(firstPoint.investments) * 100 : null;

  return <>
    <div className="flow-tape investment-tape"><div><span>当前投资市值</span><strong>{money(marketValue)}</strong></div><div><span>累计收益</span><strong className={totalGain >= 0 ? "positive" : "negative"}>{money(totalGain)} · {pct(gainPct)}</strong></div><div><span>{period.label}区间变动</span><strong className={periodChange != null && periodChange >= 0 ? "positive" : periodChange != null ? "negative" : ""}>{periodChange == null ? "—" : `${money(periodChange)} · ${periodChangePct == null ? "—" : pct(periodChangePct)}`}</strong></div></div>
    {allHoldings.length === 0 ? <Empty title="还没有持仓" detail={hasAccounts ? "添加股票、ETF 或基金，查看市值和累计收益。" : "先添加投资账户，再录入持仓。"} action={hasAccounts ? "添加持仓" : "添加账户"} onAction={onEmptyAction} /> : holdings.length === 0 ? <div className="no-match">没有符合当前筛选条件的持仓</div> : <>
      <div className="chart-grid investment-chart-grid">
        <section className="chart-section investment-trend"><div className="section-heading"><div><span>PORTFOLIO HISTORY</span><h2>投资趋势</h2><small>历史区间由当前账户余额与已同步交易反推。</small></div></div>{investmentTrend.length === 0 ? <div className="mini-empty"><p>{period.label}暂无投资数据。</p></div> : <div className="trend-chart combo-chart" aria-label={`${period.label}投资组合趋势图`}><ResponsiveContainer width="100%" height="100%"><ComposedChart data={investmentTrend} margin={{ top: 18, right: 8, left: -10, bottom: 0 }}><CartesianGrid stroke="var(--border)" vertical={false}/><XAxis dataKey="label" tick={{ fill: "var(--dim)", fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={20}/><YAxis domain={[0, "auto"]} tickFormatter={(value) => money(Number(value), true)} tick={{ fill: "var(--dim)", fontSize: 9 }} tickLine={false} axisLine={false} width={62}/><Tooltip formatter={(value) => value == null ? "暂无" : money(Number(value))} labelStyle={{ color: "#172126" }} isAnimationActive={false}/><Bar dataKey="brokerage" name="证券账户" stackId="investment" fill="var(--bar-brokerage)" isAnimationActive={false}/><Bar dataKey="retirement" name="退休账户" stackId="investment" fill="var(--bar-retirement)" radius={[2,2,0,0]} isAnimationActive={false}/><Line type="monotone" dataKey="investments" name="总投资趋势" stroke="var(--positive)" strokeWidth={2.8} dot={false} connectNulls={false} isAnimationActive={false}/></ComposedChart></ResponsiveContainer><div className="chart-legend combo-legend"><span><i className="bar-brokerage"></i>证券账户</span><span><i className="bar-retirement"></i>退休账户</span><span><i className="income-line"></i>总投资趋势</span></div></div>}</section>
        <section className="chart-section investment-allocation"><div className="section-heading"><div><span>ALLOCATION</span><h2>投资持仓分布</h2></div></div><div className="pie-layout"><div className="pie-chart" aria-label="投资持仓饼图"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={allocation} dataKey="value" nameKey="name" innerRadius={48} outerRadius={78} paddingAngle={1} isAnimationActive={false}>{allocation.map((item, index) => <Cell key={item.name} fill={PIE_COLORS[index % PIE_COLORS.length]} opacity={!selectedSlice || selectedSlice === item.name ? 1 : 0.28} stroke={selectedSlice === item.name ? "var(--text)" : "none"} strokeWidth={selectedSlice === item.name ? 2 : 0} cursor="pointer" onClick={() => selectSlice(item.name)}/>)}</Pie><Tooltip formatter={(value) => money(Number(value))} isAnimationActive={false}/></PieChart></ResponsiveContainer></div><div className="pie-legend">{allocation.map((item, index) => <button type="button" className={selectedSlice === item.name ? "selected" : ""} key={item.name} onClick={() => selectSlice(item.name)} aria-pressed={selectedSlice === item.name}><span><i style={{ background: PIE_COLORS[index % PIE_COLORS.length] }}></i>{item.name}</span><strong>{money(item.value)}</strong></button>)}</div></div></section>
      </div>
      <section className="records-section"><div className="drilldown-header"><div><span>{selectedSlice ? "持仓筛选" : "持仓明细"}</span><strong>{selectedSlice ? `${selectedSlice} · ${visibleHoldings.length} 项` : `${visibleHoldings.length} 项`}</strong></div>{selectedSlice && <button type="button" onClick={() => setSelectedSlice(null)}>清除筛选</button>}</div>{relatedTransactions.length > 0 && <div className="related-transactions"><h3>相关交易</h3><TransactionList transactions={relatedTransactions} accounts={accounts} /></div>}<HoldingsList holdings={visibleHoldings} accounts={accounts} onEdit={onEdit} /></section>
    </>}
  </>;
}

function TransactionList({ transactions, accounts }: { transactions: Transaction[]; accounts: Account[] }) {
  const [limit, setLimit] = useState(120);
  const accountMap = new Map(accounts.map((a) => [a.id, a]));
  const visibleTransactions = transactions.slice(0, limit);
  const groups = visibleTransactions.reduce<Record<string, Transaction[]>>((acc, t) => { (acc[t.date] ??= []).push(t); return acc; }, {});
  return <div className="transaction-groups">{Object.entries(groups).map(([date, rows]) => <section key={date}><h2>{new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric" }).format(new Date(`${date}T00:00:00`))}</h2>{rows.map((t) => <div className="transaction-row" key={t.id}><span className={`transaction-mark ${t.type}`}>{t.type === "income" ? "↓" : "↑"}</span><span className="transaction-main"><strong>{t.description}</strong><small>{t.category} · {accountMap.get(t.account_id)?.name ?? "账户"}</small></span><strong className={t.type === "income" ? "positive" : "negative"}>{t.type === "income" ? "+" : "−"}{money(t.amount)}</strong></div>)}</section>)}{limit < transactions.length && <button type="button" className="load-more" onClick={() => setLimit((current) => current + 120)}>再显示 120 笔 · 剩余 {transactions.length - limit} 笔</button>}</div>;
}

function HoldingsList({ holdings, accounts, onEdit }: { holdings: Holding[]; accounts: Account[]; onEdit: (h: Holding) => void }) {
  const accountMap = new Map(accounts.map((a) => [a.id, a]));
  return <div className="holdings-list">{holdings.map((h) => { const value = h.quantity*h.current_price; const gain = h.quantity*(h.current_price-h.avg_cost); const gainPercent = h.avg_cost > 0 ? (h.current_price-h.avg_cost)/h.avg_cost*100 : 0; return <button className="holding-row" key={h.id} onClick={() => onEdit(h)} aria-label={`更新 ${h.symbol} 持仓`}><span className="ticker">{h.symbol.slice(0,4)}</span><span className="holding-name"><strong>{h.symbol}</strong><small>{h.name} · {accountMap.get(h.account_id)?.name ?? "账户"}</small></span><span className="holding-value"><strong>{money(value)}</strong><small className={gain >= 0 ? "positive" : "negative"}>{gain >= 0 ? "+" : ""}{money(gain)} · {pct(gainPercent)}</small></span><Icon name="edit" size={15}/></button>;})}</div>;
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return <div className="sheet-layer" role="dialog" aria-modal="true" aria-label={title}><button className="sheet-backdrop" aria-label="关闭" onClick={onClose}></button><section className="sheet"><div className="sheet-grip"></div><header><h2>{title}</h2><button aria-label="关闭" onClick={onClose}><Icon name="close"/></button></header>{children}</section></div>;
}

function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="field"><span>{label}</span>{children}</label>; }
function ErrorText({ error }: { error: Error | null }) { return error ? <p className="form-error">保存失败，请检查后重试。</p> : null; }

function AccountForm({ onSubmit, pending, error }: { onSubmit: (v: { name: string; institution: string; type: Account["type"]; balance: number }) => void; pending: boolean; error: Error | null }) {
  const submit = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const f = new FormData(e.currentTarget); onSubmit({ name: String(f.get("name")), institution: String(f.get("institution")), type: String(f.get("type")) as Account["type"], balance: Number(f.get("balance")) }); };
  return <form className="entry-form" onSubmit={submit}><div className="form-grid"><Field label="账户名称"><input name="name" required placeholder="例如：日常支票账户" aria-label="账户名称" /></Field><Field label="银行 / 机构"><input name="institution" required placeholder="例如：Chase" aria-label="银行或机构" /></Field><Field label="账户类型"><select name="type" aria-label="账户类型">{ACCOUNT_TYPES.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></Field><Field label="当前余额"><div className="money-input"><span>$</span><input name="balance" type="number" step="0.01" required defaultValue="0" aria-label="当前余额" /></div></Field></div><ErrorText error={error}/><button className="submit-button" disabled={pending}>{pending ? "保存中…" : "保存账户"}</button></form>;
}

function TransactionForm({ accounts, onSubmit, pending, error }: { accounts: Account[]; onSubmit: (v: { account_id: number; type: "income"|"expense"; category: string; description: string; amount: number; date: string }) => void; pending: boolean; error: Error | null }) {
  const submit = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const f = new FormData(e.currentTarget); onSubmit({ account_id: Number(f.get("account")), type: String(f.get("type")) as "income"|"expense", category: String(f.get("category")), description: String(f.get("description")), amount: Number(f.get("amount")), date: String(f.get("date")) }); };
  return <form className="entry-form" onSubmit={submit}><div className="form-grid"><Field label="收支类型"><select name="type" aria-label="收支类型"><option value="expense">支出</option><option value="income">收入</option></select></Field><Field label="账户"><select name="account" aria-label="交易账户">{accounts.map(a=><option key={a.id} value={a.id}>{a.name} · {a.institution}</option>)}</select></Field><Field label="金额"><div className="money-input"><span>$</span><input name="amount" type="number" min="0.01" step="0.01" required aria-label="交易金额" /></div></Field><Field label="日期"><input name="date" type="date" required defaultValue={localDate()} aria-label="交易日期" /></Field><Field label="分类"><select name="category" aria-label="交易分类">{CATEGORIES.map(c=><option key={c}>{c}</option>)}</select></Field><Field label="说明"><input name="description" required placeholder="例如：超市购物" aria-label="交易说明" /></Field></div><ErrorText error={error}/><button className="submit-button" disabled={pending}>{pending ? "保存中…" : "保存交易"}</button></form>;
}

function HoldingForm({ accounts, onSubmit, pending, error }: { accounts: Account[]; onSubmit: (v: { account_id: number; symbol: string; name: string; quantity: number; avg_cost: number; current_price: number }) => void; pending: boolean; error: Error | null }) {
  const submit = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const f = new FormData(e.currentTarget); onSubmit({ account_id: Number(f.get("account")), symbol: String(f.get("symbol")), name: String(f.get("name")), quantity: Number(f.get("quantity")), avg_cost: Number(f.get("cost")), current_price: Number(f.get("price")) }); };
  return <form className="entry-form" onSubmit={submit}><div className="form-grid"><Field label="投资账户"><select name="account" aria-label="投资账户">{accounts.filter(a=>a.type==="investment"||a.type==="retirement").map(a=><option key={a.id} value={a.id}>{a.name} · {a.institution}</option>)}{!accounts.some(a=>a.type==="investment"||a.type==="retirement") && accounts.map(a=><option key={a.id} value={a.id}>{a.name} · {a.institution}</option>)}</select></Field><Field label="代码"><input name="symbol" required placeholder="例如：AAPL" autoCapitalize="characters" aria-label="证券代码" /></Field><Field label="名称"><input name="name" required placeholder="例如：Apple" aria-label="证券名称" /></Field><Field label="数量"><input name="quantity" type="number" min="0.000001" step="any" required aria-label="持仓数量" /></Field><Field label="平均成本"><div className="money-input"><span>$</span><input name="cost" type="number" min="0" step="0.01" required aria-label="平均成本" /></div></Field><Field label="当前价格"><div className="money-input"><span>$</span><input name="price" type="number" min="0" step="0.01" required aria-label="当前价格" /></div></Field></div><p className="form-note">你可以手动更新；账户同步后也会刷新最新持仓。</p><ErrorText error={error}/><button className="submit-button" disabled={pending}>{pending ? "保存中…" : "保存持仓"}</button></form>;
}

function BalanceForm({ account, onSubmit, pending, error }: { account: Account; onSubmit: (balance: number) => void; pending: boolean; error: Error | null }) {
  const submit = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); onSubmit(Number(new FormData(e.currentTarget).get("balance"))); };
  return <form className="entry-form" onSubmit={submit}><div className="edit-context"><span>{account.institution}</span><strong>{account.name}</strong></div><Field label="最新余额"><div className="money-input"><span>$</span><input name="balance" type="number" step="0.01" defaultValue={account.balance} required autoFocus aria-label="最新余额" /></div></Field><ErrorText error={error}/><button className="submit-button" disabled={pending}>{pending ? "更新中…" : "更新余额"}</button></form>;
}

function HoldingEditForm({ holding, onSubmit, pending, error }: { holding: Holding; onSubmit: (v: { quantity: number; avg_cost: number; current_price: number }) => void; pending: boolean; error: Error | null }) {
  const submit = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const f = new FormData(e.currentTarget); onSubmit({ quantity: Number(f.get("quantity")), avg_cost: Number(f.get("cost")), current_price: Number(f.get("price")) }); };
  return <form className="entry-form" onSubmit={submit}><div className="edit-context"><span>{holding.name}</span><strong>{holding.symbol}</strong></div><div className="form-grid"><Field label="数量"><input name="quantity" type="number" min="0.000001" step="any" required defaultValue={holding.quantity} aria-label="持仓数量" /></Field><Field label="平均成本"><div className="money-input"><span>$</span><input name="cost" type="number" min="0" step="0.01" required defaultValue={holding.avg_cost} aria-label="平均成本" /></div></Field><Field label="当前价格"><div className="money-input"><span>$</span><input name="price" type="number" min="0" step="0.01" required defaultValue={holding.current_price} aria-label="当前价格" /></div></Field></div><ErrorText error={error}/><button className="submit-button" disabled={pending}>{pending ? "更新中…" : "更新持仓"}</button></form>;
}
