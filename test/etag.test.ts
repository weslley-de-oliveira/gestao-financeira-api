import { setTimeout as sleep } from 'node:timers/promises';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAccountsRepository } from '../src/modules/accounts/accounts.repository.ts';
import { createTestApp } from './helpers/app.ts';
import { createAccount, signUp, type TestUser } from './helpers/users.ts';

/**
 * Concorrência otimista nos recursos editáveis: o `GET` e o `PATCH` devolvem `ETag`, e um `PATCH`
 * com `If-Match` de uma versão antiga responde 412 sem gravar nada.
 */
interface Resource {
  name: string;
  /** Cria o recurso e devolve a URL dele. */
  create: (user: TestUser) => Promise<string>;
  /** Edição válida; `n` muda o valor a cada chamada. */
  change: (n: number) => Record<string, unknown>;
  /** O campo editado, como a resposta o mostra. */
  read: (body: Record<string, unknown>) => unknown;
}

let accountId: string;
let categoryId: string;

const RESOURCES: Resource[] = [
  {
    name: 'conta',
    create: async (user) => `/v1/accounts/${(await createAccount(user)).id}`,
    change: (n) => ({ name: `Conta ${n}` }),
    read: (body) => body['name'],
  },
  {
    name: 'categoria',
    create: async (user) =>
      `/v1/categories/${await created(user, '/v1/categories', {
        name: `Categoria ${Math.random()}`,
        type: 'expense',
        icon: 'restaurant',
        color: '#ef6c00',
      })}`,
    change: (n) => ({ name: `Categoria editada ${n}` }),
    read: (body) => body['name'],
  },
  {
    name: 'transação',
    create: async (user) =>
      `/v1/transactions/${await created(user, '/v1/transactions', {
        type: 'expense',
        description: 'Mercado',
        amount: 10_000,
        date: '2026-11-05',
        accountId,
        categoryId,
      })}`,
    change: (n) => ({ description: `Mercado ${n}` }),
    read: (body) => body['description'],
  },
  {
    name: 'cartão',
    create: async (user) =>
      `/v1/credit-cards/${await created(user, '/v1/credit-cards', {
        name: 'Cartão',
        brand: 'visa',
        lastFourDigits: '1234',
        creditLimit: 500_000,
        closingDay: 5,
        dueDay: 12,
        paymentAccountId: accountId,
        color: '#6a1b9a',
      })}`,
    change: (n) => ({ name: `Cartão ${n}` }),
    read: (body) => body['name'],
  },
  {
    name: 'orçamento',
    create: async (user) =>
      `/v1/budgets/${await created(user, '/v1/budgets', { categoryId, limitAmount: 50_000 })}`,
    change: (n) => ({ limitAmount: 50_000 + n }),
    read: (body) => body['limitAmount'],
  },
  {
    name: 'meta',
    create: async (user) =>
      `/v1/goals/${await created(user, '/v1/goals', {
        name: 'Reserva',
        targetAmount: 1_000_000,
        color: '#2e7d32',
        icon: 'savings',
      })}`,
    change: (n) => ({ name: `Reserva ${n}` }),
    read: (body) => body['name'],
  },
];

async function created(user: TestUser, url: string, payload: Record<string, unknown>) {
  const response = await user.api('POST', url, payload);
  if (response.statusCode !== 201) throw new Error(`${url} não criado: ${response.body}`);
  return response.json<{ id: string }>().id;
}

describe('ETag e If-Match', () => {
  let app: FastifyInstance;
  let user: TestUser;

  beforeAll(async () => {
    app = await createTestApp({ today: '2026-11-15' });
    user = await signUp(app);
    accountId = (await createAccount(user)).id;
    categoryId = await created(user, '/v1/categories', {
      name: 'Alimentação ETag',
      type: 'expense',
      icon: 'restaurant',
      color: '#ef6c00',
    });
  });

  afterAll(async () => {
    await app.close();
  });

  const patch = (url: string, payload: Record<string, unknown>, ifMatch?: string) =>
    app.inject({
      method: 'PATCH',
      url,
      cookies: user.cookies,
      payload,
      ...(ifMatch && { headers: { 'if-match': ifMatch } }),
    });

  const etagOf = (response: LightMyRequestResponse) => {
    const etag = String(response.headers.etag);
    expect(etag).toMatch(/^"\d+"$/);
    return etag;
  };

  // A versão tem resolução de milissegundos: duas gravações seguidas precisam de um intervalo.
  const nextMillisecond = () => sleep(2);

  describe.each(RESOURCES)('$name', (resource) => {
    let url: string;

    beforeAll(async () => {
      url = await resource.create(user);
    });

    it('devolve a mesma ETag no GET e no PATCH com a versão atual, e uma nova depois dele', async () => {
      const detail = await user.api('GET', url);
      const read = etagOf(detail);
      // O cliente monta o If-Match a partir do `updatedAt` que recebeu (ex.: numa listagem).
      expect(read).toBe(`"${Date.parse(detail.json<{ updatedAt: string }>().updatedAt)}"`);
      await nextMillisecond();

      const response = await patch(url, resource.change(1), read);

      expect(response.statusCode).toBe(200);
      expect(etagOf(response)).not.toBe(read);
      expect(etagOf(await user.api('GET', url))).toBe(etagOf(response));
    });

    it('responde 412 e não grava quando o registro mudou desde a leitura', async () => {
      const stale = etagOf(await user.api('GET', url));
      await nextMillisecond();
      expect((await patch(url, resource.change(2))).statusCode).toBe(200);

      const response = await patch(url, resource.change(3), stale);

      expect(response.statusCode).toBe(412);
      expect(response.headers['content-type']).toContain('application/problem+json');
      expect(response.json()).toMatchObject({ status: 412, title: 'Pré-condição falhou' });
      const after = (await user.api('GET', url)).json<Record<string, unknown>>();
      expect(resource.read(after)).toEqual(resource.read(resource.change(2)));
    });

    it('aceita If-Match: * e o PATCH sem If-Match (último a gravar vence)', async () => {
      await nextMillisecond();
      expect((await patch(url, resource.change(4), '*')).statusCode).toBe(200);
      await nextMillisecond();
      expect((await patch(url, resource.change(5))).statusCode).toBe(200);
    });

    it('não aceita a versão atual como ETag fraca (comparação forte)', async () => {
      const current = etagOf(await user.api('GET', url));

      expect((await patch(url, resource.change(6), `W/${current}`)).statusCode).toBe(412);
    });
  });

  it('aportes e retiradas criam uma versão nova da meta', async () => {
    const url = `/v1/goals/${await created(user, '/v1/goals', {
      name: 'Viagem',
      targetAmount: 500_000,
      color: '#2e7d32',
      icon: 'flight',
    })}`;
    const before = etagOf(await user.api('GET', url));
    await nextMillisecond();

    const deposit = await user.api('POST', `${url}/contributions`, {
      type: 'deposit',
      amount: 1_000,
      date: '2026-11-10',
    });

    expect(etagOf(deposit)).not.toBe(before);
    expect((await patch(url, { name: 'Viagem editada' }, before)).statusCode).toBe(412);
  });

  it('a gravação condicional não altera a conta que mudou entre a leitura e a escrita', async () => {
    const repository = createAccountsRepository(app.db);
    const { id } = await createAccount(user);
    const read = await repository.findAccount(user.userId, id);
    if (!read) throw new Error('conta não encontrada');
    await nextMillisecond();
    await repository.updateAccount(user.userId, id, { name: 'Outra aba' });

    const result = await repository.updateAccount(
      user.userId,
      id,
      { name: 'Esta aba' },
      read.updatedAt,
    );

    expect(result).toBeNull();
    expect((await repository.findAccount(user.userId, id))?.name).toBe('Outra aba');
  });
});
