import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp } from '../../../test/helpers/app.ts';
import { createAccount, signUp, type TestUser } from '../../../test/helpers/users.ts';
import type { CategoryDto } from '../categories/categories.schemas.ts';
import type { DashboardDto } from '../dashboard/dashboard.schemas.ts';
import type { GoalDto } from '../goals/goals.schemas.ts';
import type { TransactionDto } from '../transactions/transactions.schemas.ts';
import { calculateBalance, goalMovements, goalsTotal } from './account-balance.ts';
import type { AccountDto } from './accounts.schemas.ts';

// Hoje é 15/11/2026. Cada teste começa com uma conta de R$ 1.000 e uma meta sem nada guardado.
describe('movimentações de metas no saldo das contas', () => {
  let app: FastifyInstance;
  let user: TestUser;
  let account: { id: string };
  let goal: GoalDto;

  beforeAll(async () => {
    app = await createTestApp({ today: '2026-11-15' });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    user = await signUp(app);
    account = await createAccount(user, { name: 'Corrente', initialBalance: 100_000 });
    goal = (
      await user.api('POST', '/v1/goals', {
        name: 'Viagem',
        targetAmount: 1_000_000,
        color: '#2e7d32',
        icon: 'flight',
      })
    ).json<GoalDto>();
  });

  const move = async (body: Record<string, unknown>, goalId = goal.id) => {
    const response = await user.api('POST', `/v1/goals/${goalId}/contributions`, {
      type: 'deposit',
      amount: 10_000,
      date: '2026-11-10',
      accountId: account.id,
      ...body,
    });
    expect(response.statusCode).toBe(201);
    return response.json<GoalDto>();
  };

  const getAccount = async (id = account.id) =>
    (await user.api('GET', `/v1/accounts/${id}`)).json<AccountDto>();

  it('o aporte sai da conta e a retirada volta para ela', async () => {
    await move({ amount: 30_000 });
    await move({ type: 'withdrawal', amount: 5_000 });

    expect(await getAccount()).toMatchObject({ currentBalance: 75_000, goalsTotal: 25_000 });
  });

  it('sem conta, só a meta muda', async () => {
    await move({ accountId: null, amount: 30_000 });

    expect(await getAccount()).toMatchObject({ currentBalance: 100_000, goalsTotal: 0 });
  });

  it('excluir a movimentação devolve o valor à conta', async () => {
    const deposit = (await move({ amount: 30_000 })).contributions[0]!;

    await user.api('DELETE', `/v1/goals/${goal.id}/contributions/${deposit.id}`);

    expect(await getAccount()).toMatchObject({ currentBalance: 100_000, goalsTotal: 0 });
  });

  it('o efeito continua depois de arquivar a conta, e aparece na listagem', async () => {
    await move({ amount: 30_000 });
    await user.api('PATCH', `/v1/accounts/${account.id}`, { isArchived: true });

    const list = (await user.api('GET', '/v1/accounts?includeArchived=true')).json<AccountDto[]>();

    expect(list).toEqual([
      expect.objectContaining({ currentBalance: 70_000, goalsTotal: 30_000, isArchived: true }),
    ]);
  });

  it('a retirada pode voltar para outra conta', async () => {
    const savings = await createAccount(user, { name: 'Poupança' });
    await move({ amount: 30_000 });
    await move({ type: 'withdrawal', amount: 30_000, accountId: savings.id });

    expect(await getAccount()).toMatchObject({ currentBalance: 70_000, goalsTotal: 30_000 });
    expect(await getAccount(savings.id)).toMatchObject({
      currentBalance: 30_000,
      goalsTotal: -30_000,
    });
  });

  it('não sofre efeito das metas de outra pessoa', async () => {
    const other = await signUp(app);
    const otherAccount = await createAccount(other);
    const otherGoal = (
      await other.api('POST', '/v1/goals', {
        name: 'Dela',
        targetAmount: 1_000,
        color: '#2e7d32',
        icon: 'savings',
      })
    ).json<GoalDto>();
    await other.api('POST', `/v1/goals/${otherGoal.id}/contributions`, {
      type: 'deposit',
      amount: 500,
      date: '2026-11-10',
      accountId: otherAccount.id,
    });

    expect(await getAccount()).toMatchObject({ currentBalance: 100_000, goalsTotal: 0 });
  });

  it('dá o mesmo saldo que a regra do front (paridade)', async () => {
    const savings = await createAccount(user, { name: 'Poupança', initialBalance: 5_000 });
    const categories = (await user.api('GET', '/v1/categories')).json<CategoryDto[]>();
    const food = categories.find((category) => category.name === 'Alimentação')!;
    const created: TransactionDto[] = [];
    for (const payload of [
      { type: 'expense', amount: 12_345, accountId: account.id, categoryId: food.id },
      { type: 'transfer', amount: 20_000, accountId: account.id, destinationAccountId: savings.id },
    ]) {
      const response = await user.api('POST', '/v1/transactions', {
        description: 'Lançamento',
        date: '2026-11-05',
        ...payload,
      });
      created.push(response.json<TransactionDto>());
    }
    await move({ amount: 30_000 });
    await move({ amount: 1_000, accountId: savings.id });
    await move({ type: 'withdrawal', amount: 7_000 });
    const current = await move({ amount: 2_000, accountId: null });

    const movements = [...created, ...goalMovements(current.contributions)];
    for (const { id, initialBalance } of [
      { id: account.id, initialBalance: 100_000 },
      { id: savings.id, initialBalance: 5_000 },
    ]) {
      expect(await getAccount(id)).toMatchObject({
        currentBalance: calculateBalance({ id, initialBalance }, movements),
        goalsTotal: goalsTotal(id, current.contributions),
      });
    }
  });

  describe('dashboard', () => {
    const dashboard = async (query = '') =>
      (await user.api('GET', `/v1/dashboard${query}`)).json<DashboardDto>();

    it('o saldo total e a evolução do saldo consideram as metas', async () => {
      await move({ amount: 30_000, date: '2026-11-10' });
      await move({ type: 'withdrawal', amount: 5_000, date: '2026-11-12' });

      const { balance, balanceEvolution, summary } = await dashboard();

      expect(balance.total).toBe(75_000);
      expect(balanceEvolution.find((point) => point.date === '2026-11-09')?.balance).toBe(100_000);
      expect(balanceEvolution.find((point) => point.date === '2026-11-10')?.balance).toBe(70_000);
      expect(balanceEvolution.find((point) => point.date === '2026-11-12')?.balance).toBe(75_000);
      expect(balanceEvolution.at(-1)?.balance).toBe(balance.total);
      // Não é receita nem despesa.
      expect(summary).toMatchObject({ income: 0, expense: 0 });
    });

    it('o saldo de abertura do período inclui as movimentações anteriores', async () => {
      await move({ amount: 30_000, date: '2026-10-20' });

      const { balanceEvolution } = await dashboard('?from=2026-11-01&to=2026-11-15');

      expect(balanceEvolution[0]).toEqual({ date: '2026-11-01', balance: 70_000 });
    });
  });
});
