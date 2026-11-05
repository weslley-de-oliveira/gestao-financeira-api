import { randomUUIDv7 } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp } from '../../../test/helpers/app.ts';
import { signUp, type TestUser } from '../../../test/helpers/users.ts';
import type { CategoryDto } from '../categories/categories.schemas.ts';
import type { BudgetDto } from './budgets.schemas.ts';

// O orçamento nasce em 11/2026 (limite de R$ 800). Outras instâncias da API, com outro "hoje",
// simulam a passagem dos meses sobre o mesmo banco.
describe('vigências do limite do orçamento', () => {
  let november: FastifyInstance;
  let december: FastifyInstance;
  let user: TestUser;
  let budget: BudgetDto;

  beforeAll(async () => {
    november = await createTestApp({ today: '2026-11-15' });
    december = await createTestApp({ today: '2026-12-10' });
  });

  afterAll(async () => {
    await november.close();
    await december.close();
  });

  beforeEach(async () => {
    user = await signUp(november);
    const food = (await user.api('GET', '/v1/categories?type=expense'))
      .json<CategoryDto[]>()
      .find((category) => category.name === 'Alimentação')!;
    budget = (
      await user.api('POST', '/v1/budgets', { categoryId: food.id, limitAmount: 80_000 })
    ).json<BudgetDto>();
  });

  /** PATCH feito no "hoje" da instância informada. */
  async function patch(app: FastifyInstance, body: Record<string, unknown>, id = budget.id) {
    return app.inject({
      method: 'PATCH',
      url: `/v1/budgets/${id}`,
      cookies: user.cookies,
      payload: body,
    });
  }

  it('mudar o limite em outro mês cria uma vigência nova e preserva os anteriores', async () => {
    const response = await patch(december, { limitAmount: 90_000 });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      limitAmount: 90_000,
      limits: [
        { month: '2026-11', amount: 80_000 },
        { month: '2026-12', amount: 90_000 },
      ],
    });
  });

  it('mudar de novo no mesmo mês substitui a vigência do mês', async () => {
    await patch(december, { limitAmount: 90_000 });

    const response = await patch(december, { limitAmount: 70_000 });

    expect(response.json<BudgetDto>().limits).toEqual([
      { month: '2026-11', amount: 80_000 },
      { month: '2026-12', amount: 70_000 },
    ]);
  });

  it('voltar ao valor anterior dispensa a vigência nova', async () => {
    await patch(december, { limitAmount: 90_000 });

    const response = await patch(december, { limitAmount: 80_000 });

    expect(response.json<BudgetDto>().limits).toEqual([{ month: '2026-11', amount: 80_000 }]);
  });

  it('no mês da criação, o novo limite substitui o primeiro', async () => {
    const response = await patch(november, { limitAmount: 50_000 });

    expect(response.json<BudgetDto>().limits).toEqual([{ month: '2026-11', amount: 50_000 }]);
  });

  it('altera só o alerta, sem mexer nas vigências', async () => {
    const response = await patch(december, { alertThreshold: 100 });

    expect(response.json()).toMatchObject({
      alertThreshold: 100,
      limits: [{ month: '2026-11', amount: 80_000 }],
    });
  });

  it('com corpo vazio, devolve o orçamento sem alterar', async () => {
    const response = await patch(december, {});

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(budget);
  });

  it('responde 422 para trocar a categoria', async () => {
    const response = await patch(december, { categoryId: randomUUIDv7() });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      errors: [
        { field: 'body.categoryId', message: 'A categoria do orçamento não pode ser alterada.' },
      ],
    });
  });

  it('responde 422 para limite inválido, sem alterar nada', async () => {
    expect((await patch(december, { limitAmount: 0 })).statusCode).toBe(422);
    expect((await user.api('GET', `/v1/budgets/${budget.id}`)).json()).toEqual(budget);
  });

  it('responde 404 para orçamento de outro usuário, sem alterá-lo', async () => {
    const other = await signUp(november);

    const response = await december.inject({
      method: 'PATCH',
      url: `/v1/budgets/${budget.id}`,
      cookies: other.cookies,
      payload: { limitAmount: 1 },
    });

    expect(response.statusCode).toBe(404);
    expect((await user.api('GET', `/v1/budgets/${budget.id}`)).json()).toEqual(budget);
  });
});
