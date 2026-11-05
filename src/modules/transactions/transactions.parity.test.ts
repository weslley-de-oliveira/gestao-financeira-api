import { randomUUID } from 'node:crypto';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp } from '../../../test/helpers/app.ts';
import { transactions } from '../../db/schema/index.ts';
import { calculateBalance } from '../accounts/account-balance.ts';
import type { AccountDto } from '../accounts/accounts.schemas.ts';
import { SESSION_COOKIE } from '../auth/session-cookie.ts';
import type { CategoryDto } from '../categories/categories.schemas.ts';
import type { TransactionDto } from './transactions.schemas.ts';

/**
 * Paridade com `transactions.facade.spec.ts` do front: os mesmos cenários, agora pela API. Uma
 * diferença intencional: conta ou categoria arquivada responde 409 com mensagem própria (no front,
 * era erro de validação no campo).
 */
describe('paridade com a facade de transações do front', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  type Api = (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    payload?: Record<string, unknown>,
  ) => Promise<LightMyRequestResponse>;

  async function signUp(): Promise<{ api: Api; userId: string }> {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: {
        name: 'Pessoa de Teste',
        email: `pessoa.${randomUUID()}@exemplo.com`,
        password: 'senha1234',
      },
    });
    const token = response.cookies.find(({ name }) => name === SESSION_COOKIE)?.value ?? '';
    const api: Api = (method, url, payload) =>
      app.inject({
        method,
        url,
        cookies: { [SESSION_COOKIE]: token },
        ...(payload && { payload }),
      });
    return { api, userId: response.json<{ id: string }>().id };
  }

  let api: Api;
  let userId: string;
  let checking: AccountDto;
  let savings: AccountDto;
  let archivedAccount: AccountDto;
  let groceries: CategoryDto;
  let salary: CategoryDto;
  let archivedCategory: CategoryDto;

  // Mesmo cenário do front: Corrente (R$ 1.000), Poupança (R$ 500) e Antiga (arquivada); Mercado,
  // Salário (receita) e Arquivada.
  beforeEach(async () => {
    ({ api, userId } = await signUp());
    const account = async (name: string, initialBalance = 0, isArchived = false) => {
      const created = (
        await api('POST', '/v1/accounts', {
          name,
          type: 'checking',
          initialBalance,
          color: '#1565c0',
          icon: 'account_balance',
        })
      ).json<AccountDto>();
      if (!isArchived) return created;
      return (await api('PATCH', `/v1/accounts/${created.id}`, { isArchived })).json<AccountDto>();
    };
    checking = await account('Corrente', 100_000);
    savings = await account('Poupança', 50_000);
    archivedAccount = await account('Antiga', 0, true);

    groceries = (
      await api('POST', '/v1/categories', {
        name: 'Mercado',
        type: 'expense',
        icon: 'shopping_cart',
        color: '#2e7d32',
      })
    ).json<CategoryDto>();
    const created = (
      await api('POST', '/v1/categories', {
        name: 'Arquivada',
        type: 'expense',
        icon: 'more_horiz',
        color: '#546e7a',
      })
    ).json<CategoryDto>();
    archivedCategory = (
      await api('PATCH', `/v1/categories/${created.id}`, { isArchived: true })
    ).json<CategoryDto>();
    salary = (await api('GET', '/v1/categories?type=income'))
      .json<CategoryDto[]>()
      .find((category) => category.name === 'Salário')!;
  });

  const expense = () => ({
    type: 'expense',
    description: 'Mercado',
    amount: 25_000,
    date: '2026-11-10',
    accountId: checking.id,
    categoryId: groceries.id,
    status: 'completed',
  });

  const listed = async () =>
    (await api('GET', '/v1/transactions')).json<{ items: TransactionDto[] }>().items;

  const balances = async () =>
    Object.fromEntries(
      (await api('GET', '/v1/accounts?includeArchived=true'))
        .json<AccountDto[]>()
        .map((account) => [account.name, account.currentBalance]),
    );

  it('cria a transação para o usuário atual', async () => {
    const created = await api('POST', '/v1/transactions', expense());

    expect(created.statusCode).toBe(201);
    expect(await listed()).toEqual([created.json()]);
  });

  it('valida as contas e a categoria contra os dados do usuário', async () => {
    const attempts = [
      // Conta arquivada.
      [{ ...expense(), accountId: archivedAccount.id }, 409],
      // Categoria de outro tipo.
      [{ ...expense(), categoryId: salary.id }, 422],
      // Categoria arquivada.
      [{ ...expense(), categoryId: archivedCategory.id }, 409],
      // Transferência para a mesma conta.
      [
        {
          ...expense(),
          type: 'transfer',
          categoryId: undefined,
          destinationAccountId: checking.id,
        },
        422,
      ],
    ] as const;

    for (const [body, status] of attempts) {
      expect((await api('POST', '/v1/transactions', body)).statusCode).toBe(status);
    }
    expect(await listed()).toEqual([]);
  });

  it('atualiza os saldos das contas, ignorando as pendentes', async () => {
    await api('POST', '/v1/transactions', expense());
    await api('POST', '/v1/transactions', {
      ...expense(),
      type: 'transfer',
      description: 'Reserva',
      amount: 30_000,
      categoryId: undefined,
      destinationAccountId: savings.id,
    });
    const pending = (
      await api('POST', '/v1/transactions', { ...expense(), amount: 99_999, status: 'pending' })
    ).json<TransactionDto>();

    expect(await balances()).toEqual({ Corrente: 45_000, Poupança: 80_000, Antiga: 0 });
    const active = (await api('GET', '/v1/accounts')).json<AccountDto[]>();
    expect(active.reduce((total, account) => total + account.currentBalance, 0)).toBe(125_000);

    await api('PATCH', `/v1/transactions/${pending.id}`, { status: 'completed' });
    expect((await balances())['Corrente']).toBe(-54_999);
  });

  it('mantém na edição as referências arquivadas que a transação já tinha', async () => {
    // Lançada antes do arquivamento: gravada direto no banco, como o seed do teste do front.
    const [old] = await app.db
      .insert(transactions)
      .values({
        userId,
        type: 'expense',
        description: 'Antiga',
        amount: 1_000,
        date: '2026-10-01',
        accountId: archivedAccount.id,
        categoryId: archivedCategory.id,
      })
      .returning();

    const updated = await api('PATCH', `/v1/transactions/${old!.id}`, { description: 'Editada' });

    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({
      description: 'Editada',
      accountId: archivedAccount.id,
    });
  });

  it('exclui a transação e recalcula o saldo', async () => {
    const created = (await api('POST', '/v1/transactions', expense())).json<TransactionDto>();

    expect((await api('DELETE', `/v1/transactions/${created.id}`)).statusCode).toBe(204);

    expect(await listed()).toEqual([]);
    expect((await balances())['Corrente']).toBe(100_000);
  });

  it('não mexe nas transações de outro usuário', async () => {
    const other = await signUp();
    const created = (await api('POST', '/v1/transactions', expense())).json<TransactionDto>();

    expect((await other.api('DELETE', `/v1/transactions/${created.id}`)).statusCode).toBe(404);
    expect((await other.api('GET', '/v1/transactions')).json()).toEqual({
      items: [],
      nextCursor: null,
    });
    expect(await listed()).toHaveLength(1);
  });

  it('o saldo calculado no banco é igual ao da regra do front (calculateBalance)', async () => {
    // Cenário variado e reproduzível: gerador pseudoaleatório com semente fixa.
    let seed = 20_261_105;
    const next = (max: number) => {
      seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
      return seed % max;
    };
    const accounts = [checking, savings];
    for (let index = 0; index < 60; index++) {
      const kind = next(3);
      const from = accounts[next(2)]!;
      const base = {
        description: `Lançamento ${index}`,
        amount: 1 + next(500_000),
        date: `2026-${String(1 + next(12)).padStart(2, '0')}-${String(1 + next(28)).padStart(2, '0')}`,
        accountId: from.id,
        status: next(4) === 0 ? 'pending' : 'completed',
      };
      const body =
        kind === 2
          ? {
              ...base,
              type: 'transfer',
              destinationAccountId: accounts.find((a) => a !== from)!.id,
            }
          : kind === 1
            ? { ...base, type: 'income', categoryId: salary.id }
            : { ...base, type: 'expense', categoryId: groceries.id };
      expect((await api('POST', '/v1/transactions', body)).statusCode).toBe(201);
    }

    // Todas as transações, página a página, como o front as receberia.
    const all: TransactionDto[] = [];
    let cursor: string | null = null;
    do {
      const page: { items: TransactionDto[]; nextCursor: string | null } = (
        await api('GET', `/v1/transactions?limit=25${cursor ? `&cursor=${cursor}` : ''}`)
      ).json();
      all.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor);
    expect(all).toHaveLength(60);

    const fromApi = (await api('GET', '/v1/accounts')).json<AccountDto[]>();
    for (const account of fromApi) {
      expect(account.currentBalance).toBe(calculateBalance(account, all));
    }
  });
});
