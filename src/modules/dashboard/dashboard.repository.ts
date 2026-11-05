import { and, asc, eq, gte, lte } from 'drizzle-orm';
import type { Database } from '../../db/client.ts';
import { transactions, type Transaction } from '../../db/schema/index.ts';

export interface DashboardRepository {
  /** Transações do usuário no período (inclusive), da mais antiga para a mais recente. */
  periodTransactions(userId: string, range: { from: string; to: string }): Promise<Transaction[]>;
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
  };
}
