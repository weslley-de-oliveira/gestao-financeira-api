import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp } from '../../../test/helpers/app.ts';
import { createAccount, signUp, type TestUser } from '../../../test/helpers/users.ts';
import {
  accounts,
  budgets,
  categories,
  creditCards,
  goals,
  sessions,
  transactions,
  users,
} from '../../db/schema/index.ts';
import type { UserDto } from '../auth/auth.schemas.ts';
import { SESSION_COOKIE } from '../auth/session-cookie.ts';
import type { CategoryDto } from '../categories/categories.schemas.ts';
import type { CreditCardDto } from '../credit-cards/credit-cards.schemas.ts';
import type { GoalDto } from '../goals/goals.schemas.ts';

// Hoje é 15/11/2026.
describe('DELETE /v1/me', () => {
  let app: FastifyInstance;
  let user: TestUser;

  beforeAll(async () => {
    app = await createTestApp({ today: '2026-11-15' });
  });

  afterAll(async () => {
    await app.close();
  });

  /** Pessoa com um pouco de tudo: conta, transação, cartão com fatura paga, orçamento e meta. */
  async function userWithData(): Promise<TestUser> {
    const owner = await signUp(app);
    const account = await createAccount(owner, { initialBalance: 100_000 });
    const food = (await owner.api('GET', '/v1/categories?type=expense')).json<CategoryDto[]>()[0]!;
    const card = (
      await owner.api('POST', '/v1/credit-cards', {
        name: 'Roxinho',
        brand: 'visa',
        lastFourDigits: '4321',
        creditLimit: 500_000,
        closingDay: 5,
        dueDay: 12,
        paymentAccountId: account.id,
        color: '#6a1b9a',
      })
    ).json<CreditCardDto>();
    await owner.api('POST', '/v1/transactions', {
      type: 'expense',
      description: 'Na conta',
      amount: 1_000,
      date: '2026-11-10',
      accountId: account.id,
      categoryId: food.id,
    });
    await owner.api('POST', '/v1/transactions', {
      type: 'expense',
      description: 'No cartão',
      amount: 2_000,
      date: '2026-10-20',
      creditCardId: card.id,
      categoryId: food.id,
    });
    await owner.api('POST', `/v1/credit-cards/${card.id}/invoices/2026-11/payment`);
    await owner.api('POST', '/v1/budgets', { categoryId: food.id, limitAmount: 50_000 });
    const goal = (
      await owner.api('POST', '/v1/goals', {
        name: 'Viagem',
        targetAmount: 100_000,
        color: '#2e7d32',
        icon: 'flight',
      })
    ).json<GoalDto>();
    await owner.api('POST', `/v1/goals/${goal.id}/contributions`, {
      type: 'deposit',
      amount: 1_000,
      date: '2026-11-01',
    });
    return owner;
  }

  /** Linhas da pessoa em cada tabela com dono. */
  async function rowsOf(userId: string) {
    const count = async (
      table:
        | typeof accounts
        | typeof categories
        | typeof transactions
        | typeof creditCards
        | typeof budgets
        | typeof goals
        | typeof sessions,
    ) => (await app.db.select().from(table).where(eq(table.userId, userId))).length;
    return {
      users: (await app.db.select().from(users).where(eq(users.id, userId))).length,
      accounts: await count(accounts),
      categories: await count(categories),
      transactions: await count(transactions),
      creditCards: await count(creditCards),
      budgets: await count(budgets),
      goals: await count(goals),
      sessions: await count(sessions),
    };
  }

  beforeEach(async () => {
    user = await userWithData();
  });

  const remove = (password: string, owner = user) => owner.api('DELETE', '/v1/me', { password });

  it('exclui a pessoa e todos os dados dela, e apaga o cookie', async () => {
    const before = await rowsOf(user.userId);
    expect(Object.values(before).every((count) => count > 0)).toBe(true);

    const response = await remove('senha1234');

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');
    const cleared = response.cookies.find(({ name }) => name === SESSION_COOKIE);
    expect(cleared?.value).toBe('');
    expect(await rowsOf(user.userId)).toEqual({
      users: 0,
      accounts: 0,
      categories: 0,
      transactions: 0,
      creditCards: 0,
      budgets: 0,
      goals: 0,
      sessions: 0,
    });
  });

  it('encerra todas as sessões, inclusive de outros aparelhos', async () => {
    const email = (await user.api('GET', '/v1/auth/me')).json<UserDto>().email;
    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email, password: 'senha1234' },
    });
    const otherDevice = login.cookies.find(({ name }) => name === SESSION_COOKIE)!.value;

    await remove('senha1234');

    for (const token of [user.cookies[SESSION_COOKIE]!, otherDevice]) {
      const me = await app.inject({
        method: 'GET',
        url: '/v1/auth/me',
        cookies: { [SESSION_COOKIE]: token },
      });
      expect(me.statusCode).toBe(401);
    }
    const again = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email, password: 'senha1234' },
    });
    expect(again.statusCode).toBe(401);
  });

  it('não mexe nos dados de outras pessoas', async () => {
    const other = await userWithData();
    const before = await rowsOf(other.userId);

    await remove('senha1234');

    expect(await rowsOf(other.userId)).toEqual(before);
  });

  it('responde 422 com senha errada, sem apagar nada', async () => {
    const before = await rowsOf(user.userId);

    const response = await remove('senha-errada');

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      errors: [{ field: 'body.password', message: 'Senha incorreta.' }],
    });
    expect(await rowsOf(user.userId)).toEqual(before);
  });

  it('responde 422 sem a senha', async () => {
    const response = await user.api('DELETE', '/v1/me', {});

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      errors: [{ field: 'body.password', message: 'Informe a senha atual para confirmar.' }],
    });
  });

  it('responde 401 sem sessão', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: '/v1/me',
      payload: { password: 'senha1234' },
    });

    expect(response.statusCode).toBe(401);
  });
});
