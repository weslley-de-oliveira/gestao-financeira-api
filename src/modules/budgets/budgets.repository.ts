import { and, asc, eq, gte } from 'drizzle-orm';
import type { Database } from '../../db/client.ts';
import { isUniqueViolation } from '../../db/errors.ts';
import { budgetLimits, budgets, type Budget, type NewBudget } from '../../db/schema/index.ts';
import type { BudgetLimitPeriod } from './budget-rules.ts';

/** Orçamento com as vigências do limite, em ordem crescente de mês (nunca vazia). */
export type BudgetWithLimits = Budget & { limits: BudgetLimitPeriod[] };

export interface BudgetsRepository {
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
