import { randomUUID, randomUUIDv7 } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../../../test/helpers/app.ts';
import { categories, type NewCategory } from '../../db/schema/index.ts';
import { SESSION_COOKIE } from '../auth/session-cookie.ts';
import type { CategoryDto } from './categories.schemas.ts';
import { categoryNameKey } from './category-name.ts';
import { DEFAULT_CATEGORIES } from './default-categories.ts';

describe('rotas /v1/categories', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  /**
   * Cadastra um usuário novo e devolve o id e o token da sessão. Por padrão, apaga as categorias
   * criadas no cadastro, para cada teste montar só o cenário que precisa.
   */
  async function signUp({ keepDefaults = false } = {}): Promise<{
    userId: string;
    token: string;
  }> {
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
    const userId = response.json<{ id: string }>().id;
    if (!keepDefaults) {
      await app.db.delete(categories).where(eq(categories.userId, userId));
    }
    return { userId, token };
  }

  /** Categoria gravada direto no banco, para montar cenários (ex.: já arquivada). */
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

  const send = (
    method: 'POST' | 'PATCH',
    url: string,
    payload: Record<string, unknown>,
    token?: string,
  ) =>
    app.inject({
      method,
      url,
      payload,
      ...(token && { cookies: { [SESSION_COOKIE]: token } }),
    });

  const validCategory = {
    name: 'Alimentação',
    type: 'expense',
    icon: 'restaurant',
    color: '#c62828',
  };

  const create = async (token: string, overrides: Record<string, unknown> = {}) =>
    send('POST', '/v1/categories', { ...validCategory, ...overrides }, token);

  async function storedCategory(id: string) {
    const [category] = await app.db.select().from(categories).where(eq(categories.id, id));
    return category;
  }

  function expectConflict(response: Awaited<ReturnType<typeof get>>, detail: string) {
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ status: 409, title: 'Conflito', detail });
  }

  describe('POST /v1/categories', () => {
    it('cadastra a categoria do usuário, não padrão, e grava o nome normalizado', async () => {
      const { userId, token } = await signUp();

      const response = await create(token, { name: '  Lazer   e  Diversão ' });

      expect(response.statusCode).toBe(201);
      const body = response.json<CategoryDto>();
      expect(body).toMatchObject({
        ...validCategory,
        name: 'Lazer e Diversão',
        isDefault: false,
        isArchived: false,
      });
      expect(await storedCategory(body.id)).toMatchObject({
        userId,
        nameNormalized: 'lazer e diversao',
      });
    });

    it('responde 409 para nome repetido no tipo, sem diferenciar acentos, maiúsculas e espaços', async () => {
      const { token } = await signUp();
      await create(token);

      const response = await create(token, { name: '  ALIMENTACAO ' });

      expectConflict(response, 'Já existe uma categoria de despesa com este nome.');
    });

    it('sugere reativar quando a categoria com o nome está arquivada', async () => {
      const { userId, token } = await signUp();
      await insertCategory(userId, {
        name: 'Salário',
        type: 'income',
        icon: 'work',
        isArchived: true,
      });

      const response = await create(token, { name: 'salario', type: 'income', icon: 'work' });

      expectConflict(
        response,
        'Já existe uma categoria de receita arquivada com este nome. Reative-a em vez de criar outra.',
      );
    });

    it('aceita o mesmo nome no outro tipo e para outro usuário', async () => {
      const { token } = await signUp();
      const other = await signUp();
      await create(token, { name: 'Outros', icon: 'more_horiz' });

      const otherType = await create(token, { name: 'Outros', type: 'income', icon: 'more_horiz' });
      const otherUser = await create(other.token, { name: 'Outros', icon: 'more_horiz' });

      expect(otherType.statusCode).toBe(201);
      expect(otherUser.statusCode).toBe(201);
    });

    it('cadastros simultâneos com o mesmo nome: um entra, o outro recebe 409', async () => {
      const { token } = await signUp();

      const responses = await Promise.all([create(token), create(token, { name: 'alimentacao' })]);

      expect(responses.map((response) => response.statusCode).sort()).toEqual([201, 409]);
    });

    it.each([
      ['nome vazio', { name: '   ' }, 'body.name', 'Informe o nome da categoria.'],
      [
        'nome com mais de 40 caracteres',
        { name: 'a'.repeat(41) },
        'body.name',
        'O nome deve ter no máximo 40 caracteres.',
      ],
      ['tipo desconhecido', { type: 'transfer' }, 'body.type', 'Selecione despesa ou receita.'],
      ['cor fora da paleta', { color: '#000000' }, 'body.color', 'Selecione uma cor válida.'],
      ['ícone de conta', { icon: 'account_balance' }, 'body.icon', 'Selecione um ícone válido.'],
    ])('responde 422 para %s', async (_case, override, field, message) => {
      const { token } = await signUp();

      const response = await create(token, override);

      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({ errors: [{ field, message }] });
    });

    it('conta o limite de 40 caracteres depois de remover os espaços extras', async () => {
      const { token } = await signUp();

      const response = await create(token, { name: `  ${'a'.repeat(20)}    ${'b'.repeat(19)}  ` });

      expect(response.statusCode).toBe(201);
      expect(response.json<CategoryDto>().name).toHaveLength(40);
    });

    it.each([['userId'], ['isDefault'], ['isArchived'], ['nameNormalized']])(
      'responde 422 se o corpo tentar definir %s',
      async (field) => {
        const { token } = await signUp();

        const response = await create(token, {
          [field]: field === 'userId' ? randomUUIDv7() : true,
        });

        expect(response.statusCode).toBe(422);
      },
    );

    it('responde 401 sem sessão', async () => {
      expect((await send('POST', '/v1/categories', validCategory)).statusCode).toBe(401);
    });
  });

  describe('PATCH /v1/categories/:id', () => {
    async function createdCategory(token: string, name = 'Alimentação'): Promise<CategoryDto> {
      return (await create(token, { name })).json<CategoryDto>();
    }

    const patch = (id: string, body: Record<string, unknown>, token?: string) =>
      send('PATCH', `/v1/categories/${id}`, body, token);

    it('altera nome, ícone e cor, atualizando o nome normalizado', async () => {
      const { token } = await signUp();
      const category = await createdCategory(token);

      const response = await patch(
        category.id,
        { name: ' Comida  fora ', icon: 'shopping_bag', color: '#2e7d32' },
        token,
      );

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        ...category,
        name: 'Comida fora',
        icon: 'shopping_bag',
        color: '#2e7d32',
      });
      expect((await storedCategory(category.id))?.nameNormalized).toBe('comida fora');
    });

    it('permite mudar só a grafia do próprio nome', async () => {
      const { token } = await signUp();
      const category = await createdCategory(token, 'alimentacao');

      const response = await patch(category.id, { name: 'Alimentação' }, token);

      expect(response.statusCode).toBe(200);
      expect(response.json<CategoryDto>().name).toBe('Alimentação');
    });

    it('responde 409 para nome de outra categoria do mesmo tipo, sem alterar nada', async () => {
      const { token } = await signUp();
      await createdCategory(token, 'Mercado');
      const category = await createdCategory(token, 'Alimentação');

      const response = await patch(category.id, { name: 'MERCADO', color: '#2e7d32' }, token);

      expectConflict(response, 'Já existe uma categoria de despesa com este nome.');
      expect(await storedCategory(category.id)).toMatchObject({
        name: 'Alimentação',
        color: '#c62828',
      });
    });

    it('sugere reativar quando o nome é de uma categoria arquivada', async () => {
      const { userId, token } = await signUp();
      await insertCategory(userId, { name: 'Antiga', isArchived: true });
      const category = await createdCategory(token);

      const response = await patch(category.id, { name: 'antiga' }, token);

      expectConflict(
        response,
        'Já existe uma categoria de despesa arquivada com este nome. Reative-a em vez de criar outra.',
      );
    });

    it.each([['income'], ['expense']])(
      'responde 422 se tentar mudar o tipo (type=%s)',
      async (type) => {
        const { token } = await signUp();
        const category = await createdCategory(token);

        const response = await patch(category.id, { type }, token);

        expect(response.statusCode).toBe(422);
        expect(response.json()).toMatchObject({
          errors: [{ field: 'body.type', message: 'O tipo da categoria não pode ser alterado.' }],
        });
        expect((await storedCategory(category.id))?.type).toBe('expense');
      },
    );

    it('com corpo vazio, devolve a categoria sem alterar', async () => {
      const { token } = await signUp();
      const category = await createdCategory(token);

      const response = await patch(category.id, {}, token);

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(category);
    });

    it.each([
      ['name', null],
      ['isDefault', true],
      ['userId', randomUUIDv7()],
    ])('responde 422 para %s = %s', async (field, value) => {
      const { token } = await signUp();
      const category = await createdCategory(token);

      expect((await patch(category.id, { [field]: value }, token)).statusCode).toBe(422);
    });

    it('responde 404 para categoria de outro usuário, sem alterá-la', async () => {
      const owner = await signUp();
      const category = await createdCategory(owner.token);
      const { token } = await signUp();

      for (const body of [{ name: 'Invadida' }, {}]) {
        const response = await patch(category.id, body, token);

        expect(response.statusCode).toBe(404);
        expect(response.json()).toMatchObject({ detail: 'Categoria não encontrada.' });
      }
      expect((await storedCategory(category.id))?.name).toBe('Alimentação');
    });

    it('responde 404 para categoria inexistente', async () => {
      const { token } = await signUp();

      expect((await patch(randomUUIDv7(), { name: 'Qualquer' }, token)).statusCode).toBe(404);
    });

    it('responde 401 sem sessão', async () => {
      expect((await patch(randomUUIDv7(), { name: 'Qualquer' })).statusCode).toBe(401);
    });
  });

  describe('conjunto padrão criado no cadastro', () => {
    it('o usuário novo já tem as 14 categorias padrão, ativas e marcadas como padrão', async () => {
      const { token } = await signUp({ keepDefaults: true });

      const response = await get('/v1/categories', token);

      const listed = response.json<CategoryDto[]>();
      expect(listed).toHaveLength(DEFAULT_CATEGORIES.length);
      expect(listed.every((category) => category.isDefault && !category.isArchived)).toBe(true);
      const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
      expect(
        listed.map(({ name, type, icon, color }) => ({ name, type, icon, color })).sort(byName),
      ).toEqual([...DEFAULT_CATEGORIES].sort(byName));
    });

    it('separa 9 de despesa e 5 de receita', async () => {
      const { token } = await signUp({ keepDefaults: true });

      const expenses = await get('/v1/categories?type=expense', token);
      const incomes = await get('/v1/categories?type=income', token);

      expect(expenses.json()).toHaveLength(9);
      expect(names(incomes)).toEqual([
        'Freelance',
        'Investimentos',
        'Outras receitas',
        'Presentes',
        'Salário',
      ]);
    });

    it('as padrão contam na unicidade do nome, como as criadas pelo usuário', async () => {
      const { token } = await signUp({ keepDefaults: true });

      const response = await create(token, { name: 'saude' });

      expectConflict(response, 'Já existe uma categoria de despesa com este nome.');
    });

    it('cada usuário recebe o próprio conjunto', async () => {
      const first = await signUp({ keepDefaults: true });
      const second = await signUp({ keepDefaults: true });

      const rows = await app.db
        .select()
        .from(categories)
        .where(eq(categories.nameNormalized, 'alimentacao'));

      const owners = rows.map((row) => row.userId);
      expect(owners).toContain(first.userId);
      expect(owners).toContain(second.userId);
    });
  });
});
