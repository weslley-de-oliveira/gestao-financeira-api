import type { Database } from '../../src/db/client.ts';
import { creditCards, type CreditCard, type NewCreditCard } from '../../src/db/schema/index.ts';

/**
 * Cartão gravado direto no banco, para testes que precisam de um cartão válido sem passar pelas
 * rotas (ex.: compras e pagamentos inseridos como cenário).
 */
export async function insertCreditCard(
  db: Database,
  owner: { userId: string; paymentAccountId: string },
  overrides: Partial<NewCreditCard> = {},
): Promise<CreditCard> {
  const [card] = await db
    .insert(creditCards)
    .values({
      ...owner,
      name: 'Cartão de teste',
      brand: 'visa',
      lastFourDigits: '1234',
      creditLimit: 500_000,
      closingDay: 5,
      dueDay: 12,
      color: '#6a1b9a',
      ...overrides,
    })
    .returning();
  if (!card) throw new Error('cartão não inserido');
  return card;
}
