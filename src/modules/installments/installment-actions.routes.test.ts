import { randomUUID, randomUUIDv7 } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp } from '../../../test/helpers/app.ts';
import { createAccount, signUp, type TestUser } from '../../../test/helpers/users.ts';
import type { CategoryDto } from '../categories/categories.schemas.ts';
import type { InstallmentPurchaseDto } from './installments.schemas.ts';

describe('ações da compra parcelada', () => {
  let app: FastifyInstance;

  // Hoje é 15/11/2026. O cartão fecha dia 5 e vence dia 12: a fatura atual é a de 12/2026, com
  // compras de 05/11 a 04/12.
  beforeAll(async () => {
    app = await createTestApp({ today: '2026-11-15' });
  });

  afterAll(async () => {
    await app.close();
  });

  let user: TestUser;
  let cardId: string;
  let food: CategoryDto;

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
  });

  /** R$ 100,00 em 5x de R$ 20,00: em 10/11 (fatura atual), 10/12, 10/01, 10/02 e 10/03. */
  const createPurchase = async (overrides: Record<string, unknown> = {}) =>
    (
      await user.api('POST', '/v1/installment-purchases', {
        description: 'Notebook',
        amount: 10_000,
        date: '2026-11-10',
        creditCardId: cardId,
        categoryId: food.id,
        installmentCount: 5,
        ...overrides,
      })
    ).json<InstallmentPurchaseDto>();

  const dates = (purchase: InstallmentPurchaseDto) =>
    purchase.installments.map((installment) => installment.date);

  const invoiceTotals = async () =>
    Object.fromEntries(
      (await user.api('GET', `/v1/credit-cards/${cardId}/invoices`))
        .json<{ referenceMonth: string; total: number }[]>()
        .map(({ referenceMonth, total }) => [referenceMonth, total]),
    );

  describe('POST /:id/anticipation', () => {
    const anticipate = (id: string, count: number, headers: Record<string, string> = {}) =>
      app.inject({
        method: 'POST',
        url: `/v1/installment-purchases/${id}/anticipation`,
        cookies: user.cookies,
        headers,
        payload: { count },
      });

    it('leva as últimas parcelas para a fatura atual, sem mudar número nem valor', async () => {
      const purchase = await createPurchase();

      const response = await anticipate(purchase.id, 2);

      expect(response.statusCode).toBe(200);
      const body = response.json<InstallmentPurchaseDto>();
      expect(dates(body)).toEqual([
        '2026-11-10',
        '2026-12-10',
        '2027-01-10',
        '2026-11-15',
        '2026-11-15',
      ]);
      expect(body.installments.map((installment) => installment.installmentNumber)).toEqual([
        1, 2, 3, 4, 5,
      ]);
      expect(body).toMatchObject({ amount: 10_000, anticipatableCount: 2 });
      expect(await invoiceTotals()).toEqual({
        '2026-12': 6_000,
        '2027-01': 2_000,
        '2027-02': 2_000,
      });
      const card = (await user.api('GET', `/v1/credit-cards/${cardId}`)).json<{
        usedLimit: number;
      }>();
      expect(card.usedLimit).toBe(10_000);
    });

    it('com a mesma Idempotency-Key, não antecipa outras parcelas', async () => {
      const purchase = await createPurchase();
      const headers = { 'idempotency-key': randomUUID() };

      await anticipate(purchase.id, 1, headers);
      const again = await anticipate(purchase.id, 1, headers);

      expect(again.statusCode).toBe(200);
      expect(again.headers['idempotent-replayed']).toBe('true');
      const detail = (
        await user.api('GET', `/v1/installment-purchases/${purchase.id}`)
      ).json<InstallmentPurchaseDto>();
      expect(detail.anticipatableCount).toBe(3);
    });

    it('pula as parcelas com estorno', async () => {
      const purchase = await createPurchase();
      await user.api('POST', `/v1/transactions/${purchase.installments[4]!.id}/refunds`, {
        amount: 500,
        date: '2027-03-10',
      });

      const body = (await anticipate(purchase.id, 1)).json<InstallmentPurchaseDto>();

      expect(dates(body)).toEqual([
        '2026-11-10',
        '2026-12-10',
        '2027-01-10',
        '2026-11-15',
        '2027-03-10',
      ]);
    });

    it('recusa mais parcelas que as possíveis (422), sem mudar nada', async () => {
      const purchase = await createPurchase();

      const response = await anticipate(purchase.id, 5);

      expect(response.json()).toMatchObject({
        status: 422,
        errors: [{ field: 'body.count', message: 'Só 4 parcelas podem ser antecipadas.' }],
      });
      const detail = (
        await user.api('GET', `/v1/installment-purchases/${purchase.id}`)
      ).json<InstallmentPurchaseDto>();
      expect(dates(detail)).toEqual(dates(purchase));
    });

    it('responde 409 quando não há o que antecipar', async () => {
      // Em 2x a partir de 20/10: a 2ª parcela já está na fatura atual.
      const purchase = await createPurchase({ date: '2026-10-20', installmentCount: 2 });

      const response = await anticipate(purchase.id, 1);

      expect(response.statusCode).toBe(409);
      expect(response.json<{ detail: string }>().detail).toContain('Não há parcelas a antecipar');
    });

    it('responde 404 para compra inexistente ou de outra pessoa', async () => {
      const purchase = await createPurchase();
      const other = await signUp(app);

      const foreign = await other.api(
        'POST',
        `/v1/installment-purchases/${purchase.id}/anticipation`,
        { count: 1 },
      );
      const missing = await anticipate(randomUUIDv7(), 1);

      expect(foreign.statusCode).toBe(404);
      expect(missing.statusCode).toBe(404);
    });
  });
});
