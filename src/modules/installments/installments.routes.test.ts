import { randomUUID, randomUUIDv7 } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp } from '../../../test/helpers/app.ts';
import { createAccount, signUp, type TestUser } from '../../../test/helpers/users.ts';
import { transactions } from '../../db/schema/index.ts';
import type { CategoryDto } from '../categories/categories.schemas.ts';
import type { InstallmentPurchaseDto } from './installments.schemas.ts';

describe('rotas /v1/installment-purchases', () => {
  let app: FastifyInstance;

  // Hoje é 15/11/2026. O cartão fecha dia 5 e vence dia 12.
  beforeAll(async () => {
    app = await createTestApp({ today: '2026-11-15' });
  });

  afterAll(async () => {
    await app.close();
  });

  let user: TestUser;
  let cardId: string;
  let food: CategoryDto;
  let salary: CategoryDto;

  beforeEach(async () => {
    user = await signUp(app);
    const account = await createAccount(user);
    cardId = (
      await user.api('POST', '/v1/credit-cards', {
        name: 'Cartão principal',
        brand: 'visa',
        lastFourDigits: '1234',
        creditLimit: 500_000,
        closingDay: 5,
        dueDay: 12,
        paymentAccountId: account.id,
        color: '#6a1b9a',
      })
    ).json<{ id: string }>().id;
    const categories = (await user.api('GET', '/v1/categories')).json<CategoryDto[]>();
    food = categories.find((category) => category.name === 'Alimentação')!;
    salary = categories.find((category) => category.type === 'income')!;
  });

  const purchase = (overrides: Record<string, unknown> = {}) => ({
    description: 'Geladeira',
    amount: 10_000,
    date: '2026-11-10',
    creditCardId: cardId,
    categoryId: food.id,
    installmentCount: 3,
    ...overrides,
  });

  const create = (body: Record<string, unknown>, headers: Record<string, string> = {}) =>
    app.inject({
      method: 'POST',
      url: '/v1/installment-purchases',
      cookies: user.cookies,
      headers,
      payload: body,
    });

  describe('POST', () => {
    it('divide a compra em parcelas, uma por fatura, com a sobra na 1ª', async () => {
      const response = await create(purchase({ notes: 'Em 3x sem juros' }));

      expect(response.statusCode).toBe(201);
      const body = response.json<InstallmentPurchaseDto>();
      expect(body).toMatchObject({
        description: 'Geladeira',
        amount: 10_000,
        installmentCount: 3,
        creditCardId: cardId,
        categoryId: food.id,
        notes: 'Em 3x sem juros',
      });
      expect(
        body.installments.map(({ installmentNumber, amount, date }) => [
          installmentNumber,
          amount,
          date,
        ]),
      ).toEqual([
        [1, 3_334, '2026-11-10'],
        [2, 3_333, '2026-12-10'],
        [3, 3_333, '2027-01-10'],
      ]);
      expect(
        body.installments.every(
          (installment) =>
            installment.installmentGroupId === body.id &&
            installment.installmentCount === 3 &&
            installment.creditCardId === cardId &&
            installment.accountId === null &&
            installment.status === 'completed',
        ),
      ).toBe(true);
    });

    it('cada parcela entra na fatura do seu mês, e o limite reserva o total', async () => {
      await create(purchase());

      const invoices = (await user.api('GET', `/v1/credit-cards/${cardId}/invoices`)).json<
        { referenceMonth: string; total: number }[]
      >();
      const card = (await user.api('GET', `/v1/credit-cards/${cardId}`)).json<{
        usedLimit: number;
      }>();

      expect(invoices.map(({ referenceMonth, total }) => [referenceMonth, total])).toEqual([
        ['2027-02', 3_333],
        ['2027-01', 3_333],
        ['2026-12', 3_334],
      ]);
      expect(card.usedLimit).toBe(10_000);
    });

    it('detalha a compra pelo id do grupo', async () => {
      const created = (await create(purchase())).json<InstallmentPurchaseDto>();

      const response = await user.api('GET', `/v1/installment-purchases/${created.id}`);

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(created);
    });

    it('com a mesma Idempotency-Key, devolve a mesma compra sem duplicar as parcelas', async () => {
      const headers = { 'idempotency-key': randomUUID() };

      const first = await create(purchase(), headers);
      const again = await create(purchase(), headers);

      expect(again.statusCode).toBe(201);
      expect(again.headers['idempotent-replayed']).toBe('true');
      expect(again.json<InstallmentPurchaseDto>().id).toBe(first.json<InstallmentPurchaseDto>().id);
      const rows = await app.db
        .select()
        .from(transactions)
        .where(eq(transactions.userId, user.userId));
      expect(rows).toHaveLength(3);
    });

    it.each([
      [
        'uma parcela só',
        { installmentCount: 1 },
        'body.installmentCount',
        'Parcele em pelo menos 2 vezes.',
      ],
      [
        'mais de 24 parcelas',
        { installmentCount: 25 },
        'body.installmentCount',
        'Parcele em no máximo 24 vezes.',
      ],
      [
        'menos de 1 centavo por parcela',
        { amount: 2, installmentCount: 3 },
        'body.amount',
        'O valor precisa ter pelo menos R$ 0,01 por parcela.',
      ],
      ['campo desconhecido', { accountId: randomUUIDv7() }, 'body', undefined],
    ])('responde 422 para %s', async (_case, overrides, field, message) => {
      const response = await create(purchase(overrides));

      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({
        errors: [{ field, ...(message && { message }) }],
      });
    });

    it('responde 422 no campo para cartão de outra pessoa e categoria de receita', async () => {
      const unknownCard = await create(purchase({ creditCardId: randomUUIDv7() }));
      const income = await create(purchase({ categoryId: salary.id }));

      expect(unknownCard.json()).toMatchObject({ errors: [{ field: 'body.creditCardId' }] });
      expect(income.json()).toMatchObject({ errors: [{ field: 'body.categoryId' }] });
    });

    it('responde 409 com cartão arquivado', async () => {
      await user.api('PATCH', `/v1/credit-cards/${cardId}`, { isArchived: true });

      const response = await create(purchase());

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ type: '/problems/archived-reference' });
    });

    it('responde 409 se alguma parcela cairia numa fatura já paga, sem gravar nada', async () => {
      // A fatura de 11/2026 (compras de 05/10 a 04/11) já foi paga.
      await user.api('POST', '/v1/transactions', {
        type: 'expense',
        description: 'Compra paga',
        amount: 1_000,
        date: '2026-10-20',
        creditCardId: cardId,
        categoryId: food.id,
      });
      await user.api('POST', `/v1/credit-cards/${cardId}/invoices/2026-11/payment`);

      const response = await create(purchase({ date: '2026-10-25' }));

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ type: '/problems/paid-invoice' });
      const parcels = await app.db
        .select()
        .from(transactions)
        .where(eq(transactions.description, 'Geladeira'));
      expect(parcels.filter((row) => row.userId === user.userId)).toEqual([]);
    });
  });

  describe('PATCH /:id', () => {
    it('altera descrição, categoria e observações de todas as parcelas', async () => {
      const created = (await create(purchase())).json<InstallmentPurchaseDto>();
      const market = (
        await user.api('POST', '/v1/categories', {
          name: 'Casa nova',
          type: 'expense',
          icon: 'home',
          color: '#2e7d32',
        })
      ).json<CategoryDto>();

      const response = await user.api('PATCH', `/v1/installment-purchases/${created.id}`, {
        description: '  Geladeira   nova ',
        categoryId: market.id,
        notes: 'Entrega em casa',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<InstallmentPurchaseDto>();
      expect(body).toMatchObject({
        description: 'Geladeira nova',
        categoryId: market.id,
        notes: 'Entrega em casa',
        amount: 10_000,
      });
      expect(
        body.installments.every(
          (installment) =>
            installment.description === 'Geladeira nova' &&
            installment.categoryId === market.id &&
            installment.notes === 'Entrega em casa',
        ),
      ).toBe(true);
      expect(body.installments.map((installment) => installment.amount)).toEqual([
        3_334, 3_333, 3_333,
      ]);
    });

    it('altera mesmo com uma fatura da compra já paga', async () => {
      // Hoje é 15/11: a fatura de 12/2026 ainda não fechou, então paga a de 11 com outra data.
      const created = (
        await create(purchase({ date: '2026-10-20' }))
      ).json<InstallmentPurchaseDto>();
      await user.api('POST', `/v1/credit-cards/${cardId}/invoices/2026-11/payment`);

      const response = await user.api('PATCH', `/v1/installment-purchases/${created.id}`, {
        description: 'Geladeira renomeada',
      });

      expect(response.statusCode).toBe(200);
    });

    it.each([
      ['valor', { amount: 20_000 }],
      ['número de parcelas', { installmentCount: 4 }],
      ['cartão', { creditCardId: randomUUIDv7() }],
      ['data', { date: '2026-11-20' }],
    ])('não altera o %s (422)', async (_case, body) => {
      const created = (await create(purchase())).json<InstallmentPurchaseDto>();

      const response = await user.api('PATCH', `/v1/installment-purchases/${created.id}`, body);

      expect(response.statusCode).toBe(422);
    });

    it('recusa categoria de receita (422) e arquivada (409)', async () => {
      const created = (await create(purchase())).json<InstallmentPurchaseDto>();
      const archived = (
        await user.api('POST', '/v1/categories', {
          name: 'Antiga',
          type: 'expense',
          icon: 'home',
          color: '#2e7d32',
        })
      ).json<CategoryDto>();
      await user.api('PATCH', `/v1/categories/${archived.id}`, { isArchived: true });

      const income = await user.api('PATCH', `/v1/installment-purchases/${created.id}`, {
        categoryId: salary.id,
      });
      const old = await user.api('PATCH', `/v1/installment-purchases/${created.id}`, {
        categoryId: archived.id,
      });

      expect(income.json()).toMatchObject({ status: 422, errors: [{ field: 'body.categoryId' }] });
      expect(old.json()).toMatchObject({ status: 409, type: '/problems/archived-reference' });
    });
  });

  describe('DELETE /:id', () => {
    it('exclui todas as parcelas e libera o limite', async () => {
      const created = (await create(purchase())).json<InstallmentPurchaseDto>();

      const response = await user.api('DELETE', `/v1/installment-purchases/${created.id}`);

      expect(response.statusCode).toBe(204);
      expect((await user.api('GET', `/v1/installment-purchases/${created.id}`)).statusCode).toBe(
        404,
      );
      const card = (await user.api('GET', `/v1/credit-cards/${cardId}`)).json<{
        usedLimit: number;
      }>();
      expect(card.usedLimit).toBe(0);
    });

    it('recusa (409) se alguma parcela estiver numa fatura já paga, sem apagar nada', async () => {
      const created = (
        await create(purchase({ date: '2026-10-20' }))
      ).json<InstallmentPurchaseDto>();
      await user.api('POST', `/v1/credit-cards/${cardId}/invoices/2026-11/payment`);

      const response = await user.api('DELETE', `/v1/installment-purchases/${created.id}`);

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ type: '/problems/paid-invoice' });
      const kept = (
        await user.api('GET', `/v1/installment-purchases/${created.id}`)
      ).json<InstallmentPurchaseDto>();
      expect(kept.installments).toHaveLength(3);
    });

    it('responde 404 para compra inexistente', async () => {
      const response = await user.api('DELETE', `/v1/installment-purchases/${randomUUIDv7()}`);

      expect(response.statusCode).toBe(404);
    });
  });

  describe('GET /:id', () => {
    it('responde 404 para compra inexistente ou de outra pessoa', async () => {
      const created = (await create(purchase())).json<InstallmentPurchaseDto>();
      const other = await signUp(app);

      expect((await other.api('GET', `/v1/installment-purchases/${created.id}`)).statusCode).toBe(
        404,
      );
      expect(
        (await user.api('GET', `/v1/installment-purchases/${randomUUIDv7()}`)).statusCode,
      ).toBe(404);
    });

    it('responde 401 sem sessão', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/v1/installment-purchases/${randomUUIDv7()}`,
      });

      expect(response.statusCode).toBe(401);
    });
  });
});
