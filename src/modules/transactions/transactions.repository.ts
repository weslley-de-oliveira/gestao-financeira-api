import { and, eq } from 'drizzle-orm';
import type { Database } from '../../db/client.ts';
import { transactions, type NewTransaction, type Transaction } from '../../db/schema/index.ts';

/** Campos que a edição regrava: nunca o dono, o id ou as datas de criação. */
export type TransactionChanges = Omit<NewTransaction, 'id' | 'userId' | 'createdAt' | 'updatedAt'>;

export interface TransactionsRepository {
  /** Transação pelo id, só se for do usuário: a de outro usuário é tratada como inexistente. */
  findTransaction(userId: string, transactionId: string): Promise<Transaction | null>;
  insertTransaction(transaction: NewTransaction): Promise<Transaction>;
  /** Regrava a transação só se for do usuário; devolve `null` se não encontrar. */
  updateTransaction(
    userId: string,
    transactionId: string,
    changes: TransactionChanges,
  ): Promise<Transaction | null>;
  /** Apaga a transação só se for do usuário; devolve se apagou. */
  deleteTransaction(userId: string, transactionId: string): Promise<boolean>;
}

export function createTransactionsRepository(db: Database): TransactionsRepository {
  const ownedBy = (userId: string, transactionId: string) =>
    and(eq(transactions.id, transactionId), eq(transactions.userId, userId));

  return {
    async findTransaction(userId, transactionId) {
      const [transaction] = await db
        .select()
        .from(transactions)
        .where(ownedBy(userId, transactionId));
      return transaction ?? null;
    },

    async insertTransaction(transaction) {
      const [created] = await db.insert(transactions).values(transaction).returning();
      if (!created) throw new Error('A transação não foi inserida.');
      return created;
    },

    async updateTransaction(userId, transactionId, changes) {
      const [updated] = await db
        .update(transactions)
        .set(changes)
        .where(ownedBy(userId, transactionId))
        .returning();
      return updated ?? null;
    },

    async deleteTransaction(userId, transactionId) {
      const deleted = await db
        .delete(transactions)
        .where(ownedBy(userId, transactionId))
        .returning({ id: transactions.id });
      return deleted.length > 0;
    },
  };
}
