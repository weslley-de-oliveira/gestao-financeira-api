import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../../../test/helpers/app.ts';
import { calculateBalance } from '../../modules/accounts/account-balance.ts';
import type { AccountDto } from '../../modules/accounts/accounts.schemas.ts';
import { SESSION_COOKIE } from '../../modules/auth/session-cookie.ts';
import type { DashboardDto } from '../../modules/dashboard/dashboard.schemas.ts';
import type { TransactionDto } from '../../modules/transactions/transactions.schemas.ts';
import { transactions, users } from '../schema/index.ts';
import { DEMO_CREDENTIALS, seedDemo } from './demo-seed.ts';
import { monthsSinceAnchor, shiftSeedDates } from './seed-dates.ts';

describe('datas do seed', () => {
  it('conta os meses desde a âncora, nunca negativo', () => {
    expect(monthsSinceAnchor('2026-11-05', '2026-11-30')).toBe(0);
    expect(monthsSinceAnchor('2026-11-05', '2027-02-01')).toBe(3);
    expect(monthsSinceAnchor('2026-11-05', '2026-01-01')).toBe(0);
  });

  it('avança datas e meses mantendo o dia, e não mexe nos outros campos', () => {
    const shifted = shiftSeedDates(
      {
        date: '2026-11-28',
        createdAt: '2026-12-02T12:00:00.000Z',
        invoiceMonth: '2026-12',
        limits: [{ month: '2026-09', amount: 1_000 }],
        deadline: null,
        description: '2026-11-28',
      },
      2,
    );

    expect(shifted).toEqual({
      date: '2027-01-28',
      createdAt: '2027-02-02T12:00:00.000Z',
      invoiceMonth: '2027-02',
      limits: [{ month: '2026-11', amount: 1_000 }],
      deadline: null,
      description: '2026-11-28',
    });
  });
});

// A âncora do seed é 05/11/2026: com hoje em 15/01/2027, as datas avançam 2 meses.
describe('seed da demo', () => {
  let app: FastifyInstance;
  let cookies: Record<string, string>;

  beforeAll(async () => {
    app = await createTestApp({ today: '2027-01-15' });
    await seedDemo(app.db, '2027-01-15');
    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: DEMO_CREDENTIALS,
    });
    expect(login.statusCode).toBe(200);
    cookies = {
      [SESSION_COOKIE]: login.cookies.find(({ name }) => name === SESSION_COOKIE)!.value,
    };
  });

  afterAll(async () => {
    await app.close();
  });

  const get = async <T>(url: string) =>
    (await app.inject({ method: 'GET', url, cookies })).json<T>();

  it('cria a demo com o cenário do front e o login demo@exemplo.com / demo1234', async () => {
    const accounts = await get<AccountDto[]>('/v1/accounts');
    const page = await get<{ items: TransactionDto[] }>('/v1/transactions?limit=100');

    expect(accounts.map(({ name }) => name)).toEqual([
      'Carteira',
      'Conta corrente',
      'Investimentos',
      'Poupança',
    ]);
    expect(page.items).toHaveLength(100);
    expect(await get<unknown[]>('/v1/categories')).toHaveLength(14);
    expect(await get<unknown[]>('/v1/credit-cards')).toHaveLength(2);
    expect(await get<unknown[]>('/v1/budgets')).toHaveLength(4);
    expect(await get<unknown[]>('/v1/goals')).toHaveLength(4);
  });

  it('avança as datas até o mês atual', async () => {
    const rows = await app.db.select({ date: transactions.date }).from(transactions);
    const demoDates = (
      await app.db
        .select({ date: transactions.date })
        .from(transactions)
        .innerJoin(users, eq(users.id, transactions.userId))
        .where(eq(users.email, DEMO_CREDENTIALS.email))
    ).map(({ date }) => date);

    expect(rows.length).toBeGreaterThanOrEqual(164);
    // No seed original, de 02/06/2026 a 25/11/2026; dois meses depois.
    expect(demoDates.toSorted()[0]).toBe('2026-08-02');
    expect(demoDates.toSorted().at(-1)).toBe('2027-01-25');
  });

  it('os saldos da API batem com a regra do front sobre as transações da demo', async () => {
    const accounts = await get<AccountDto[]>('/v1/accounts');
    const all: TransactionDto[] = [];
    let cursor: string | null = null;
    do {
      const page: { items: TransactionDto[]; nextCursor: string | null } = await get(
        `/v1/transactions?limit=100${cursor ? `&cursor=${cursor}` : ''}`,
      );
      all.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor);

    expect(all).toHaveLength(164);
    for (const account of accounts) {
      expect(account.currentBalance).toBe(calculateBalance(account, all));
    }
  });

  it('o dashboard abre com dados do mês', async () => {
    const dashboard = await get<DashboardDto>('/v1/dashboard');

    expect(dashboard.from).toBe('2027-01-01');
    expect(dashboard.summary.expense).toBeGreaterThan(0);
    expect(dashboard.recentTransactions).toHaveLength(5);
    expect(dashboard.goalHighlights.length).toBeGreaterThan(0);
  });

  it('rodar de novo recria a demo, sem duplicar', async () => {
    await seedDemo(app.db, '2027-01-15');

    const demo = await app.db.select().from(users).where(eq(users.email, DEMO_CREDENTIALS.email));
    expect(demo).toHaveLength(1);
    const count = await app.db
      .select()
      .from(transactions)
      .where(eq(transactions.userId, demo[0]!.id));
    expect(count).toHaveLength(164);
  });
});
