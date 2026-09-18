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
type CreditCard = Dashboard["credit_cards"][number];
type CardBenefit = Dashboard["card_benefits"][number];
type FinancialGoal = Dashboard["financial_goals"][number];
type AccountTypeLabel = Dashboard["account_type_labels"][number];
type AccountTypeOption = { value: Account["type"]; label: string };
type Tab = "overview" | "transactions" | "investments" | "cards" | "planning";
type Sheet = "account" | "transaction" | "holding" | "balance" | "holdingEdit" | "creditCard" | "creditCardEdit" | "cardBenefit" | "benefitEdit" | "goal" | "goalEdit" | "typeLabels" | null;
type PeriodMode = "month" | "year" | "threeYears";
type HoldingGroupMode = "account" | "symbol";

const CATEGORIES = ["收入", "住房", "餐饮", "交通", "购物", "账单", "娱乐", "健康", "教育", "工资", "投资收入", "转账", "其他"];
const ACCOUNT_TYPES = [
  ["checking", "支票账户"], ["savings", "储蓄账户"], ["investment", "证券投资"],
  ["retirement", "退休账户"], ["property", "房产"], ["crypto", "数字资产"],
  ["private_investment", "项目投资"], ["credit", "信用卡"], ["loan", "贷款 / 负债"], ["other", "其他"],
] as const;
const INVESTMENT_ACCOUNT_TYPES = new Set<Account["type"]>(["investment", "retirement", "property", "crypto", "private_investment"]);
const PIE_COLORS = ["#c94f47", "#e68a4a", "#d5ad3d", "#14866d", "#2a7594", "#7a6d9e", "#9d5c77", "#647780", "#a57a51", "#4c8a75", "#b55f55", "#71838b"];

function localDate() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function readLocalPreference(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function saveLocalPreference(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage may be unavailable in a sandboxed host; UI state still works in memory.
  }
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

function wholeMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(value);
}

function pct(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function holdingMarketValue(holding: Holding) {
  const value = holding.quantity * holding.current_price;
  return Number.isFinite(value) ? value : 0;
}

function isBiltHousingPayment(transaction: Transaction) {
  const description = transaction.description
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ");
  return description.includes("bilt housing payment") || description.includes("payment bilt housing");
}

function isTransfer(transaction: Transaction) {
  const category = transaction.category.trim().toLocaleLowerCase();
  return category === "转账" || category === "transfer" || category.includes("transfer");
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
  } else if (mode === "year") {
    start = new Date(now.getFullYear() + offset, 0, 1);
    end = new Date(start.getFullYear() + 1, 0, 1);
    label = `${start.getFullYear()} 年`;
  } else {
    end = new Date(now.getFullYear(), now.getMonth() + 1 + offset * 36, 1);
    start = new Date(end.getFullYear(), end.getMonth() - 36, 1);
    const formatMonth = (date: Date) => new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "short" }).format(date);
    label = `${formatMonth(start)}–${formatMonth(new Date(end.getFullYear(), end.getMonth() - 1, 1))}`;
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
    let property = 0;
    let crypto = 0;
    let privateInvestment = 0;
    let other = 0;
    for (const account of accounts) {
      const after = (transactionsByAccount.get(account.id) ?? []).filter((transaction) => transaction.date > cutoff);
      const incomeAfter = after.filter((transaction) => transaction.type === "income").reduce((sum, transaction) => sum + transaction.amount, 0);
      const expenseAfter = after.filter((transaction) => transaction.type === "expense").reduce((sum, transaction) => sum + transaction.amount, 0);
      const historicalBalance = account.type === "credit" || account.type === "loan"
        ? account.balance - expenseAfter + incomeAfter
        : account.balance - incomeAfter + expenseAfter;
      if (account.type === "investment") brokerage += historicalBalance;
      else if (account.type === "retirement") retirement += historicalBalance;
      else if (account.type === "property") property += historicalBalance;
      else if (account.type === "crypto") crypto += historicalBalance;
      else if (account.type === "private_investment") privateInvestment += historicalBalance;
      else if (account.type === "other") other += historicalBalance;
      else if (account.type !== "credit" && account.type !== "loan") cash += historicalBalance;
    }
    const snapshot = latestSnapshotByDay.get(cutoff);
    const reconstructedAssets = cash + brokerage + retirement + property + crypto + privateInvestment + other;
    const reconstructedInvestments = brokerage + retirement + property + crypto + privateInvestment;
    return {
      key: cutoff,
      label: mode === "month" ? `${sampleDate.getMonth() + 1}/${sampleDate.getDate()}` : `${sampleDate.getMonth() + 1}月`,
      assets: snapshot?.total_assets ?? reconstructedAssets,
      investments: snapshot?.total_investments ?? reconstructedInvestments,
      cash: snapshot?.cash_assets ?? cash + other,
      brokerage: snapshot?.brokerage_assets ?? brokerage,
      retirement: snapshot?.retirement_assets ?? retirement,
      property,
      crypto,
      privateInvestment,
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

function Icon({ name, size = 20 }: { name: "home" | "receipt" | "chart" | "card" | "target" | "plus" | "wallet" | "filter" | "search" | "close" | "edit" | "refresh" | "left" | "right" | "chevron"; size?: number }) {
  const paths: Record<string, ReactNode> = {
    home: <><path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9v11h13V9M9 20v-6h6v6"/></>,
    receipt: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2Z"/><path d="M9 8h6M9 12h6M9 16h3"/></>,
    chart: <><path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/></>,
    card: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h4"/></>,
    target: <><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M15 9l5-5M16 4h4v4"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    wallet: <><path d="M3 7.5h17v12H3zM3 7.5V5h14v2.5M15 12h5"/></>,
    filter: <><path d="M4 6h16M7 12h10M10 18h4"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    close: <><path d="m6 6 12 12M18 6 6 18"/></>,
    edit: <><path d="m4 16-.8 4 4-.8L18 8.4 15.6 6Z"/><path d="m14 7.5 2.5 2.5"/></>,
    refresh: <><path d="M20 6v5h-5"/><path d="M4 18v-5h5"/><path d="M6.1 9a7 7 0 0 1 11.6-2.6L20 9M4 15l2.3 2.6A7 7 0 0 0 18 15"/></>,
    left: <path d="m15 18-6-6 6-6"/>,
    right: <path d="m9 18 6-6-6-6"/>,
    chevron: <path d="m8 10 4 4 4-4"/>,
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

function FilterBar({ accounts, accountTypeOptions, account, setAccount, bank, setBank, accountType, setAccountType, category, setCategory, categoryOptions = CATEGORIES, showCategory = false }: { accounts: Account[]; accountTypeOptions: AccountTypeOption[]; account: string[]; setAccount: (v: string[]) => void; bank: string[]; setBank: (v: string[]) => void; accountType: string[]; setAccountType: (v: string[]) => void; category: string[]; setCategory: (v: string[]) => void; categoryOptions?: string[]; showCategory?: boolean }) {
  const banks = [...new Set(accounts.map((a) => a.institution))];
  const hasFilters = account.length + bank.length + accountType.length + category.length > 0;
  const clearAll = () => { setAccount([]); setBank([]); setAccountType([]); setCategory([]); };
  return <div className="filters" aria-label="筛选器">
    <div className="filter-icon"><Icon name="filter" size={17}/></div>
    <MultiFilter label="按账户类型筛选" allLabel="所有类型" values={accountType} setValues={setAccountType} options={accountTypeOptions}/>
    <MultiFilter label="按账户筛选" allLabel="所有账户" values={account} setValues={setAccount} options={accounts.map((item) => ({ value: String(item.id), label: item.name }))}/>
    <MultiFilter label="按银行筛选" allLabel="所有银行" values={bank} setValues={setBank} options={banks.map((item) => ({ value: item, label: item }))}/>
    {showCategory && <MultiFilter label="按分类筛选" allLabel="所有分类" values={category} setValues={setCategory} options={categoryOptions.map((item) => ({ value: item, label: item }))}/>} 
    {hasFilters && <button type="button" className="clear-filters" onClick={clearAll}>清除筛选</button>}
  </div>;
}

function PeriodSelector({ mode, setMode, offset, setOffset, label }: { mode: PeriodMode; setMode: (v: PeriodMode) => void; offset: number; setOffset: (v: number) => void; label: string }) {
  return <div className="period-control">
    <div className="period-tabs" role="group" aria-label="查看周期">
      {(["month", "year", "threeYears"] as const).map((value) => <button key={value} className={mode === value ? "active" : ""} onClick={() => { setMode(value); setOffset(0); }}>{value === "month" ? "月" : value === "year" ? "年" : "过去3年"}</button>)}
    </div>
    <div className="period-stepper"><button aria-label="上一周期" onClick={() => setOffset(offset - 1)}><Icon name="left" size={17}/></button><strong>{label}</strong><button aria-label="下一周期" onClick={() => setOffset(offset + 1)} disabled={offset >= 0}><Icon name="right" size={17}/></button></div>
  </div>;
}

function CalculationMenu({ excludeBiltHousingPayment, setExcludeBiltHousingPayment, excludeTransfers, setExcludeTransfers, excludedBiltCount, excludedTransferCount }: { excludeBiltHousingPayment: boolean; setExcludeBiltHousingPayment: (value: boolean) => void; excludeTransfers: boolean; setExcludeTransfers: (value: boolean) => void; excludedBiltCount: number; excludedTransferCount: number }) {
  return <details className="calculation-menu">
    <summary aria-label="打开计算排除选项"><Icon name="filter" size={15}/><span>计算范围</span><strong>{[excludeBiltHousingPayment, excludeTransfers].filter(Boolean).length} 项已排除</strong></summary>
    <div className="calculation-menu-panel" role="group" aria-label="计算排除选项">
      <div><strong>排除重复与转账</strong><small>仅影响汇总、趋势和分类图，不会删除交易。</small></div>
      <label><input type="checkbox" checked={excludeBiltHousingPayment} onChange={(event) => setExcludeBiltHousingPayment(event.target.checked)} /><span><strong>Bilt Housing Payment</strong><small>{excludeBiltHousingPayment ? `已排除 ${excludedBiltCount} 笔` : "当前计入"}</small></span></label>
      <label><input type="checkbox" checked={excludeTransfers} onChange={(event) => setExcludeTransfers(event.target.checked)} /><span><strong>Transfer / 转账</strong><small>{excludeTransfers ? `已排除 ${excludedTransferCount} 笔` : "当前计入"}</small></span></label>
    </div>
  </details>;
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
  const [selectedCard, setSelectedCard] = useState<CreditCard | null>(null);
  const [selectedBenefit, setSelectedBenefit] = useState<CardBenefit | null>(null);
  const [selectedGoal, setSelectedGoal] = useState<FinancialGoal | null>(null);
  const [periodMode, setPeriodMode] = useState<PeriodMode>("month");
  const [periodOffset, setPeriodOffset] = useState(0);
  const [excludeBiltHousingPayment, setExcludeBiltHousingPayment] = useState(true);
  const [excludeTransfers, setExcludeTransfers] = useState(true);
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);
  const previousSync = useRef<string | null>(null);
  const autoCardsChecked = useRef(false);

  const data = dashboard.data ?? { accounts: [], transactions: [], holdings: [], snapshots: [], credit_cards: [], card_benefits: [], financial_goals: [], account_type_labels: [] };
  const accountTypeOptions = useMemo<AccountTypeOption[]>(() => ACCOUNT_TYPES.map(([value, fallback]) => ({ value, label: data.account_type_labels.find((item) => item.type === value)?.label ?? fallback })), [data.account_type_labels]);
  const accountTypeLabelMap = useMemo(() => new Map<Account["type"], string>(accountTypeOptions.map((item) => [item.value, item.label])), [accountTypeOptions]);
  const excludedBiltCount = useMemo(() => data.transactions.filter(isBiltHousingPayment).length, [data.transactions]);
  const excludedTransferCount = useMemo(() => data.transactions.filter(isTransfer).length, [data.transactions]);
  const calculationTransactions = useMemo(() => data.transactions.filter((transaction) => (!excludeBiltHousingPayment || !isBiltHousingPayment(transaction)) && (!excludeTransfers || !isTransfer(transaction))), [data.transactions, excludeBiltHousingPayment, excludeTransfers]);
  const period = useMemo(() => getPeriod(periodMode, periodOffset), [periodMode, periodOffset]);
  const periodTransactions = useMemo(() => calculationTransactions.filter((t) => t.date >= period.startKey && t.date < period.endKey), [calculationTransactions, period.startKey, period.endKey]);
  const filteredAccounts = useMemo(() => data.accounts.filter((a) => (accountFilter.length === 0 || accountFilter.includes(String(a.id))) && (bankFilter.length === 0 || bankFilter.includes(a.institution)) && (accountTypeFilter.length === 0 || accountTypeFilter.includes(a.type))), [data.accounts, accountFilter, bankFilter, accountTypeFilter]);
  const filteredAccountIds = useMemo(() => new Set(filteredAccounts.map((account) => account.id)), [filteredAccounts]);
  const accountFilteredTransactions = periodTransactions.filter((transaction) => filteredAccountIds.has(transaction.account_id));
  const transactions = accountFilteredTransactions.filter((transaction) => categoryFilter.length === 0 || categoryFilter.includes(transaction.category));
  const categoryOptions = useMemo(() => [...new Set(data.transactions.map((transaction) => transaction.category))].sort((a, b) => a.localeCompare(b, "zh-CN")), [data.transactions]);
  const holdings = useMemo(() => data.holdings.filter((holding) => filteredAccountIds.has(holding.account_id)), [data.holdings, filteredAccountIds]);
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
  const accountEditMutation = useMutation({ mutationFn: api.updateAccount, onSuccess: () => { invalidate(); setSheet(null); setSelectedAccount(null); } });
  const accountDeleteMutation = useMutation({ mutationFn: api.deleteAccount, onSuccess: () => { invalidate(); setSheet(null); setSelectedAccount(null); } });
  const holdingEditMutation = useMutation({ mutationFn: api.updateHolding, onSuccess: () => { invalidate(); setSheet(null); } });
  const creditCardMutation = useMutation({ mutationFn: api.addCreditCard, onSuccess: () => { invalidate(); setSheet(null); } });
  const creditCardEditMutation = useMutation({ mutationFn: api.updateCreditCard, onSuccess: () => { invalidate(); setSheet(null); } });
  const autoCardMutation = useMutation({ mutationFn: api.syncCreditCardsFromAccounts, onSuccess: (result) => { if (result.created > 0) invalidate(); } });
  const benefitMutation = useMutation({ mutationFn: api.addCardBenefit, onSuccess: () => { invalidate(); setSheet(null); } });
  const benefitEditMutation = useMutation({ mutationFn: api.updateCardBenefit, onSuccess: () => { invalidate(); setSheet(null); } });
  const goalMutation = useMutation({ mutationFn: api.addFinancialGoal, onSuccess: () => { invalidate(); setSheet(null); } });
  const goalEditMutation = useMutation({ mutationFn: api.updateFinancialGoal, onSuccess: () => { invalidate(); setSheet(null); } });
  const accountTypeLabelMutation = useMutation({ mutationFn: api.updateAccountTypeLabel, onSuccess: () => invalidate() });
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

  useEffect(() => {
    if (!dashboard.data || autoCardsChecked.current) return;
    autoCardsChecked.current = true;
    autoCardMutation.mutate({});
  }, [dashboard.data]);

  const openBalance = (account: Account) => { setSelectedAccount(account); setSheet("balance"); };
  const openHolding = (holding: Holding) => { setSelectedHolding(holding); setSheet("holdingEdit"); };
  const openCard = (card: CreditCard) => { setSelectedCard(card); setSheet("creditCardEdit"); };
  const openBenefit = (benefit: CardBenefit) => { setSelectedBenefit(benefit); setSheet("benefitEdit"); };
  const openGoal = (goal: FinancialGoal) => { setSelectedGoal(goal); setSheet("goalEdit"); };
  const addBenefit = (card: CreditCard) => { setSelectedCard(card); setSheet("cardBenefit"); };
  const hasAccounts = data.accounts.length > 0;
  const isSyncing = syncMutation.isPending || syncStatus.data?.status === "syncing";
  const lastSynced = syncStatus.data?.synced_at ? new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(syncStatus.data.synced_at)) : null;
  const calculationMenu = <CalculationMenu excludeBiltHousingPayment={excludeBiltHousingPayment} setExcludeBiltHousingPayment={setExcludeBiltHousingPayment} excludeTransfers={excludeTransfers} setExcludeTransfers={setExcludeTransfers} excludedBiltCount={excludedBiltCount} excludedTransferCount={excludedTransferCount} />;

  if (dashboard.isPending) return <main className="loading" aria-label="正在加载财务数据"><div className="loading-head"><div className="loading-line"></div><div className="loading-line short"></div></div><div className="loading-card"></div><div className="loading-metrics"><span></span><span></span><span></span></div><div className="loading-chart"></div></main>;
  if (dashboard.error) return <main className="error-page"><p>暂时无法读取数据。</p><button onClick={() => dashboard.refetch()}>重试</button></main>;

  return <div className="app-shell">
    <SafeAreaTopScrim backgroundColor="var(--bg)" />
    <aside className="desktop-nav" aria-label="主导航">
      <div className="nav-stamp"><Icon name="wallet" size={22}/></div>
      <NavButton active={tab === "overview"} onClick={() => setTab("overview")} icon="home" label="总览" />
      <NavButton active={tab === "transactions"} onClick={() => setTab("transactions")} icon="receipt" label="收支" />
      <NavButton active={tab === "investments"} onClick={() => setTab("investments")} icon="chart" label="投资" />
      <NavButton active={tab === "cards"} onClick={() => setTab("cards")} icon="card" label="卡权益" />
      <NavButton active={tab === "planning"} onClick={() => setTab("planning")} icon="target" label="规划" />
    </aside>

    <main className="main-content">
      <header className="page-top">
        <div><p className="date-label">FINANCIAL LEDGER</p><h1>{tab === "overview" ? "资金全景" : tab === "transactions" ? "收入与支出" : tab === "investments" ? "投资组合" : tab === "cards" ? "信用卡权益" : "财务规划"}</h1></div>
        <div className="top-actions">
          {(tab === "overview" || tab === "transactions" || tab === "investments") && <button className="sync-button" aria-label="手动刷新账户数据" onClick={() => syncMutation.mutate({})} disabled={isSyncing}><Icon name="refresh" size={17}/><span>{isSyncing ? "同步中…" : "刷新"}</span></button>}
          <button className="add-button" aria-label={tab === "overview" ? "添加账户" : tab === "transactions" ? "添加交易" : tab === "investments" ? "添加持仓" : tab === "cards" ? "添加信用卡" : "添加财务目标"} onClick={() => setSheet(tab === "overview" ? "account" : tab === "transactions" ? "transaction" : tab === "investments" ? "holding" : tab === "cards" ? "creditCard" : "goal")} disabled={(tab === "transactions" || tab === "investments") && !hasAccounts}><Icon name="plus" size={18}/><span>{tab === "overview" ? "账户" : tab === "transactions" ? "交易" : tab === "investments" ? "持仓" : tab === "cards" ? "信用卡" : "目标"}</span></button>
        </div>
      </header>
      {(tab === "overview" || tab === "transactions" || tab === "investments") && <div className="sync-line" aria-live="polite">{syncFeedback ?? (lastSynced ? `每天自动同步 · 上次同步 ${lastSynced}` : "已连接账户每天自动同步，也可手动刷新")}</div>}

      {tab === "overview" && <Overview accounts={data.accounts} accountTypeOptions={accountTypeOptions} accountTypeLabelMap={accountTypeLabelMap} transactions={periodTransactions} historicalTransactions={calculationTransactions} holdings={data.holdings} snapshots={data.snapshots} periodMode={periodMode} setPeriodMode={setPeriodMode} periodOffset={periodOffset} setPeriodOffset={setPeriodOffset} period={period} netWorth={data.accounts.reduce((s, a) => s + (a.type === "credit" || a.type === "loan" ? -Math.abs(a.balance) : a.balance), 0)} marketValue={data.holdings.reduce((s,h)=>s+h.quantity*h.current_price,0)} totalGain={data.holdings.reduce((s,h)=>s+h.quantity*(h.current_price-h.avg_cost),0)} calculationMenu={calculationMenu} onAddAccount={() => setSheet("account")} onEditAccount={openBalance} />}

      {tab === "transactions" && <section>
        <PeriodSelector mode={periodMode} setMode={setPeriodMode} offset={periodOffset} setOffset={setPeriodOffset} label={period.label}/>
        <FilterBar accounts={data.accounts} accountTypeOptions={accountTypeOptions} account={accountFilter} setAccount={setAccountFilter} bank={bankFilter} setBank={setBankFilter} accountType={accountTypeFilter} setAccountType={setAccountTypeFilter} category={categoryFilter} setCategory={setCategoryFilter} categoryOptions={categoryOptions} showCategory />
        <div className="flow-tape"><div><span>收入</span><strong className="positive">{money(income)}</strong></div><div><span>支出</span><strong className="negative">{money(expenses)}</strong></div><div><span>净流入</span><strong>{money(income - expenses)}</strong></div></div>
        {data.transactions.length === 0 ? <Empty title="从第一笔收支开始" detail={hasAccounts ? "记录收入或消费，分类走势会自动形成。" : "先添加一个账户，再记录收入和支出。"} action={hasAccounts ? "添加交易" : "添加账户"} onAction={() => setSheet(hasAccounts ? "transaction" : "account")} /> : accountFilteredTransactions.length === 0 ? <div className="no-match">{period.label}没有符合当前账户筛选条件的交易</div> : <CashFlowWorkspace transactions={accountFilteredTransactions} accounts={data.accounts} periodMode={periodMode} period={period} selectedCategories={categoryFilter} setSelectedCategories={setCategoryFilter} calculationMenu={calculationMenu} />}
      </section>}

      {tab === "investments" && <section>
        <PeriodSelector mode={periodMode} setMode={setPeriodMode} offset={periodOffset} setOffset={setPeriodOffset} label={period.label}/>
        <FilterBar accounts={data.accounts} accountTypeOptions={accountTypeOptions} account={accountFilter} setAccount={setAccountFilter} bank={bankFilter} setBank={setBankFilter} accountType={accountTypeFilter} setAccountType={setAccountTypeFilter} category={categoryFilter} setCategory={setCategoryFilter} />
        <InvestmentDashboard holdings={holdings} allHoldings={data.holdings} transactions={calculationTransactions} accounts={data.accounts} accountTypeLabelMap={accountTypeLabelMap} trendAccounts={filteredAccounts} snapshots={data.snapshots} useSnapshots={accountFilter.length === 0 && bankFilter.length === 0 && accountTypeFilter.length === 0} periodMode={periodMode} period={period} marketValue={marketValue} totalGain={totalGain} gainPct={gainPct} calculationMenu={calculationMenu} onEdit={openHolding} onEmptyAction={() => setSheet(hasAccounts ? "holding" : "account")} hasAccounts={hasAccounts} />
      </section>}

      {tab === "cards" && <CreditCardBenefits cards={data.credit_cards} benefits={data.card_benefits} onAddCard={() => setSheet("creditCard")} onEditCard={openCard} onAddBenefit={addBenefit} onEditBenefit={openBenefit} />}

      {tab === "planning" && <FinancialPlanning goals={data.financial_goals} netWorth={data.accounts.reduce((sum, account) => sum + (account.type === "credit" || account.type === "loan" ? -Math.abs(account.balance) : account.balance), 0)} onAdd={() => setSheet("goal")} onEdit={openGoal} />}
    </main>

    <nav className="mobile-nav" aria-label="主导航"><NavButton active={tab === "overview"} onClick={() => setTab("overview")} icon="home" label="总览" /><NavButton active={tab === "transactions"} onClick={() => setTab("transactions")} icon="receipt" label="收支" /><NavButton active={tab === "investments"} onClick={() => setTab("investments")} icon="chart" label="投资" /><NavButton active={tab === "cards"} onClick={() => setTab("cards")} icon="card" label="卡权益" /><NavButton active={tab === "planning"} onClick={() => setTab("planning")} icon="target" label="规划" /></nav>

    {sheet && <Sheet title={sheet === "account" ? "添加账户" : sheet === "transaction" ? "记录交易" : sheet === "holding" ? "添加持仓" : sheet === "balance" ? "编辑账户" : sheet === "holdingEdit" ? "更新持仓" : sheet === "creditCard" ? "添加信用卡" : sheet === "creditCardEdit" ? "更新信用卡" : sheet === "cardBenefit" ? "添加权益" : sheet === "benefitEdit" ? "更新权益" : sheet === "goal" ? "添加财务目标" : sheet === "goalEdit" ? "更新财务目标" : "分类名称设置"} onClose={() => setSheet(null)}>
      {sheet === "account" && <AccountForm accountTypeOptions={accountTypeOptions} pending={accountMutation.isPending} error={accountMutation.error} onSubmit={(value) => accountMutation.mutate(value)} />}
      {sheet === "transaction" && <TransactionForm accounts={data.accounts} pending={transactionMutation.isPending} error={transactionMutation.error} onSubmit={(value) => transactionMutation.mutate(value)} />}
      {sheet === "holding" && <HoldingForm accounts={data.accounts} pending={holdingMutation.isPending} error={holdingMutation.error} onSubmit={(value) => holdingMutation.mutate(value)} />}
      {sheet === "balance" && selectedAccount && <AccountEditForm account={selectedAccount} accountTypeOptions={accountTypeOptions} pending={accountEditMutation.isPending || accountDeleteMutation.isPending} error={accountEditMutation.error ?? accountDeleteMutation.error} onSubmit={(value) => accountEditMutation.mutate({ id: selectedAccount.id, ...value })} onDelete={() => accountDeleteMutation.mutate({ id: selectedAccount.id })} />}
      {sheet === "holdingEdit" && selectedHolding && <HoldingEditForm holding={selectedHolding} pending={holdingEditMutation.isPending} error={holdingEditMutation.error} onSubmit={(value) => holdingEditMutation.mutate({ id: selectedHolding.id, ...value })} />}
      {sheet === "creditCard" && <CreditCardForm pending={creditCardMutation.isPending} error={creditCardMutation.error} onSubmit={(value) => creditCardMutation.mutate(value)} />}
      {sheet === "creditCardEdit" && selectedCard && <CreditCardEditForm card={selectedCard} pending={creditCardEditMutation.isPending} error={creditCardEditMutation.error} onSubmit={(value) => creditCardEditMutation.mutate({ id: selectedCard.id, ...value })} />}
      {sheet === "cardBenefit" && selectedCard && <CardBenefitForm card={selectedCard} pending={benefitMutation.isPending} error={benefitMutation.error} onSubmit={(value) => benefitMutation.mutate(value)} />}
      {sheet === "benefitEdit" && selectedBenefit && <BenefitEditForm benefit={selectedBenefit} pending={benefitEditMutation.isPending} error={benefitEditMutation.error} onSubmit={(value) => benefitEditMutation.mutate({ id: selectedBenefit.id, ...value })} />}
      {sheet === "goal" && <FinancialGoalForm pending={goalMutation.isPending} error={goalMutation.error} onSubmit={(value) => goalMutation.mutate(value)} />}
      {sheet === "goalEdit" && selectedGoal && <FinancialGoalEditForm goal={selectedGoal} pending={goalEditMutation.isPending} error={goalEditMutation.error} onSubmit={(value) => goalEditMutation.mutate({ id: selectedGoal.id, ...value })} />}
      {sheet === "typeLabels" && <AccountTypeLabelsForm options={accountTypeOptions} pending={accountTypeLabelMutation.isPending} error={accountTypeLabelMutation.error} onSave={(value) => accountTypeLabelMutation.mutate(value)} />}
    </Sheet>}
  </div>;
}

function NavButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: "home" | "receipt" | "chart" | "card" | "target"; label: string }) {
  return <button className={`nav-button ${active ? "active" : ""}`} onClick={onClick} aria-current={active ? "page" : undefined}><Icon name={icon}/><span>{label}</span></button>;
}

function Overview({ accounts, accountTypeOptions, accountTypeLabelMap, transactions, historicalTransactions, holdings, snapshots, periodMode, setPeriodMode, periodOffset, setPeriodOffset, period, netWorth, marketValue, totalGain, calculationMenu, onAddAccount, onEditAccount }: { accounts: Account[]; accountTypeOptions: AccountTypeOption[]; accountTypeLabelMap: Map<Account["type"], string>; transactions: Transaction[]; historicalTransactions: Transaction[]; holdings: Holding[]; snapshots: Snapshot[]; periodMode: PeriodMode; setPeriodMode: (v: PeriodMode) => void; periodOffset: number; setPeriodOffset: (v: number) => void; period: ReturnType<typeof getPeriod>; netWorth: number; marketValue: number; totalGain: number; calculationMenu: ReactNode; onAddAccount: () => void; onEditAccount: (a: Account) => void }) {
  const assets = accounts.filter((a) => a.type !== "credit" && a.type !== "loan").reduce((s, a) => s + a.balance, 0);
  const liabilities = accounts.filter((a) => a.type === "credit" || a.type === "loan").reduce((s, a) => s + Math.abs(a.balance), 0);
  const income = transactions.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
  const expenses = transactions.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
  const snapshotTrend = buildBalanceHistory(accounts, historicalTransactions, snapshots, periodMode, period.start, period.end);
  const accountGroups = accountTypeOptions.map(({ value: type, label }) => ({ type, label, accounts: accounts.filter((account) => account.type === type) })).filter((group) => group.accounts.length > 0);
  const [collapsedAccountGroups, setCollapsedAccountGroups] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(readLocalPreference("finance-account-groups-collapsed") ?? "{}"); } catch { return {}; }
  });
  const toggleAccountGroup = (type: string) => setCollapsedAccountGroups((current) => {
    const next = { ...current, [type]: !current[type] };
    saveLocalPreference("finance-account-groups-collapsed", JSON.stringify(next));
    return next;
  });
  return <>
    <section className="net-worth-panel">
      <div className="net-worth-copy"><span>当前净资产</span><strong>{wholeMoney(netWorth)}</strong><p>{accounts.length ? `${accounts.length} 个账户` : "添加账户后显示"}</p></div>
      <div className="composition"><div className="composition-bar"><span style={{ width: `${assets + liabilities > 0 ? assets/(assets+liabilities)*100 : 50}%` }}></span></div><div className="composition-labels"><span><i className="asset-dot"></i>资产 {money(assets, true)}</span><span><i className="liability-dot"></i>负债 {money(liabilities, true)}</span></div></div>
    </section>
    <PeriodSelector mode={periodMode} setMode={setPeriodMode} offset={periodOffset} setOffset={setPeriodOffset} label={period.label}/>
    <section className="metric-row"><article><span>收入 · {period.label}</span><strong className="positive">{money(income, true)}</strong></article><article><span>支出 · {period.label}</span><strong className="negative">{money(expenses, true)}</strong></article><article><span>投资市值 · 当前</span><strong>{money(marketValue, true)}</strong><small className={totalGain >= 0 ? "positive" : "negative"}>{totalGain >= 0 ? "+" : ""}{money(totalGain, true)}</small></article></section>
    <section className="chart-section asset-trend-section"><div className="section-heading trend-section-heading"><div><span>BALANCE HISTORY</span><h2>总资产与总投资趋势</h2><small>历史区间由当前余额与已同步交易反推；同步快照会自动替换对应日期。</small></div>{calculationMenu}</div>{snapshotTrend.length === 0 ? <div className="mini-empty"><p>{period.label}暂无可用数据。</p></div> : <div className="trend-chart asset-trend" aria-label={`${period.label}总资产与总投资组合趋势图`}><ResponsiveContainer width="100%" height="100%"><ComposedChart data={snapshotTrend} margin={{ top: 18, right: 8, left: -10, bottom: 0 }}><CartesianGrid stroke="var(--border)" vertical={false}/><XAxis dataKey="label" tick={{ fill: "var(--dim)", fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={20}/><YAxis domain={[0, "auto"]} tickFormatter={(value) => money(Number(value), true)} tick={{ fill: "var(--dim)", fontSize: 9 }} tickLine={false} axisLine={false} width={62}/><Tooltip formatter={(value) => value == null ? "暂无" : money(Number(value))} labelStyle={{ color: "#172126" }} isAnimationActive={false}/><Bar dataKey="cash" name="现金及其他" stackId="assets" fill="var(--bar-cash)" isAnimationActive={false}/><Bar dataKey="brokerage" name={accountTypeLabelMap.get("investment") ?? "证券投资"} stackId="assets" fill="var(--bar-brokerage)" isAnimationActive={false}/><Bar dataKey="retirement" name={accountTypeLabelMap.get("retirement") ?? "退休账户"} stackId="assets" fill="var(--bar-retirement)" isAnimationActive={false}/><Bar dataKey="property" name={accountTypeLabelMap.get("property") ?? "房产"} stackId="assets" fill="var(--bar-property)" isAnimationActive={false}/><Bar dataKey="crypto" name={accountTypeLabelMap.get("crypto") ?? "数字资产"} stackId="assets" fill="var(--bar-crypto)" isAnimationActive={false}/><Bar dataKey="privateInvestment" name={accountTypeLabelMap.get("private_investment") ?? "项目投资"} stackId="assets" fill="var(--bar-private)" radius={[2,2,0,0]} isAnimationActive={false}/><Line type="monotone" dataKey="assets" name="总资产" stroke="var(--accent-chart)" strokeWidth={2.8} dot={{ r: 3 }} connectNulls={false} isAnimationActive={false}/><Line type="monotone" dataKey="investments" name="总投资" stroke="var(--positive)" strokeWidth={2.8} dot={{ r: 3 }} connectNulls={false} isAnimationActive={false}/></ComposedChart></ResponsiveContainer><div className="chart-legend combo-legend"><span><i className="bar-cash"></i>现金及其他</span><span><i className="bar-brokerage"></i>{accountTypeLabelMap.get("investment") ?? "证券投资"}</span><span><i className="bar-retirement"></i>{accountTypeLabelMap.get("retirement") ?? "退休账户"}</span><span><i className="bar-property"></i>{accountTypeLabelMap.get("property") ?? "房产"}</span><span><i className="bar-crypto"></i>{accountTypeLabelMap.get("crypto") ?? "数字资产"}</span><span><i className="bar-private"></i>{accountTypeLabelMap.get("private_investment") ?? "项目投资"}</span><span><i className="asset-line"></i>总资产</span><span><i className="income-line"></i>总投资</span></div></div>}</section>
    <div className="overview-grid">
      <section className="ledger-section">
        <div className="section-heading"><div><span>ACCOUNTS BY TYPE</span><h2>账户分类</h2></div><div className="section-actions"><button onClick={onAddAccount}>添加</button></div></div>
        {accounts.length === 0 ? <Empty title="先建立资金版图" detail="添加银行、信用卡或投资账户，余额由你掌控。" action="添加第一个账户" onAction={onAddAccount}/> : <div className="account-groups">{accountGroups.map((group) => {
          const collapsed = collapsedAccountGroups[group.type] === true;
          return <section className={`account-group ${collapsed ? "collapsed" : ""}`} key={group.type}>
            <button type="button" className="group-toggle" onClick={() => toggleAccountGroup(group.type)} aria-expanded={!collapsed} aria-controls={`account-group-${group.type}`}>
              <span className="group-title"><Icon name="chevron" size={15}/><span>{group.label}</span><small>{group.accounts.length} 个账户</small></span>
              <strong>{money(group.accounts.reduce((sum, account) => sum + account.balance, 0))}</strong>
            </button>
            {!collapsed && <div className="account-list" id={`account-group-${group.type}`}>{group.accounts.map((a) => <button key={a.id} className="account-row" onClick={() => onEditAccount(a)} aria-label={`编辑账户 ${a.name}`}><span className={`account-sigil ${a.type}`}>{a.institution.slice(0,1).toUpperCase()}</span><span className="account-name"><strong>{a.name}</strong><small>{a.institution}</small></span><strong className={a.type === "credit" || a.type === "loan" ? "negative" : ""}>{money(a.balance)}</strong><Icon name="edit" size={15}/></button>)}</div>}
          </section>;
        })}</div>}
      </section>
      <section className="ledger-section"><div className="section-heading"><div><span>HOLDINGS</span><h2>投资摘要</h2></div></div>{holdings.length === 0 ? <div className="mini-empty"><p>同步或添加持仓后，这里会显示当前市值与收益。</p></div> : <div className="investment-summary"><strong>{holdings.length}</strong><span>项持仓</span><small>当前收益 {totalGain >= 0 ? "+" : ""}{money(totalGain, true)}</small></div>}</section>
    </div>
  </>;
}

function CashFlowBreakdown({ title, eyebrow, emptyText, ariaLabel, categories, selectedCategories, onToggle }: { title: string; eyebrow: string; emptyText: string; ariaLabel: string; categories: Array<{ name: string; value: number }>; selectedCategories: string[]; onToggle: (name: string) => void }) {
  return <section className="chart-section cash-flow-breakdown">
    <div className="section-heading"><div><span>{eyebrow}</span><h2>{title}</h2></div></div>
    {categories.length === 0 ? <div className="mini-empty"><p>{emptyText}</p></div> : <div className="pie-layout">
      <div className="pie-chart" aria-label={ariaLabel}><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={categories} dataKey="value" nameKey="name" innerRadius={48} outerRadius={78} paddingAngle={1} isAnimationActive={false}>{categories.map((category, index) => <Cell key={category.name} fill={PIE_COLORS[index % PIE_COLORS.length]} opacity={selectedCategories.length === 0 || selectedCategories.includes(category.name) ? 1 : 0.22} stroke={selectedCategories.includes(category.name) ? "var(--text)" : "none"} strokeWidth={selectedCategories.includes(category.name) ? 2 : 0} cursor="pointer" onClick={() => onToggle(category.name)}/>)}</Pie><Tooltip formatter={(value) => money(Number(value))} isAnimationActive={false}/></PieChart></ResponsiveContainer></div>
      <div className="pie-legend">{categories.map((category, index) => <button type="button" className={selectedCategories.includes(category.name) ? "selected" : ""} key={category.name} onClick={() => onToggle(category.name)} aria-pressed={selectedCategories.includes(category.name)}><span><i style={{ background: PIE_COLORS[index % PIE_COLORS.length] }}></i>{category.name}</span><strong>{money(category.value)}</strong></button>)}</div>
    </div>}
  </section>;
}

function CashFlowWorkspace({ transactions, accounts, periodMode, period, selectedCategories, setSelectedCategories, calculationMenu }: { transactions: Transaction[]; accounts: Account[]; periodMode: PeriodMode; period: ReturnType<typeof getPeriod>; selectedCategories: string[]; setSelectedCategories: (values: string[]) => void; calculationMenu: ReactNode }) {
  const expenseCategoryMap = new Map<string, number>();
  const incomeCategoryMap = new Map<string, number>();
  for (const transaction of transactions) {
    const categoryMap = transaction.type === "income" ? incomeCategoryMap : expenseCategoryMap;
    categoryMap.set(transaction.category, (categoryMap.get(transaction.category) ?? 0) + transaction.amount);
  }
  const expenseCategories = [...expenseCategoryMap.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  const incomeCategories = [...incomeCategoryMap.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  const visibleTransactions = selectedCategories.length > 0 ? transactions.filter((transaction) => selectedCategories.includes(transaction.category)) : transactions;
  const { rows, categorySeries } = buildCategorizedCashFlow(visibleTransactions, periodMode, period.start, period.end);
  const toggleCategory = (name: string) => setSelectedCategories(selectedCategories.includes(name) ? selectedCategories.filter((category) => category !== name) : [...selectedCategories, name]);

  return <>
    <section className="chart-section full-width-trend"><div className="section-heading trend-section-heading"><div><span>CASH FLOW</span><h2>收支趋势</h2></div>{calculationMenu}</div><div className="trend-chart combo-chart" aria-label={`${period.label}收支组合趋势图`}><ResponsiveContainer width="100%" height="100%"><ComposedChart data={rows} margin={{ top: 18, right: 8, left: -10, bottom: 0 }}><CartesianGrid stroke="var(--border)" vertical={false}/><XAxis dataKey="label" tick={{ fill: "var(--dim)", fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={20}/><YAxis domain={[0, "auto"]} tickFormatter={(value) => money(Number(value), true)} tick={{ fill: "var(--dim)", fontSize: 9 }} tickLine={false} axisLine={false} width={56}/><Tooltip formatter={(value) => money(Number(value))} labelStyle={{ color: "#172126" }} isAnimationActive={false}/>{categorySeries.map((series, index) => <Bar key={series.key} dataKey={series.key} name={series.name} stackId="expense" fill={series.color} radius={index === categorySeries.length - 1 ? [2,2,0,0] : undefined} isAnimationActive={false}/>)}<Line type="monotone" dataKey="income" name="收入" stroke="var(--positive)" strokeWidth={2.7} dot={false} isAnimationActive={false}/><Line type="monotone" dataKey="expense" name="支出" stroke="var(--negative)" strokeWidth={2.7} dot={false} isAnimationActive={false}/></ComposedChart></ResponsiveContainer><div className="chart-legend combo-legend">{categorySeries.map((series) => <span key={series.key}><i style={{ background: series.color }}></i>{series.name}</span>)}<span><i className="income-line"></i>收入趋势</span><span><i className="expense-line"></i>支出趋势</span></div></div></section>
    <div className="detail-grid cash-flow-detail">
      <div className="detail-side breakdown-stack">
        <CashFlowBreakdown title="收入分类" eyebrow="INCOME" emptyText={`${period.label}暂无分类收入。`} ariaLabel={`${period.label}收入分类饼图`} categories={incomeCategories} selectedCategories={selectedCategories} onToggle={toggleCategory}/>
        <CashFlowBreakdown title="消费分类" eyebrow="SPENDING" emptyText={`${period.label}暂无分类支出。`} ariaLabel={`${period.label}消费分类饼图`} categories={expenseCategories} selectedCategories={selectedCategories} onToggle={toggleCategory}/>
      </div>
      <section className="records-section detail-main"><div className="drilldown-header"><div><span>{selectedCategories.length > 0 ? "分类筛选" : "交易记录"}</span><strong>{selectedCategories.length > 0 ? `${selectedCategories.join("、")} · ${visibleTransactions.length} 笔` : `${visibleTransactions.length} 笔`}</strong></div>{selectedCategories.length > 0 && <button type="button" onClick={() => setSelectedCategories([])}>清除筛选</button>}</div>{visibleTransactions.length === 0 ? <div className="no-match">没有符合分类筛选的交易</div> : <TransactionList transactions={visibleTransactions} accounts={accounts} />}</section>
    </div>
  </>;
}

function InvestmentDashboard({ holdings, allHoldings, transactions, accounts, accountTypeLabelMap, trendAccounts, snapshots, useSnapshots, periodMode, period, marketValue, totalGain, gainPct, calculationMenu, onEdit, onEmptyAction, hasAccounts }: { holdings: Holding[]; allHoldings: Holding[]; transactions: Transaction[]; accounts: Account[]; accountTypeLabelMap: Map<Account["type"], string>; trendAccounts: Account[]; snapshots: Snapshot[]; useSnapshots: boolean; periodMode: PeriodMode; period: ReturnType<typeof getPeriod>; marketValue: number; totalGain: number; gainPct: number; calculationMenu: ReactNode; onEdit: (holding: Holding) => void; onEmptyAction: () => void; hasAccounts: boolean }) {
  const [selectedSlice, setSelectedSlice] = useState<string | null>(null);
  const allocation = useMemo(() => {
    const symbolMap = new Map<string, number>();
    for (const holding of holdings) {
      const exposure = Math.abs(holdingMarketValue(holding));
      if (exposure > 0) symbolMap.set(holding.symbol, (symbolMap.get(holding.symbol) ?? 0) + exposure);
    }
    const ranked = [...symbolMap.entries()].map(([name, value]) => ({ name, value, symbols: [name] })).sort((a, b) => b.value - a.value);
    return ranked.length <= 8 ? ranked : [...ranked.slice(0, 7), { name: "其他", value: ranked.slice(7).reduce((sum, item) => sum + item.value, 0), symbols: ranked.slice(7).map((item) => item.name) }];
  }, [holdings]);
  useEffect(() => {
    if (selectedSlice && !allocation.some((item) => item.name === selectedSlice)) setSelectedSlice(null);
  }, [selectedSlice, allocation]);
  const selectedSymbols = allocation.find((item) => item.name === selectedSlice)?.symbols ?? [];
  const visibleHoldings = selectedSlice ? holdings.filter((holding) => selectedSymbols.includes(holding.symbol)) : holdings;
  const relatedTransactions = selectedSlice ? transactions.filter((transaction) => {
    const terms = transaction.description.toUpperCase().split(/[^A-Z0-9.]+/).filter(Boolean);
    return selectedSymbols.some((symbol) => terms.includes(symbol.toUpperCase()));
  }) : [];
  const selectSlice = (name: string) => setSelectedSlice((current) => current === name ? null : name);
  const investmentAccounts = useMemo(() => trendAccounts.filter((account) => INVESTMENT_ACCOUNT_TYPES.has(account.type)), [trendAccounts]);
  const investmentTransactions = useMemo(() => {
    const investmentAccountIds = new Set(investmentAccounts.map((account) => account.id));
    return transactions.filter((transaction) => investmentAccountIds.has(transaction.account_id));
  }, [investmentAccounts, transactions]);
  const investmentTrend = useMemo(() => buildBalanceHistory(investmentAccounts, investmentTransactions, snapshots, periodMode, period.start, period.end, useSnapshots), [investmentAccounts, investmentTransactions, snapshots, periodMode, period.start, period.end, useSnapshots]);
  const firstPoint = investmentTrend[0];
  const lastPoint = investmentTrend[investmentTrend.length - 1];
  const periodChange = firstPoint && lastPoint && firstPoint.key !== lastPoint.key ? lastPoint.investments - firstPoint.investments : null;
  const periodChangePct = periodChange != null && firstPoint && firstPoint.investments !== 0 ? periodChange / Math.abs(firstPoint.investments) * 100 : null;

  return <>
    <div className="flow-tape investment-tape"><div><span>当前投资市值</span><strong>{money(marketValue)}</strong></div><div><span>累计收益</span><strong className={totalGain >= 0 ? "positive" : "negative"}>{money(totalGain)} · {pct(gainPct)}</strong></div><div><span>{period.label}区间变动</span><strong className={periodChange != null && periodChange >= 0 ? "positive" : periodChange != null ? "negative" : ""}>{periodChange == null ? "—" : `${money(periodChange)} · ${periodChangePct == null ? "—" : pct(periodChangePct)}`}</strong></div></div>
    {allHoldings.length === 0 ? <Empty title="还没有持仓" detail={hasAccounts ? "添加股票、ETF 或基金，查看市值和累计收益。" : "先添加投资账户，再录入持仓。"} action={hasAccounts ? "添加持仓" : "添加账户"} onAction={onEmptyAction} /> : holdings.length === 0 ? <div className="no-match">没有符合当前筛选条件的持仓</div> : <>
      <section className="chart-section investment-trend full-width-trend"><div className="section-heading trend-section-heading"><div><span>PORTFOLIO HISTORY</span><h2>投资趋势</h2><small>历史区间由当前账户余额与已同步交易反推。</small></div>{calculationMenu}</div>{investmentTrend.length === 0 ? <div className="mini-empty"><p>{period.label}暂无投资数据。</p></div> : <div className="trend-chart combo-chart" aria-label={`${period.label}投资组合趋势图`}><ResponsiveContainer width="100%" height="100%"><ComposedChart data={investmentTrend} margin={{ top: 18, right: 8, left: -10, bottom: 0 }}><CartesianGrid stroke="var(--border)" vertical={false}/><XAxis dataKey="label" tick={{ fill: "var(--dim)", fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={20}/><YAxis domain={[0, "auto"]} tickFormatter={(value) => money(Number(value), true)} tick={{ fill: "var(--dim)", fontSize: 9 }} tickLine={false} axisLine={false} width={62}/><Tooltip formatter={(value) => value == null ? "暂无" : money(Number(value))} labelStyle={{ color: "#172126" }} isAnimationActive={false}/><Bar dataKey="brokerage" name={accountTypeLabelMap.get("investment") ?? "证券投资"} stackId="investment" fill="var(--bar-brokerage)" isAnimationActive={false}/><Bar dataKey="retirement" name={accountTypeLabelMap.get("retirement") ?? "退休账户"} stackId="investment" fill="var(--bar-retirement)" isAnimationActive={false}/><Bar dataKey="property" name={accountTypeLabelMap.get("property") ?? "房产"} stackId="investment" fill="var(--bar-property)" isAnimationActive={false}/><Bar dataKey="crypto" name={accountTypeLabelMap.get("crypto") ?? "数字资产"} stackId="investment" fill="var(--bar-crypto)" isAnimationActive={false}/><Bar dataKey="privateInvestment" name={accountTypeLabelMap.get("private_investment") ?? "项目投资"} stackId="investment" fill="var(--bar-private)" radius={[2,2,0,0]} isAnimationActive={false}/><Line type="monotone" dataKey="investments" name="总投资趋势" stroke="var(--positive)" strokeWidth={2.8} dot={false} connectNulls={false} isAnimationActive={false}/></ComposedChart></ResponsiveContainer><div className="chart-legend combo-legend"><span><i className="bar-brokerage"></i>{accountTypeLabelMap.get("investment") ?? "证券投资"}</span><span><i className="bar-retirement"></i>{accountTypeLabelMap.get("retirement") ?? "退休账户"}</span><span><i className="bar-property"></i>{accountTypeLabelMap.get("property") ?? "房产"}</span><span><i className="bar-crypto"></i>{accountTypeLabelMap.get("crypto") ?? "数字资产"}</span><span><i className="bar-private"></i>{accountTypeLabelMap.get("private_investment") ?? "项目投资"}</span><span><i className="income-line"></i>总投资趋势</span></div></div>}</section>
      <div className="detail-grid investment-detail">
        <section className="chart-section investment-allocation detail-side"><div className="section-heading"><div><span>ALLOCATION</span><h2>投资敞口分布</h2><small>按绝对市值统计，空头头寸也计入敞口。</small></div></div>{allocation.length === 0 ? <div className="mini-empty"><p>当前持仓暂无可绘制的市值。</p></div> : <div className="pie-layout"><div className="pie-chart" aria-label="投资敞口饼图"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={allocation} dataKey="value" nameKey="name" innerRadius={48} outerRadius={78} paddingAngle={1} isAnimationActive={false}>{allocation.map((item, index) => <Cell key={item.name} fill={PIE_COLORS[index % PIE_COLORS.length]} opacity={!selectedSlice || selectedSlice === item.name ? 1 : 0.28} stroke={selectedSlice === item.name ? "var(--text)" : "none"} strokeWidth={selectedSlice === item.name ? 2 : 0} cursor="pointer" onClick={() => selectSlice(item.name)}/>)}</Pie><Tooltip formatter={(value) => money(Number(value))} isAnimationActive={false}/></PieChart></ResponsiveContainer></div><div className="pie-legend">{allocation.map((item, index) => <button type="button" className={selectedSlice === item.name ? "selected" : ""} key={item.name} onClick={() => selectSlice(item.name)} aria-pressed={selectedSlice === item.name}><span><i style={{ background: PIE_COLORS[index % PIE_COLORS.length] }}></i>{item.name}</span><strong>{money(item.value)}</strong></button>)}</div></div>}</section>
        <section className="records-section detail-main"><div className="drilldown-header"><div><span>{selectedSlice ? "持仓筛选" : "持仓明细"}</span><strong>{selectedSlice ? `${selectedSlice} · ${visibleHoldings.length} 项` : `${visibleHoldings.length} 项`}</strong></div>{selectedSlice && <button type="button" onClick={() => setSelectedSlice(null)}>清除筛选</button>}</div>{relatedTransactions.length > 0 && <div className="related-transactions"><h3>相关交易</h3><TransactionList transactions={relatedTransactions} accounts={accounts} /></div>}<HoldingsList holdings={visibleHoldings} accounts={accounts} onEdit={onEdit} /></section>
      </div>
    </>}
  </>;
}

const RESET_LABELS: Record<CardBenefit["reset_period"], string> = { annual: "每年", monthly: "每月", quarterly: "每季度", one_time: "一次性" };
const GOAL_LABELS: Record<FinancialGoal["category"], string> = { emergency: "应急金", retirement: "退休", home: "住房", travel: "旅行", education: "教育", debt: "还债", investment: "投资", other: "其他" };
const GOAL_STATUS_LABELS: Record<FinancialGoal["status"], string> = { active: "进行中", completed: "已完成", paused: "已暂停" };

function CreditCardBenefits({ cards, benefits, onAddCard, onEditCard, onAddBenefit, onEditBenefit }: { cards: CreditCard[]; benefits: CardBenefit[]; onAddCard: () => void; onEditCard: (card: CreditCard) => void; onAddBenefit: (card: CreditCard) => void; onEditBenefit: (benefit: CardBenefit) => void }) {
  const annualFees = cards.reduce((sum, card) => sum + card.annual_fee, 0);
  const expected = benefits.reduce((sum, benefit) => sum + benefit.expected_value, 0);
  const actual = benefits.reduce((sum, benefit) => sum + benefit.actual_value, 0);
  const net = actual - annualFees;
  return <section className="feature-page">
    <div className="feature-summary"><article><span>年度年费</span><strong>{money(annualFees)}</strong></article><article><span>已兑现权益</span><strong className="positive">{money(actual)}</strong></article><article><span>实际净价值</span><strong className={net >= 0 ? "positive" : "negative"}>{money(net)}</strong></article><article><span>兑现率</span><strong>{expected > 0 ? `${Math.round(actual / expected * 100)}%` : "—"}</strong></article></div>
    {cards.length === 0 ? <Empty title="从一张信用卡开始" detail="录入年费，再把报销、积分和会员权益按实际使用额记下来。" action="添加信用卡" onAction={onAddCard}/> : <div className="credit-card-grid">{cards.map((card) => {
      const cardBenefits = benefits.filter((benefit) => benefit.card_id === card.id);
      const cardExpected = cardBenefits.reduce((sum, benefit) => sum + benefit.expected_value, 0);
      const cardActual = cardBenefits.reduce((sum, benefit) => sum + benefit.actual_value, 0);
      const progress = card.annual_fee > 0 ? Math.min(cardActual / card.annual_fee * 100, 100) : cardActual > 0 ? 100 : 0;
      return <article className="credit-card-ledger" key={card.id}>
        <header><div><span>{card.issuer}</span><h2>{card.name}</h2></div><div className="card-header-actions"><div className="fee-badge"><small>年费</small><strong>{money(card.annual_fee, true)}</strong></div><button type="button" className="card-edit-button" aria-label={`编辑 ${card.name}`} onClick={() => onEditCard(card)}><Icon name="edit" size={15}/></button></div></header>
        <div className="value-track" aria-label={`${card.name}权益已覆盖年费 ${Math.round(progress)}%`}><span style={{ width: `${progress}%` }}></span></div>
        <div className="card-metrics"><span>实际权益<strong className="positive">{money(cardActual)}</strong></span><span>预计价值<strong>{money(cardExpected)}</strong></span><span>净价值<strong className={cardActual - card.annual_fee >= 0 ? "positive" : "negative"}>{money(cardActual - card.annual_fee)}</strong></span></div>
        <div className="card-meta"><span>{card.renewal_month ? `${card.renewal_month} 月续费` : "未设置续费月"}</span><span>{card.points_balance.toLocaleString("en-US")} 积分</span>{card.source_url && <a href={card.source_url} target="_blank" rel="noreferrer">官方权益</a>}{card.notes && <span>{card.notes}</span>}</div>
        <div className="benefit-list">{cardBenefits.length === 0 ? <p>还没有权益记录。</p> : cardBenefits.map((benefit) => <button key={benefit.id} onClick={() => onEditBenefit(benefit)} aria-label={`更新 ${benefit.name} 实际价值`}><span><strong>{benefit.name}</strong><small>{RESET_LABELS[benefit.reset_period]} · 预计 {money(benefit.expected_value)}</small></span><span className="benefit-value"><strong>{money(benefit.actual_value)}</strong><small>已兑现</small></span><Icon name="edit" size={15}/></button>)}</div>
        <button className="inline-add" onClick={() => onAddBenefit(card)}><Icon name="plus" size={15}/>添加权益</button>
      </article>;
    })}</div>}
  </section>;
}

function FinancialPlanning({ goals, netWorth, onAdd, onEdit }: { goals: FinancialGoal[]; netWorth: number; onAdd: () => void; onEdit: (goal: FinancialGoal) => void }) {
  const active = goals.filter((goal) => goal.status === "active");
  const target = active.reduce((sum, goal) => sum + goal.target_amount, 0);
  const current = active.reduce((sum, goal) => sum + goal.current_amount, 0);
  const completion = target > 0 ? Math.min(current / target * 100, 100) : 0;
  return <section className="feature-page">
    <div className="planning-overview"><div><span>当前净资产</span><strong>{wholeMoney(netWorth)}</strong><small>来自账户总览</small></div><div className="planning-progress"><span>进行中目标进度 <strong>{Math.round(completion)}%</strong></span><div><i style={{ width: `${completion}%` }}></i></div><small>{money(current, true)} / {money(target, true)}</small></div></div>
    <div className="planning-heading"><div><span>FINANCIAL GOALS</span><h2>目标与资金计划</h2><p>把每个目标的金额、期限和当前进度放在一起。</p></div><button onClick={onAdd}><Icon name="plus" size={16}/>新目标</button></div>
    {goals.length === 0 ? <Empty title="建立第一个财务目标" detail="可以从应急金、旅行、住房或退休开始，目标金额和进度都由你填写。" action="添加财务目标" onAction={onAdd}/> : <div className="goal-grid">{goals.map((goal) => {
      const progress = Math.min(goal.current_amount / goal.target_amount * 100, 100);
      return <button className="goal-card" key={goal.id} onClick={() => onEdit(goal)} aria-label={`更新目标 ${goal.title}`}>
        <div className="goal-top"><span className={`goal-status ${goal.status}`}>{GOAL_STATUS_LABELS[goal.status]}</span><small>{GOAL_LABELS[goal.category]}</small></div>
        <h3>{goal.title}</h3>
        <div className="goal-amount"><strong>{money(goal.current_amount, true)}</strong><span>/ {money(goal.target_amount, true)}</span></div>
        <div className="goal-track"><span style={{ width: `${progress}%` }}></span></div>
        <div className="goal-foot"><span>{Math.round(progress)}% 完成</span><span>{goal.target_date ? `目标 ${new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "short", day: "numeric" }).format(new Date(`${goal.target_date}T00:00:00`))}` : "无固定日期"}</span></div>
        {goal.notes && <p>{goal.notes}</p>}
      </button>;
    })}</div>}
  </section>;
}

function CreditCardForm({ onSubmit, pending, error }: { onSubmit: (v: { name: string; issuer: string; annual_fee: number; renewal_month: number | null; points_balance: number; notes: string | null }) => void; pending: boolean; error: Error | null }) {
  const submit = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const f = new FormData(e.currentTarget); const month = String(f.get("renewalMonth") ?? ""); onSubmit({ name: String(f.get("name")), issuer: String(f.get("issuer")), annual_fee: Number(f.get("annualFee")), renewal_month: month ? Number(month) : null, points_balance: Number(f.get("pointsBalance")), notes: String(f.get("notes") ?? "").trim() || null }); };
  return <form className="entry-form" onSubmit={submit}><div className="form-grid"><Field label="信用卡名称"><input name="name" required placeholder="例如：Venture X" aria-label="信用卡名称" /></Field><Field label="发卡机构"><input name="issuer" required placeholder="例如：Capital One" aria-label="发卡机构" /></Field><Field label="年度年费"><div className="money-input"><span>$</span><input name="annualFee" type="number" min="0" step="0.01" required aria-label="年度年费" /></div></Field><Field label="积分数量"><input name="pointsBalance" type="number" min="0" step="1" required defaultValue="0" aria-label="信用卡积分数量" /></Field><Field label="续费月份（可选）"><select name="renewalMonth" aria-label="续费月份"><option value="">未设置</option>{Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1} 月</option>)}</select></Field><Field label="备注"><input name="notes" placeholder="例如：保留到下次续费前复盘" aria-label="信用卡备注" /></Field></div><ErrorText error={error}/><button className="submit-button" disabled={pending}>{pending ? "保存中…" : "保存信用卡"}</button></form>;
}

function CreditCardEditForm({ card, onSubmit, pending, error }: { card: CreditCard; onSubmit: (v: { name: string; issuer: string; annual_fee: number; renewal_month: number | null; points_balance: number; notes: string | null }) => void; pending: boolean; error: Error | null }) {
  const submit = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const f = new FormData(e.currentTarget); const month = String(f.get("renewalMonth") ?? ""); onSubmit({ name: String(f.get("name")), issuer: String(f.get("issuer")), annual_fee: Number(f.get("annualFee")), renewal_month: month ? Number(month) : null, points_balance: Number(f.get("pointsBalance")), notes: String(f.get("notes") ?? "").trim() || null }); };
  return <form className="entry-form" onSubmit={submit}><div className="edit-context"><span>{card.issuer}</span><strong>{card.name}</strong></div><div className="form-grid"><Field label="信用卡名称"><input name="name" required defaultValue={card.name} aria-label="信用卡名称" /></Field><Field label="发卡机构"><input name="issuer" required defaultValue={card.issuer} aria-label="发卡机构" /></Field><Field label="年度年费"><div className="money-input"><span>$</span><input name="annualFee" type="number" min="0" step="0.01" required defaultValue={card.annual_fee} aria-label="年度年费" /></div></Field><Field label="积分数量"><input name="pointsBalance" type="number" min="0" step="1" required defaultValue={card.points_balance} aria-label="信用卡积分数量" /></Field><Field label="续费月份（可选）"><select name="renewalMonth" defaultValue={card.renewal_month ?? ""} aria-label="续费月份"><option value="">未设置</option>{Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1} 月</option>)}</select></Field><Field label="备注"><input name="notes" defaultValue={card.notes ?? ""} aria-label="信用卡备注" /></Field></div><ErrorText error={error}/><button className="submit-button" disabled={pending}>{pending ? "更新中…" : "更新信用卡"}</button></form>;
}

function CardBenefitForm({ card, onSubmit, pending, error }: { card: CreditCard; onSubmit: (v: { card_id: number; name: string; expected_value: number; actual_value: number; reset_period: CardBenefit["reset_period"]; notes: string | null }) => void; pending: boolean; error: Error | null }) {
  const submit = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const f = new FormData(e.currentTarget); onSubmit({ card_id: card.id, name: String(f.get("name")), expected_value: Number(f.get("expectedValue")), actual_value: Number(f.get("actualValue")), reset_period: String(f.get("resetPeriod")) as CardBenefit["reset_period"], notes: String(f.get("notes") ?? "").trim() || null }); };
  return <form className="entry-form" onSubmit={submit}><div className="edit-context"><span>{card.issuer}</span><strong>{card.name}</strong></div><div className="form-grid"><Field label="权益名称"><input name="name" required placeholder="例如：旅行报销" aria-label="权益名称" /></Field><Field label="重置周期"><select name="resetPeriod" aria-label="权益重置周期"><option value="annual">每年</option><option value="monthly">每月</option><option value="quarterly">每季度</option><option value="one_time">一次性</option></select></Field><Field label="年度可用价值"><div className="money-input"><span>$</span><input name="expectedValue" type="number" min="0" step="0.01" required aria-label="年度可用价值" /></div></Field><Field label="本持卡年度已兑现"><div className="money-input"><span>$</span><input name="actualValue" type="number" min="0" step="0.01" required defaultValue="0" aria-label="实际兑现价值" /></div></Field><Field label="备注"><input name="notes" placeholder="例如：每月报销需手动激活" aria-label="权益备注" /></Field></div><ErrorText error={error}/><button className="submit-button" disabled={pending}>{pending ? "保存中…" : "保存权益"}</button></form>;
}

function BenefitEditForm({ benefit, onSubmit, pending, error }: { benefit: CardBenefit; onSubmit: (v: { expected_value: number; actual_value: number; notes: string | null }) => void; pending: boolean; error: Error | null }) {
  const submit = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const f = new FormData(e.currentTarget); onSubmit({ expected_value: Number(f.get("expectedValue")), actual_value: Number(f.get("actualValue")), notes: String(f.get("notes") ?? "").trim() || null }); };
  return <form className="entry-form" onSubmit={submit}><div className="edit-context"><span>{RESET_LABELS[benefit.reset_period]}</span><strong>{benefit.name}</strong></div><div className="form-grid"><Field label="年度可用价值"><div className="money-input"><span>$</span><input name="expectedValue" type="number" min="0" step="0.01" required defaultValue={benefit.expected_value} aria-label="年度可用价值" /></div></Field><Field label="本持卡年度已兑现"><div className="money-input"><span>$</span><input name="actualValue" type="number" min="0" step="0.01" required defaultValue={benefit.actual_value} aria-label="实际兑现价值" /></div></Field><Field label="备注"><input name="notes" defaultValue={benefit.notes ?? ""} aria-label="权益备注" /></Field></div><ErrorText error={error}/><button className="submit-button" disabled={pending}>{pending ? "更新中…" : "更新权益"}</button></form>;
}

function FinancialGoalForm({ onSubmit, pending, error }: { onSubmit: (v: { title: string; category: FinancialGoal["category"]; target_amount: number; current_amount: number; target_date: string | null; status: FinancialGoal["status"]; notes: string | null }) => void; pending: boolean; error: Error | null }) {
  const submit = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const f = new FormData(e.currentTarget); const targetDate = String(f.get("targetDate") ?? ""); onSubmit({ title: String(f.get("title")), category: String(f.get("category")) as FinancialGoal["category"], target_amount: Number(f.get("targetAmount")), current_amount: Number(f.get("currentAmount")), target_date: targetDate || null, status: "active", notes: String(f.get("notes") ?? "").trim() || null }); };
  return <form className="entry-form" onSubmit={submit}><div className="form-grid"><Field label="目标名称"><input name="title" required placeholder="例如：6 个月应急金" aria-label="目标名称" /></Field><Field label="目标类型"><select name="category" aria-label="目标类型">{Object.entries(GOAL_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field><Field label="目标金额"><div className="money-input"><span>$</span><input name="targetAmount" type="number" min="0.01" step="0.01" required aria-label="目标金额" /></div></Field><Field label="当前已准备"><div className="money-input"><span>$</span><input name="currentAmount" type="number" min="0" step="0.01" required defaultValue="0" aria-label="当前目标金额" /></div></Field><Field label="目标日期（可选）"><input name="targetDate" type="date" aria-label="目标日期" /></Field><Field label="计划备注"><input name="notes" placeholder="例如：每月自动转入 $1,000" aria-label="计划备注" /></Field></div><ErrorText error={error}/><button className="submit-button" disabled={pending}>{pending ? "保存中…" : "保存目标"}</button></form>;
}

function FinancialGoalEditForm({ goal, onSubmit, pending, error }: { goal: FinancialGoal; onSubmit: (v: { current_amount: number; status: FinancialGoal["status"]; notes: string | null }) => void; pending: boolean; error: Error | null }) {
  const submit = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const f = new FormData(e.currentTarget); onSubmit({ current_amount: Number(f.get("currentAmount")), status: String(f.get("status")) as FinancialGoal["status"], notes: String(f.get("notes") ?? "").trim() || null }); };
  return <form className="entry-form" onSubmit={submit}><div className="edit-context"><span>{GOAL_LABELS[goal.category]} · 目标 {money(goal.target_amount)}</span><strong>{goal.title}</strong></div><div className="form-grid"><Field label="当前已准备"><div className="money-input"><span>$</span><input name="currentAmount" type="number" min="0" step="0.01" required defaultValue={goal.current_amount} aria-label="当前目标金额" /></div></Field><Field label="状态"><select name="status" defaultValue={goal.status} aria-label="目标状态">{Object.entries(GOAL_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field><Field label="计划备注"><input name="notes" defaultValue={goal.notes ?? ""} aria-label="计划备注" /></Field></div><ErrorText error={error}/><button className="submit-button" disabled={pending}>{pending ? "更新中…" : "更新目标"}</button></form>;
}

function TransactionList({ transactions, accounts }: { transactions: Transaction[]; accounts: Account[] }) {
  const [limit, setLimit] = useState(120);
  const [query, setQuery] = useState("");
  const accountMap = new Map(accounts.map((a) => [a.id, a]));
  const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
  const matchingTransactions = normalizedQuery ? transactions.filter((transaction) => {
    const account = accountMap.get(transaction.account_id);
    const amountText = `${transaction.amount} ${transaction.amount.toFixed(2)} ${money(transaction.amount)}`;
    return [transaction.description, transaction.category, transaction.date, transaction.type === "income" ? "收入" : "支出", account?.name ?? "", account?.institution ?? "", amountText]
      .some((value) => value.toLocaleLowerCase("zh-CN").includes(normalizedQuery));
  }) : transactions;
  useEffect(() => setLimit(120), [normalizedQuery, transactions.length]);
  const visibleTransactions = matchingTransactions.slice(0, limit);
  const groups = visibleTransactions.reduce<Record<string, Transaction[]>>((acc, t) => { (acc[t.date] ??= []).push(t); return acc; }, {});
  return <div className="transaction-browser">
    <div className="transaction-search">
      <label><Icon name="search" size={17}/><input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="搜索交易记录" placeholder="搜索名称、分类、账户、日期或金额" /></label>
      {query && <button type="button" aria-label="清除交易搜索" onClick={() => setQuery("")}><Icon name="close" size={15}/></button>}
      <small aria-live="polite">{normalizedQuery ? `${matchingTransactions.length} 笔匹配` : `${transactions.length} 笔记录`}</small>
    </div>
    {matchingTransactions.length === 0 ? <div className="transaction-search-empty">没有找到“{query.trim()}”相关的交易</div> : <div className="transaction-groups">{Object.entries(groups).map(([date, rows]) => <section key={date}><h2>{new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric" }).format(new Date(`${date}T00:00:00`))}</h2>{rows.map((t) => <div className="transaction-row" key={t.id}><span className={`transaction-mark ${t.type}`}>{t.type === "income" ? "↓" : "↑"}</span><span className="transaction-main"><strong>{t.description}</strong><small>{t.category} · {accountMap.get(t.account_id)?.name ?? "账户"}</small></span><strong className={t.type === "income" ? "positive" : "negative"}>{t.type === "income" ? "+" : "−"}{money(t.amount)}</strong></div>)}</section>)}{limit < matchingTransactions.length && <button type="button" className="load-more" onClick={() => setLimit((current) => current + 120)}>再显示 120 笔 · 剩余 {matchingTransactions.length - limit} 笔</button>}</div>}
  </div>;
}

function HoldingsList({ holdings, accounts, onEdit }: { holdings: Holding[]; accounts: Account[]; onEdit: (h: Holding) => void }) {
  const accountMap = new Map(accounts.map((a) => [a.id, a]));
  const [groupMode, setGroupMode] = useState<HoldingGroupMode>(() => readLocalPreference("finance-holdings-group-mode") === "symbol" ? "symbol" : "account");
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(readLocalPreference("finance-holdings-groups-collapsed") ?? "{}"); } catch { return {}; }
  });
  const changeMode = (mode: HoldingGroupMode) => {
    setGroupMode(mode);
    saveLocalPreference("finance-holdings-group-mode", mode);
  };
  const collapseByDefault = holdings.length > 80;
  const toggleGroup = (key: string) => setCollapsedGroups((current) => {
    const next = { ...current, [key]: !(current[key] ?? collapseByDefault) };
    saveLocalPreference("finance-holdings-groups-collapsed", JSON.stringify(next));
    return next;
  });
  const grouped = new Map<string, { key: string; title: string; subtitle: string; rows: Holding[] }>();
  for (const holding of holdings) {
    const account = accountMap.get(holding.account_id);
    const rawKey = groupMode === "account" ? String(holding.account_id) : holding.symbol;
    const key = `${groupMode}:${rawKey}`;
    const existing = grouped.get(key);
    if (existing) existing.rows.push(holding);
    else grouped.set(key, {
      key,
      title: groupMode === "account" ? (account?.name ?? "未知账户") : holding.symbol,
      subtitle: groupMode === "account" ? (account?.institution ?? "账户") : holding.name,
      rows: [holding],
    });
  }
  const groups = [...grouped.values()].sort((left, right) => {
    const leftValue = left.rows.reduce((sum, holding) => sum + holdingMarketValue(holding), 0);
    const rightValue = right.rows.reduce((sum, holding) => sum + holdingMarketValue(holding), 0);
    return rightValue - leftValue;
  });
  return <div className="holdings-browser">
    <div className="holding-group-controls" role="group" aria-label="持仓分组方式">
      <span>分组</span>
      <button type="button" className={groupMode === "account" ? "active" : ""} aria-pressed={groupMode === "account"} onClick={() => changeMode("account")}>按账户</button>
      <button type="button" className={groupMode === "symbol" ? "active" : ""} aria-pressed={groupMode === "symbol"} onClick={() => changeMode("symbol")}>按股票</button>
    </div>
    <div className="holdings-groups">{groups.map((group) => {
      const collapsed = collapsedGroups[group.key] ?? collapseByDefault;
      const groupValue = group.rows.reduce((sum, holding) => sum + holdingMarketValue(holding), 0);
      const groupGain = group.rows.reduce((sum, holding) => sum + holding.quantity * (holding.current_price - holding.avg_cost), 0);
      return <section className={`holding-group ${collapsed ? "collapsed" : ""}`} key={group.key}>
        <button type="button" className="holding-group-toggle" onClick={() => toggleGroup(group.key)} aria-expanded={!collapsed} aria-controls={`holding-group-${group.key.replace(/[^a-zA-Z0-9_-]/g, "-")}`}>
          <span className="group-title"><Icon name="chevron" size={15}/><span><strong>{group.title}</strong><small>{group.subtitle} · {group.rows.length} 项</small></span></span>
          <span className="holding-group-total"><strong>{money(groupValue)}</strong><small className={groupGain >= 0 ? "positive" : "negative"}>{groupGain >= 0 ? "+" : ""}{money(groupGain)}</small></span>
        </button>
        {!collapsed && <div className="holdings-list" id={`holding-group-${group.key.replace(/[^a-zA-Z0-9_-]/g, "-")}`}>{group.rows.sort((left, right) => holdingMarketValue(right) - holdingMarketValue(left)).map((holding) => {
          const value = holdingMarketValue(holding);
          const gain = holding.quantity * (holding.current_price - holding.avg_cost);
          const gainPercent = holding.avg_cost > 0 ? (holding.current_price - holding.avg_cost) / holding.avg_cost * 100 : 0;
          const secondary = groupMode === "account" ? holding.name : (accountMap.get(holding.account_id)?.name ?? "账户");
          const dailyAmount = holding.day_gain_amount;
          const dailyPercent = holding.day_gain_pct;
          const hasDailyGain = dailyAmount != null && dailyPercent != null;
          const dailyText = hasDailyGain ? `${dailyAmount >= 0 ? "+" : ""}${money(dailyAmount)} · ${pct(dailyPercent)}` : "—";
          return <button className="holding-row" key={holding.id} onClick={() => onEdit(holding)} aria-label={`更新 ${holding.symbol} 持仓`}><span className="ticker">{holding.symbol.slice(0,4)}</span><span className="holding-name"><strong>{holding.symbol}</strong><small>{secondary}</small></span><span className="holding-value"><strong>{money(value)}</strong><small className={gain >= 0 ? "positive" : "negative"}>累计 {gain >= 0 ? "+" : ""}{money(gain)} · {pct(gainPercent)}</small><small className={!hasDailyGain ? "muted" : dailyAmount >= 0 ? "positive" : "negative"}>今日 {dailyText}</small></span><Icon name="edit" size={15}/></button>;
        })}</div>}
      </section>;
    })}</div>
  </div>;
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return <div className="sheet-layer" role="dialog" aria-modal="true" aria-label={title}><button className="sheet-backdrop" aria-label="关闭" onClick={onClose}></button><section className="sheet"><div className="sheet-grip"></div><header><h2>{title}</h2><button aria-label="关闭" onClick={onClose}><Icon name="close"/></button></header>{children}</section></div>;
}

function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="field"><span>{label}</span>{children}</label>; }
function ErrorText({ error }: { error: Error | null }) { return error ? <p className="form-error">保存失败，请检查后重试。</p> : null; }

function AccountTypeLabelRow({ option, pending, onSave }: { option: AccountTypeOption; pending: boolean; onSave: (value: AccountTypeLabel) => void }) {
  const [label, setLabel] = useState(option.label);
  useEffect(() => setLabel(option.label), [option.label]);
  const cleanLabel = label.trim();
  return <div className="type-label-row">
    <label><span>{option.label}</span><small>{option.value}</small><input aria-label={`修改${option.label}分类名称`} value={label} maxLength={24} onChange={(event) => setLabel(event.target.value)} /></label>
    <button type="button" onClick={() => onSave({ type: option.value, label: cleanLabel })} disabled={pending || cleanLabel.length === 0 || cleanLabel === option.label}>{pending ? "保存中" : "保存"}</button>
  </div>;
}

function AccountTypeLabelsForm({ options, onSave, pending, error }: { options: AccountTypeOption[]; onSave: (value: AccountTypeLabel) => void; pending: boolean; error: Error | null }) {
  return <div className="type-label-settings">
    <p>只更改界面中的分类名称，不会改变账户类型、同步规则或历史数据。</p>
    <div className="type-label-list">{options.map((option) => <AccountTypeLabelRow key={option.value} option={option} pending={pending} onSave={onSave} />)}</div>
    <ErrorText error={error}/>
  </div>;
}

function AccountForm({ accountTypeOptions, onSubmit, pending, error }: { accountTypeOptions: AccountTypeOption[]; onSubmit: (v: { name: string; institution: string; type: Account["type"]; balance: number }) => void; pending: boolean; error: Error | null }) {
  const submit = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const f = new FormData(e.currentTarget); onSubmit({ name: String(f.get("name")), institution: String(f.get("institution")), type: String(f.get("type")) as Account["type"], balance: Number(f.get("balance")) }); };
  return <form className="entry-form" onSubmit={submit}><div className="form-grid"><Field label="账户名称"><input name="name" required placeholder="例如：日常支票账户" aria-label="账户名称" /></Field><Field label="银行 / 机构"><input name="institution" required placeholder="例如：Chase" aria-label="银行或机构" /></Field><Field label="账户类型"><select name="type" aria-label="账户类型">{accountTypeOptions.map(({ value, label })=><option key={value} value={value}>{label}</option>)}</select></Field><Field label="当前余额"><div className="money-input"><span>$</span><input name="balance" type="number" step="0.01" required defaultValue="0" aria-label="当前余额" /></div></Field></div><ErrorText error={error}/><button className="submit-button" disabled={pending}>{pending ? "保存中…" : "保存账户"}</button></form>;
}

function TransactionForm({ accounts, onSubmit, pending, error }: { accounts: Account[]; onSubmit: (v: { account_id: number; type: "income"|"expense"; category: string; description: string; amount: number; date: string }) => void; pending: boolean; error: Error | null }) {
  const submit = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const f = new FormData(e.currentTarget); onSubmit({ account_id: Number(f.get("account")), type: String(f.get("type")) as "income"|"expense", category: String(f.get("category")), description: String(f.get("description")), amount: Number(f.get("amount")), date: String(f.get("date")) }); };
  return <form className="entry-form" onSubmit={submit}><div className="form-grid"><Field label="收支类型"><select name="type" aria-label="收支类型"><option value="expense">支出</option><option value="income">收入</option></select></Field><Field label="账户"><select name="account" aria-label="交易账户">{accounts.map(a=><option key={a.id} value={a.id}>{a.name} · {a.institution}</option>)}</select></Field><Field label="金额"><div className="money-input"><span>$</span><input name="amount" type="number" min="0.01" step="0.01" required aria-label="交易金额" /></div></Field><Field label="日期"><input name="date" type="date" required defaultValue={localDate()} aria-label="交易日期" /></Field><Field label="分类"><select name="category" aria-label="交易分类">{CATEGORIES.map(c=><option key={c}>{c}</option>)}</select></Field><Field label="说明"><input name="description" required placeholder="例如：超市购物" aria-label="交易说明" /></Field></div><ErrorText error={error}/><button className="submit-button" disabled={pending}>{pending ? "保存中…" : "保存交易"}</button></form>;
}

function HoldingForm({ accounts, onSubmit, pending, error }: { accounts: Account[]; onSubmit: (v: { account_id: number; symbol: string; name: string; quantity: number; avg_cost: number; current_price: number }) => void; pending: boolean; error: Error | null }) {
  const submit = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const f = new FormData(e.currentTarget); onSubmit({ account_id: Number(f.get("account")), symbol: String(f.get("symbol")), name: String(f.get("name")), quantity: Number(f.get("quantity")), avg_cost: Number(f.get("cost")), current_price: Number(f.get("price")) }); };
  return <form className="entry-form" onSubmit={submit}><div className="form-grid"><Field label="投资账户"><select name="account" aria-label="投资账户">{accounts.filter(a=>INVESTMENT_ACCOUNT_TYPES.has(a.type)).map(a=><option key={a.id} value={a.id}>{a.name} · {a.institution}</option>)}{!accounts.some(a=>INVESTMENT_ACCOUNT_TYPES.has(a.type)) && accounts.map(a=><option key={a.id} value={a.id}>{a.name} · {a.institution}</option>)}</select></Field><Field label="代码"><input name="symbol" required placeholder="例如：AAPL" autoCapitalize="characters" aria-label="证券代码" /></Field><Field label="名称"><input name="name" required placeholder="例如：Apple" aria-label="证券名称" /></Field><Field label="数量"><input name="quantity" type="number" min="0.000001" step="any" required aria-label="持仓数量" /></Field><Field label="平均成本"><div className="money-input"><span>$</span><input name="cost" type="number" min="0" step="0.01" required aria-label="平均成本" /></div></Field><Field label="当前价格"><div className="money-input"><span>$</span><input name="price" type="number" min="0" step="0.01" required aria-label="当前价格" /></div></Field></div><p className="form-note">你可以手动更新；账户同步后也会刷新最新持仓。</p><ErrorText error={error}/><button className="submit-button" disabled={pending}>{pending ? "保存中…" : "保存持仓"}</button></form>;
}

function AccountEditForm({ account, accountTypeOptions, onSubmit, onDelete, pending, error }: { account: Account; accountTypeOptions: AccountTypeOption[]; onSubmit: (value: { name: string; institution: string; type: Account["type"]; balance: number }) => void; onDelete: () => void; pending: boolean; error: Error | null }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    onSubmit({ name: String(form.get("name")), institution: String(form.get("institution")), type: String(form.get("type")) as Account["type"], balance: Number(form.get("balance")) });
  };
  return <form className="entry-form" onSubmit={submit}>
    <div className="edit-context"><span>{account.institution}</span><strong>{account.name}</strong></div>
    <div className="form-grid">
      <Field label="账户名称"><input name="name" required maxLength={80} defaultValue={account.name} autoFocus aria-label="账户名称" /></Field>
      <Field label="银行 / 机构"><input name="institution" required maxLength={80} defaultValue={account.institution} aria-label="银行或机构" /></Field>
      <Field label="账户类型"><select name="type" defaultValue={account.type} aria-label="账户类型">{accountTypeOptions.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}</select></Field>
      <Field label="最新余额"><div className="money-input"><span>$</span><input name="balance" type="number" step="0.01" defaultValue={account.balance} required aria-label="最新余额" /></div></Field>
    </div>
    <ErrorText error={error}/><button className="submit-button" disabled={pending}>{pending ? "保存中…" : "保存账户"}</button>
    <div className="danger-zone">
      {!confirmDelete ? <button type="button" onClick={() => setConfirmDelete(true)} disabled={pending}>删除账户</button> : <div className="delete-confirm"><p>删除后，该账户的交易和持仓也会一并移除。</p><div><button type="button" onClick={() => setConfirmDelete(false)} disabled={pending}>取消</button><button type="button" className="danger-button" onClick={onDelete} disabled={pending}>{pending ? "处理中…" : "确认删除"}</button></div></div>}
    </div>
  </form>;
}

function HoldingEditForm({ holding, onSubmit, pending, error }: { holding: Holding; onSubmit: (v: { quantity: number; avg_cost: number; current_price: number }) => void; pending: boolean; error: Error | null }) {
  const submit = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const f = new FormData(e.currentTarget); onSubmit({ quantity: Number(f.get("quantity")), avg_cost: Number(f.get("cost")), current_price: Number(f.get("price")) }); };
  return <form className="entry-form" onSubmit={submit}><div className="edit-context"><span>{holding.name}</span><strong>{holding.symbol}</strong></div><div className="form-grid"><Field label="数量"><input name="quantity" type="number" min="0.000001" step="any" required defaultValue={holding.quantity} aria-label="持仓数量" /></Field><Field label="平均成本"><div className="money-input"><span>$</span><input name="cost" type="number" min="0" step="0.01" required defaultValue={holding.avg_cost} aria-label="平均成本" /></div></Field><Field label="当前价格"><div className="money-input"><span>$</span><input name="price" type="number" min="0" step="0.01" required defaultValue={holding.current_price} aria-label="当前价格" /></div></Field></div><ErrorText error={error}/><button className="submit-button" disabled={pending}>{pending ? "更新中…" : "更新持仓"}</button></form>;
}
