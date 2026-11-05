import { randomUUID, randomUUIDv7 } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../../../test/helpers/app.ts';
import { categories, type NewCategory } from '../../db/schema/index.ts';
import { SESSION_COOKIE } from '../auth/session-cookie.ts';
import type { CategoryDto } from './categories.schemas.ts';
import { categoryNameKey } from './category-name.ts';

describe('rotas /v1/categories', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  /** Cadastra um usuário novo e devolve o id e o token da sessão. */
  async function signUp(): Promise<{ userId: string; token: string }> {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: {
        name: 'Pessoa de Teste',
        email: `pessoa.${randomUUID()}@exemplo.com`,
        password: 'senha1234',
      },
    });
    const token = response.cookies.find(({ name }) => name === SESSION_COOKIE)?.value;
    if (!token) throw new Error('cadastro sem cookie de sessão');
    return { userId: response.json<{ id: string }>().id, token };
  }

  /** O cadastro de categorias pela API chega no próximo passo; aqui elas entram direto no banco. */
  async function insertCategory(userId: string, overrides: Partial<NewCategory> = {}) {
    const name = overrides.name ?? 'Alimentação';
    const [category] = await app.db
      .insert(categories)
      .values({
        userId,
        name,
        nameNormalized: categoryNameKey(name),
        type: 'expense',
        icon: 'restaurant',
        color: '#c62828',
        ...overrides,
      })
      .returning();
    if (!category) throw new Error('categoria não inserida');
    return category;
  }

  const get = (url: string, token?: string) =>
    app.inject({
      method: 'GET',
      url,
      ...(token && { cookies: { [SESSION_COOKIE]: token } }),
    });

  const names = (response: Awaited<ReturnType<typeof get>>) =>
    response.json<CategoryDto[]>().map((category) => category.name);

  /** Usuário com duas despesas, uma receita e uma despesa arquivada. */
  async function userWithCategories() {
    const user = await signUp();
    await insertCategory(user.userId, { name: 'mercado', icon: 'shopping_cart' });
    await insertCategory(user.userId, { name: 'Educação', icon: 'school' });
    await insertCategory(user.userId, { name: 'Salário', type: 'income', icon: 'work' });
    await insertCategory(user.userId, { name: 'Antiga', isArchived: true });
    return user;
  }

  describe('GET /v1/categories', () => {
    it('lista as ativas dos dois tipos, em ordem alfabética, só do usuário', async () => {
      const { token } = await userWithCategories();
      const other = await signUp();
      await insertCategory(other.userId, { name: 'Categoria de outra pessoa' });

      const response = await get('/v1/categories', token);

      expect(response.statusCode).toBe(200);
      expect(names(response)).toEqual(['Educação', 'mercado', 'Salário']);
    });

    it.each([
      ['expense', ['Educação', 'mercado']],
      ['income', ['Salário']],
    ])('filtra por type=%s', async (type, expected) => {
      const { token } = await userWithCategories();

      const response = await get(`/v1/categories?type=${type}`, token);

      expect(names(response)).toEqual(expected);
    });

    it('inclui as arquivadas com includeArchived=true, também junto do filtro de tipo', async () => {
      const { token } = await userWithCategories();

      const response = await get('/v1/categories?type=expense&includeArchived=true', token);

      expect(names(response)).toEqual(['Antiga', 'Educação', 'mercado']);
    });

    it.each([
      ['type=transfer', 'querystring.type', 'Selecione despesa ou receita.'],
      ['includeArchived=sim', 'querystring.includeArchived', 'Use true ou false.'],
    ])('responde 422 para %s', async (query, field, message) => {
      const { token } = await signUp();

      const response = await get(`/v1/categories?${query}`, token);

      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({ errors: [{ field, message }] });
    });

    it('responde 401 sem sessão', async () => {
      expect((await get('/v1/categories')).statusCode).toBe(401);
    });
  });

  describe('GET /v1/categories/:id', () => {
    it('detalha a categoria sem expor o dono nem o nome normalizado', async () => {
      const { userId, token } = await signUp();
      const category = await insertCategory(userId, { isDefault: true });

      const response = await get(`/v1/categories/${category.id}`, token);

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        id: category.id,
        name: 'Alimentação',
        type: 'expense',
        icon: 'restaurant',
        color: '#c62828',
        isDefault: true,
        isArchived: false,
        createdAt: category.createdAt.toISOString(),
      });
    });

    it('detalha também categoria arquivada', async () => {
      const { userId, token } = await signUp();
      const category = await insertCategory(userId, { isArchived: true });

      const response = await get(`/v1/categories/${category.id}`, token);

      expect(response.json<CategoryDto>().isArchived).toBe(true);
    });

    it('responde 404 igual para categoria de outro usuário e categoria inexistente', async () => {
      const owner = await signUp();
      const category = await insertCategory(owner.userId);
      const { token } = await signUp();

      for (const id of [category.id, randomUUIDv7()]) {
        const response = await get(`/v1/categories/${id}`, token);

        expect(response.statusCode).toBe(404);
        expect(response.json()).toMatchObject({
          status: 404,
          detail: 'Categoria não encontrada.',
        });
      }
    });

    it('responde 422 para id que não é UUID', async () => {
      const { token } = await signUp();

      const response = await get('/v1/categories/abc', token);

      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({
        errors: [{ field: 'params.id', message: 'Identificador de categoria inválido.' }],
      });
    });

    it('responde 401 sem sessão', async () => {
      expect((await get(`/v1/categories/${randomUUIDv7()}`)).statusCode).toBe(401);
    });
  });
});
