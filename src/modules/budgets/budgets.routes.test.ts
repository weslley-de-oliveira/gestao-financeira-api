import { randomUUIDv7 } from 'node:crypto';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp } from '../../../test/helpers/app.ts';
import { signUp, type TestUser } from '../../../test/helpers/users.ts';
import type { CategoryDto } from '../categories/categories.schemas.ts';
import type { BudgetDto } from './budgets.schemas.ts';

// Hoje é 15/11/2026: o limite de um orçamento novo vale de 2026-11 em diante.
describe('rotas /v1/budgets', () => {
  let app: FastifyInstance;
  let user: TestUser;
  let food: CategoryDto;
  let salary: CategoryDto;

  beforeAll(async () => {
    app = await createTestApp({ today: '2026-11-15' });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    user = await signUp(app);
    const categories = (await user.api('GET', '/v1/categories')).json<CategoryDto[]>();
    food = categories.find((category) => category.name === 'Alimentação')!;
    salary = categories.find((category) => category.name === 'Salário')!;
  });

  const create = (body: Record<string, unknown>, api = user.api) =>
    api('POST', '/v1/budgets', body);

  const valid = () => ({ categoryId: food.id, limitAmount: 80_000 });

  function expectInvalid(response: LightMyRequestResponse, field: string, message: string) {
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ errors: [{ field, message }] });
  }

  describe('POST /v1/budgets', () => {
    it('cria o orçamento com o limite valendo do mês atual e alerta de 80%', async () => {
      const response = await create(valid());

      expect(response.statusCode).toBe(201);
      expect(response.json()).toEqual({
        id: expect.any(String) as unknown,
        categoryId: food.id,
        alertThreshold: 80,
        limitAmount: 80_000,
        limits: [{ month: '2026-11', amount: 80_000 }],
        // Consumo do mês atual, ainda sem gastos.
        progress: {
          month: '2026-11',
          limit: 80_000,
          spent: 0,
          pending: 0,
          available: 80_000,
          percent: 0,
          state: 'ok',
        },
        createdAt: expect.any(String) as unknown,
        updatedAt: expect.any(String) as unknown,
      });
    });

    it('aceita os percentuais de alerta do formulário', async () => {
      const response = await create({ ...valid(), alertThreshold: 95 });

      expect(response.json<BudgetDto>().alertThreshold).toBe(95);
    });

    it('responde 409 para um segundo orçamento da mesma categoria', async () => {
      await create(valid());

      const response = await create({ ...valid(), limitAmount: 1_000 });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        detail: 'Já existe um orçamento para a categoria "Alimentação". Altere o limite dele.',
      });
    });

    it('cadastros simultâneos para a mesma categoria: um entra, o outro recebe 409', async () => {
      const responses = await Promise.all([create(valid()), create(valid())]);

      expect(responses.map((response) => response.statusCode).sort()).toEqual([201, 409]);
    });

    it('responde 422 para categoria de receita', async () => {
      expectInvalid(
        await create({ ...valid(), categoryId: salary.id }),
        'body.categoryId',
        'Orçamentos são de categorias de despesa.',
      );
    });

    it('trata categoria de outro usuário e inexistente como inexistentes', async () => {
      const other = await signUp(app);
      const otherFood = (await other.api('GET', '/v1/categories?type=expense')).json<
        CategoryDto[]
      >()[0]!;

      for (const categoryId of [otherFood.id, randomUUIDv7()]) {
        expectInvalid(
          await create({ ...valid(), categoryId }),
          'body.categoryId',
          'Categoria não encontrada.',
        );
      }
    });

    it('responde 409 para categoria arquivada', async () => {
      await user.api('PATCH', `/v1/categories/${food.id}`, { isArchived: true });

      const response = await create(valid());

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        detail: 'A categoria "Alimentação" está arquivada. Reative-a para criar o orçamento.',
      });
    });

    it.each([
      ['limite zero', { limitAmount: 0 }, 'body.limitAmount', 'O limite deve ser maior que zero.'],
      [
        'limite fracionado',
        { limitAmount: 10.5 },
        'body.limitAmount',
        'Informe o limite em centavos inteiros.',
      ],
      [
        'limite acima de R$ 1 bilhão',
        { limitAmount: 100_000_000_001 },
        'body.limitAmount',
        'O valor deve ser de até R$ 1 bilhão.',
      ],
      [
        'alerta fora das opções',
        { alertThreshold: 83 },
        'body.alertThreshold',
        'Selecione um percentual de alerta entre 50, 60, 70, 75, 80, 85, 90, 95, 100.',
      ],
      ['sem categoria', { categoryId: undefined }, 'body.categoryId', 'Selecione a categoria.'],
    ])('responde 422 para %s', async (_case, overrides, field, message) => {
      expectInvalid(await create({ ...valid(), ...overrides }), field, message);
    });

    it.each([['userId'], ['limits']])('responde 422 se o corpo trouxer %s', async (field) => {
      const response = await create({ ...valid(), [field]: randomUUIDv7() });

      expect(response.statusCode).toBe(422);
    });

    it('responde 401 sem sessão', async () => {
      const response = await app.inject({ method: 'POST', url: '/v1/budgets', payload: valid() });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('GET /v1/budgets/:id', () => {
    it('detalha o orçamento com as vigências', async () => {
      const created = (await create(valid())).json<BudgetDto>();

      const response = await user.api('GET', `/v1/budgets/${created.id}`);

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(created);
    });

    it('responde 404 igual para orçamento de outro usuário e inexistente', async () => {
      const created = (await create(valid())).json<BudgetDto>();
      const other = await signUp(app);

      for (const id of [created.id, randomUUIDv7()]) {
        const response = await other.api('GET', `/v1/budgets/${id}`);

        expect(response.statusCode).toBe(404);
        expect(response.json()).toMatchObject({ detail: 'Orçamento não encontrado.' });
      }
    });
  });

  describe('DELETE /v1/budgets/:id', () => {
    it('exclui o orçamento e libera a categoria para um novo', async () => {
      const created = (await create(valid())).json<BudgetDto>();

      const response = await user.api('DELETE', `/v1/budgets/${created.id}`);

      expect(response.statusCode).toBe(204);
      expect(response.body).toBe('');
      expect((await user.api('GET', `/v1/budgets/${created.id}`)).statusCode).toBe(404);
      expect((await create(valid())).statusCode).toBe(201);
    });

    it('não mexe nas transações da categoria', async () => {
      const account = (
        await user.api('POST', '/v1/accounts', {
          name: 'Conta',
          type: 'checking',
          color: '#1565c0',
          icon: 'home',
        })
      ).json<{ id: string }>();
      const expense = await user.api('POST', '/v1/transactions', {
        type: 'expense',
        description: 'Mercado',
        amount: 1_000,
        date: '2026-11-10',
        accountId: account.id,
        categoryId: food.id,
      });
      const created = (await create(valid())).json<BudgetDto>();

      await user.api('DELETE', `/v1/budgets/${created.id}`);

      const id = expense.json<{ id: string }>().id;
      expect((await user.api('GET', `/v1/transactions/${id}`)).statusCode).toBe(200);
    });

    it('responde 404 ao excluir de novo e para orçamento de outro usuário', async () => {
      const created = (await create(valid())).json<BudgetDto>();
      const other = await signUp(app);

      expect((await other.api('DELETE', `/v1/budgets/${created.id}`)).statusCode).toBe(404);
      expect((await user.api('GET', `/v1/budgets/${created.id}`)).statusCode).toBe(200);
      await user.api('DELETE', `/v1/budgets/${created.id}`);
      expect((await user.api('DELETE', `/v1/budgets/${created.id}`)).statusCode).toBe(404);
    });
  });
});
