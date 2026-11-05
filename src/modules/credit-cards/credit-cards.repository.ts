import { and, asc, eq } from 'drizzle-orm';
import type { Database } from '../../db/client.ts';
import { alphabetical } from '../../db/order.ts';
import { creditCards, type CreditCard, type NewCreditCard } from '../../db/schema/index.ts';

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
  };
}
