import { and, asc, eq, gte, isNotNull, lte } from 'drizzle-orm';
import type { Database } from '../../db/client.ts';
import {
  goalContributions,
  goals,
  transactions,
  type GoalContribution,
  type Transaction,
} from '../../db/schema/index.ts';

export interface DashboardRepository {
  /** Transações do usuário no período (inclusive), da mais antiga para a mais recente. */
  periodTransactions(userId: string, range: { from: string; to: string }): Promise<Transaction[]>;
  /** Movimentações de metas com conta no período (inclusive): mexem no saldo das contas. */
  periodGoalContributions(
    userId: string,
    range: { from: string; to: string },
  ): Promise<GoalContribution[]>;
}

export function createDashboardRepository(db: Database): DashboardRepository {
  return {
    async periodTransactions(userId, { from, to }) {
      return db
        .select()
        .from(transactions)
        .where(
          and(
            eq(transactions.userId, userId),
            gte(transactions.date, from),
            lte(transactions.date, to),
          ),
        )
        .orderBy(asc(transactions.date), asc(transactions.id));
    },

    async periodGoalContributions(userId, { from, to }) {
      const rows = await db
        .select({ contribution: goalContributions })
        .from(goalContributions)
        .innerJoin(goals, eq(goals.id, goalContributions.goalId))
        .where(
          and(
            eq(goals.userId, userId),
            isNotNull(goalContributions.accountId),
            gte(goalContributions.date, from),
            lte(goalContributions.date, to),
          ),
        )
        .orderBy(asc(goalContributions.date), asc(goalContributions.id));
      return rows.map((row) => row.contribution);
    },
  };
}
