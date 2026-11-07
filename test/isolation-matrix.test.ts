import { randomUUIDv7 } from 'node:crypto';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './helpers/app.ts';
import { createAccount, signUp, type Api, type TestUser } from './helpers/users.ts';

/**
 * Matriz rota × método do isolamento entre usuários: cada rota que recebe o id de um recurso
 * responde 404 para o recurso de outra pessoa, igual a um id que não existe, e nada muda. O teste
 * de guarda, no fim, falha se uma rota nova com id na URL não entrar na matriz.
 */
type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

interface OwnerIds {
  account: string;
  category: string;
  transaction: string;
  card: string;
  budget: string;
  goal: string;
  contribution: string;
  installmentPurchase: string;
}

interface Case {
  method: Method;
  /** Caminho no formato do OpenAPI, ex.: `/v1/goals/{id}/contributions/{contributionId}`. */
  path: string;
  /** Parâmetros da URL com os ids da dona. */
  params: (ids: OwnerIds) => Record<string, string>;
  /** Corpo válido: a validação não pode responder antes da checagem do dono. */
  body?: Record<string, unknown>;
}

const MONTH = '2026-11';

const CASES: Case[] = [
  { method: 'GET', path: '/v1/accounts/{id}', params: (ids) => ({ id: ids.account }) },
  {
    method: 'PATCH',
    path: '/v1/accounts/{id}',
    params: (ids) => ({ id: ids.account }),
    body: { name: 'Invadida', isArchived: true },
  },
  { method: 'GET', path: '/v1/categories/{id}', params: (ids) => ({ id: ids.category }) },
  {
    method: 'PATCH',
    path: '/v1/categories/{id}',
    params: (ids) => ({ id: ids.category }),
    body: { name: 'Invadida', isArchived: true },
  },
  { method: 'GET', path: '/v1/transactions/{id}', params: (ids) => ({ id: ids.transaction }) },
  {
    method: 'PATCH',
    path: '/v1/transactions/{id}',
    params: (ids) => ({ id: ids.transaction }),
    body: { amount: 1 },
  },
  { method: 'DELETE', path: '/v1/transactions/{id}', params: (ids) => ({ id: ids.transaction }) },
  {
    method: 'POST',
    path: '/v1/transactions/{id}/refunds',
    params: (ids) => ({ id: ids.transaction }),
    body: { amount: 100, date: '2026-11-12' },
  },
  {
    method: 'GET',
    path: '/v1/transactions/{id}/refunds',
    params: (ids) => ({ id: ids.transaction }),
  },
  {
    method: 'GET',
    path: '/v1/installment-purchases/{id}',
    params: (ids) => ({ id: ids.installmentPurchase }),
  },
  {
    method: 'PATCH',
    path: '/v1/installment-purchases/{id}',
    params: (ids) => ({ id: ids.installmentPurchase }),
    body: { description: 'Invasão' },
  },
  {
    method: 'DELETE',
    path: '/v1/installment-purchases/{id}',
    params: (ids) => ({ id: ids.installmentPurchase }),
  },
  {
    method: 'POST',
    path: '/v1/installment-purchases/{id}/anticipation',
    params: (ids) => ({ id: ids.installmentPurchase }),
    body: { count: 1 },
  },
  { method: 'GET', path: '/v1/credit-cards/{id}', params: (ids) => ({ id: ids.card }) },
  {
    method: 'PATCH',
    path: '/v1/credit-cards/{id}',
    params: (ids) => ({ id: ids.card }),
    body: { creditLimit: 1, isArchived: true },
  },
  { method: 'GET', path: '/v1/credit-cards/{id}/invoices', params: (ids) => ({ id: ids.card }) },
  {
    method: 'GET',
    path: '/v1/credit-cards/{id}/invoices/{month}',
    params: (ids) => ({ id: ids.card, month: MONTH }),
  },
  {
    method: 'POST',
    path: '/v1/credit-cards/{id}/invoices/{month}/payment',
    params: (ids) => ({ id: ids.card, month: MONTH }),
  },
  {
    method: 'DELETE',
    path: '/v1/credit-cards/{id}/invoices/{month}/payment',
    params: (ids) => ({ id: ids.card, month: MONTH }),
  },
  { method: 'GET', path: '/v1/budgets/{id}', params: (ids) => ({ id: ids.budget }) },
  {
    method: 'PATCH',
    path: '/v1/budgets/{id}',
    params: (ids) => ({ id: ids.budget }),
    body: { limitAmount: 1 },
  },
  { method: 'DELETE', path: '/v1/budgets/{id}', params: (ids) => ({ id: ids.budget }) },
  { method: 'GET', path: '/v1/goals/{id}', params: (ids) => ({ id: ids.goal }) },
  {
    method: 'PATCH',
    path: '/v1/goals/{id}',
    params: (ids) => ({ id: ids.goal }),
    body: { name: 'Invadida', isArchived: true },
  },
  {
    method: 'POST',
    path: '/v1/goals/{id}/contributions',
    params: (ids) => ({ id: ids.goal }),
    body: { type: 'withdrawal', amount: 1, date: '2026-11-01' },
  },
  {
    method: 'DELETE',
    path: '/v1/goals/{id}/contributions/{contributionId}',
    params: (ids) => ({ id: ids.goal, contributionId: ids.contribution }),
  },
];

function url(path: string, params: Record<string, string>): string {
  return path.replace(/\{(\w+)\}/g, (_match, name: string) => params[name] ?? '');
}

describe('isolamento entre usuários: matriz rota × método', () => {
  let app: FastifyInstance;
  let owner: TestUser;
  let intruder: TestUser;
  let ids: OwnerIds;
  /** Tudo o que a dona vê antes das tentativas, para conferir que nada mudou. */
  let snapshot: string[];

  /** Hoje é 15/11/2026: a fatura de 11/2026 do cartão (compras até 04/11) pode ser paga. */
  beforeAll(async () => {
    app = await createTestApp({ today: '2026-11-15' });
    owner = await signUp(app);
    intruder = await signUp(app);
    const api = owner.api;

    const account = await createAccount(owner);
    const category = (
      await api('POST', '/v1/categories', {
        name: 'Categoria da dona',
        type: 'expense',
        icon: 'pets',
        color: '#2e7d32',
      })
    ).json<{ id: string }>();
    const transaction = (
      await api('POST', '/v1/transactions', {
        type: 'expense',
        description: 'Despesa da dona',
        amount: 1_000,
        date: '2026-11-10',
        accountId: account.id,
        categoryId: category.id,
      })
    ).json<{ id: string }>();
    const card = (
      await api('POST', '/v1/credit-cards', {
        name: 'Cartão da dona',
        brand: 'visa',
        lastFourDigits: '4321',
        creditLimit: 500_000,
        closingDay: 5,
        dueDay: 12,
        paymentAccountId: account.id,
        color: '#6a1b9a',
      })
    ).json<{ id: string }>();
    await api('POST', '/v1/transactions', {
      type: 'expense',
      description: 'Compra da dona',
      amount: 2_000,
      date: '2026-10-20',
      creditCardId: card.id,
      categoryId: category.id,
    });
    expect(
      (await api('POST', `/v1/credit-cards/${card.id}/invoices/${MONTH}/payment`)).statusCode,
    ).toBe(201);
    const installmentPurchase = (
      await api('POST', '/v1/installment-purchases', {
        description: 'Parcelada da dona',
        amount: 30_000,
        date: '2026-11-10',
        creditCardId: card.id,
        categoryId: category.id,
        installmentCount: 3,
      })
    ).json<{ id: string }>();
    const budget = (
      await api('POST', '/v1/budgets', { categoryId: category.id, limitAmount: 50_000 })
    ).json<{ id: string }>();
    const goal = (
      await api('POST', '/v1/goals', {
        name: 'Meta da dona',
        targetAmount: 100_000,
        color: '#2e7d32',
        icon: 'flight',
      })
    ).json<{ id: string }>();
    const withContribution = (
      await api('POST', `/v1/goals/${goal.id}/contributions`, {
        type: 'deposit',
        amount: 10_000,
        date: '2026-11-01',
      })
    ).json<{ contributions: { id: string }[] }>();

    ids = {
      account: account.id,
      category: category.id,
      transaction: transaction.id,
      card: card.id,
      budget: budget.id,
      goal: goal.id,
      contribution: withContribution.contributions[0]!.id,
      installmentPurchase: installmentPurchase.id,
    };
    snapshot = await ownerView(api);
  });

  afterAll(async () => {
    await app.close();
  });

  /** As leituras da dona sobre cada recurso, como texto (para comparar antes e depois). */
  async function ownerView(api: Api): Promise<string[]> {
    const paths = CASES.filter((item) => item.method === 'GET').map((item) =>
      url(item.path, item.params(ids)),
    );
    return Promise.all(paths.map(async (path) => (await api('GET', path)).body));
  }

  /** O que um 404 diz, sem os campos que mudam a cada requisição (`requestId`, `instance`). */
  function notFound(response: LightMyRequestResponse) {
    expect(response.statusCode).toBe(404);
    const { type, title, status, detail } = response.json<Record<string, unknown>>();
    return { type, title, status, detail };
  }

  const randomIds = (): OwnerIds => ({
    account: randomUUIDv7(),
    category: randomUUIDv7(),
    transaction: randomUUIDv7(),
    card: randomUUIDv7(),
    budget: randomUUIDv7(),
    goal: randomUUIDv7(),
    contribution: randomUUIDv7(),
    installmentPurchase: randomUUIDv7(),
  });

  it.each(CASES.map((item) => [`${item.method} ${item.path}`, item] as const))(
    '%s responde 404 para recurso de outra pessoa, igual a um id que não existe',
    async (_name, { method, path, params, body }) => {
      const foreign = await intruder.api(method, url(path, params(ids)), body);
      const missing = await intruder.api(method, url(path, params(randomIds())), body);

      expect(notFound(foreign)).toEqual(notFound(missing));
    },
  );

  it('misturar a meta própria com a movimentação de outra pessoa também responde 404', async () => {
    const own = (
      await intruder.api('POST', '/v1/goals', {
        name: 'Meta da intrusa',
        targetAmount: 100_000,
        color: '#2e7d32',
        icon: 'savings',
      })
    ).json<{ id: string }>();

    const response = await intruder.api(
      'DELETE',
      `/v1/goals/${own.id}/contributions/${ids.contribution}`,
    );

    expect(response.statusCode).toBe(404);
  });

  // Roda depois das tentativas (os testes de um arquivo são sequenciais).
  it('nenhuma tentativa mudou os dados da dona', async () => {
    expect(await ownerView(owner.api)).toEqual(snapshot);
  });

  it('a matriz cobre todas as rotas da API que recebem um id na URL', async () => {
    await app.ready();
    const spec = app.swagger() as { paths: Record<string, Record<string, unknown>> };
    const withId = Object.entries(spec.paths)
      .filter(([path]) => path.includes('{id}'))
      .flatMap(([path, operations]) =>
        Object.keys(operations).map((method) => `${method.toUpperCase()} ${path}`),
      );

    expect(withId.toSorted()).toEqual(
      CASES.map((item) => `${item.method} ${item.path}`).toSorted(),
    );
  });
});
