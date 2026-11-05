import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../../../test/helpers/app.ts';
import { createAccount, signUp, type TestUser } from '../../../test/helpers/users.ts';
import type { CategoryDto } from '../categories/categories.schemas.ts';
import type { CreditCardDto } from '../credit-cards/credit-cards.schemas.ts';
import type { TransactionDto } from '../transactions/transactions.schemas.ts';
import { budgetProgress } from './budget-rules.ts';
import type { BudgetDto } from './budgets.schemas.ts';

// Cenário de `budget-rules.spec.ts` do front: orçamento de Alimentação criado em 09/2026 com limite
// de R$ 500, alterado em 11/2026 para R$ 800 (alerta em 80%). Hoje é 15/11/2026.
describe('consumo do orçamento no mês', () => {
  let september: FastifyInstance;
  let app: FastifyInstance;
  let user: TestUser;
  let food: CategoryDto;
  let leisure: CategoryDto;
  let budget: BudgetDto;

  beforeAll(async () => {
    september = await createTestApp({ today: '2026-09-10' });
    app = await createTestApp({ today: '2026-11-15' });
    user = await signUp(app);
    const account = await createAccount(user);
    const savings = await createAccount(user, { name: 'Poupança' });
    const categories = (await user.api('GET', '/v1/categories')).json<CategoryDto[]>();
    food = categories.find((category) => category.name === 'Alimentação')!;
    leisure = categories.find((category) => category.name === 'Lazer')!;
    const salary = categories.find((category) => category.name === 'Salário')!;

    budget = (
      await september.inject({
        method: 'POST',
        url: '/v1/budgets',
        cookies: user.cookies,
        payload: { categoryId: food.id, limitAmount: 50_000 },
      })
    ).json<BudgetDto>();
    await user.api('PATCH', `/v1/budgets/${budget.id}`, { limitAmount: 80_000 });

    const card = (
      await user.api('POST', '/v1/credit-cards', {
        name: 'Roxinho',
        brand: 'visa',
        lastFourDigits: '4321',
        creditLimit: 500_000,
        closingDay: 5,
        dueDay: 12,
        paymentAccountId: account.id,
        color: '#6a1b9a',
      })
    ).json<CreditCardDto>();

    const transaction = (body: Record<string, unknown>) =>
      user.api('POST', '/v1/transactions', {
        type: 'expense',
        description: 'Compra',
        amount: 1_000,
        date: '2026-11-10',
        accountId: account.id,
        categoryId: food.id,
        ...body,
      });
    await transaction({ description: 'Mercado', amount: 40_000 });
    await transaction({
      description: 'Cartão',
      amount: 20_000,
      accountId: undefined,
      creditCardId: card.id,
    });
    await transaction({ description: 'Pendente', amount: 5_000, status: 'pending' });
    await transaction({ description: 'Outubro', amount: 9_999, date: '2026-10-31' });
    await transaction({ description: 'Outra categoria', categoryId: leisure.id });
    await transaction({ description: 'Receita', type: 'income', categoryId: salary.id });
    await transaction({
      description: 'Transferência',
      type: 'transfer',
      categoryId: undefined,
      destinationAccountId: savings.id,
    });
  });

  afterAll(async () => {
    await september.close();
    await app.close();
  });

  const progressOf = async (month?: string) =>
    (
      await user.api('GET', `/v1/budgets/${budget.id}${month ? `?month=${month}` : ''}`)
    ).json<BudgetDto>().progress;

  it('conta as despesas realizadas da categoria no mês, com as pendentes à parte', async () => {
    expect(await progressOf()).toEqual({
      month: '2026-11',
      limit: 80_000,
      spent: 60_000,
      pending: 5_000,
      available: 20_000,
      percent: 75,
      state: 'ok',
    });
  });

  it('usa o limite em vigor em cada mês', async () => {
    expect(await progressOf('2026-10')).toMatchObject({
      limit: 50_000,
      spent: 9_999,
      available: 40_001,
    });
    expect(await progressOf('2027-03')).toMatchObject({ limit: 80_000, spent: 0 });
  });

  it('não vale antes do primeiro mês', async () => {
    expect(await progressOf('2026-08')).toBeNull();
    expect((await user.api('GET', '/v1/budgets?month=2026-08')).json()).toEqual([]);
  });

  it('entra em alerta no percentual definido e excede acima de 100%', async () => {
    await user.api('PATCH', `/v1/budgets/${budget.id}`, { alertThreshold: 70 });
    expect((await progressOf())?.state).toBe('warning');

    await user.api('PATCH', `/v1/budgets/${budget.id}`, { limitAmount: 59_999 });
    expect(await progressOf()).toMatchObject({ state: 'exceeded', available: -1 });

    await user.api('PATCH', `/v1/budgets/${budget.id}`, {
      limitAmount: 80_000,
      alertThreshold: 80,
    });
  });

  it('lista os do mês, em ordem alfabética da categoria, com o consumo', async () => {
    const leisureBudget = (
      await user.api('POST', '/v1/budgets', { categoryId: leisure.id, limitAmount: 10_000 })
    ).json<BudgetDto>();

    const list = (await user.api('GET', '/v1/budgets')).json<BudgetDto[]>();

    expect(list.map(({ id, progress }) => [id, progress?.spent])).toEqual([
      [budget.id, 60_000],
      [leisureBudget.id, 1_000],
    ]);
    // Em outubro, só o que já existia.
    const october = (await user.api('GET', '/v1/budgets?month=2026-10')).json<BudgetDto[]>();
    expect(october.map(({ id }) => id)).toEqual([budget.id]);
  });

  it('bate com a regra do front (budgetProgress) em vários meses', async () => {
    const all = (await user.api('GET', '/v1/transactions?limit=100')).json<{
      items: TransactionDto[];
    }>().items;
    const current = (await user.api('GET', `/v1/budgets/${budget.id}`)).json<BudgetDto>();

    for (const month of ['2026-08', '2026-09', '2026-10', '2026-11', '2026-12']) {
      expect(await progressOf(month)).toEqual(budgetProgress(current, all, month));
    }
  });

  it('responde 422 para mês inválido', async () => {
    const response = await user.api('GET', '/v1/budgets?month=2026-13');

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      errors: [{ field: 'querystring.month', message: 'Informe o mês no formato aaaa-mm.' }],
    });
  });

  it('não mostra orçamentos de outro usuário', async () => {
    const other = await signUp(app);

    expect((await other.api('GET', '/v1/budgets')).json()).toEqual([]);
  });
});
