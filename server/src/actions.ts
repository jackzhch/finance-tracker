import { defineAction, z, type ActionsModule, type Ctx } from "@hatch/space-sdk";
import { asc, desc, eq, sql } from "drizzle-orm";
import * as schema from "./schema";

const accountType = z.enum(["checking", "savings", "investment", "retirement", "property", "crypto", "private_investment", "credit", "loan", "other"]);
const transactionType = z.enum(["income", "expense"]);
const okResponse = z.object({ ok: z.literal(true) });
const syncStatusValue = z.enum(["idle", "syncing", "success", "error"]);
const DEFAULT_ACCOUNT_TYPE_LABELS: Record<z.infer<typeof accountType>, string> = {
  checking: "支票账户",
  savings: "储蓄账户",
  investment: "证券投资",
  retirement: "退休账户",
  property: "房产",
  crypto: "数字资产",
  private_investment: "项目投资",
  credit: "信用卡",
  loan: "贷款 / 负债",
  other: "其他",
};

const accountTypeLabelResponse = z.object({
  type: accountType,
  label: z.string(),
});

const accountResponse = z.object({
  id: z.number(),
  name: z.string(),
  institution: z.string(),
  type: accountType,
  balance: z.number(),
});

const transactionResponse = z.object({
  id: z.number(),
  account_id: z.number(),
  type: transactionType,
  category: z.string(),
  description: z.string(),
  amount: z.number(),
  date: z.string(),
});

const holdingResponse = z.object({
  id: z.number(),
  account_id: z.number(),
  symbol: z.string(),
  name: z.string(),
  quantity: z.number(),
  avg_cost: z.number(),
  current_price: z.number(),
  day_gain_amount: z.number().nullable(),
  day_gain_pct: z.number().nullable(),
});

const syncStatusResponse = z.object({
  status: syncStatusValue,
  message: z.string().nullable(),
  started_at: z.string().nullable(),
  synced_at: z.string().nullable(),
});

const snapshotResponse = z.object({
  id: z.number(),
  captured_at: z.string(),
  total_assets: z.number(),
  total_investments: z.number(),
  cash_assets: z.number().nullable(),
  brokerage_assets: z.number().nullable(),
  retirement_assets: z.number().nullable(),
});

const resetPeriod = z.enum(["annual", "monthly", "quarterly", "one_time"]);
const goalCategory = z.enum(["emergency", "retirement", "home", "travel", "education", "debt", "investment", "other"]);
const goalStatus = z.enum(["active", "completed", "paused"]);

const creditCardResponse = z.object({
  id: z.number(), account_id: z.number().nullable(), name: z.string(), issuer: z.string(), annual_fee: z.number(), renewal_month: z.number().nullable(), points_balance: z.number(), source_url: z.string().nullable(), notes: z.string().nullable(),
});

type CardPreset = {
  annualFee: number;
  sourceUrl: string;
  benefits: Array<{ name: string; expectedValue: number; resetPeriod: "annual" | "monthly" | "quarterly" | "one_time"; notes: string }>;
};

function cardPresetFor(name: string, institution: string): CardPreset | null {
  const value = `${name} ${institution}`.toLowerCase();
  if (value.includes("venture x")) return {
    annualFee: 395,
    sourceUrl: "https://www.capitalone.com/credit-cards/venture-x/?irgwc=1&afsrc=1&external_id=IRAFF_ZZb385def50ec242698f0d0669b50f7188_USCIR_K102401_A344893L_C_S28049_P&pscid=&oC=eZan6vxLBE&applicationprefillid=",
    benefits: [
      { name: "Capital One Travel 年度抵扣", expectedValue: 300, resetPeriod: "annual", notes: "通过 Capital One Travel 预订时使用；请按实际兑现额更新。" },
      { name: "周年 10,000 miles", expectedValue: 100, resetPeriod: "annual", notes: "官方按旅行兑换价值 $100 标示；实际价值取决于兑换方式。" },
      { name: "Global Entry / TSA PreCheck", expectedValue: 120, resetPeriod: "one_time", notes: "最高 $120，每四年一次；请按实际兑现额更新。" },
    ],
  };
  if (value.includes("sapphire reserve")) return {
    annualFee: 795,
    sourceUrl: "https://Creditcards.chase.com/rewards-credit-cards?iCELL=6H4S&CID=MKT3",
    benefits: [{ name: "年度旅行抵扣", expectedValue: 300, resetPeriod: "annual", notes: "标准旅行权益；请按实际兑现额更新。" }],
  };
  if (value.includes("sapphire preferred")) return {
    annualFee: 95,
    sourceUrl: "https://Creditcards.chase.com/rewards-credit-cards?iCELL=6H4S&CID=MKT3",
    benefits: [{ name: "Chase Travel 酒店抵扣", expectedValue: 50, resetPeriod: "annual", notes: "适用条件以官方条款为准；请按实际兑现额更新。" }],
  };
  if (value.includes("freedom unlimited")) return {
    annualFee: 0,
    sourceUrl: "https://Creditcards.chase.com/rewards-credit-cards?iCELL=6H4S&CID=MKT3",
    benefits: [{ name: "标准返现奖励", expectedValue: 0, resetPeriod: "annual", notes: "1.5% 基础返现，餐饮与药店 3%，Chase Travel 5%；价值随消费变化。" }],
  };
  if (value.includes("freedom flex")) return {
    annualFee: 0,
    sourceUrl: "https://Creditcards.chase.com/rewards-credit-cards?iCELL=6H4S&CID=MKT3",
    benefits: [{ name: "季度奖励类别", expectedValue: 0, resetPeriod: "quarterly", notes: "价值随激活类别和消费变化，请按实际兑现额更新。" }],
  };
  if (value.includes("discover it")) return {
    annualFee: 0,
    sourceUrl: "https://www.discover.com/credit-cards/brnd/?cmpgnid=dp-dbr-inet-cdt-sc-fb-AERG-D-NT&iq_id=dp-dbr-inet-cdt-sc-fb-AERG-D-NT",
    benefits: [{ name: "季度 5% 返现类别", expectedValue: 0, resetPeriod: "quarterly", notes: "需激活且受季度上限限制；价值随消费变化。" }],
  };
  if (value.includes("bilt")) return {
    annualFee: value.includes("palladium") ? 495 : value.includes("obsidian") ? 95 : 0,
    sourceUrl: "https://www.bilt.com/card/blue",
    benefits: [
      { name: "住房付款免交易费", expectedValue: 0, resetPeriod: "annual", notes: "价值取决于住房付款金额；请按实际节省金额更新。" },
      { name: "手机保护与旅行保障", expectedValue: 0, resetPeriod: "annual", notes: "保障范围和条件以官方指南为准。" },
    ],
  };
  return null;
}

async function ensureCreditCardsFromAccounts(ctx: Ctx) {
  const db = ctx.db<typeof schema>();
  const [accounts, cards] = await Promise.all([db.select().from(schema.accounts), db.select().from(schema.creditCards)]);
  let created = 0;
  for (const account of accounts.filter((item) => item.type === "credit")) {
    if (cards.some((card) => card.accountId === account.id)) continue;
    const unlinked = cards.find((card) => card.accountId == null && card.name === account.name && card.issuer === account.institution);
    if (unlinked) {
      await db.update(schema.creditCards).set({ accountId: account.id }).where(eq(schema.creditCards.id, unlinked.id));
      continue;
    }
    const preset = cardPresetFor(account.name, account.institution);
    const insertedRows = await db.insert(schema.creditCards).values({
      accountId: account.id,
      name: account.name,
      issuer: account.institution,
      annualFee: preset?.annualFee ?? 0,
      renewalMonth: null,
      pointsBalance: 0,
      sourceUrl: preset?.sourceUrl ?? null,
      notes: preset ? "年费与标准权益来自公开资料，可按实际持卡条款修改。" : "已从信用卡账户自动添加；卡种无法从账户名称确认，请补充年费和权益。",
    }).returning({ id: schema.creditCards.id });
    const inserted = insertedRows[0];
    if (!inserted) continue;
    if (preset && preset.benefits.length > 0) {
      await db.insert(schema.cardBenefits).values(preset.benefits.map((benefit) => ({ cardId: inserted.id, name: benefit.name, expectedValue: benefit.expectedValue, actualValue: 0, resetPeriod: benefit.resetPeriod, notes: benefit.notes })));
    }
    created += 1;
  }
  return created;
}
const cardBenefitResponse = z.object({
  id: z.number(), card_id: z.number(), name: z.string(), expected_value: z.number(), actual_value: z.number(), reset_period: resetPeriod, notes: z.string().nullable(),
});
const financialGoalResponse = z.object({
  id: z.number(), title: z.string(), category: goalCategory, target_amount: z.number(), current_amount: z.number(), target_date: z.string().nullable(), status: goalStatus, notes: z.string().nullable(),
});

function zelleClassification(description: string): { type: "income" | "expense"; category: "INCOME" | "OTHER" } | null {
  if (/\bzelle\s+payment\s+from\b/i.test(description)) return { type: "income", category: "INCOME" };
  if (/\bzelle\s+payment\s+to\b/i.test(description)) return { type: "expense", category: "OTHER" };
  return null;
}

async function captureSnapshot(ctx: Ctx) {
  const db = ctx.db<typeof schema>();
  const accounts = await db.select().from(schema.accounts);
  const totalAssets = accounts
    .filter((account) => account.type !== "credit" && account.type !== "loan")
    .reduce((sum, account) => sum + account.balance, 0);
  const brokerageAssets = accounts
    .filter((account) => account.type === "investment")
    .reduce((sum, account) => sum + account.balance, 0);
  const retirementAssets = accounts
    .filter((account) => account.type === "retirement")
    .reduce((sum, account) => sum + account.balance, 0);
  const alternativeAssets = accounts
    .filter((account) => account.type === "property" || account.type === "crypto" || account.type === "private_investment")
    .reduce((sum, account) => sum + account.balance, 0);
  const totalInvestments = brokerageAssets + retirementAssets + alternativeAssets;
  const cashAssets = totalAssets - totalInvestments;
  await db.insert(schema.balanceSnapshots).values({
    capturedAt: new Date(),
    totalAssets,
    totalInvestments,
    cashAssets,
    brokerageAssets,
    retirementAssets,
  });
}

const syncTaskMessage = `Synchronize every currently linked Plaid account into the Finance Tracker web artifact using only real Plaid data.

First read /opt/hatch/skills/plaid/SKILL.md and follow it. Then run plaid accounts, plaid investments-holdings when investment accounts exist, and plaid transactions-sync. If ~/workspace/finance-tracker-sync/watermark.json exists, use its saved cursors; otherwise request the most recent 90 days. Continue transaction pagination until complete.

Use the finance-tracker artifact actions to save data. Call getDashboard first. Prefer the mapping in ~/workspace/finance-tracker-sync/account-map.json from plaid account id to tracker account id. If the file or a mapping is missing, match an existing tracker account by institution plus the masked final four digits in its name. Only call addAccount when no real match exists; never duplicate or delete an account. Names visible in the tracker must contain only the institution and masked final four digits, never a full account number, Plaid id, credential id, token, or cursor. Map every Plaid loan account, including subtype mortgage accounts from PennyMac or Wells Fargo, to tracker account type loan. Use updateAccountBalance for balances; credit-card and loan current debt are stored as positive balances. For holdings, match by tracker account and security/symbol, then call updateHolding or addHolding. Keep symbols at 16 characters or fewer with a clear abbreviation when needed. Also populate each holding's day_gain_amount and day_gain_pct whenever Plaid provides both the institution price and a security close price: day_gain_amount = (institution_price - close_price) * quantity, and day_gain_pct = close_price > 0 ? (institution_price - close_price) / close_price * 100 : null. If Plaid does not provide a trustworthy prior close, store null for both fields rather than estimating. Add only new posted bank and credit transactions with addTransaction, deduplicating against getDashboard by account, date, amount, description, and type; skip pending transactions. Classify Zelle transfers by the direction stated in the description: "Zelle payment from …" is income with the exact category INCOME; "Zelle payment to …" is expense with the exact category OTHER. Use that normalized type and category when deduplicating. Use the closest existing Chinese category for every other transaction.

After all writes succeed, update ~/workspace/finance-tracker-sync/account-map.json and ~/workspace/finance-tracker-sync/watermark.json with the mapping, latest cursors, and synced_at. Finally call syncComplete with status success and a short Chinese message. If anything prevents a trustworthy sync, do not invent or partially overwrite values; call syncComplete with status error and a short readable Chinese explanation. Do not expose any full account number, token, credential id, internal account id, or cursor in the callback message.`;

export const Actions = {
  getDashboard: defineAction({
    request: z.object({}),
    response: z.object({
      accounts: z.array(accountResponse),
      transactions: z.array(transactionResponse),
      holdings: z.array(holdingResponse),
      snapshots: z.array(snapshotResponse),
      credit_cards: z.array(creditCardResponse),
      card_benefits: z.array(cardBenefitResponse),
      financial_goals: z.array(financialGoalResponse),
      account_type_labels: z.array(accountTypeLabelResponse),
    }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const [accounts, transactions, holdings, snapshots, creditCards, cardBenefits, financialGoals, savedTypeLabels] = await Promise.all([
        db.select().from(schema.accounts).orderBy(asc(schema.accounts.institution), asc(schema.accounts.name)),
        db.select().from(schema.transactions).orderBy(desc(schema.transactions.date), desc(schema.transactions.id)),
        db.select().from(schema.holdings).orderBy(asc(schema.holdings.symbol)),
        db.select().from(schema.balanceSnapshots).orderBy(asc(schema.balanceSnapshots.capturedAt)),
        db.select().from(schema.creditCards).orderBy(asc(schema.creditCards.issuer), asc(schema.creditCards.name)),
        db.select().from(schema.cardBenefits).orderBy(asc(schema.cardBenefits.cardId), asc(schema.cardBenefits.name)),
        db.select().from(schema.financialGoals).orderBy(asc(schema.financialGoals.status), asc(schema.financialGoals.targetDate)),
        db.select().from(schema.accountTypeLabels),
      ]);
      const savedLabelMap = new Map(savedTypeLabels.map((row) => [row.type, row.label]));
      return {
        accounts: accounts.map((row) => ({ id: row.id, name: row.name, institution: row.institution, type: row.type, balance: row.balance })),
        transactions: transactions.map((row) => {
          const zelle = zelleClassification(row.description);
          return { id: row.id, account_id: row.accountId, type: zelle?.type ?? row.type, category: zelle?.category ?? row.category, description: row.description, amount: row.amount, date: row.date };
        }),
        holdings: holdings.map((row) => ({ id: row.id, account_id: row.accountId, symbol: row.symbol, name: row.name, quantity: row.quantity, avg_cost: row.avgCost, current_price: row.currentPrice, day_gain_amount: row.dayGainAmount, day_gain_pct: row.dayGainPct })),
        snapshots: snapshots.map((row) => ({ id: row.id, captured_at: row.capturedAt.toISOString(), total_assets: row.totalAssets, total_investments: row.totalInvestments, cash_assets: row.cashAssets, brokerage_assets: row.brokerageAssets, retirement_assets: row.retirementAssets })),
        credit_cards: creditCards.map((row) => ({ id: row.id, account_id: row.accountId, name: row.name, issuer: row.issuer, annual_fee: row.annualFee, renewal_month: row.renewalMonth, points_balance: row.pointsBalance, source_url: row.sourceUrl, notes: row.notes })),
        card_benefits: cardBenefits.map((row) => ({ id: row.id, card_id: row.cardId, name: row.name, expected_value: row.expectedValue, actual_value: row.actualValue, reset_period: row.resetPeriod, notes: row.notes })),
        financial_goals: financialGoals.map((row) => ({ id: row.id, title: row.title, category: row.category, target_amount: row.targetAmount, current_amount: row.currentAmount, target_date: row.targetDate, status: row.status, notes: row.notes })),
        account_type_labels: accountType.options.map((type) => ({ type, label: savedLabelMap.get(type) ?? DEFAULT_ACCOUNT_TYPE_LABELS[type] })),
      };
    },
  }),

  updateAccountTypeLabel: defineAction({
    request: z.object({ type: accountType, label: z.string().trim().min(1).max(24) }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      await db.insert(schema.accountTypeLabels).values({ type: args.type, label: args.label }).onConflictDoUpdate({
        target: schema.accountTypeLabels.type,
        set: { label: args.label },
      });
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  getSyncStatus: defineAction({
    request: z.object({}),
    response: syncStatusResponse,
    async handler(ctx): Promise<z.infer<typeof syncStatusResponse>> {
      const db = ctx.db<typeof schema>();
      let row = (await db.select().from(schema.syncState).where(eq(schema.syncState.id, 1)))[0];
      if (!row) return { status: "idle", message: null, started_at: null, synced_at: null };

      if (row.status === "syncing" && row.taskId) {
        const task = await ctx.agent.status(row.taskId);
        if (task.status === "failed" || (task.status === "completed" && task.returnContractStatus === "unsatisfied")) {
          const message = task.failureReason ?? task.statusMessage ?? "同步未完成，请稍后重试。";
          await db.update(schema.syncState).set({ status: "error", message }).where(eq(schema.syncState.id, 1));
          row = { ...row, status: "error", message };
        }
      }

      return {
        status: row.status,
        message: row.message,
        started_at: row.startedAt ? row.startedAt.toISOString() : null,
        synced_at: row.syncedAt ? row.syncedAt.toISOString() : null,
      };
    },
  }),

  syncNow: defineAction({
    request: z.object({}),
    response: z.object({ ok: z.boolean(), status: syncStatusValue, message: z.string() }),
    async handler(ctx): Promise<{ ok: boolean; status: z.infer<typeof syncStatusValue>; message: string }> {
      const db = ctx.db<typeof schema>();
      const current = (await db.select().from(schema.syncState).where(eq(schema.syncState.id, 1)))[0];
      if (current?.status === "syncing" && current.taskId) {
        const task = await ctx.agent.status(current.taskId);
        if (task.status === "queued" || task.status === "running") {
          return { ok: true, status: "syncing", message: "同步正在进行中。" };
        }
      }

      const startedAt = new Date();
      const task = await ctx.agent.spawnTask(syncTaskMessage, { expectsAction: "synccomplete", dedupeKey: "plaid-finance-sync" });
      if (!task.ok) {
        const message = "无法启动同步，请稍后重试。";
        await db.insert(schema.syncState).values({ id: 1, status: "error", message, startedAt }).onConflictDoUpdate({ target: schema.syncState.id, set: { status: "error", taskId: null, message, startedAt } });
        return { ok: false, status: "error", message };
      }

      await db.insert(schema.syncState).values({ id: 1, status: "syncing", taskId: task.taskId, message: "正在从已连接账户同步…", startedAt }).onConflictDoUpdate({ target: schema.syncState.id, set: { status: "syncing", taskId: task.taskId, message: "正在从已连接账户同步…", startedAt } });
      ctx.invalidateQueries();
      return { ok: true, status: "syncing", message: "同步已开始。" };
    },
  }),

  syncComplete: defineAction({
    request: z.object({ status: z.enum(["success", "error"]), message: z.string().trim().min(1).max(240) }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      const now = new Date();
      await db.insert(schema.syncState).values({ id: 1, status: args.status, message: args.message, syncedAt: args.status === "success" ? now : null }).onConflictDoUpdate({ target: schema.syncState.id, set: { status: args.status, message: args.message, syncedAt: args.status === "success" ? now : null } });
      if (args.status === "success") await captureSnapshot(ctx);
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  addAccount: defineAction({
    request: z.object({ name: z.string().trim().min(1).max(80), institution: z.string().trim().min(1).max(80), type: accountType, balance: z.number().finite() }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const result = await ctx.db<typeof schema>().insert(schema.accounts).values(args).returning({ id: schema.accounts.id });
      const inserted = result[0];
      if (!inserted) throw new Error("Account could not be created");
      await captureSnapshot(ctx);
      ctx.invalidateQueries();
      return { id: inserted.id };
    },
  }),

  updateAccountBalance: defineAction({
    request: z.object({ id: z.number().int().positive(), balance: z.number().finite() }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      await ctx.db<typeof schema>().update(schema.accounts).set({ balance: args.balance }).where(eq(schema.accounts.id, args.id));
      await captureSnapshot(ctx);
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  updateAccount: defineAction({
    request: z.object({ id: z.number().int().positive(), name: z.string().trim().min(1).max(80), institution: z.string().trim().min(1).max(80), type: accountType, balance: z.number().finite() }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      await ctx.db<typeof schema>().update(schema.accounts).set({ name: args.name, institution: args.institution, type: args.type, balance: args.balance }).where(eq(schema.accounts.id, args.id));
      await captureSnapshot(ctx);
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  deleteAccount: defineAction({
    request: z.object({ id: z.number().int().positive() }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      await ctx.db<typeof schema>().delete(schema.accounts).where(eq(schema.accounts.id, args.id));
      await captureSnapshot(ctx);
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  addTransaction: defineAction({
    request: z.object({ account_id: z.number().int().positive(), type: transactionType, category: z.string().trim().min(1).max(60), description: z.string().trim().min(1).max(120), amount: z.number().positive().finite(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const zelle = zelleClassification(args.description);
      const result = await ctx.db<typeof schema>().insert(schema.transactions).values({ accountId: args.account_id, type: zelle?.type ?? args.type, category: zelle?.category ?? args.category, description: args.description, amount: args.amount, date: args.date }).returning({ id: schema.transactions.id });
      const inserted = result[0];
      if (!inserted) throw new Error("Transaction could not be created");
      ctx.invalidateQueries();
      return { id: inserted.id };
    },
  }),

  normalizeZelleTransactions: defineAction({
    request: z.object({}),
    response: z.object({ updated: z.number() }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const fromPredicate = sql`lower(${schema.transactions.description}) like '%zelle payment from%'`;
      const toPredicate = sql`lower(${schema.transactions.description}) like '%zelle payment to%'`;
      const [fromRows, toRows] = await Promise.all([
        db.select({ id: schema.transactions.id }).from(schema.transactions).where(fromPredicate),
        db.select({ id: schema.transactions.id }).from(schema.transactions).where(toPredicate),
      ]);
      if (fromRows.length > 0) await db.update(schema.transactions).set({ type: "income", category: "INCOME" }).where(fromPredicate);
      if (toRows.length > 0) await db.update(schema.transactions).set({ type: "expense", category: "OTHER" }).where(toPredicate);
      const updated = fromRows.length + toRows.length;
      if (updated > 0) ctx.invalidateQueries();
      return { updated };
    },
  }),

  deleteTransaction: defineAction({
    request: z.object({ id: z.number().int().positive() }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      await ctx.db<typeof schema>().delete(schema.transactions).where(eq(schema.transactions.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  addHolding: defineAction({
    request: z.object({ account_id: z.number().int().positive(), symbol: z.string().trim().min(1).max(16), name: z.string().trim().min(1).max(100), quantity: z.number().positive().finite(), avg_cost: z.number().nonnegative().finite(), current_price: z.number().nonnegative().finite(), day_gain_amount: z.number().finite().nullable().optional(), day_gain_pct: z.number().finite().nullable().optional() }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const result = await ctx.db<typeof schema>().insert(schema.holdings).values({ accountId: args.account_id, symbol: args.symbol.toUpperCase(), name: args.name, quantity: args.quantity, avgCost: args.avg_cost, currentPrice: args.current_price, dayGainAmount: args.day_gain_amount ?? null, dayGainPct: args.day_gain_pct ?? null }).returning({ id: schema.holdings.id });
      const inserted = result[0];
      if (!inserted) throw new Error("Holding could not be created");
      ctx.invalidateQueries();
      return { id: inserted.id };
    },
  }),

  updateHolding: defineAction({
    request: z.object({ id: z.number().int().positive(), quantity: z.number().positive().finite(), avg_cost: z.number().nonnegative().finite(), current_price: z.number().nonnegative().finite(), day_gain_amount: z.number().finite().nullable().optional(), day_gain_pct: z.number().finite().nullable().optional() }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      await ctx.db<typeof schema>().update(schema.holdings).set({ quantity: args.quantity, avgCost: args.avg_cost, currentPrice: args.current_price, ...(args.day_gain_amount !== undefined ? { dayGainAmount: args.day_gain_amount } : {}), ...(args.day_gain_pct !== undefined ? { dayGainPct: args.day_gain_pct } : {}), updatedAt: new Date() }).where(eq(schema.holdings.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  deleteHolding: defineAction({
    request: z.object({ id: z.number().int().positive() }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      await ctx.db<typeof schema>().delete(schema.holdings).where(eq(schema.holdings.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  syncCreditCardsFromAccounts: defineAction({
    request: z.object({}),
    response: z.object({ created: z.number() }),
    async handler(ctx) {
      const created = await ensureCreditCardsFromAccounts(ctx);
      if (created > 0) ctx.invalidateQueries();
      return { created };
    },
  }),

  addCreditCard: defineAction({
    request: z.object({ name: z.string().trim().min(1).max(80), issuer: z.string().trim().min(1).max(80), annual_fee: z.number().nonnegative().finite(), renewal_month: z.number().int().min(1).max(12).nullable(), points_balance: z.number().nonnegative().finite(), notes: z.string().trim().max(300).nullable() }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const rows = await ctx.db<typeof schema>().insert(schema.creditCards).values({ name: args.name, issuer: args.issuer, annualFee: args.annual_fee, renewalMonth: args.renewal_month, pointsBalance: args.points_balance, notes: args.notes }).returning({ id: schema.creditCards.id });
      const inserted = rows[0];
      if (!inserted) throw new Error("Card could not be created");
      ctx.invalidateQueries();
      return { id: inserted.id };
    },
  }),

  updateCreditCard: defineAction({
    request: z.object({ id: z.number().int().positive(), name: z.string().trim().min(1).max(80), issuer: z.string().trim().min(1).max(80), annual_fee: z.number().nonnegative().finite(), renewal_month: z.number().int().min(1).max(12).nullable(), points_balance: z.number().nonnegative().finite(), notes: z.string().trim().max(300).nullable() }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      await ctx.db<typeof schema>().update(schema.creditCards).set({ name: args.name, issuer: args.issuer, annualFee: args.annual_fee, renewalMonth: args.renewal_month, pointsBalance: args.points_balance, notes: args.notes }).where(eq(schema.creditCards.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  addCardBenefit: defineAction({
    request: z.object({ card_id: z.number().int().positive(), name: z.string().trim().min(1).max(100), expected_value: z.number().nonnegative().finite(), actual_value: z.number().nonnegative().finite(), reset_period: resetPeriod, notes: z.string().trim().max(300).nullable() }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const rows = await ctx.db<typeof schema>().insert(schema.cardBenefits).values({ cardId: args.card_id, name: args.name, expectedValue: args.expected_value, actualValue: args.actual_value, resetPeriod: args.reset_period, notes: args.notes }).returning({ id: schema.cardBenefits.id });
      const inserted = rows[0];
      if (!inserted) throw new Error("Benefit could not be created");
      ctx.invalidateQueries();
      return { id: inserted.id };
    },
  }),

  updateCardBenefit: defineAction({
    request: z.object({ id: z.number().int().positive(), expected_value: z.number().nonnegative().finite(), actual_value: z.number().nonnegative().finite(), notes: z.string().trim().max(300).nullable() }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      await ctx.db<typeof schema>().update(schema.cardBenefits).set({ expectedValue: args.expected_value, actualValue: args.actual_value, notes: args.notes, updatedAt: new Date() }).where(eq(schema.cardBenefits.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),

  addFinancialGoal: defineAction({
    request: z.object({ title: z.string().trim().min(1).max(100), category: goalCategory, target_amount: z.number().positive().finite(), current_amount: z.number().nonnegative().finite(), target_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), status: goalStatus, notes: z.string().trim().max(400).nullable() }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const rows = await ctx.db<typeof schema>().insert(schema.financialGoals).values({ title: args.title, category: args.category, targetAmount: args.target_amount, currentAmount: args.current_amount, targetDate: args.target_date, status: args.status, notes: args.notes }).returning({ id: schema.financialGoals.id });
      const inserted = rows[0];
      if (!inserted) throw new Error("Goal could not be created");
      ctx.invalidateQueries();
      return { id: inserted.id };
    },
  }),

  updateFinancialGoal: defineAction({
    request: z.object({ id: z.number().int().positive(), current_amount: z.number().nonnegative().finite(), status: goalStatus, notes: z.string().trim().max(400).nullable() }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      await ctx.db<typeof schema>().update(schema.financialGoals).set({ currentAmount: args.current_amount, status: args.status, notes: args.notes, updatedAt: new Date() }).where(eq(schema.financialGoals.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),
} satisfies ActionsModule;
