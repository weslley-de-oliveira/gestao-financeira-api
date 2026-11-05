import { randomUUIDv7 } from 'node:crypto';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp } from '../../../test/helpers/app.ts';
import { signUp, type TestUser } from '../../../test/helpers/users.ts';
import type { GoalDto } from './goals.schemas.ts';

// Hoje é 15/11/2026.
describe('rotas /v1/goals', () => {
  let app: FastifyInstance;
  let user: TestUser;

  beforeAll(async () => {
    app = await createTestApp({ today: '2026-11-15' });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    user = await signUp(app);
  });

  const valid = (overrides: Record<string, unknown> = {}) => ({
    name: 'Viagem',
    targetAmount: 1_000_000,
    color: '#2e7d32',
    icon: 'flight',
    ...overrides,
  });

  async function createGoal(overrides: Record<string, unknown> = {}): Promise<GoalDto> {
    const response = await user.api('POST', '/v1/goals', valid(overrides));
    expect(response.statusCode).toBe(201);
    return response.json<GoalDto>();
  }

  const patch = (id: string, body: Record<string, unknown>) =>
    user.api('PATCH', `/v1/goals/${id}`, body);

  function expectInvalid(response: LightMyRequestResponse, field: string, message: string) {
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ errors: [{ field, message }] });
  }

  describe('POST /v1/goals', () => {
    it('cadastra a meta, sem valor inicial nem prazo por padrão', async () => {
      const response = await user.api(
        'POST',
        '/v1/goals',
        valid({ name: '  Viagem   ao Japão ', description: '   ' }),
      );

      expect(response.statusCode).toBe(201);
      expect(response.json()).toEqual({
        id: expect.any(String) as unknown,
        name: 'Viagem ao Japão',
        description: null,
        targetAmount: 1_000_000,
        initialAmount: 0,
        deadline: null,
        color: '#2e7d32',
        icon: 'flight',
        isPaused: false,
        isArchived: false,
        createdAt: expect.any(String) as unknown,
        contributions: [],
        currentAmount: 0,
        remainingAmount: 1_000_000,
        excessAmount: 0,
        percent: 0,
        status: 'in-progress',
        monthsLeft: null,
        monthlyPace: null,
      });
    });

    it('aceita prazo hoje ou no futuro', async () => {
      expect((await createGoal({ deadline: '2026-11-15' })).deadline).toBe('2026-11-15');
      expect((await createGoal({ deadline: '2027-04-30' })).deadline).toBe('2027-04-30');
    });

    it.each([
      [
        'prazo no passado',
        { deadline: '2026-11-14' },
        'body.deadline',
        'A data-limite deve ser hoje ou uma data futura.',
      ],
      [
        'prazo inexistente',
        { deadline: '2026-02-30' },
        'body.deadline',
        'Informe uma data válida no formato aaaa-mm-dd.',
      ],
      ['nome vazio', { name: ' ' }, 'body.name', 'Informe o nome da meta.'],
      [
        'nome com 61 caracteres',
        { name: 'a'.repeat(61) },
        'body.name',
        'O nome deve ter no máximo 60 caracteres.',
      ],
      [
        'descrição com 301 caracteres',
        { description: 'a'.repeat(301) },
        'body.description',
        'A descrição deve ter no máximo 300 caracteres.',
      ],
      ['alvo zero', { targetAmount: 0 }, 'body.targetAmount', 'O valor deve ser maior que zero.'],
      [
        'valor inicial negativo',
        { initialAmount: -1 },
        'body.initialAmount',
        'Informe um valor válido.',
      ],
      [
        'valor inicial fracionado',
        { initialAmount: 1.5 },
        'body.initialAmount',
        'Informe o valor inicial em centavos inteiros.',
      ],
      ['ícone fora da lista', { icon: 'x' }, 'body.icon', 'Selecione um ícone válido.'],
      ['cor fora da paleta', { color: '#000000' }, 'body.color', 'Selecione uma cor válida.'],
    ])('responde 422 para %s', async (_case, overrides, field, message) => {
      expectInvalid(await user.api('POST', '/v1/goals', valid(overrides)), field, message);
    });

    it.each([['userId'], ['isPaused'], ['isArchived']])(
      'responde 422 se o corpo trouxer %s',
      async (field) => {
        const value = field === 'userId' ? randomUUIDv7() : true;

        expect((await user.api('POST', '/v1/goals', valid({ [field]: value }))).statusCode).toBe(
          422,
        );
      },
    );
  });

  describe('GET /v1/goals', () => {
    it('lista as ativas, prazo mais próximo primeiro e sem prazo por último', async () => {
      await createGoal({ name: 'Sem prazo' });
      await createGoal({ name: 'Distante', deadline: '2027-12-01' });
      await createGoal({ name: 'Próxima', deadline: '2026-12-01' });
      const archived = await createGoal({ name: 'Arquivada' });
      await patch(archived.id, { isArchived: true });

      const names = async (query = '') =>
        (await user.api('GET', `/v1/goals${query}`)).json<GoalDto[]>().map((goal) => goal.name);

      expect(await names()).toEqual(['Próxima', 'Distante', 'Sem prazo']);
      expect(await names('?includeArchived=true')).toEqual([
        'Próxima',
        'Distante',
        'Arquivada',
        'Sem prazo',
      ]);
    });

    it('detalha a meta; de outro usuário ou inexistente responde 404 igual', async () => {
      const goal = await createGoal();
      const other = await signUp(app);

      expect((await user.api('GET', `/v1/goals/${goal.id}`)).json()).toEqual(goal);
      for (const id of [goal.id, randomUUIDv7()]) {
        const response = await other.api('GET', `/v1/goals/${id}`);

        expect(response.statusCode).toBe(404);
        expect(response.json()).toMatchObject({ detail: 'Meta não encontrada.' });
      }
    });
  });

  describe('PATCH /v1/goals/:id', () => {
    it('altera só os campos enviados e remove descrição e prazo com null', async () => {
      const goal = await createGoal({ description: 'Japão', deadline: '2027-04-30' });

      const response = await patch(goal.id, {
        name: 'Viagem ao Japão',
        targetAmount: 2_000_000,
        description: null,
        deadline: null,
      });

      expect(response.json()).toEqual({
        ...goal,
        name: 'Viagem ao Japão',
        targetAmount: 2_000_000,
        description: null,
        deadline: null,
        // Novo alvo e sem prazo: o restante muda e não há mais ritmo mensal.
        remainingAmount: 2_000_000,
        monthsLeft: null,
        monthlyPace: null,
      });
    });

    it('pausa, retoma, arquiva e reativa; sem rota de exclusão', async () => {
      const goal = await createGoal();

      expect((await patch(goal.id, { isPaused: true })).json()).toMatchObject({ isPaused: true });
      expect((await patch(goal.id, { isPaused: false })).json()).toMatchObject({ isPaused: false });
      expect((await patch(goal.id, { isArchived: true })).json()).toMatchObject({
        isArchived: true,
      });
      expect((await patch(goal.id, { isArchived: false })).json()).toEqual(goal);
      expect((await user.api('DELETE', `/v1/goals/${goal.id}`)).statusCode).toBe(404);
    });

    it('mantém um prazo já vencido, mas não define um novo no passado', async () => {
      const earlier = await createTestApp({ today: '2026-10-01' });
      const created = await earlier.inject({
        method: 'POST',
        url: '/v1/goals',
        cookies: user.cookies,
        payload: valid({ deadline: '2026-10-31' }),
      });
      await earlier.close();
      const goal = created.json<GoalDto>();

      // Hoje (15/11) o prazo de 31/10 já venceu: editar outro campo continua possível.
      expect((await patch(goal.id, { name: 'Vencida' })).statusCode).toBe(200);
      expectInvalid(
        await patch(goal.id, { deadline: '2026-11-01' }),
        'body.deadline',
        'A data-limite deve ser hoje ou uma data futura.',
      );
    });

    it('responde 404 para meta de outro usuário, sem alterá-la', async () => {
      const goal = await createGoal();
      const other = await signUp(app);

      expect(
        (await other.api('PATCH', `/v1/goals/${goal.id}`, { name: 'Invadida' })).statusCode,
      ).toBe(404);
      expect((await user.api('GET', `/v1/goals/${goal.id}`)).json()).toEqual(goal);
    });
  });
});
