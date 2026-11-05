import type { Database } from '../../db/client.ts';
import { transactions, type NewTransaction, type Transaction } from '../../db/schema/index.ts';

export interface TransactionsRepository {
  insertTransaction(transaction: NewTransaction): Promise<Transaction>;
}

export function createTransactionsRepository(db: Database): TransactionsRepository {
  return {
    async insertTransaction(transaction) {
      const [created] = await db.insert(transactions).values(transaction).returning();
      if (!created) throw new Error('A transação não foi inserida.');
      return created;
    },
  };
}
