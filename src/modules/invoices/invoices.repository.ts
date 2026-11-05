import { and, eq, inArray } from 'drizzle-orm';
import type { Database } from '../../db/client.ts';
import { isUniqueViolation } from '../../db/errors.ts';
import { transactions, type NewTransaction, type Transaction } from '../../db/schema/index.ts';

export interface InvoicesRepository {
  /** Compras e pagamentos de fatura de um cartão do usuário: tudo o que forma as faturas. */
  listCardMovements(userId: string, creditCardId: string): Promise<Transaction[]>;
  /**
   * Grava o pagamento da fatura. Devolve `null` se a fatura (cartão e mês) já tiver pagamento: o
   * índice único resolve dois pagamentos simultâneos.
   */
  insertPayment(payment: NewTransaction): Promise<Transaction | null>;
  /** Apaga o pagamento da fatura (cartão e mês) do usuário; devolve se havia pagamento. */
  deletePayment(userId: string, creditCardId: string, referenceMonth: string): Promise<boolean>;
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

    async insertPayment(payment) {
      try {
        const [created] = await db.insert(transactions).values(payment).returning();
        return created ?? null;
      } catch (error) {
        if (isUniqueViolation(error, 'transactions_invoice_payment_unique')) {
          return null;
        }
        throw error;
      }
    },

    async deletePayment(userId, creditCardId, referenceMonth) {
      const deleted = await db
        .delete(transactions)
        .where(
          and(
            eq(transactions.userId, userId),
            eq(transactions.creditCardId, creditCardId),
            eq(transactions.type, 'invoice-payment'),
            eq(transactions.invoiceMonth, referenceMonth),
          ),
        )
        .returning({ id: transactions.id });
      return deleted.length > 0;
    },
  };
}
