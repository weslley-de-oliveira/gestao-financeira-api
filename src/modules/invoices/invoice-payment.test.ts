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

  it('não paga fatura sem saldo a pagar', async () => {
    expectConflict(await pay('2026-09'), 'A fatura não tem saldo a pagar.');
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

  describe('pagamento parcial', () => {
    const payPart = (amount: unknown, month = '2026-11') =>
      user.api('POST', `/v1/credit-cards/${card.id}/invoices/${month}/payment`, { amount });

    it('paga parte do saldo: a fatura continua em aberto com o que falta', async () => {
      const response = await payPart(20_000);

      expect(response.statusCode).toBe(201);
      const invoice = response.json<InvoiceDto>();
      expect(invoice).toMatchObject({
        status: 'overdue',
        amountDue: 35_050,
        paidAmount: 20_000,
        balance: 15_050,
      });
      expect(invoice.payment).toMatchObject({
        description: 'Fatura Roxinho 11/2026 (parcial)',
        amount: 20_000,
        date: '2026-11-15',
      });
      expect(invoice.payments).toHaveLength(1);
    });

    it('debita da conta e libera do limite só o que foi pago', async () => {
      await payPart(20_000);

      const balance = (await user.api('GET', `/v1/accounts/${account.id}`)).json<AccountDto>();
      const usage = (await user.api('GET', `/v1/credit-cards/${card.id}`)).json<CreditCardDto>();
      expect(balance.currentBalance).toBe(100_000 - 20_000);
      expect(usage.usedLimit).toBe(45_040 - 20_000);
    });

    it('sem valor, o pagamento seguinte quita o que falta', async () => {
      await payPart(20_000);

      const response = await pay('2026-11');

      expect(response.statusCode).toBe(201);
      const invoice = response.json<InvoiceDto>();
      expect(invoice).toMatchObject({ status: 'paid', paidAmount: 35_050, balance: 0 });
      expect(invoice.payments.map((payment) => [payment.description, payment.amount])).toEqual([
        ['Fatura Roxinho 11/2026', 15_050],
        ['Fatura Roxinho 11/2026 (parcial)', 20_000],
      ]);
      expectConflict(await payPart(1), 'Esta fatura já foi paga.');
    });

    it('o valor igual ao saldo quita a fatura, sem "(parcial)"', async () => {
      const response = await payPart(35_050);

      expect(response.json<InvoiceDto>()).toMatchObject({
        status: 'paid',
        payment: { description: 'Fatura Roxinho 11/2026', amount: 35_050 },
      });
    });

    it('recusa valor acima do saldo (422 no amount)', async () => {
      await payPart(20_000);

      const response = await payPart(15_051);

      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({
        errors: [
          {
            field: 'body.amount',
            message: 'O pagamento pode ser de no máximo R$ 150,50, o saldo da fatura.',
          },
        ],
      });
    });

    it.each([[0], [-100], [10.5], ['100']])('recusa o valor %j', async (amount) => {
      expect((await payPart(amount)).statusCode).toBe(422);
    });

    it('dois pagamentos parciais ao mesmo tempo não passam do saldo', async () => {
      const responses = await Promise.all([payPart(20_000), payPart(20_000)]);

      expect(responses.map((response) => response.statusCode).sort()).toEqual([201, 422]);
      const invoice = (
        await user.api('GET', `/v1/credit-cards/${card.id}/invoices/2026-11`)
      ).json<InvoiceDto>();
      expect(invoice).toMatchObject({ paidAmount: 20_000, balance: 15_050 });
    });

    it('o saldo que faltou passa para a fatura seguinte no fechamento dela', async () => {
      await payPart(20_000);
      const december = await createTestApp({ today: '2026-12-05' });
      try {
        const get = (month: string) =>
          december.inject({
            method: 'GET',
            url: `/v1/credit-cards/${card.id}/invoices/${month}`,
            cookies: user.cookies,
          });

        expect((await get('2026-11')).json()).toMatchObject({
          status: 'carried-over',
          balance: 15_050,
        });
        expect((await get('2026-12')).json()).toMatchObject({
          status: 'closed',
          total: 9_990,
          previousBalance: 15_050,
          amountDue: 25_040,
          balance: 25_040,
        });
        const late = await december.inject({
          method: 'POST',
          url: `/v1/credit-cards/${card.id}/invoices/2026-11/payment`,
          cookies: user.cookies,
        });
        expect(late.statusCode).toBe(409);
        expect(late.json()).toMatchObject({
          detail: 'O saldo desta fatura passou para a fatura de 12/2026: pague por ela.',
        });
      } finally {
        await december.close();
      }
    });
  });

  describe('desfazer o pagamento', () => {
    const undo = (month: string, api = user.api) =>
      api('DELETE', `/v1/credit-cards/${card.id}/invoices/${month}/payment`);

    it('a fatura volta ao status pelas datas, o valor volta para a conta e as compras ao limite', async () => {
      await pay('2026-11');

      const response = await undo('2026-11');

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ status: 'overdue', total: 35_050, payment: null });
      const balance = (await user.api('GET', `/v1/accounts/${account.id}`)).json<AccountDto>();
      const usage = (await user.api('GET', `/v1/credit-cards/${card.id}`)).json<CreditCardDto>();
      expect(balance.currentBalance).toBe(100_000);
      expect(usage.usedLimit).toBe(45_040);
    });

    it('depois de desfeito, a fatura pode ser paga de novo', async () => {
      await pay('2026-11');
      await undo('2026-11');

      expect((await pay('2026-11')).statusCode).toBe(201);
    });

    it('desfaz só o pagamento mais recente', async () => {
      await user.api('POST', `/v1/credit-cards/${card.id}/invoices/2026-11/payment`, {
        amount: 20_000,
      });
      await pay('2026-11');

      const response = await undo('2026-11');

      expect(response.json<InvoiceDto>()).toMatchObject({
        status: 'overdue',
        paidAmount: 20_000,
        balance: 15_050,
        payment: { description: 'Fatura Roxinho 11/2026 (parcial)', amount: 20_000 },
      });
      expect(response.json<InvoiceDto>().payments).toHaveLength(1);
    });

    it('recusa (409) com pagamento numa fatura posterior, sem apagar nada', async () => {
      await pay('2026-11');
      const december = await createTestApp({ today: '2026-12-15' });
      try {
        const inDecember = (method: 'POST' | 'DELETE', month: string) =>
          december.inject({
            method,
            url: `/v1/credit-cards/${card.id}/invoices/${month}/payment`,
            cookies: user.cookies,
          });
        expect((await inDecember('POST', '2026-12')).statusCode).toBe(201);

        const response = await inDecember('DELETE', '2026-11');

        expect(response.statusCode).toBe(409);
        expect(response.json()).toMatchObject({
          type: '/problems/later-invoice-payment',
          detail:
            'A fatura de 12/2026 já tem pagamento. Desfaça antes os pagamentos das faturas seguintes.',
        });
        expect((await inDecember('DELETE', '2026-12')).statusCode).toBe(200);
        expect((await inDecember('DELETE', '2026-11')).statusCode).toBe(200);
      } finally {
        await december.close();
      }
    });

    it('responde 409 para fatura sem pagamento', async () => {
      expectConflict(await undo('2026-11'), 'Esta fatura não tem pagamento para desfazer.');
    });

    it('não desfaz o pagamento no cartão de outro usuário', async () => {
      await pay('2026-11');
      const other = await signUp(app);

      expect((await undo('2026-11', other.api)).statusCode).toBe(404);
      expect(
        (await user.api('GET', `/v1/credit-cards/${card.id}/invoices/2026-11`)).json(),
      ).toMatchObject({ status: 'paid' });
    });
  });
});
