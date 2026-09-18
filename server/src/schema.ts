import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const accounts = sqliteTable("accounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  institution: text("institution").notNull(),
  type: text("type", { enum: ["checking", "savings", "investment", "retirement", "property", "crypto", "private_investment", "credit", "loan", "other"] }).notNull(),
  balance: real("balance").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const accountTypeLabels = sqliteTable("account_type_labels", {
  type: text("type", { enum: ["checking", "savings", "investment", "retirement", "property", "crypto", "private_investment", "credit", "loan", "other"] }).primaryKey(),
  label: text("label").notNull(),
});

export const transactions = sqliteTable("transactions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  accountId: integer("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  type: text("type", { enum: ["income", "expense"] }).notNull(),
  category: text("category").notNull(),
  description: text("description").notNull(),
  amount: real("amount").notNull(),
  date: text("date").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const holdings = sqliteTable("holdings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  accountId: integer("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  symbol: text("symbol").notNull(),
  name: text("name").notNull(),
  quantity: real("quantity").notNull(),
  avgCost: real("avg_cost").notNull(),
  currentPrice: real("current_price").notNull(),
  dayGainAmount: real("day_gain_amount"),
  dayGainPct: real("day_gain_pct"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const syncState = sqliteTable("sync_state", {
  id: integer("id").primaryKey(),
  status: text("status", { enum: ["idle", "syncing", "success", "error"] }).notNull(),
  taskId: text("task_id"),
  message: text("message"),
  startedAt: integer("started_at", { mode: "timestamp_ms" }),
  syncedAt: integer("synced_at", { mode: "timestamp_ms" }),
});

export const balanceSnapshots = sqliteTable("balance_snapshots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  capturedAt: integer("captured_at", { mode: "timestamp_ms" }).notNull(),
  totalAssets: real("total_assets").notNull(),
  totalInvestments: real("total_investments").notNull(),
  cashAssets: real("cash_assets"),
  brokerageAssets: real("brokerage_assets"),
  retirementAssets: real("retirement_assets"),
});

export const creditCards = sqliteTable("credit_cards", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  accountId: integer("account_id").references(() => accounts.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  issuer: text("issuer").notNull(),
  annualFee: real("annual_fee").notNull(),
  renewalMonth: integer("renewal_month"),
  pointsBalance: real("points_balance").notNull().default(0),
  sourceUrl: text("source_url"),
  notes: text("notes"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const cardBenefits = sqliteTable("card_benefits", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  cardId: integer("card_id").notNull().references(() => creditCards.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  expectedValue: real("expected_value").notNull(),
  actualValue: real("actual_value").notNull(),
  resetPeriod: text("reset_period", { enum: ["annual", "monthly", "quarterly", "one_time"] }).notNull(),
  notes: text("notes"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const financialGoals = sqliteTable("financial_goals", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  category: text("category", { enum: ["emergency", "retirement", "home", "travel", "education", "debt", "investment", "other"] }).notNull(),
  targetAmount: real("target_amount").notNull(),
  currentAmount: real("current_amount").notNull(),
  targetDate: text("target_date"),
  status: text("status", { enum: ["active", "completed", "paused"] }).notNull(),
  notes: text("notes"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});
