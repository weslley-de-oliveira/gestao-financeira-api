import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp } from '../../../test/helpers/app.ts';
import { signUp, type TestUser } from '../../../test/helpers/users.ts';
import type { GoalDto } from './goals.schemas.ts';

// Os cenários de `goal-rules.spec.ts` do front, agora pela API. Hoje é 15/11/2026; metas "Viagem"
// com alvo de R$ 10.000.
describe('progresso, status e ritmo mensal das metas', () => {
  let september: FastifyInstance;
  let app: FastifyInstance;
  let user: TestUser;

  beforeAll(async () => {
    september = await createTestApp({ today: '2026-09-01' });
    app = await createTestApp({ today: '2026-11-15' });
  });

  afterAll(async () => {
    await september.close();
    await app.close();
  });

  beforeEach(async () => {
    user = await signUp(app);
  });

  /** Cria a meta no "hoje" da instância informada (prazos vencidos precisam nascer antes). */
  async function createGoal(
    overrides: Record<string, unknown> = {},
    on: FastifyInstance = app,
  ): Promise<GoalDto> {
    const response = await on.inject({
      method: 'POST',
      url: '/v1/goals',
      cookies: user.cookies,
      payload: {
        name: 'Viagem',
        targetAmount: 1_000_000,
        initialAmount: 100_000,
        color: '#2e7d32',
        icon: 'flight',
        ...overrides,
      },
    });
    expect(response.statusCode).toBe(201);
    return response.json<GoalDto>();
  }

  const current = async (goal: GoalDto) =>
    (await user.api('GET', `/v1/goals/${goal.id}`)).json<GoalDto>();

  it('calcula o restante e o ritmo mensal contando o mês atual, arredondado para cima', async () => {
    const goal = await createGoal({ deadline: '2027-04-30' });

    const response = await user.api('POST', `/v1/goals/${goal.id}/contributions`, {
      type: 'deposit',
      amount: 100_000,
      date: '2026-11-01',
    });

    expect(response.json()).toMatchObject({
      currentAmount: 200_000,
      remainingAmount: 800_000,
      excessAmount: 0,
      percent: 20,
      status: 'in-progress',
      monthsLeft: 6,
      // 800.000 / 6 = 133.333,33… → arredondado para cima.
      monthlyPace: 133_334,
    });
  });

  it('mantém o excedente quando a meta é concluída', async () => {
    const goal = await createGoal({ initialAmount: 1_250_000 });

    expect(goal).toMatchObject({
      status: 'completed',
      remainingAmount: 0,
      excessAmount: 250_000,
      percent: 125,
      monthlyPace: null,
    });
  });

  it('prazo no mês atual: um mês para juntar o restante', async () => {
    expect(await createGoal({ deadline: '2026-11-30' })).toMatchObject({
      monthsLeft: 1,
      monthlyPace: 900_000,
    });
  });

  it('com o prazo vencido, fica atrasada e sem ritmo; pausada, fica pausada', async () => {
    const goal = await createGoal({ deadline: '2026-10-01' }, september);

    expect(await current(goal)).toMatchObject({
      status: 'overdue',
      monthsLeft: null,
      monthlyPace: null,
    });
    const paused = await user.api('PATCH', `/v1/goals/${goal.id}`, { isPaused: true });
    expect(paused.json()).toMatchObject({ status: 'paused', monthlyPace: null });
  });

  it('concluída vale mais que pausada', async () => {
    const goal = await createGoal({ initialAmount: 1_000_000 });

    const paused = await user.api('PATCH', `/v1/goals/${goal.id}`, { isPaused: true });

    expect(paused.json()).toMatchObject({ status: 'completed', isPaused: true });
  });

  it('lista o que pede ação primeiro', async () => {
    await createGoal({ name: 'Sem prazo' });
    await createGoal({ name: 'Concluída', initialAmount: 1_000_000 });
    await createGoal({ name: 'Atrasada', deadline: '2026-10-01' }, september);
    await createGoal({ name: 'Próxima', deadline: '2026-12-01' });
    const paused = await createGoal({ name: 'Pausada' });
    await user.api('PATCH', `/v1/goals/${paused.id}`, { isPaused: true });

    const names = (await user.api('GET', '/v1/goals')).json<GoalDto[]>().map((goal) => goal.name);

    expect(names).toEqual(['Atrasada', 'Próxima', 'Sem prazo', 'Pausada', 'Concluída']);
  });
});
