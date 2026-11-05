import { eq } from 'drizzle-orm';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp } from '../../../test/helpers/app.ts';
import { createAccount, signUp, type TestUser } from '../../../test/helpers/users.ts';
import { transactions } from '../../db/schema/index.ts';
import type { AccountDto } from '../accounts/accounts.schemas.ts';
import type { CategoryDto } from '../categories/categories.schemas.ts';
import type { CreditCardDto } from '../credit-cards/credit-cards.schemas.ts';
import type { InvoiceDto } from './invoices.schemas.ts';

// Hoje é 15/11/2026. Cartão com fechamento no dia 5 e vencimento no 12: a fatura de 11/2026
// (compras de 05/10 a 04/11) está vencida; a de 12/2026 está aberta.
describe('pagamento de fatura', () => {
  let app: FastifyInstance;
  let user: TestUser;
  let account: { id: string };
  let card: CreditCardDto;
  let food: CategoryDto;

  beforeAll(async () => {
    app = await createTestApp({ today: '2026-11-15' });
  });

  afterAll(async () => {
    await app.close();
  });

  // Cada teste com uma pessoa nova: o pagamento muda o estado da fatura.
  beforeEach(async () => {
    user = await signUp(app);
    account = await createAccount(user, { initialBalance: 100_000 });
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
    await purchase(20_000, '2026-10-20');
    await purchase(15_050, '2026-11-04');
    await purchase(9_990, '2026-11-05');
  });

  const purchase = (amount: number, date: string) =>
    user.api('POST', '/v1/transactions', {
      type: 'expense',
      description: 'Compra',
      amount,
      date,
      creditCardId: card.id,
      categoryId: food.id,
    });

  const pay = (month: string, api = user.api) =>
    api('POST', `/v1/credit-cards/${card.id}/invoices/${month}/payment`);

  function expectConflict(response: LightMyRequestResponse, detail: string) {
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ status: 409, detail });
  }

  it('paga o total da fatura vencida, hoje, pela conta de pagamento do cartão', async () => {
    const response = await pay('2026-11');

    expect(response.statusCode).toBe(201);
    const invoice = response.json<InvoiceDto>();
    expect(invoice).toMatchObject({ referenceMonth: '2026-11', status: 'paid', total: 35_050 });
    expect(invoice.payment).toMatchObject({
      type: 'invoice-payment',
      description: 'Fatura Roxinho 11/2026',
      amount: 35_050,
      date: '2026-11-15',
      accountId: account.id,
      creditCardId: card.id,
      invoiceMonth: '2026-11',
      categoryId: null,
      status: 'completed',
    });
  });

  it('debita a conta e libera o limite do cartão', async () => {
    await pay('2026-11');

    const balance = (await user.api('GET', `/v1/accounts/${account.id}`)).json<AccountDto>();
    const usage = (await user.api('GET', `/v1/credit-cards/${card.id}`)).json<CreditCardDto>();
    expect(balance.currentBalance).toBe(100_000 - 35_050);
    expect(usage.usedLimit).toBe(9_990);
  });

  it('paga também fatura fechada e ainda não vencida', async () => {
    const closedDay = await createTestApp({ today: '2026-11-08' });
    try {
      const response = await closedDay.inject({
        method: 'POST',
        url: `/v1/credit-cards/${card.id}/invoices/2026-11/payment`,
        cookies: user.cookies,
      });

      expect(response.statusCode).toBe(201);
      expect(response.json<InvoiceDto>().payment?.date).toBe('2026-11-08');
    } finally {
      await closedDay.close();
    }
  });

  it('não paga duas vezes', async () => {
    await pay('2026-11');

    expectConflict(await pay('2026-11'), 'Esta fatura já foi paga.');
  });

  it('dois pagamentos ao mesmo tempo: um entra, o outro recebe 409', async () => {
    const responses = await Promise.all([pay('2026-11'), pay('2026-11')]);

    expect(responses.map((response) => response.statusCode).sort()).toEqual([201, 409]);
    const payments = await app.db
      .select()
      .from(transactions)
      .where(eq(transactions.creditCardId, card.id));
    expect(payments.filter((row) => row.type === 'invoice-payment')).toHaveLength(1);
  });

  it('não paga a fatura aberta', async () => {
    expectConflict(
      await pay('2026-12'),
      'A fatura ainda está aberta: ela pode ser paga a partir do fechamento, em 05/12/2026.',
    );
  });

  it('não paga fatura sem compras', async () => {
    expectConflict(await pay('2026-09'), 'A fatura não tem compras para pagar.');
  });

  it('não paga com a conta de pagamento arquivada', async () => {
    await user.api('PATCH', `/v1/accounts/${account.id}`, { isArchived: true });

    expectConflict(
      await pay('2026-11'),
      'A conta de pagamento "Conta corrente" está arquivada. Reative-a ou troque a conta de pagamento do cartão.',
    );
  });

  it('não paga fatura do cartão de outro usuário', async () => {
    const other = await signUp(app);

    const response = await pay('2026-11', other.api);

    expect(response.statusCode).toBe(404);
    expect(
      (await user.api('GET', `/v1/credit-cards/${card.id}/invoices/2026-11`)).json(),
    ).toMatchObject({
      status: 'overdue',
    });
  });

  it('o pagamento não é editável nem excluível pelas rotas de transações', async () => {
    const payment = (await pay('2026-11')).json<InvoiceDto>().payment!;

    expect(
      (await user.api('PATCH', `/v1/transactions/${payment.id}`, { amount: 1 })).statusCode,
    ).toBe(409);
    expect((await user.api('DELETE', `/v1/transactions/${payment.id}`)).statusCode).toBe(409);
  });
});
