import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp } from '../../../test/helpers/app.ts';
import { createAccount, signUp, type TestUser } from '../../../test/helpers/users.ts';
import type { CategoryDto } from '../categories/categories.schemas.ts';
import type { CreditCardDto } from '../credit-cards/credit-cards.schemas.ts';
import type { TransactionDto } from './transactions.schemas.ts';

// Hoje é 15/11/2026. Cartão com fechamento no dia 5: a fatura de 11/2026 tem as compras de 05/10 a
// 04/11 e é paga no início de cada teste; a de 12/2026 (de 05/11 a 04/12) está aberta.
describe('compras de fatura paga ficam bloqueadas', () => {
  let app: FastifyInstance;
  let user: TestUser;
  let account: { id: string };
  let card: CreditCardDto;
  let food: CategoryDto;
  /** Compra da fatura paga (11/2026). */
  let paidPurchase: TransactionDto;
  /** Compra da fatura aberta (12/2026). */
  let openPurchase: TransactionDto;

  const LOCKED =
    'A fatura de 11/2026 do cartão "Roxinho" já foi paga. Desfaça o pagamento para alterar as compras dela.';

  beforeAll(async () => {
    app = await createTestApp({ today: '2026-11-15' });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    user = await signUp(app);
    account = await createAccount(user);
    card = (
      await user.api('POST', '/v1/credit-cards', {
        name: 'Roxinho',
        brand: 'mastercard',
        lastFourDigits: '4321',
        creditLimit: 500_000,
        closingDay: 5,
        dueDay: 12,
        paymentAccountId: account.id,
        color: '#6a1b9a',
      })
    ).json<CreditCardDto>();
    food = (await user.api('GET', '/v1/categories?type=expense'))
      .json<CategoryDto[]>()
      .find((category) => category.name === 'Alimentação')!;
    paidPurchase = (await purchase({ date: '2026-10-20' })).json<TransactionDto>();
    openPurchase = (await purchase({ date: '2026-11-10' })).json<TransactionDto>();
    const paid = await user.api('POST', `/v1/credit-cards/${card.id}/invoices/2026-11/payment`);
    expect(paid.statusCode).toBe(201);
  });

  const purchase = (overrides: Record<string, unknown> = {}) =>
    user.api('POST', '/v1/transactions', {
      type: 'expense',
      description: 'Compra',
      amount: 10_000,
      date: '2026-11-10',
      creditCardId: card.id,
      categoryId: food.id,
      ...overrides,
    });

  const patch = (id: string, body: Record<string, unknown>) =>
    user.api('PATCH', `/v1/transactions/${id}`, body);

  function expectLocked(response: LightMyRequestResponse) {
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      type: '/problems/paid-invoice',
      status: 409,
      detail: LOCKED,
    });
  }

  it('não cria compra que cairia na fatura paga', async () => {
    expectLocked(await purchase({ date: '2026-11-04' }));
  });

  it('não cria compra numa fatura anterior à paga: o saldo dela passa para a paga', async () => {
    const response = await purchase({ date: '2026-09-20' });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      type: '/problems/paid-invoice',
      detail:
        'A fatura de 11/2026 do cartão "Roxinho" já foi paga, e o saldo da fatura de 10/2026 passa para ela. Desfaça esse pagamento para alterar as compras.',
    });
  });

  it('cria normalmente na fatura aberta', async () => {
    expect((await purchase({ date: '2026-11-05' })).statusCode).toBe(201);
  });

  it('não altera compra da fatura paga, nem com corpo vazio', async () => {
    expectLocked(await patch(paidPurchase.id, { amount: 1 }));
    expectLocked(await patch(paidPurchase.id, {}));
  });

  it('não tira a compra da fatura paga (data, conta ou outro cartão)', async () => {
    expectLocked(await patch(paidPurchase.id, { date: '2026-11-10' }));
    expectLocked(await patch(paidPurchase.id, { accountId: account.id }));
  });

  it('não move compra da fatura aberta para a paga', async () => {
    expectLocked(await patch(openPurchase.id, { date: '2026-10-25' }));
  });

  it('não move despesa da conta para a fatura paga', async () => {
    const onAccount = (
      await purchase({ creditCardId: undefined, accountId: account.id, date: '2026-10-25' })
    ).json<TransactionDto>();

    expectLocked(await patch(onAccount.id, { creditCardId: card.id }));
  });

  it('não exclui compra da fatura paga', async () => {
    expectLocked(await user.api('DELETE', `/v1/transactions/${paidPurchase.id}`));
    expect((await user.api('GET', `/v1/transactions/${paidPurchase.id}`)).statusCode).toBe(200);
  });

  it('altera e exclui normalmente as compras da fatura aberta', async () => {
    expect((await patch(openPurchase.id, { amount: 1 })).statusCode).toBe(200);
    expect((await user.api('DELETE', `/v1/transactions/${openPurchase.id}`)).statusCode).toBe(204);
  });

  it('depois de desfazer o pagamento, as compras voltam a ser editáveis', async () => {
    await user.api('DELETE', `/v1/credit-cards/${card.id}/invoices/2026-11/payment`);

    expect((await patch(paidPurchase.id, { amount: 1 })).statusCode).toBe(200);
    expect((await purchase({ date: '2026-11-04' })).statusCode).toBe(201);
  });
});
