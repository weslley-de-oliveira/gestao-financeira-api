import { randomUUID, randomUUIDv7 } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../../../test/helpers/app.ts';
import { accounts, type NewAccount } from '../../db/schema/index.ts';
import { SESSION_COOKIE } from '../auth/session-cookie.ts';
import type { AccountDto } from './accounts.schemas.ts';

describe('rotas /v1/accounts', () => {
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
        currentBalance: -150_075,
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

  const validAccount = {
    name: 'Conta corrente',
    type: 'checking',
    institution: 'Banco Exemplo',
    initialBalance: 123_456,
    color: '#1565c0',
    icon: 'account_balance',
  };

  async function storedAccount(id: string) {
    const [account] = await app.db.select().from(accounts).where(eq(accounts.id, id));
    return account;
  }

  describe('POST /v1/accounts', () => {
    it('cadastra a conta do usuário da sessão e responde 201', async () => {
      const { userId, token } = await signUp();

      const response = await send('POST', '/v1/accounts', validAccount, token);

      expect(response.statusCode).toBe(201);
      const body = response.json<AccountDto>();
      expect(body).toMatchObject({ ...validAccount, isArchived: false });
      expect((await storedAccount(body.id))?.userId).toBe(userId);
      expect(names(await get('/v1/accounts', token))).toEqual(['Conta corrente']);
    });

    it('apara o nome, grava instituição vazia como null e assume saldo inicial zero', async () => {
      const { token } = await signUp();
      const withoutBalance: Record<string, unknown> = { ...validAccount };
      delete withoutBalance['initialBalance'];

      const response = await send(
        'POST',
        '/v1/accounts',
        { ...withoutBalance, name: '  Carteira  ', institution: '   ' },
        token,
      );

      expect(response.json()).toMatchObject({
        name: 'Carteira',
        institution: null,
        initialBalance: 0,
      });
    });

    it('aceita conta sem instituição e com saldo negativo', async () => {
      const { token } = await signUp();
      const withoutInstitution: Record<string, unknown> = { ...validAccount };
      delete withoutInstitution['institution'];

      const response = await send(
        'POST',
        '/v1/accounts',
        { ...withoutInstitution, initialBalance: -50_000 },
        token,
      );

      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({ institution: null, initialBalance: -50_000 });
    });

    it.each([
      ['nome vazio', { name: '   ' }, 'body.name', 'Informe o nome da conta.'],
      [
        'nome com mais de 60 caracteres',
        { name: 'a'.repeat(61) },
        'body.name',
        'O nome deve ter no máximo 60 caracteres.',
      ],
      [
        'instituição com mais de 60 caracteres',
        { institution: 'a'.repeat(61) },
        'body.institution',
        'A instituição deve ter no máximo 60 caracteres.',
      ],
      ['tipo desconhecido', { type: 'credit' }, 'body.type', 'Selecione um tipo de conta válido.'],
      ['cor fora da paleta', { color: '#000000' }, 'body.color', 'Selecione uma cor válida.'],
      ['ícone fora da lista', { icon: 'rocket' }, 'body.icon', 'Selecione um ícone válido.'],
      [
        'saldo com centavos fracionados',
        { initialBalance: 10.5 },
        'body.initialBalance',
        'Informe o valor em centavos inteiros.',
      ],
      [
        'saldo em texto',
        { initialBalance: '1.234,56' },
        'body.initialBalance',
        'Informe o valor em centavos inteiros.',
      ],
      [
        'saldo acima de R$ 1 bilhão',
        { initialBalance: 100_000_000_001 },
        'body.initialBalance',
        'O valor deve ser de até R$ 1 bilhão.',
      ],
    ])('responde 422 para %s', async (_case, override, field, message) => {
      const { token } = await signUp();

      const response = await send('POST', '/v1/accounts', { ...validAccount, ...override }, token);

      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({ errors: [{ field, message }] });
    });

    it.each([
      ['userId', () => randomUUIDv7()],
      ['id', () => randomUUIDv7()],
      ['isArchived', () => true],
    ])('responde 422 se o corpo tentar definir %s', async (field, value) => {
      const { token } = await signUp();

      const response = await send(
        'POST',
        '/v1/accounts',
        { ...validAccount, [field]: value() },
        token,
      );

      expect(response.statusCode).toBe(422);
      expect(names(await get('/v1/accounts?includeArchived=true', token))).toEqual([]);
    });

    it('responde 422 listando os campos obrigatórios ausentes', async () => {
      const { token } = await signUp();

      const response = await send('POST', '/v1/accounts', {}, token);

      expect(response.statusCode).toBe(422);
      const fields = response.json<{ errors: { field: string }[] }>().errors.map((e) => e.field);
      expect(fields.sort()).toEqual(['body.color', 'body.icon', 'body.name', 'body.type']);
    });

    it('responde 401 sem sessão', async () => {
      expect((await send('POST', '/v1/accounts', validAccount)).statusCode).toBe(401);
    });
  });

  describe('PATCH /v1/accounts/:id', () => {
    async function createdAccount(token: string): Promise<AccountDto> {
      const response = await send('POST', '/v1/accounts', validAccount, token);
      return response.json<AccountDto>();
    }

    it('altera só os campos enviados', async () => {
      const { token } = await signUp();
      const account = await createdAccount(token);

      const response = await send(
        'PATCH',
        `/v1/accounts/${account.id}`,
        { name: ' Conta salário ', type: 'other', initialBalance: -1 },
        token,
      );

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        ...account,
        name: 'Conta salário',
        type: 'other',
        initialBalance: -1,
        // Sem transações, o saldo atual acompanha o inicial.
        currentBalance: -1,
      });
      const stored = await storedAccount(account.id);
      expect(stored?.updatedAt.getTime()).toBeGreaterThan(stored?.createdAt.getTime() ?? 0);
    });

    it('remove a instituição com null ou texto vazio', async () => {
      const { token } = await signUp();
      const first = await createdAccount(token);
      const second = await createdAccount(token);

      const withNull = await send(
        'PATCH',
        `/v1/accounts/${first.id}`,
        { institution: null },
        token,
      );
      const withBlank = await send(
        'PATCH',
        `/v1/accounts/${second.id}`,
        { institution: ' ' },
        token,
      );

      expect(withNull.json<AccountDto>().institution).toBeNull();
      expect(withBlank.json<AccountDto>().institution).toBeNull();
    });

    it('com corpo vazio, devolve a conta sem alterar', async () => {
      const { token } = await signUp();
      const account = await createdAccount(token);

      const response = await send('PATCH', `/v1/accounts/${account.id}`, {}, token);

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(account);
    });

    it('responde 422 para campo inválido, sem alterar nada', async () => {
      const { token } = await signUp();
      const account = await createdAccount(token);

      const response = await send(
        'PATCH',
        `/v1/accounts/${account.id}`,
        { name: 'Novo nome', color: '#000000' },
        token,
      );

      expect(response.statusCode).toBe(422);
      expect((await storedAccount(account.id))?.name).toBe('Conta corrente');
    });

    it.each([
      ['name', null],
      ['initialBalance', null],
      ['userId', randomUUIDv7()],
    ])('responde 422 para %s = %s', async (field, value) => {
      const { token } = await signUp();
      const account = await createdAccount(token);

      const response = await send('PATCH', `/v1/accounts/${account.id}`, { [field]: value }, token);

      expect(response.statusCode).toBe(422);
    });

    it('responde 404 para conta de outro usuário, sem alterá-la', async () => {
      const owner = await signUp();
      const account = await createdAccount(owner.token);
      const { token } = await signUp();

      for (const body of [{ name: 'Invadida' }, {}]) {
        const response = await send('PATCH', `/v1/accounts/${account.id}`, body, token);

        expect(response.statusCode).toBe(404);
        expect(response.json()).toMatchObject({ detail: 'Conta não encontrada.' });
      }
      expect((await storedAccount(account.id))?.name).toBe('Conta corrente');
    });

    it('responde 404 para conta inexistente', async () => {
      const { token } = await signUp();

      const response = await send(
        'PATCH',
        `/v1/accounts/${randomUUIDv7()}`,
        { name: 'Qualquer' },
        token,
      );

      expect(response.statusCode).toBe(404);
    });

    it('responde 401 sem sessão', async () => {
      const response = await send('PATCH', `/v1/accounts/${randomUUIDv7()}`, { name: 'Qualquer' });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('arquivar e reativar', () => {
    async function createdAccount(token: string, name = 'Conta corrente'): Promise<AccountDto> {
      const response = await send('POST', '/v1/accounts', { ...validAccount, name }, token);
      return response.json<AccountDto>();
    }

    const setArchived = (id: string, isArchived: unknown, token?: string) =>
      send('PATCH', `/v1/accounts/${id}`, { isArchived }, token);

    it('arquivada, a conta sai da lista padrão mas continua no detalhe e na lista completa', async () => {
      const { token } = await signUp();
      const account = await createdAccount(token, 'Antiga');
      await createdAccount(token, 'Atual');

      const response = await setArchived(account.id, true, token);

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ ...account, isArchived: true });
      expect(names(await get('/v1/accounts', token))).toEqual(['Atual']);
      expect(names(await get('/v1/accounts?includeArchived=true', token))).toEqual([
        'Antiga',
        'Atual',
      ]);
      expect((await get(`/v1/accounts/${account.id}`, token)).statusCode).toBe(200);
    });

    it('reativada, a conta volta para a lista padrão com os mesmos dados', async () => {
      const { token } = await signUp();
      const account = await createdAccount(token);
      await setArchived(account.id, true, token);

      const response = await setArchived(account.id, false, token);

      expect(response.json()).toEqual(account);
      expect(names(await get('/v1/accounts', token))).toEqual(['Conta corrente']);
    });

    it('arquivar de novo uma conta já arquivada não é erro', async () => {
      const { token } = await signUp();
      const account = await createdAccount(token);
      await setArchived(account.id, true, token);

      const response = await setArchived(account.id, true, token);

      expect(response.statusCode).toBe(200);
      expect(response.json<AccountDto>().isArchived).toBe(true);
    });

    it('permite editar e arquivar na mesma requisição', async () => {
      const { token } = await signUp();
      const account = await createdAccount(token);

      const response = await send(
        'PATCH',
        `/v1/accounts/${account.id}`,
        { name: 'Encerrada', isArchived: true },
        token,
      );

      expect(response.json()).toMatchObject({ name: 'Encerrada', isArchived: true });
    });

    it.each([['sim'], [1], [null]])('responde 422 para isArchived = %s', async (value) => {
      const { token } = await signUp();
      const account = await createdAccount(token);

      const response = await setArchived(account.id, value, token);

      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({
        errors: [{ field: 'body.isArchived', message: 'Informe true ou false.' }],
      });
    });

    it('não arquiva conta de outro usuário', async () => {
      const owner = await signUp();
      const account = await createdAccount(owner.token);
      const { token } = await signUp();

      expect((await setArchived(account.id, true, token)).statusCode).toBe(404);
      expect((await storedAccount(account.id))?.isArchived).toBe(false);
    });

    it('não tem rota de exclusão: DELETE não apaga a conta', async () => {
      const { token } = await signUp();
      const account = await createdAccount(token);

      const response = await app.inject({
        method: 'DELETE',
        url: `/v1/accounts/${account.id}`,
        cookies: { [SESSION_COOKIE]: token },
      });

      expect(response.statusCode).toBe(404);
      expect(await storedAccount(account.id)).toBeDefined();
    });
  });
});
