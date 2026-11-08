import { randomUUIDv7 } from 'node:crypto';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp } from '../../../test/helpers/app.ts';
import { createAccount, signUp, type TestUser } from '../../../test/helpers/users.ts';
import { goalBalance } from './goal-rules.ts';
import type { GoalDto } from './goals.schemas.ts';

// Hoje é 15/11/2026. Cada teste começa com uma meta de R$ 10.000 e R$ 1.000 já guardados.
describe('aportes e retiradas das metas', () => {
  let app: FastifyInstance;
  let user: TestUser;
  let goal: GoalDto;

  beforeAll(async () => {
    app = await createTestApp({ today: '2026-11-15' });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    user = await signUp(app);
    goal = (
      await user.api('POST', '/v1/goals', {
        name: 'Viagem',
        targetAmount: 1_000_000,
        initialAmount: 100_000,
        color: '#2e7d32',
        icon: 'flight',
      })
    ).json<GoalDto>();
  });

  const add = (body: Record<string, unknown>, api = user.api) =>
    api('POST', `/v1/goals/${goal.id}/contributions`, {
      type: 'deposit',
      amount: 10_000,
      date: '2026-11-01',
      ...body,
    });

  const remove = (contributionId: string, api = user.api) =>
    api('DELETE', `/v1/goals/${goal.id}/contributions/${contributionId}`);

  /** Acumulado da meta como o front calcula: inicial + aportes − retiradas. */
  const balanceOf = (current: GoalDto) => goalBalance(current.initialAmount, current.contributions);

  function expectConflict(response: LightMyRequestResponse, detail: string) {
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ status: 409, detail });
  }

  it('registra o aporte e devolve a meta com as movimentações', async () => {
    const response = await add({ amount: 50_000, note: '  Bônus  ' });

    expect(response.statusCode).toBe(201);
    const updated = response.json<GoalDto>();
    expect(updated.contributions).toEqual([
      {
        id: expect.any(String) as unknown,
        type: 'deposit',
        accountId: null,
        amount: 50_000,
        date: '2026-11-01',
        note: 'Bônus',
        createdAt: expect.any(String) as unknown,
      },
    ]);
    expect(balanceOf(updated)).toBe(150_000);
  });

  it('lista as movimentações das mais recentes para as mais antigas', async () => {
    await add({ date: '2026-10-01', note: 'Outubro' });
    await add({ date: '2026-11-10', note: 'Novembro' });
    await add({ type: 'withdrawal', amount: 5_000, date: '2026-11-10', note: 'Resgate' });

    const current = (await user.api('GET', `/v1/goals/${goal.id}`)).json<GoalDto>();

    expect(current.contributions.map(({ note }) => note)).toEqual([
      'Resgate',
      'Novembro',
      'Outubro',
    ]);
    expect(balanceOf(current)).toBe(115_000);
  });

  it('aceita retirada até zerar o acumulado, mas não além', async () => {
    expect((await add({ type: 'withdrawal', amount: 100_000 })).statusCode).toBe(201);

    expectConflict(
      await add({ type: 'withdrawal', amount: 1 }),
      'A retirada é maior que o valor acumulado.',
    );
  });

  it('duas retiradas ao mesmo tempo não deixam o acumulado negativo', async () => {
    const responses = await Promise.all([
      add({ type: 'withdrawal', amount: 60_000 }),
      add({ type: 'withdrawal', amount: 60_000 }),
    ]);

    expect(responses.map((response) => response.statusCode).sort()).toEqual([201, 409]);
    const current = (await user.api('GET', `/v1/goals/${goal.id}`)).json<GoalDto>();
    expect(balanceOf(current)).toBe(40_000);
  });

  it.each([
    ['data futura', { date: '2026-11-16' }, 'body.date', 'A data não pode ser futura.'],
    ['valor zero', { amount: 0 }, 'body.amount', 'O valor deve ser maior que zero.'],
    ['tipo desconhecido', { type: 'transfer' }, 'body.type', 'Selecione aporte ou retirada.'],
    [
      'observação com 121 caracteres',
      { note: 'a'.repeat(121) },
      'body.note',
      'A observação deve ter no máximo 120 caracteres.',
    ],
  ])('responde 422 para %s', async (_case, body, field, message) => {
    const response = await add(body);

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ errors: [{ field, message }] });
  });

  describe('conta da movimentação', () => {
    it('guarda a conta do aporte e da retirada', async () => {
      const account = await createAccount(user);

      await add({ accountId: account.id });
      const response = await add({ type: 'withdrawal', amount: 5_000, accountId: account.id });

      expect(response.statusCode).toBe(201);
      expect(response.json<GoalDto>().contributions.map((item) => item.accountId)).toEqual([
        account.id,
        account.id,
      ]);
    });

    it('responde 422 para conta inexistente ou de outra pessoa', async () => {
      const other = await signUp(app);
      const othersAccount = await createAccount(other);

      for (const accountId of [randomUUIDv7(), othersAccount.id]) {
        const response = await add({ accountId });

        expect(response.statusCode).toBe(422);
        expect(response.json()).toMatchObject({
          errors: [{ field: 'body.accountId', message: 'Conta não encontrada.' }],
        });
      }
    });

    it('responde 409 para conta arquivada', async () => {
      const account = await createAccount(user, { name: 'Antiga' });
      await user.api('PATCH', `/v1/accounts/${account.id}`, { isArchived: true });

      const response = await add({ accountId: account.id });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        type: '/problems/archived-reference',
        detail: 'A conta "Antiga" está arquivada. Reative-a para movimentar a meta com ela.',
      });
    });
  });

  describe('excluir movimentação', () => {
    it('recalcula o acumulado', async () => {
      const deposit = (await add({ amount: 50_000 })).json<GoalDto>().contributions[0]!;

      const response = await remove(deposit.id);

      expect(response.statusCode).toBe(200);
      expect(response.json<GoalDto>().contributions).toEqual([]);
    });

    it('não exclui o aporte que sustenta uma retirada', async () => {
      const deposit = (await add({ amount: 50_000 })).json<GoalDto>().contributions[0]!;
      await add({ type: 'withdrawal', amount: 120_000 });

      expectConflict(
        await remove(deposit.id),
        'Sem este aporte, as retiradas deixariam o acumulado negativo.',
      );
    });

    it('excluir uma retirada sempre é possível', async () => {
      const withdrawal = (await add({ type: 'withdrawal', amount: 100_000 })).json<GoalDto>()
        .contributions[0]!;

      expect((await remove(withdrawal.id)).statusCode).toBe(200);
    });

    it('responde 404 para movimentação inexistente ou de outra meta', async () => {
      const otherGoal = (
        await user.api('POST', '/v1/goals', {
          name: 'Outra',
          targetAmount: 1_000,
          color: '#2e7d32',
          icon: 'savings',
        })
      ).json<GoalDto>();
      const elsewhere = (
        await user.api('POST', `/v1/goals/${otherGoal.id}/contributions`, {
          type: 'deposit',
          amount: 1_000,
          date: '2026-11-01',
        })
      ).json<GoalDto>().contributions[0]!;

      for (const id of [randomUUIDv7(), elsewhere.id]) {
        const response = await remove(id);

        expect(response.statusCode).toBe(404);
        expect(response.json()).toMatchObject({ detail: 'Movimentação não encontrada.' });
      }
    });
  });

  it('o valor inicial também não pode deixar o acumulado negativo', async () => {
    await add({ type: 'withdrawal', amount: 80_000 });

    expectConflict(
      await user.api('PATCH', `/v1/goals/${goal.id}`, { initialAmount: 50_000 }),
      'Com esse valor inicial, as retiradas deixariam o acumulado negativo.',
    );
    expect(
      (await user.api('PATCH', `/v1/goals/${goal.id}`, { initialAmount: 80_000 })).statusCode,
    ).toBe(200);
  });

  it('não movimenta meta de outro usuário', async () => {
    const deposit = (await add({})).json<GoalDto>().contributions[0]!;
    const other = await signUp(app);

    expect((await add({}, other.api)).statusCode).toBe(404);
    expect((await remove(deposit.id, other.api)).statusCode).toBe(404);
    const current = (await user.api('GET', `/v1/goals/${goal.id}`)).json<GoalDto>();
    expect(current.contributions).toHaveLength(1);
  });
});
