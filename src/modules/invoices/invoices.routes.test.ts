import { randomUUIDv7 } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../../../test/helpers/app.ts';
import { createAccount, signUp, type TestUser } from '../../../test/helpers/users.ts';
import type { CategoryDto } from '../categories/categories.schemas.ts';
import type { CreditCardDto } from '../credit-cards/credit-cards.schemas.ts';
import type { InvoiceDto, InvoiceSummaryDto } from './invoices.schemas.ts';

// Cenário de `invoice-rules.spec.ts` do front: cartão com fechamento no dia 5 e vencimento no 12.
describe('faturas calculadas', () => {
  let app: FastifyInstance;
  let user: TestUser;
  let account: { id: string };
  let card: CreditCardDto;

  beforeAll(async () => {
    app = await createTestApp({ today: '2026-11-15' });
    user = await signUp(app);
    account = await createAccount(user);
    card = await createCard(user, account.id);
    const otherCard = await createCard(user, account.id);
    const food = (await user.api('GET', '/v1/categories?type=expense'))
      .json<CategoryDto[]>()
      .find((category) => category.name === 'Alimentação')!;

    const purchase = (description: string, amount: number, date: string, creditCardId = card.id) =>
      user.api('POST', '/v1/transactions', {
        type: 'expense',
        description,
        amount,
        date,
        creditCardId,
        categoryId: food.id,
      });
    await purchase('Sapato', 20_000, '2026-10-20');
    await purchase('Farmácia', 15_050, '2026-11-04');
    await purchase('Notebook', 9_990, '2026-11-05');
    await purchase('Outro cartão', 1_000, '2026-11-01', otherCard.id);
    await user.api('POST', '/v1/transactions', {
      type: 'expense',
      description: 'Na conta',
      amount: 1_000,
      date: '2026-11-10',
      accountId: account.id,
      categoryId: food.id,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  async function createCard(owner: TestUser, paymentAccountId: string): Promise<CreditCardDto> {
    const response = await owner.api('POST', '/v1/credit-cards', {
      name: 'Roxinho',
      brand: 'mastercard',
      lastFourDigits: '4321',
      creditLimit: 500_000,
      closingDay: 5,
      dueDay: 12,
      paymentAccountId,
      color: '#6a1b9a',
    });
    return response.json<CreditCardDto>();
  }

  /** Consulta com outro "hoje", no mesmo banco. */
  async function on<T>(today: string, url: string): Promise<T> {
    const other = await createTestApp({ today });
    try {
      return (await other.inject({ method: 'GET', url, cookies: user.cookies })).json<T>();
    } finally {
      await other.close();
    }
  }

  it('lista a aberta e as que têm compras, da mais recente para a mais antiga', async () => {
    const response = await user.api('GET', `/v1/credit-cards/${card.id}/invoices`);

    expect(response.statusCode).toBe(200);
    expect(
      response
        .json<InvoiceSummaryDto[]>()
        .map(({ referenceMonth, status, total, purchaseCount }) => [
          referenceMonth,
          status,
          total,
          purchaseCount,
        ]),
    ).toEqual([
      ['2026-12', 'open', 9_990, 1],
      ['2026-11', 'overdue', 35_050, 2],
    ]);
  });

  it('detalha a fatura com o ciclo, o total e as compras mais recentes primeiro', async () => {
    const response = await user.api('GET', `/v1/credit-cards/${card.id}/invoices/2026-11`);

    expect(response.statusCode).toBe(200);
    const invoice = response.json<InvoiceDto>();
    expect(invoice).toMatchObject({
      referenceMonth: '2026-11',
      start: '2026-10-05',
      end: '2026-11-04',
      closingDate: '2026-11-05',
      dueDate: '2026-11-12',
      creditCardId: card.id,
      total: 35_050,
      status: 'overdue',
      payment: null,
    });
    expect(invoice.purchases.map((purchase) => purchase.description)).toEqual([
      'Farmácia',
      'Sapato',
    ]);
  });

  it.each([
    ['2026-11-04', 'open'],
    ['2026-11-05', 'closed'],
    ['2026-11-12', 'closed'],
    ['2026-11-13', 'overdue'],
  ])('em %s a fatura de 11/2026 está %s', async (today, status) => {
    const invoice = await on<InvoiceDto>(today, `/v1/credit-cards/${card.id}/invoices/2026-11`);

    expect(invoice.status).toBe(status);
  });

  it('mês sem compras devolve a fatura vazia', async () => {
    const invoice = (
      await user.api('GET', `/v1/credit-cards/${card.id}/invoices/2027-03`)
    ).json<InvoiceDto>();

    expect(invoice).toMatchObject({ total: 0, purchases: [], status: 'open' });
  });

  it('cartão sem compras lista só a fatura aberta', async () => {
    const empty = await createCard(user, account.id);

    const invoices = (await user.api('GET', `/v1/credit-cards/${empty.id}/invoices`)).json<
      InvoiceSummaryDto[]
    >();

    expect(invoices.map(({ referenceMonth }) => referenceMonth)).toEqual(['2026-12']);
  });

  it('responde 404 igual para cartão de outro usuário e inexistente', async () => {
    const other = await signUp(app);

    for (const id of [card.id, randomUUIDv7()]) {
      for (const url of [
        `/v1/credit-cards/${id}/invoices`,
        `/v1/credit-cards/${id}/invoices/2026-11`,
      ]) {
        const response = await other.api('GET', url);

        expect(response.statusCode).toBe(404);
        expect(response.json()).toMatchObject({ detail: 'Cartão não encontrado.' });
      }
    }
  });

  it.each([['2026-13'], ['2026-1'], ['novembro']])('responde 422 para o mês %s', async (month) => {
    const response = await user.api('GET', `/v1/credit-cards/${card.id}/invoices/${month}`);

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      errors: [{ field: 'params.month', message: 'Informe o mês no formato aaaa-mm.' }],
    });
  });

  it('responde 401 sem sessão', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/credit-cards/${card.id}/invoices`,
    });

    expect(response.statusCode).toBe(401);
  });
});
