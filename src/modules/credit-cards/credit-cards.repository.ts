import { and, asc, eq, sql } from 'drizzle-orm';
import type { Database } from '../../db/client.ts';
import { alphabetical } from '../../db/order.ts';
import {
  creditCards,
  transactions,
  type CreditCard,
  type NewCreditCard,
} from '../../db/schema/index.ts';

/** Campos que o usuário pode alterar: nunca o dono, o id ou as datas. */
export type CreditCardChanges = Partial<
  Omit<NewCreditCard, 'id' | 'userId' | 'createdAt' | 'updatedAt'>
>;

export interface CreditCardsRepository {
  /** Cartões do usuário em ordem alfabética (sem diferenciar maiúsculas e acentos). */
  listCreditCards(userId: string, options: { includeArchived: boolean }): Promise<CreditCard[]>;
  /** Cartão pelo id, só se for do usuário: o de outro usuário é tratado como inexistente. */
  findCreditCard(userId: string, creditCardId: string): Promise<CreditCard | null>;
  insertCreditCard(card: NewCreditCard): Promise<CreditCard>;
  /** Altera o cartão só se for do usuário; devolve `null` se não encontrar. */
  updateCreditCard(
    userId: string,
    creditCardId: string,
    changes: CreditCardChanges,
  ): Promise<CreditCard | null>;
  /**
   * Totais de cada cartão para o uso do limite: todas as compras, todos os pagamentos de fatura e
   * as compras do ciclo informado (a fatura aberta). Mesma regra de `calculateCardUsage`.
   */
  usageTotals(userId: string, cycles: readonly CardCycle[]): Promise<Map<string, UsageTotals>>;
}

export interface CardCycle {
  creditCardId: string;
  start: string;
  end: string;
}

export interface UsageTotals {
  purchases: number;
  payments: number;
  cyclePurchases: number;
}

export function createCreditCardsRepository(db: Database): CreditCardsRepository {
  const ownedBy = (userId: string, creditCardId: string) =>
    and(eq(creditCards.id, creditCardId), eq(creditCards.userId, userId));

  return {
    async listCreditCards(userId, { includeArchived }) {
      return db
        .select()
        .from(creditCards)
        .where(
          and(
            eq(creditCards.userId, userId),
            includeArchived ? undefined : eq(creditCards.isArchived, false),
          ),
        )
        .orderBy(alphabetical(creditCards.name), asc(creditCards.id));
    },

    async findCreditCard(userId, creditCardId) {
      const [card] = await db.select().from(creditCards).where(ownedBy(userId, creditCardId));
      return card ?? null;
    },

    async insertCreditCard(card) {
      const [created] = await db.insert(creditCards).values(card).returning();
      if (!created) throw new Error('O cartão não foi inserido.');
      return created;
    },

    async updateCreditCard(userId, creditCardId, changes) {
      const [updated] = await db
        .update(creditCards)
        .set(changes)
        .where(ownedBy(userId, creditCardId))
        .returning();
      return updated ?? null;
    },

    async usageTotals(userId, cycles) {
      if (cycles.length === 0) {
        return new Map();
      }
      const values = sql.join(
        cycles.map(
          ({ creditCardId, start, end }) =>
            sql`(${creditCardId}::uuid, ${start}::date, ${end}::date)`,
        ),
        sql`, `,
      );
      const { rows } = await db.execute<{
        credit_card_id: string;
        purchases: string;
        payments: string;
        cycle_purchases: string;
      }>(sql`
        select cycles.credit_card_id,
          coalesce(sum(${transactions.amount}) filter (where ${transactions.type} = 'expense'), 0)
            as purchases,
          coalesce(sum(${transactions.amount})
            filter (where ${transactions.type} = 'invoice-payment'), 0) as payments,
          coalesce(sum(${transactions.amount}) filter (
            where ${transactions.type} = 'expense'
              and ${transactions.date} between cycles.start_date and cycles.end_date
          ), 0) as cycle_purchases
        from (values ${values}) as cycles (credit_card_id, start_date, end_date)
        left join ${transactions}
          on ${transactions.creditCardId} = cycles.credit_card_id
          and ${transactions.userId} = ${userId}
        group by cycles.credit_card_id
      `);
      // `sum` de bigint vem como texto (numeric); os valores cabem com folga em um `number`.
      return new Map(
        rows.map((row) => [
          row.credit_card_id,
          {
            purchases: Number(row.purchases),
            payments: Number(row.payments),
            cyclePurchases: Number(row.cycle_purchases),
          },
        ]),
      );
    },
  };
}
