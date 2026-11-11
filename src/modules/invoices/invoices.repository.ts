import { and, eq, inArray } from 'drizzle-orm';
import type { Database } from '../../db/client.ts';
import {
  creditCards,
  transactions,
  type NewTransaction,
  type Transaction,
} from '../../db/schema/index.ts';

/** Cartão travado para gravar pagamentos: as movimentações lidas valem até o fim da transação. */
export interface LockedCard {
  /** Compras, estornos e pagamentos de fatura do cartão, lidos com o cartão travado. */
  movements: Transaction[];
  insertPayment: (payment: NewTransaction) => Promise<Transaction>;
  deletePayment: (paymentId: string) => Promise<void>;
}

export interface InvoicesRepository {
  /** Compras, estornos e pagamentos de fatura de um cartão do usuário: tudo o que forma as faturas. */
  listCardMovements(userId: string, creditCardId: string): Promise<Transaction[]>;
  /**
   * Trava o cartão do usuário (`select … for update`) e roda `run` numa transação. Dois pagamentos
   * do mesmo cartão ao mesmo tempo esperam a vez: o segundo já lê o primeiro e não paga além do
   * saldo.
   */
  withLockedCard<T>(
    userId: string,
    creditCardId: string,
    run: (card: LockedCard) => Promise<T>,
  ): Promise<T>;
}

type Executor = Database | Parameters<Parameters<Database['transaction']>[0]>[0];

function cardMovements(executor: Executor, userId: string, creditCardId: string) {
  return executor
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        eq(transactions.creditCardId, creditCardId),
        inArray(transactions.type, ['expense', 'refund', 'invoice-payment']),
      ),
    );
}

export function createInvoicesRepository(db: Database): InvoicesRepository {
  return {
    async listCardMovements(userId, creditCardId) {
      return cardMovements(db, userId, creditCardId);
    },

    async withLockedCard(userId, creditCardId, run) {
      return db.transaction(async (tx) => {
        await tx
          .select({ id: creditCards.id })
          .from(creditCards)
          .where(and(eq(creditCards.id, creditCardId), eq(creditCards.userId, userId)))
          .for('update');
        return run({
          movements: await cardMovements(tx, userId, creditCardId),
          async insertPayment(payment) {
            const [created] = await tx.insert(transactions).values(payment).returning();
            if (!created) {
              throw new Error('Invoice payment was not inserted');
            }
            return created;
          },
          async deletePayment(paymentId) {
            await tx
              .delete(transactions)
              .where(
                and(
                  eq(transactions.id, paymentId),
                  eq(transactions.userId, userId),
                  eq(transactions.type, 'invoice-payment'),
                ),
              );
          },
        });
      });
    },
  };
}
