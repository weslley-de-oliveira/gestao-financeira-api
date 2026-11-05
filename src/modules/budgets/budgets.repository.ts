import { and, asc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type { Database } from '../../db/client.ts';
import { isUniqueViolation } from '../../db/errors.ts';
import { alphabetical } from '../../db/order.ts';
import {
  budgetLimits,
  budgets,
  categories,
  transactions,
  type Budget,
  type NewBudget,
} from '../../db/schema/index.ts';
import type { BudgetLimitPeriod } from './budget-rules.ts';

/** Orçamento com as vigências do limite, em ordem crescente de mês (nunca vazia). */
export type BudgetWithLimits = Budget & { limits: BudgetLimitPeriod[] };

export interface BudgetsRepository {
  /** Orçamentos do usuário, com as vigências, em ordem alfabética do nome da categoria. */
  listBudgets(userId: string): Promise<BudgetWithLimits[]>;
  /**
   * Despesas do usuário no período, somadas por categoria: realizadas (`spent`) e pendentes
   * (`pending`). Compras no cartão entram pela data da compra. Mesma regra de `budgetProgress`.
   */
  spendingByCategory(
    userId: string,
    categoryIds: readonly string[],
    range: { start: string; end: string },
  ): Promise<Map<string, { spent: number; pending: number }>>;
  /** Orçamento pelo id, só se for do usuário: o de outro usuário é tratado como inexistente. */
  findBudget(userId: string, budgetId: string): Promise<BudgetWithLimits | null>;
  /**
   * Cria o orçamento com a primeira vigência, na mesma transação. Devolve `null` se a categoria
   * já tiver orçamento (a constraint resolve dois cadastros simultâneos).
   */
  insertBudget(budget: NewBudget, limit: BudgetLimitPeriod): Promise<BudgetWithLimits | null>;
  /**
   * Altera o orçamento do usuário, numa transação: o alerta e, se informadas, as vigências a
   * partir de `limitsFrom.month` (as anteriores ficam como estão). `null` se não encontrar.
   */
  updateBudget(
    userId: string,
    budgetId: string,
    changes: {
      alertThreshold?: number | undefined;
      limitsFrom?: { month: string; limits: BudgetLimitPeriod[] } | undefined;
    },
  ): Promise<BudgetWithLimits | null>;
}

export function createBudgetsRepository(db: Database): BudgetsRepository {
  async function limitsOf(budgetId: string): Promise<BudgetLimitPeriod[]> {
    return db
      .select({ month: budgetLimits.month, amount: budgetLimits.amount })
      .from(budgetLimits)
      .where(eq(budgetLimits.budgetId, budgetId))
      .orderBy(asc(budgetLimits.month));
  }

  return {
    async listBudgets(userId) {
      const rows = await db
        .select({ budget: budgets })
        .from(budgets)
        .innerJoin(categories, eq(categories.id, budgets.categoryId))
        .where(eq(budgets.userId, userId))
        .orderBy(alphabetical(categories.name), asc(budgets.id));
      if (rows.length === 0) {
        return [];
      }
      const limits = await db
        .select()
        .from(budgetLimits)
        .where(
          inArray(
            budgetLimits.budgetId,
            rows.map(({ budget }) => budget.id),
          ),
        )
        .orderBy(asc(budgetLimits.month));
      return rows.map(({ budget }) => ({
        ...budget,
        limits: limits
          .filter((limit) => limit.budgetId === budget.id)
          .map(({ month, amount }) => ({ month, amount })),
      }));
    },

    async spendingByCategory(userId, categoryIds, { start, end }) {
      if (categoryIds.length === 0) {
        return new Map();
      }
      const rows = await db
        .select({
          categoryId: transactions.categoryId,
          spent: sql<string>`coalesce(sum(${transactions.amount}) filter (where ${transactions.status} = 'completed'), 0)`,
          pending: sql<string>`coalesce(sum(${transactions.amount}) filter (where ${transactions.status} = 'pending'), 0)`,
        })
        .from(transactions)
        .where(
          and(
            eq(transactions.userId, userId),
            eq(transactions.type, 'expense'),
            inArray(transactions.categoryId, [...categoryIds]),
            gte(transactions.date, start),
            lte(transactions.date, end),
          ),
        )
        .groupBy(transactions.categoryId);
      // `sum` de bigint vem como texto (numeric); os valores cabem com folga em um `number`.
      return new Map(
        rows.map((row) => [
          row.categoryId ?? '',
          { spent: Number(row.spent), pending: Number(row.pending) },
        ]),
      );
    },

    async findBudget(userId, budgetId) {
      const [budget] = await db
        .select()
        .from(budgets)
        .where(and(eq(budgets.id, budgetId), eq(budgets.userId, userId)));
      return budget ? { ...budget, limits: await limitsOf(budget.id) } : null;
    },

    async insertBudget(budget, limit) {
      try {
        return await db.transaction(async (tx) => {
          const [created] = await tx.insert(budgets).values(budget).returning();
          if (!created) throw new Error('O orçamento não foi inserido.');
          await tx.insert(budgetLimits).values({ budgetId: created.id, ...limit });
          return { ...created, limits: [limit] };
        });
      } catch (error) {
        if (isUniqueViolation(error, 'budgets_user_category_unique')) {
          return null;
        }
        throw error;
      }
    },

    async updateBudget(userId, budgetId, { alertThreshold, limitsFrom }) {
      const updated = await db.transaction(async (tx) => {
        const [budget] = await tx
          .update(budgets)
          .set({ ...(alertThreshold !== undefined && { alertThreshold }), updatedAt: new Date() })
          .where(and(eq(budgets.id, budgetId), eq(budgets.userId, userId)))
          .returning();
        if (!budget || !limitsFrom) {
          return budget;
        }
        await tx
          .delete(budgetLimits)
          .where(
            and(eq(budgetLimits.budgetId, budgetId), gte(budgetLimits.month, limitsFrom.month)),
          );
        const replaced = limitsFrom.limits.filter((limit) => limit.month >= limitsFrom.month);
        if (replaced.length > 0) {
          await tx.insert(budgetLimits).values(replaced.map((limit) => ({ budgetId, ...limit })));
        }
        return budget;
      });
      return updated ? { ...updated, limits: await limitsOf(updated.id) } : null;
    },
  };
}
