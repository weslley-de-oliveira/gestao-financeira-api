import { and, eq, inArray } from 'drizzle-orm';
import type { Database } from '../../db/client.ts';
import { transactions, type Transaction } from '../../db/schema/index.ts';

export interface InvoicesRepository {
  /** Compras e pagamentos de fatura de um cartão do usuário: tudo o que forma as faturas. */
  listCardMovements(userId: string, creditCardId: string): Promise<Transaction[]>;
}

export function createInvoicesRepository(db: Database): InvoicesRepository {
  return {
    async listCardMovements(userId, creditCardId) {
      return db
        .select()
        .from(transactions)
        .where(
          and(
            eq(transactions.userId, userId),
            eq(transactions.creditCardId, creditCardId),
            inArray(transactions.type, ['expense', 'invoice-payment']),
          ),
        );
    },
  };
}
