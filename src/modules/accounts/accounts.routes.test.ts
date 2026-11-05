import { randomUUID, randomUUIDv7 } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../../../test/helpers/app.ts';
import { accounts, type NewAccount } from '../../db/schema/index.ts';
import { SESSION_COOKIE } from '../auth/session-cookie.ts';
import type { AccountDto } from './accounts.schemas.ts';

describe('GET /v1/accounts', () => {
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

  /** O cadastro de contas pela API chega no próximo passo; aqui elas entram direto no banco. */
  async function insertAccount(userId: string, overrides: Partial<NewAccount> = {}) {
    const [account] = await app.db
      .insert(accounts)
      .values({
        userId,
        name: 'Conta corrente',
        type: 'checking',
        color: '#1565c0',
        icon: 'account_balance',
        ...overrides,
      })
      .returning();
    if (!account) throw new Error('conta não inserida');
    return account;
  }

  const get = (url: string, token?: string) =>
    app.inject({
      method: 'GET',
      url,
      ...(token && { cookies: { [SESSION_COOKIE]: token } }),
    });

  const names = (response: Awaited<ReturnType<typeof get>>) =>
    response.json<AccountDto[]>().map((account) => account.name);

  it('lista só as contas ativas do usuário, em ordem alfabética sem diferenciar acentos', async () => {
    const { userId, token } = await signUp();
    for (const name of ['banco Digital', 'Carteira', 'Álvaro Investimentos']) {
      await insertAccount(userId, { name });
    }
    await insertAccount(userId, { name: 'Antiga', isArchived: true });
    const other = await signUp();
    await insertAccount(other.userId, { name: 'Conta de outra pessoa' });

    const response = await get('/v1/accounts', token);

    expect(response.statusCode).toBe(200);
    expect(names(response)).toEqual(['Álvaro Investimentos', 'banco Digital', 'Carteira']);
  });

  it('inclui as arquivadas com includeArchived=true', async () => {
    const { userId, token } = await signUp();
    await insertAccount(userId, { name: 'Ativa' });
    await insertAccount(userId, { name: 'Arquivada', isArchived: true });

    const response = await get('/v1/accounts?includeArchived=true', token);

    expect(names(response)).toEqual(['Arquivada', 'Ativa']);
  });

  it('devolve lista vazia para quem ainda não tem contas', async () => {
    const { token } = await signUp();

    const response = await get('/v1/accounts', token);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
  });

  it('responde 422 para includeArchived que não é booleano', async () => {
    const { token } = await signUp();

    const response = await get('/v1/accounts?includeArchived=talvez', token);

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      errors: [{ field: 'querystring.includeArchived', message: 'Use true ou false.' }],
    });
  });

  it('responde 401 sem sessão', async () => {
    expect((await get('/v1/accounts')).statusCode).toBe(401);
  });

  describe('GET /v1/accounts/:id', () => {
    it('detalha a conta com o saldo inicial em centavos, sem expor o dono', async () => {
      const { userId, token } = await signUp();
      const account = await insertAccount(userId, {
        name: 'Poupança',
        type: 'savings',
        institution: 'Banco Exemplo',
        initialBalance: -150_075,
        color: '#2e7d32',
        icon: 'savings',
      });

      const response = await get(`/v1/accounts/${account.id}`, token);

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        id: account.id,
        name: 'Poupança',
        type: 'savings',
        institution: 'Banco Exemplo',
        initialBalance: -150_075,
        color: '#2e7d32',
        icon: 'savings',
        isArchived: false,
        createdAt: account.createdAt.toISOString(),
      });
    });

    it('detalha também conta arquivada', async () => {
      const { userId, token } = await signUp();
      const account = await insertAccount(userId, { isArchived: true });

      const response = await get(`/v1/accounts/${account.id}`, token);

      expect(response.json<AccountDto>().isArchived).toBe(true);
    });

    it('responde 404 igual para conta de outro usuário e conta inexistente', async () => {
      const owner = await signUp();
      const account = await insertAccount(owner.userId);
      const { token } = await signUp();

      for (const id of [account.id, randomUUIDv7()]) {
        const response = await get(`/v1/accounts/${id}`, token);

        expect(response.statusCode).toBe(404);
        expect(response.json()).toMatchObject({
          status: 404,
          title: 'Recurso não encontrado',
          detail: 'Conta não encontrada.',
        });
      }
    });

    it('responde 422 para id que não é UUID', async () => {
      const { token } = await signUp();

      const response = await get('/v1/accounts/123', token);

      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({
        errors: [{ field: 'params.id', message: 'Identificador de conta inválido.' }],
      });
    });

    it('responde 401 sem sessão', async () => {
      expect((await get(`/v1/accounts/${randomUUIDv7()}`)).statusCode).toBe(401);
    });
  });
});
