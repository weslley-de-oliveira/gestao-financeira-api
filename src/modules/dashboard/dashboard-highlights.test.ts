import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../../../test/helpers/app.ts';
import { createAccount, signUp, type TestUser } from '../../../test/helpers/users.ts';
import type { CategoryDto } from '../categories/categories.schemas.ts';
import type { GoalDto } from '../goals/goals.schemas.ts';
import type { DashboardDto } from './dashboard.schemas.ts';

// Hoje é 15/11/2026.
describe('transações recentes e destaques do dashboard', () => {
  let october: FastifyInstance;
  let app: FastifyInstance;
  let user: TestUser;
  let byName: (name: string) => CategoryDto;

  beforeAll(async () => {
    october = await createTestApp({ today: '2026-10-01' });
    app = await createTestApp({ today: '2026-11-15' });
    user = await signUp(app);
    const account = await createAccount(user);
    const categories = (await user.api('GET', '/v1/categories')).json<CategoryDto[]>();
    byName = (name) => categories.find((category) => category.name === name)!;

    const expense = (description: string, date: string, category: string, amount = 1_000) =>
      user.api('POST', '/v1/transactions', {
        type: 'expense',
        description,
        amount,
        date,
        accountId: account.id,
        categoryId: byName(category).id,
      });
    for (const [description, date] of [
      ['Dia 3', '2026-11-03'],
      ['Dia 9', '2026-11-09'],
      ['Dia 5', '2026-11-05'],
      ['Dia 12', '2026-11-12'],
      ['Dia 1', '2026-11-01'],
      ['Dia 7', '2026-11-07'],
      ['Outubro', '2026-10-31'],
    ] as const) {
      await expense(description, date, 'Lazer');
    }
    // Consumo de novembro: Alimentação 90%, Moradia 50%, Transporte 120%, Lazer 6.000/100.000.
    await expense('Mercado', '2026-11-10', 'Alimentação', 90_000);
    await expense('Aluguel', '2026-11-10', 'Moradia', 50_000);
    await expense('Combustível', '2026-11-10', 'Transporte', 120_000);
    for (const [category, limitAmount] of [
      ['Alimentação', 100_000],
      ['Moradia', 100_000],
      ['Transporte', 100_000],
      ['Lazer', 100_000],
    ] as const) {
      await user.api('POST', '/v1/budgets', { categoryId: byName(category).id, limitAmount });
    }

    const goal = async (name: string, overrides: Record<string, unknown> = {}, on = app) => {
      const response = await on.inject({
        method: 'POST',
        url: '/v1/goals',
        cookies: user.cookies,
        payload: {
          name,
          targetAmount: 1_000_000,
          color: '#2e7d32',
          icon: 'flight',
          ...overrides,
        },
      });
      return response.json<GoalDto>();
    };
    await goal('Sem prazo');
    await goal('Concluída', { initialAmount: 1_000_000 });
    await goal('Atrasada', { deadline: '2026-10-15' }, october);
    await goal('Próxima', { deadline: '2026-12-01' });
    const archived = await goal('Arquivada', { deadline: '2026-11-20' });
    await user.api('PATCH', `/v1/goals/${archived.id}`, { isArchived: true });
  });

  afterAll(async () => {
    await october.close();
    await app.close();
  });

  const dashboard = async (query = '') =>
    (await user.api('GET', `/v1/dashboard${query}`)).json<DashboardDto>();

  it('traz as 5 transações mais recentes do período', async () => {
    const { recentTransactions } = await dashboard();

    expect(recentTransactions.map(({ description }) => description)).toEqual([
      'Dia 12',
      // Mesmo dia: a registrada por último primeiro.
      'Combustível',
      'Aluguel',
      'Mercado',
      'Dia 9',
    ]);
  });

  it('as recentes seguem o período escolhido', async () => {
    const { recentTransactions } = await dashboard('?from=2026-10-01&to=2026-10-31');

    expect(recentTransactions.map(({ description }) => description)).toEqual(['Outubro']);
  });

  it('destaca os 3 orçamentos mais consumidos no mês atual', async () => {
    const { budgetHighlights } = await dashboard();

    expect(
      budgetHighlights.map(({ categoryId, progress }) => [categoryId, progress?.state]),
    ).toEqual([
      [byName('Transporte').id, 'exceeded'],
      [byName('Alimentação').id, 'warning'],
      [byName('Moradia').id, 'ok'],
    ]);
  });

  it('os destaques de orçamento não seguem o período escolhido', async () => {
    const { budgetHighlights } = await dashboard('?from=2026-10-01&to=2026-10-31');

    expect(budgetHighlights[0]?.progress?.month).toBe('2026-11');
  });

  it('destaca até 3 metas ativas não concluídas, atrasadas primeiro', async () => {
    const { goalHighlights } = await dashboard();

    expect(goalHighlights.map(({ name, status }) => [name, status])).toEqual([
      ['Atrasada', 'overdue'],
      ['Próxima', 'in-progress'],
      ['Sem prazo', 'in-progress'],
    ]);
  });
});
