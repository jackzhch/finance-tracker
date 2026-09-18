import { defineAction, z, type ActionsModule, type Ctx } from "@hatch/space-sdk";
import { asc, desc, eq } from "drizzle-orm";
import * as schema from "./schema";

const accountType = z.enum(["checking", "savings", "investment", "retirement", "credit", "other"]);
const transactionType = z.enum(["income", "expense"]);
const okResponse = z.object({ ok: z.literal(true) });
const syncStatusValue = z.enum(["idle", "syncing", "success", "error"]);

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

async function captureSnapshot(ctx: Ctx) {
  const db = ctx.db<typeof schema>();
  const accounts = await db.select().from(schema.accounts);
  const totalAssets = accounts
    .filter((account) => account.type !== "credit")
    .reduce((sum, account) => sum + account.balance, 0);
  const brokerageAssets = accounts
    .filter((account) => account.type === "investment")
    .reduce((sum, account) => sum + account.balance, 0);
  const retirementAssets = accounts
    .filter((account) => account.type === "retirement")
    .reduce((sum, account) => sum + account.balance, 0);
  const totalInvestments = brokerageAssets + retirementAssets;
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

Use the finance-tracker artifact actions to save data. Call getDashboard first. Prefer the mapping in ~/workspace/finance-tracker-sync/account-map.json from plaid account id to tracker account id. If the file or a mapping is missing, match an existing tracker account by institution plus the masked final four digits in its name. Only call addAccount when no real match exists; never duplicate or delete an account. Names visible in the tracker must contain only the institution and masked final four digits, never a full account number, Plaid id, credential id, token, or cursor. Use updateAccountBalance for balances; credit-card current debt is stored as a positive balance. For holdings, match by tracker account and security/symbol, then call updateHolding or addHolding. Keep symbols at 16 characters or fewer with a clear abbreviation when needed. Add only new posted bank and credit transactions with addTransaction, deduplicating against getDashboard by account, date, amount, description, and type; skip pending transactions. Use the closest existing Chinese category.

After all writes succeed, update ~/workspace/finance-tracker-sync/account-map.json and ~/workspace/finance-tracker-sync/watermark.json with the mapping, latest cursors, and synced_at. Finally call syncComplete with status success and a short Chinese message. If anything prevents a trustworthy sync, do not invent or partially overwrite values; call syncComplete with status error and a short readable Chinese explanation. Do not expose any full account number, token, credential id, internal account id, or cursor in the callback message.`;

export const Actions = {
  getDashboard: defineAction({
    request: z.object({}),
    response: z.object({
      accounts: z.array(accountResponse),
      transactions: z.array(transactionResponse),
      holdings: z.array(holdingResponse),
      snapshots: z.array(snapshotResponse),
    }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const [accounts, transactions, holdings, snapshots] = await Promise.all([
        db.select().from(schema.accounts).orderBy(asc(schema.accounts.institution), asc(schema.accounts.name)),
        db.select().from(schema.transactions).orderBy(desc(schema.transactions.date), desc(schema.transactions.id)),
        db.select().from(schema.holdings).orderBy(asc(schema.holdings.symbol)),
        db.select().from(schema.balanceSnapshots).orderBy(asc(schema.balanceSnapshots.capturedAt)),
      ]);
      return {
        accounts: accounts.map((row) => ({ id: row.id, name: row.name, institution: row.institution, type: row.type, balance: row.balance })),
        transactions: transactions.map((row) => ({ id: row.id, account_id: row.accountId, type: row.type, category: row.category, description: row.description, amount: row.amount, date: row.date })),
        holdings: holdings.map((row) => ({ id: row.id, account_id: row.accountId, symbol: row.symbol, name: row.name, quantity: row.quantity, avg_cost: row.avgCost, current_price: row.currentPrice })),
        snapshots: snapshots.map((row) => ({ id: row.id, captured_at: row.capturedAt.toISOString(), total_assets: row.totalAssets, total_investments: row.totalInvestments, cash_assets: row.cashAssets, brokerage_assets: row.brokerageAssets, retirement_assets: row.retirementAssets })),
      };
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
      const result = await ctx.db<typeof schema>().insert(schema.transactions).values({ accountId: args.account_id, type: args.type, category: args.category, description: args.description, amount: args.amount, date: args.date }).returning({ id: schema.transactions.id });
      const inserted = result[0];
      if (!inserted) throw new Error("Transaction could not be created");
      ctx.invalidateQueries();
      return { id: inserted.id };
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
    request: z.object({ account_id: z.number().int().positive(), symbol: z.string().trim().min(1).max(16), name: z.string().trim().min(1).max(100), quantity: z.number().positive().finite(), avg_cost: z.number().nonnegative().finite(), current_price: z.number().nonnegative().finite() }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const result = await ctx.db<typeof schema>().insert(schema.holdings).values({ accountId: args.account_id, symbol: args.symbol.toUpperCase(), name: args.name, quantity: args.quantity, avgCost: args.avg_cost, currentPrice: args.current_price }).returning({ id: schema.holdings.id });
      const inserted = result[0];
      if (!inserted) throw new Error("Holding could not be created");
      ctx.invalidateQueries();
      return { id: inserted.id };
    },
  }),

  updateHolding: defineAction({
    request: z.object({ id: z.number().int().positive(), quantity: z.number().positive().finite(), avg_cost: z.number().nonnegative().finite(), current_price: z.number().nonnegative().finite() }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      await ctx.db<typeof schema>().update(schema.holdings).set({ quantity: args.quantity, avgCost: args.avg_cost, currentPrice: args.current_price, updatedAt: new Date() }).where(eq(schema.holdings.id, args.id));
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
} satisfies ActionsModule;
