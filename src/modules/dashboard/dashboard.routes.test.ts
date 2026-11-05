import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../../../test/helpers/app.ts';
import { createAccount, signUp, type TestUser } from '../../../test/helpers/users.ts';
import type { CategoryDto } from '../categories/categories.schemas.ts';
import type { CreditCardDto } from '../credit-cards/credit-cards.schemas.ts';
import type { DashboardDto } from './dashboard.schemas.ts';

// Hoje é 15/11/2026. Contas: Corrente (R$ 1.000), Poupança (R$ 500) e Antiga (arquivada).
describe('GET /v1/dashboard', () => {
  let app: FastifyInstance;
  let user: TestUser;

  beforeAll(async () => {
    app = await createTestApp({ today: '2026-11-15' });
    user = await signUp(app);
    const checking = await createAccount(user, { name: 'Corrente', initialBalance: 100_000 });
    const savings = await createAccount(user, { name: 'Poupança', initialBalance: 50_000 });
    const old = await createAccount(user, { name: 'Antiga', initialBalance: 999_999 });
    const categories = (await user.api('GET', '/v1/categories')).json<CategoryDto[]>();
    const food = categories.find((category) => category.name === 'Alimentação')!;
    const salary = categories.find((category) => category.name === 'Salário')!;
    const card = (
      await user.api('POST', '/v1/credit-cards', {
        name: 'Roxinho',
        brand: 'visa',
        lastFourDigits: '4321',
        creditLimit: 500_000,
        closingDay: 5,
        dueDay: 12,
        paymentAccountId: checking.id,
        color: '#6a1b9a',
      })
    ).json<CreditCardDto>();

    const post = (body: Record<string, unknown>) =>
      user.api('POST', '/v1/transactions', {
        type: 'expense',
        description: 'Lançamento',
        amount: 1_000,
        date: '2026-11-10',
        accountId: checking.id,
        categoryId: food.id,
        ...body,
      });
    await post({ type: 'income', amount: 30_000, date: '2026-11-02', categoryId: salary.id });
    await post({ amount: 5_000, date: '2026-11-02', accountId: savings.id });
    await post({ amount: 2_000, date: '2026-11-03', status: 'pending' });
    await post({
      type: 'transfer',
      amount: 40_000,
      date: '2026-11-04',
      categoryId: undefined,
      destinationAccountId: savings.id,
    });
    await post({ amount: 10_000, date: '2026-10-15' });
    await post({ amount: 8_000, date: '2026-10-20', accountId: undefined, creditCardId: card.id });
    // Compra no cartão em novembro: é despesa do período.
    await post({ amount: 7_000, date: '2026-11-06', accountId: undefined, creditCardId: card.id });
    // Fatura de 11/2026 (compras até 04/11): pagar não é despesa, só tira dinheiro da conta.
    await user.api('POST', `/v1/credit-cards/${card.id}/invoices/2026-11/payment`);
    await user.api('PATCH', `/v1/accounts/${old.id}`, { isArchived: true });
  });

  afterAll(async () => {
    await app.close();
  });

  const dashboard = (query = '') => user.api('GET', `/v1/dashboard${query}`);

  function expectInvalid(response: LightMyRequestResponse, field: string, message: string) {
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ errors: [{ field, message }] });
  }

  it('sem período, resume o mês atual', async () => {
    const response = await dashboard();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      from: '2026-11-01',
      to: '2026-11-30',
      summary: {
        income: 30_000,
        // R$ 50 na Poupança + R$ 70 no cartão; transferência e pagamento de fatura não contam.
        expense: 12_000,
        net: 18_000,
        pendingCount: 1,
      },
    });
  });

  it('soma o saldo atual só das contas ativas', async () => {
    const { balance } = (await dashboard()).json<DashboardDto>();

    // Corrente: 1.000 + 300 − 400 (transferência) − 100 (outubro) − 80 (fatura) = 720.
    // Poupança: 500 − 50 + 400 = 850.
    expect(balance).toEqual({ total: 157_000, activeAccounts: 2 });
  });

  it('resume o período pedido', async () => {
    const response = await dashboard('?from=2026-10-01&to=2026-10-31');

    expect(response.json()).toMatchObject({
      from: '2026-10-01',
      to: '2026-10-31',
      summary: { income: 0, expense: 18_000, net: -18_000, pendingCount: 0 },
    });
  });

  it.each([
    [
      'só a data inicial',
      '?from=2026-11-01',
      'querystring.to',
      'Informe as duas datas do período, ou nenhuma (mês atual).',
    ],
    [
      'data final antes da inicial',
      '?from=2026-11-10&to=2026-11-01',
      'querystring.to',
      'A data final deve ser igual ou posterior à data inicial.',
    ],
    [
      'período maior que um ano',
      '?from=2025-01-01&to=2026-01-02',
      'querystring.to',
      'O período deve ter no máximo um ano.',
    ],
    [
      'data inválida',
      '?from=2026-02-30&to=2026-03-01',
      'querystring.from',
      'Informe uma data válida no formato aaaa-mm-dd.',
    ],
  ])('responde 422 para %s', async (_case, query, field, message) => {
    expectInvalid(await dashboard(query), field, message);
  });

  it('aceita o período de um ano inteiro', async () => {
    expect((await dashboard('?from=2026-01-01&to=2026-12-31')).statusCode).toBe(200);
  });

  it('mostra só os dados do usuário', async () => {
    const other = await signUp(app);

    expect((await other.api('GET', '/v1/dashboard')).json()).toMatchObject({
      summary: { income: 0, expense: 0, net: 0, pendingCount: 0 },
      balance: { total: 0, activeAccounts: 0 },
    });
  });

  it('responde 401 sem sessão', async () => {
    expect((await app.inject({ method: 'GET', url: '/v1/dashboard' })).statusCode).toBe(401);
  });
});
