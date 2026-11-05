import { randomUUID, randomUUIDv7 } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../../../test/helpers/app.ts';
import { transactions } from '../../db/schema/index.ts';
import { SESSION_COOKIE } from '../auth/session-cookie.ts';
import type { CategoryDto } from '../categories/categories.schemas.ts';
import type { TransactionDto } from '../transactions/transactions.schemas.ts';
import type { AccountDto } from './accounts.schemas.ts';

describe('saldo atual das contas (currentBalance)', () => {
  let app: FastifyInstance;
  let userId: string;
  let cookies: Record<string, string>;
  let checking: AccountDto;
  let savings: AccountDto;
  let food: CategoryDto;
  let salary: CategoryDto;

  beforeAll(async () => {
    app = await createTestApp();
    const registered = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: {
        name: 'Pessoa de Teste',
        email: `pessoa.${randomUUID()}@exemplo.com`,
        password: 'senha1234',
      },
    });
    userId = registered.json<{ id: string }>().id;
    const token = registered.cookies.find(({ name }) => name === SESSION_COOKIE)?.value ?? '';
    cookies = { [SESSION_COOKIE]: token };

    checking = await createAccount('Corrente', 100_000);
    savings = await createAccount('Poupança', 50_000);
    const categories = (await app.inject({ method: 'GET', url: '/v1/categories', cookies })).json<
      CategoryDto[]
    >();
    food = categories.find((category) => category.name === 'Alimentação')!;
    salary = categories.find((category) => category.name === 'Salário')!;
  });

  afterAll(async () => {
    await app.close();
  });

  async function createAccount(name: string, initialBalance: number): Promise<AccountDto> {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/accounts',
      cookies,
      payload: { name, type: 'checking', initialBalance, color: '#1565c0', icon: 'home' },
    });
    return response.json<AccountDto>();
  }

  async function createTransaction(payload: Record<string, unknown>): Promise<TransactionDto> {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/transactions',
      cookies,
      payload: { description: 'Lançamento', date: '2026-11-05', ...payload },
    });
    expect(response.statusCode).toBe(201);
    return response.json<TransactionDto>();
  }

  const balanceOf = async (account: AccountDto) =>
    (
      await app.inject({ method: 'GET', url: `/v1/accounts/${account.id}`, cookies })
    ).json<AccountDto>().currentBalance;

  it('começa igual ao saldo inicial', async () => {
    expect(checking.currentBalance).toBe(100_000);
    expect(await balanceOf(savings)).toBe(50_000);
  });

  it('soma receitas, subtrai despesas e move o valor das transferências', async () => {
    await createTransaction({
      type: 'income',
      amount: 30_000,
      accountId: checking.id,
      categoryId: salary.id,
    });
    await createTransaction({
      type: 'expense',
      amount: 12_345,
      accountId: checking.id,
      categoryId: food.id,
    });
    await createTransaction({
      type: 'transfer',
      amount: 20_000,
      accountId: checking.id,
      destinationAccountId: savings.id,
    });
    await createTransaction({
      type: 'transfer',
      amount: 7_550,
      accountId: savings.id,
      destinationAccountId: checking.id,
    });

    // 100.000 + 30.000 − 12.345 − 20.000 + 7.550
    expect(await balanceOf(checking)).toBe(105_205);
    // 50.000 + 20.000 − 7.550
    expect(await balanceOf(savings)).toBe(62_450);
  });

  it('ignora pendentes e compras no cartão; desconta pagamento de fatura', async () => {
    await createTransaction({
      type: 'expense',
      amount: 99_999,
      accountId: checking.id,
      categoryId: food.id,
      status: 'pending',
    });
    // Compra no cartão e pagamento de fatura gravados direto no banco: as rotas de cartões e
    // faturas chegam na Etapa 4.
    const creditCardId = randomUUIDv7();
    await app.db.insert(transactions).values([
      {
        userId,
        type: 'expense',
        description: 'Compra no cartão',
        amount: 40_000,
        date: '2026-11-05',
        creditCardId,
        categoryId: food.id,
      },
      {
        userId,
        type: 'invoice-payment',
        description: 'Fatura de outubro',
        amount: 40_000,
        date: '2026-11-05',
        accountId: checking.id,
        creditCardId,
        invoiceMonth: '2026-10',
      },
    ]);

    expect(await balanceOf(checking)).toBe(65_205);
  });

  it('aparece na listagem e mantém o patrimônio após transferências', async () => {
    const list = (await app.inject({ method: 'GET', url: '/v1/accounts', cookies })).json<
      AccountDto[]
    >();

    expect(list.map(({ name, currentBalance }) => ({ name, currentBalance }))).toEqual([
      { name: 'Corrente', currentBalance: 65_205 },
      { name: 'Poupança', currentBalance: 62_450 },
    ]);
  });

  it('acompanha a edição, a realização e a exclusão de transações', async () => {
    const pending = await createTransaction({
      type: 'income',
      amount: 1_000,
      accountId: savings.id,
      categoryId: salary.id,
      status: 'pending',
    });
    expect(await balanceOf(savings)).toBe(62_450);

    await app.inject({
      method: 'PATCH',
      url: `/v1/transactions/${pending.id}`,
      cookies,
      payload: { status: 'completed' },
    });
    expect(await balanceOf(savings)).toBe(63_450);

    await app.inject({ method: 'DELETE', url: `/v1/transactions/${pending.id}`, cookies });
    expect(await balanceOf(savings)).toBe(62_450);
  });

  it('recalcula ao mudar o saldo inicial e continua na conta arquivada', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/accounts/${savings.id}`,
      cookies,
      payload: { initialBalance: 0, isArchived: true },
    });

    expect(response.json()).toMatchObject({ initialBalance: 0, currentBalance: 12_450 });
  });

  it('não sofre efeito de transações de outro usuário', async () => {
    // Outro usuário no mesmo banco, com movimentação na própria conta.
    const registered = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: {
        name: 'Outra pessoa',
        email: `outra.${randomUUID()}@exemplo.com`,
        password: 'senha1234',
      },
    });
    const otherCookies = {
      [SESSION_COOKIE]: registered.cookies.find(({ name }) => name === SESSION_COOKIE)?.value ?? '',
    };
    const otherAccount = (
      await app.inject({
        method: 'POST',
        url: '/v1/accounts',
        cookies: otherCookies,
        payload: { name: 'Conta dela', type: 'checking', color: '#1565c0', icon: 'home' },
      })
    ).json<AccountDto>();
    const otherCategories = (
      await app.inject({ method: 'GET', url: '/v1/categories?type=income', cookies: otherCookies })
    ).json<CategoryDto[]>();
    await app.inject({
      method: 'POST',
      url: '/v1/transactions',
      cookies: otherCookies,
      payload: {
        type: 'income',
        description: 'Receita dela',
        amount: 5_000,
        date: '2026-11-05',
        accountId: otherAccount.id,
        categoryId: otherCategories[0]?.id,
      },
    });

    expect(await balanceOf(checking)).toBe(65_205);
  });
});
