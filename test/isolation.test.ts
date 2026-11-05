import { randomUUID, randomUUIDv7 } from 'node:crypto';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '../src/modules/auth/session-cookie.ts';
import { createTestApp } from './helpers/app.ts';

/** Requisição feita com a sessão de uma pessoa. */
type Api = (
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  payload?: Record<string, unknown>,
) => Promise<LightMyRequestResponse>;

/**
 * Isolamento entre usuários: ninguém lê, altera, arquiva ou exclui recurso de outra pessoa. O
 * recurso alheio responde sempre 404, igual a um id que não existe, para não revelar o que existe.
 * Cada recurso novo da API entra na lista `RESOURCES`.
 */
interface Resource {
  name: string;
  path: string;
  /** Consultas da listagem em que o recurso alheio não pode aparecer. */
  listQueries: string[];
  /** Monta o cenário da dona (ex.: conta e categoria de uma transação) e devolve o corpo do cadastro. */
  create: (api: Api) => Promise<Record<string, unknown>>;
  /** Uma edição válida qualquer. */
  edit: Record<string, unknown>;
  archivable: boolean;
  deletable: boolean;
}

const RESOURCES: Resource[] = [
  {
    name: 'contas',
    path: '/v1/accounts',
    listQueries: ['', '?includeArchived=true'],
    create: () =>
      Promise.resolve({
        name: 'Conta da dona',
        type: 'checking',
        institution: 'Banco Exemplo',
        initialBalance: 250_000,
        color: '#1565c0',
        icon: 'account_balance',
      }),
    edit: { name: 'Invadida', initialBalance: 0 },
    archivable: true,
    deletable: false,
  },
  {
    name: 'categorias',
    path: '/v1/categories',
    listQueries: ['', '?includeArchived=true'],
    create: () =>
      Promise.resolve({
        name: 'Categoria da dona',
        type: 'expense',
        icon: 'pets',
        color: '#2e7d32',
      }),
    edit: { name: 'Invadida', color: '#c62828' },
    archivable: true,
    deletable: false,
  },
  {
    name: 'transações',
    path: '/v1/transactions',
    listQueries: ['', '?type=expense'],
    async create(api) {
      const account = await api('POST', '/v1/accounts', {
        name: 'Conta da dona',
        type: 'checking',
        color: '#1565c0',
        icon: 'home',
      });
      const categories = await api('GET', '/v1/categories?type=expense');
      return {
        type: 'expense',
        description: 'Despesa da dona',
        amount: 12_345,
        date: '2026-11-05',
        accountId: account.json<{ id: string }>().id,
        categoryId: categories.json<{ id: string }[]>()[0]?.id,
      };
    },
    edit: { description: 'Invadida', amount: 1 },
    archivable: false,
    deletable: true,
  },
  {
    name: 'cartões',
    path: '/v1/credit-cards',
    listQueries: ['', '?includeArchived=true'],
    async create(api) {
      const account = await api('POST', '/v1/accounts', {
        name: 'Conta da dona',
        type: 'checking',
        color: '#1565c0',
        icon: 'home',
      });
      return {
        name: 'Cartão da dona',
        brand: 'visa',
        lastFourDigits: '4321',
        creditLimit: 500_000,
        closingDay: 5,
        dueDay: 12,
        paymentAccountId: account.json<{ id: string }>().id,
        color: '#6a1b9a',
      };
    },
    edit: { name: 'Invadido', creditLimit: 1 },
    archivable: true,
    deletable: false,
  },
];

describe.each(RESOURCES)('isolamento entre usuários: $name', (resource) => {
  let app: FastifyInstance;
  let owner: Api;
  let intruder: Api;
  /** Recurso da dona, como ela o vê logo depois de cadastrar. */
  let original: { id: string } & Record<string, unknown>;

  /** Cadastra uma pessoa nova e devolve as requisições com a sessão dela. */
  async function signUp(): Promise<Api> {
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
    return (method, url, payload) =>
      app.inject({
        method,
        url,
        cookies: { [SESSION_COOKIE]: token },
        ...(payload && { payload }),
      });
  }

  /** Ids de uma listagem, seja lista simples ou página (`{ items, nextCursor }`). */
  function listedIds(response: LightMyRequestResponse): string[] {
    const body = response.json<{ id: string }[] | { items: { id: string }[] }>();
    return (Array.isArray(body) ? body : body.items).map(({ id }) => id);
  }

  /** O que um 404 diz, sem os campos que mudam a cada requisição (`requestId`, `instance`). */
  function notFound(response: LightMyRequestResponse) {
    expect(response.statusCode).toBe(404);
    const { type, title, status, detail } = response.json<Record<string, unknown>>();
    return { type, title, status, detail };
  }

  beforeAll(async () => {
    app = await createTestApp();
    owner = await signUp();
    intruder = await signUp();
    const created = await owner('POST', resource.path, await resource.create(owner));
    expect(created.statusCode).toBe(201);
    original = created.json();
  });

  afterAll(async () => {
    await app.close();
  });

  it('não aparece em nenhuma listagem da outra pessoa', async () => {
    for (const query of resource.listQueries) {
      const response = await intruder('GET', `${resource.path}${query}`);

      expect(response.statusCode).toBe(200);
      expect(listedIds(response)).not.toContain(original.id);
    }
  });

  it('o detalhe responde 404, igual a um id que não existe', async () => {
    const foreign = await intruder('GET', `${resource.path}/${original.id}`);
    const missing = await intruder('GET', `${resource.path}/${randomUUIDv7()}`);

    expect(notFound(foreign)).toEqual(notFound(missing));
  });

  const patches: [string, () => Record<string, unknown>][] = [
    ['editar', () => resource.edit],
    ...(resource.archivable
      ? [['arquivar', () => ({ isArchived: true })] as [string, () => Record<string, unknown>]]
      : []),
    ['enviar corpo vazio', () => ({})],
  ];

  it.each(patches)('%s responde 404, igual a um id que não existe', async (_action, body) => {
    const foreign = await intruder('PATCH', `${resource.path}/${original.id}`, body());
    const missing = await intruder('PATCH', `${resource.path}/${randomUUIDv7()}`, body());

    expect(notFound(foreign)).toEqual(notFound(missing));
  });

  if (resource.deletable) {
    it('excluir responde 404, igual a um id que não existe', async () => {
      const foreign = await intruder('DELETE', `${resource.path}/${original.id}`);
      const missing = await intruder('DELETE', `${resource.path}/${randomUUIDv7()}`);

      expect(notFound(foreign)).toEqual(notFound(missing));
    });
  }

  // Roda por último (os testes de um arquivo são sequenciais): confere o efeito de todos os acima.
  it('nenhuma tentativa alterou o recurso, e a dona continua com acesso', async () => {
    const detail = await owner('GET', `${resource.path}/${original.id}`);
    const list = await owner('GET', resource.path);

    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toEqual(original);
    expect(listedIds(list)).toContain(original.id);
  });
});
