import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../../../test/helpers/app.ts';
import { createAccount, signUp, type TestUser } from '../../../test/helpers/users.ts';
import { transactions } from '../../db/schema/index.ts';
import type { CategoryDto } from '../categories/categories.schemas.ts';
import type { TransactionDto } from '../transactions/transactions.schemas.ts';
import { calculateCardUsage } from './card-usage.ts';
import type { CreditCardDto } from './credit-cards.schemas.ts';

// O mesmo cenário de `card-usage.spec.ts` do front, agora pela API: cartão com fechamento no dia 5
// e vencimento no dia 12, hoje é 15/11/2026.
describe('limite usado, disponível e próxima fatura', () => {
  let app: FastifyInstance;
  let user: TestUser;
  let account: { id: string };
  let card: CreditCardDto;
  let otherCard: CreditCardDto;
  let food: CategoryDto;

  beforeAll(async () => {
    app = await createTestApp({ today: '2026-11-15' });
    user = await signUp(app);
    account = await createAccount(user);
    card = await createCard('Roxinho', 100_000);
    otherCard = await createCard('Outro', 100_000);
    food = (await user.api('GET', '/v1/categories?type=expense'))
      .json<CategoryDto[]>()
      .find((category) => category.name === 'Alimentação')!;

    const purchase = (creditCardId: string, amount: number, date: string) =>
      user.api('POST', '/v1/transactions', {
        type: 'expense',
        description: 'Compra',
        amount,
        date,
        creditCardId,
        categoryId: food.id,
      });
    await purchase(card.id, 20_000, '2026-10-20');
    await purchase(card.id, 15_050, '2026-11-04');
    await purchase(card.id, 9_990, '2026-11-05');
    await purchase(otherCard.id, 50_000, '2026-11-01');
    // Despesa na conta: não usa limite de cartão nenhum.
    await user.api('POST', '/v1/transactions', {
      type: 'expense',
      description: 'Na conta',
      amount: 70_000,
      date: '2026-11-01',
      accountId: account.id,
      categoryId: food.id,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  async function createCard(name: string, creditLimit: number): Promise<CreditCardDto> {
    const response = await user.api('POST', '/v1/credit-cards', {
      name,
      brand: 'mastercard',
      lastFourDigits: '4321',
      creditLimit,
      closingDay: 5,
      dueDay: 12,
      paymentAccountId: account.id,
      color: '#6a1b9a',
    });
    return response.json<CreditCardDto>();
  }

  const usageOf = async (id: string, api = user.api) =>
    (await api('GET', `/v1/credit-cards/${id}`)).json<CreditCardDto>();

  it('compromete o limite com todas as compras do cartão', async () => {
    expect(await usageOf(card.id)).toMatchObject({ usedLimit: 45_040, availableLimit: 54_960 });
  });

  it('a próxima fatura é a aberta hoje, com as compras já lançadas nela', async () => {
    // Em 15/11 a aberta é a que fecha em 05/12 (compras de 05/11 a 04/12).
    expect((await usageOf(card.id)).nextInvoice).toEqual({
      referenceMonth: '2026-12',
      start: '2026-11-05',
      end: '2026-12-04',
      closingDate: '2026-12-05',
      dueDate: '2026-12-12',
      amount: 9_990,
    });
  });

  it('em outro dia, a próxima fatura é outra', async () => {
    // Mesmo banco, outro "hoje": em 04/11 a aberta ainda é a que fecha em 05/11.
    const earlier = await createTestApp({ today: '2026-11-04' });
    try {
      const response = await earlier.inject({
        method: 'GET',
        url: `/v1/credit-cards/${card.id}`,
        cookies: user.cookies,
      });

      expect(response.json<CreditCardDto>().nextInvoice).toMatchObject({
        closingDate: '2026-11-05',
        dueDate: '2026-11-12',
        amount: 35_050,
      });
    } finally {
      await earlier.close();
    }
  });

  it('libera o limite com as faturas pagas do cartão', async () => {
    // Pagamento gravado direto no banco: a rota de pagamento vem nos próximos passos.
    await app.db.insert(transactions).values({
      userId: user.userId,
      type: 'invoice-payment',
      description: 'Fatura 11/2026',
      amount: 35_050,
      date: '2026-11-10',
      accountId: account.id,
      creditCardId: card.id,
      invoiceMonth: '2026-11',
    });

    expect(await usageOf(card.id)).toMatchObject({ usedLimit: 9_990, availableLimit: 90_010 });
    expect(await usageOf(otherCard.id)).toMatchObject({ usedLimit: 50_000 });
  });

  it('fica negativo quando o limite é ultrapassado', async () => {
    await user.api('PATCH', `/v1/credit-cards/${otherCard.id}`, { creditLimit: 40_000 });

    expect(await usageOf(otherCard.id)).toMatchObject({ availableLimit: -10_000 });
  });

  it('aparece na listagem e bate com a regra do front (calculateCardUsage)', async () => {
    const cards = (await user.api('GET', '/v1/credit-cards')).json<CreditCardDto[]>();
    const movements = (await user.api('GET', '/v1/transactions?limit=100')).json<{
      items: TransactionDto[];
    }>().items;

    expect(cards).toHaveLength(2);
    for (const listed of cards) {
      const { usedLimit, availableLimit, nextInvoice } = listed;
      expect({ usedLimit, availableLimit, nextInvoice }).toEqual(
        calculateCardUsage(listed, movements, '2026-11-15'),
      );
    }
  });
});
