import { randomUUID, randomUUIDv7 } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp } from '../../../test/helpers/app.ts';
import { createAccount, signUp, type TestUser } from '../../../test/helpers/users.ts';
import type { CategoryDto } from '../categories/categories.schemas.ts';
import type { InstallmentPurchaseDto } from '../installments/installments.schemas.ts';
import type { TransactionDto } from './transactions.schemas.ts';

describe('estornos: /v1/transactions/{id}/refunds', () => {
  let app: FastifyInstance;

  // Hoje é 15/11/2026. O cartão fecha dia 5 e vence dia 12.
  beforeAll(async () => {
    app = await createTestApp({ today: '2026-11-15' });
  });

  afterAll(async () => {
    await app.close();
  });

  let user: TestUser;
  let accountId: string;
  let cardId: string;
  let food: CategoryDto;
  let salary: CategoryDto;

  beforeEach(async () => {
    user = await signUp(app);
    accountId = (await createAccount(user)).id;
    cardId = (
      await user.api('POST', '/v1/credit-cards', {
        name: 'Cartão principal',
        brand: 'visa',
        lastFourDigits: '1234',
        creditLimit: 500_000,
        closingDay: 5,
        dueDay: 12,
        paymentAccountId: accountId,
        color: '#6a1b9a',
      })
    ).json<{ id: string }>().id;
    const categories = (await user.api('GET', '/v1/categories')).json<CategoryDto[]>();
    food = categories.find((category) => category.name === 'Alimentação')!;
    salary = categories.find((category) => category.type === 'income')!;
  });

  async function expense(overrides: Record<string, unknown> = {}): Promise<TransactionDto> {
    const response = await user.api('POST', '/v1/transactions', {
      type: 'expense',
      description: 'Tênis',
      amount: 10_000,
      date: '2026-11-10',
      accountId,
      categoryId: food.id,
      ...overrides,
    });
    expect(response.statusCode).toBe(201);
    return response.json();
  }

  const refund = (
    id: string,
    body: Record<string, unknown>,
    headers: Record<string, string> = {},
  ) =>
    app.inject({
      method: 'POST',
      url: `/v1/transactions/${id}/refunds`,
      cookies: user.cookies,
      headers,
      payload: body,
    });

  it('estorna parte de uma despesa em conta, na conta e na categoria dela', async () => {
    const original = await expense();

    const response = await refund(original.id, { amount: 3_000, date: '2026-11-12' });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      type: 'refund',
      description: 'Estorno: Tênis',
      amount: 3_000,
      date: '2026-11-12',
      accountId,
      creditCardId: null,
      categoryId: null,
      status: 'completed',
      refundedTransactionId: original.id,
    });
  });

  it('aceita vários estornos até o valor da despesa, e lista todos', async () => {
    const original = await expense();
    await refund(original.id, { amount: 3_000, date: '2026-11-12' });
    await refund(original.id, { amount: 7_000, date: '2026-11-13', description: 'Devolução' });

    const more = await refund(original.id, { amount: 1, date: '2026-11-14' });
    const list = await user.api('GET', `/v1/transactions/${original.id}/refunds`);

    expect(more.statusCode).toBe(422);
    expect(more.json()).toMatchObject({
      errors: [{ field: 'body.amount', message: 'Esta despesa já foi estornada por inteiro.' }],
    });
    expect(list.json<TransactionDto[]>().map((item) => [item.description, item.amount])).toEqual([
      ['Estorno: Tênis', 3_000],
      ['Devolução', 7_000],
    ]);
  });

  it('recusa (422) mais do que falta estornar e data anterior à despesa', async () => {
    const original = await expense();
    await refund(original.id, { amount: 9_930, date: '2026-11-12' });

    const response = await refund(original.id, { amount: 100, date: '2026-11-01' });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      errors: [
        {
          field: 'body.amount',
          message: 'O estorno pode ser de no máximo R$ 0,70, o que falta estornar.',
        },
        { field: 'body.date', message: 'O estorno não pode ser anterior à despesa.' },
      ],
    });
  });

  it.each([
    ['receita', () => ({ type: 'income', categoryId: salary.id })],
    ['despesa pendente', () => ({ status: 'pending' })],
  ])('recusa (409) estornar %s', async (_case, overrides) => {
    const original = await expense(overrides());

    const response = await refund(original.id, { amount: 1_000, date: '2026-11-12' });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      detail: 'Só despesas realizadas podem ser estornadas.',
    });
  });

  it('recusa (409) estornar outro estorno', async () => {
    const original = await expense();
    const first = (
      await refund(original.id, { amount: 1_000, date: '2026-11-12' })
    ).json<TransactionDto>();

    expect((await refund(first.id, { amount: 100, date: '2026-11-12' })).statusCode).toBe(409);
  });

  it('estorna uma compra no cartão, no cartão, e recusa (409) numa fatura já paga', async () => {
    const purchase = await expense({
      accountId: undefined,
      creditCardId: cardId,
      date: '2026-10-20',
    });
    const open = await refund(purchase.id, { amount: 1_000, date: '2026-11-10' });
    expect(open.statusCode).toBe(201);
    expect(open.json()).toMatchObject({ accountId: null, creditCardId: cardId });

    // A fatura de 11/2026 (compras de 05/10 a 04/11) é paga; um estorno nela é recusado.
    await user.api('POST', `/v1/credit-cards/${cardId}/invoices/2026-11/payment`);
    const paid = await refund(purchase.id, { amount: 1_000, date: '2026-10-25' });

    expect(paid.statusCode).toBe(409);
    expect(paid.json()).toMatchObject({ type: '/problems/paid-invoice' });
  });

  it('estorna uma parcela de uma compra parcelada', async () => {
    const purchase = (
      await user.api('POST', '/v1/installment-purchases', {
        description: 'Geladeira',
        amount: 30_000,
        date: '2026-11-10',
        creditCardId: cardId,
        categoryId: food.id,
        installmentCount: 3,
      })
    ).json<InstallmentPurchaseDto>();

    const response = await refund(purchase.installments[1]!.id, {
      amount: 10_000,
      date: '2026-12-10',
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ refundedTransactionId: purchase.installments[1]!.id });
  });

  it('com a mesma Idempotency-Key, devolve o mesmo estorno', async () => {
    const original = await expense();
    const headers = { 'idempotency-key': randomUUID() };

    const first = await refund(original.id, { amount: 1_000, date: '2026-11-12' }, headers);
    const again = await refund(original.id, { amount: 1_000, date: '2026-11-12' }, headers);

    expect(again.json<TransactionDto>().id).toBe(first.json<TransactionDto>().id);
    const list = await user.api('GET', `/v1/transactions/${original.id}/refunds`);
    expect(list.json<unknown[]>()).toHaveLength(1);
  });

  describe('efeitos', () => {
    it('devolve o valor à conta', async () => {
      const original = await expense();
      await refund(original.id, { amount: 3_000, date: '2026-11-12' });

      const account = (await user.api('GET', `/v1/accounts/${accountId}`)).json<{
        currentBalance: number;
      }>();

      expect(account.currentBalance).toBe(-7_000);
    });

    it('no cartão, abate a fatura em que cai, libera o limite e pode deixar crédito', async () => {
      // Compra de 20/10 (fatura de 11/2026) e estornos em 10/11 (fatura de 12/2026).
      const purchase = await expense({
        accountId: undefined,
        creditCardId: cardId,
        date: '2026-10-20',
      });
      await expense({ accountId: undefined, creditCardId: cardId, amount: 2_000 });
      await refund(purchase.id, { amount: 6_000, date: '2026-11-10' });

      const invoices = (await user.api('GET', `/v1/credit-cards/${cardId}/invoices`)).json<
        { referenceMonth: string; total: number }[]
      >();
      const december = (await user.api('GET', `/v1/credit-cards/${cardId}/invoices/2026-12`)).json<{
        total: number;
        purchases: unknown[];
        refunds: TransactionDto[];
      }>();
      const card = (await user.api('GET', `/v1/credit-cards/${cardId}`)).json<{
        usedLimit: number;
        nextInvoice: { amount: number };
      }>();

      expect(invoices.map(({ referenceMonth, total }) => [referenceMonth, total])).toEqual([
        ['2026-12', -4_000],
        ['2026-11', 10_000],
      ]);
      expect(december.purchases).toHaveLength(1);
      expect(december.refunds.map((item) => item.amount)).toEqual([6_000]);
      expect(card.usedLimit).toBe(6_000);
      expect(card.nextInvoice.amount).toBe(-4_000);
    });
  });

  describe('edição e exclusão', () => {
    it('edita descrição, valor e data do estorno, dentro do que falta estornar', async () => {
      const original = await expense();
      const first = (
        await refund(original.id, { amount: 3_000, date: '2026-11-12' })
      ).json<TransactionDto>();
      await refund(original.id, { amount: 5_000, date: '2026-11-12' });

      const ok = await user.api('PATCH', `/v1/transactions/${first.id}`, {
        description: 'Devolução parcial',
        amount: 5_000,
        date: '2026-11-13',
      });
      const tooMuch = await user.api('PATCH', `/v1/transactions/${first.id}`, { amount: 5_001 });
      const account = await user.api('PATCH', `/v1/transactions/${first.id}`, {
        accountId: randomUUIDv7(),
      });

      expect(ok.json()).toMatchObject({
        type: 'refund',
        description: 'Devolução parcial',
        amount: 5_000,
        date: '2026-11-13',
        refundedTransactionId: original.id,
      });
      expect(tooMuch.json()).toMatchObject({
        status: 422,
        errors: [
          {
            field: 'body.amount',
            message: 'O estorno pode ser de no máximo R$ 50,00, o que falta estornar.',
          },
        ],
      });
      expect(account.json()).toMatchObject({ status: 422, errors: [{ field: 'body.accountId' }] });
    });

    it('exclui o estorno, mas não a despesa que tem estornos (409)', async () => {
      const original = await expense();
      const first = (
        await refund(original.id, { amount: 3_000, date: '2026-11-12' })
      ).json<TransactionDto>();

      const blocked = await user.api('DELETE', `/v1/transactions/${original.id}`);
      const amountChange = await user.api('PATCH', `/v1/transactions/${original.id}`, {
        amount: 1,
      });
      const rename = await user.api('PATCH', `/v1/transactions/${original.id}`, {
        description: 'Tênis de corrida',
      });

      expect(blocked.json()).toMatchObject({ status: 409, type: '/problems/has-refunds' });
      expect(amountChange.json()).toMatchObject({ status: 409, type: '/problems/has-refunds' });
      expect(rename.statusCode).toBe(200);

      expect((await user.api('DELETE', `/v1/transactions/${first.id}`)).statusCode).toBe(204);
      expect((await user.api('DELETE', `/v1/transactions/${original.id}`)).statusCode).toBe(204);
    });

    it('não exclui a compra parcelada com uma parcela estornada (409)', async () => {
      const purchase = (
        await user.api('POST', '/v1/installment-purchases', {
          description: 'Geladeira',
          amount: 30_000,
          date: '2026-11-10',
          creditCardId: cardId,
          categoryId: food.id,
          installmentCount: 3,
        })
      ).json<InstallmentPurchaseDto>();
      await refund(purchase.installments[0]!.id, { amount: 1_000, date: '2026-11-10' });

      const response = await user.api('DELETE', `/v1/installment-purchases/${purchase.id}`);

      expect(response.json()).toMatchObject({ status: 409, type: '/problems/has-refunds' });
    });

    it('lista os estornos pelo tipo', async () => {
      const original = await expense();
      await refund(original.id, { amount: 3_000, date: '2026-11-12' });

      const page = await user.api('GET', '/v1/transactions?type=refund');

      expect(page.json<{ items: TransactionDto[] }>().items.map((item) => item.type)).toEqual([
        'refund',
      ]);
    });
  });

  it('responde 404 para despesa de outra pessoa ou inexistente, e 401 sem sessão', async () => {
    const original = await expense();
    const other = await signUp(app);

    const foreign = await other.api('POST', `/v1/transactions/${original.id}/refunds`, {
      amount: 1_000,
      date: '2026-11-12',
    });
    const missing = await refund(randomUUIDv7(), { amount: 1_000, date: '2026-11-12' });
    const anonymous = await app.inject({
      method: 'POST',
      url: `/v1/transactions/${original.id}/refunds`,
      payload: { amount: 1_000, date: '2026-11-12' },
    });

    expect([foreign.statusCode, missing.statusCode, anonymous.statusCode]).toEqual([404, 404, 401]);
  });
});
