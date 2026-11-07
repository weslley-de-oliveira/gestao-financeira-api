import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../../../test/helpers/app.ts';
import { createAccount, signUp, type TestUser } from '../../../test/helpers/users.ts';
import { transactions, type Transaction } from '../../db/schema/index.ts';
import { calculateBalance } from '../accounts/account-balance.ts';
import type { AccountDto } from '../accounts/accounts.schemas.ts';
import { budgetProgress } from '../budgets/budget-rules.ts';
import type { BudgetDto } from '../budgets/budgets.schemas.ts';
import type { CategoryDto } from '../categories/categories.schemas.ts';
import { calculateCardUsage } from '../credit-cards/card-usage.ts';
import type { CreditCardDto } from '../credit-cards/credit-cards.schemas.ts';
import { summarizeTransactions } from '../dashboard/dashboard-metrics.ts';
import { listInvoices } from '../invoices/invoice-rules.ts';
import type { TransactionDto } from './transactions.schemas.ts';

/**
 * Estornos em conta e no cartão, em vários meses: saldo, uso do limite, faturas, orçamento e
 * totais calculados em SQL pela API têm de bater com as regras de referência (as mesmas do front).
 */
describe('estornos: paridade com as regras de saldo, cartão, fatura, orçamento e totais', () => {
  const TODAY = '2026-11-15';
  let app: FastifyInstance;
  let user: TestUser;
  let account: AccountDto;
  let card: CreditCardDto;
  let food: CategoryDto;

  beforeAll(async () => {
    app = await createTestApp({ today: TODAY });
    user = await signUp(app);
    account = (await createAccount(user, { initialBalance: 100_000 })) as AccountDto;
    card = (
      await user.api('POST', '/v1/credit-cards', {
        name: 'Cartão principal',
        brand: 'visa',
        lastFourDigits: '1234',
        creditLimit: 500_000,
        closingDay: 5,
        dueDay: 12,
        paymentAccountId: account.id,
        color: '#6a1b9a',
      })
    ).json<CreditCardDto>();
    food = (await user.api('GET', '/v1/categories'))
      .json<CategoryDto[]>()
      .find((category) => category.name === 'Alimentação')!;
    await user.api('POST', '/v1/budgets', { categoryId: food.id, limitAmount: 60_000 });

    const expense = async (body: Record<string, unknown>) =>
      (
        await user.api('POST', '/v1/transactions', {
          type: 'expense',
          description: 'Despesa',
          categoryId: food.id,
          ...body,
        })
      ).json<TransactionDto>();
    const refund = async (id: string, amount: number, date: string) => {
      const response = await user.api('POST', `/v1/transactions/${id}/refunds`, { amount, date });
      expect(response.statusCode).toBe(201);
    };

    const inAccount = await expense({ amount: 30_000, date: '2026-11-02', accountId: account.id });
    const october = await expense({ amount: 25_000, date: '2026-10-20', creditCardId: card.id });
    const november = await expense({ amount: 8_000, date: '2026-11-08', creditCardId: card.id });
    await refund(inAccount.id, 10_000, '2026-11-03');
    await refund(inAccount.id, 5_000, '2026-12-01');
    // Estorno da compra de outubro na fatura aberta de dezembro (maior que as compras dela).
    await refund(october.id, 15_000, '2026-11-10');
    await refund(november.id, 2_000, '2026-11-12');
  });

  afterAll(async () => {
    await app.close();
  });

  async function rows(): Promise<Transaction[]> {
    return app.db.select().from(transactions).where(eq(transactions.userId, user.userId));
  }

  it('o saldo da conta é o da regra única do saldo', async () => {
    const listed = (await user.api('GET', `/v1/accounts/${account.id}`)).json<AccountDto>();

    expect(listed.currentBalance).toBe(calculateBalance(listed, await rows()));
    expect(listed.currentBalance).toBe(100_000 - 30_000 + 10_000 + 5_000);
  });

  it('o uso do cartão e as faturas são os da regra de referência', async () => {
    const listed = (await user.api('GET', `/v1/credit-cards/${card.id}`)).json<CreditCardDto>();
    const invoices = (await user.api('GET', `/v1/credit-cards/${card.id}/invoices`)).json<
      { referenceMonth: string; total: number; status: string }[]
    >();
    const all = await rows();

    expect({
      usedLimit: listed.usedLimit,
      availableLimit: listed.availableLimit,
      nextInvoice: listed.nextInvoice,
    }).toEqual(calculateCardUsage(listed, all, TODAY));
    expect(
      invoices.map(({ referenceMonth, total, status }) => [referenceMonth, total, status]),
    ).toEqual(
      listInvoices(card, all, TODAY).map(({ referenceMonth, total, status }) => [
        referenceMonth,
        total,
        status,
      ]),
    );
    // Dezembro: 8.000 de compras − 17.000 de estornos = crédito de 9.000.
    expect(invoices[0]).toMatchObject({ referenceMonth: '2026-12', total: -9_000 });
    expect(listed.usedLimit).toBe(25_000 + 8_000 - 15_000 - 2_000);
  });

  it('o orçamento desconta os estornos no mês deles', async () => {
    const all = await rows();
    const [budget] = (await user.api('GET', '/v1/budgets')).json<BudgetDto[]>();
    if (!budget) throw new Error('orçamento não criado');

    for (const month of ['2026-11', '2026-12']) {
      const progress = (
        await user.api('GET', `/v1/budgets/${budget.id}?month=${month}`)
      ).json<BudgetDto>().progress;
      expect(progress).toEqual(budgetProgress(budget, all, month));
    }
    // Novembro: 30.000 + 8.000 de despesas − 10.000 − 15.000 − 2.000 de estornos.
    expect(budgetProgress(budget, all, '2026-11')?.spent).toBe(11_000);
  });

  it('os totais da listagem e do dashboard são os de summarizeTransactions', async () => {
    const all = await rows();
    const november = all.filter((item) => item.date.startsWith('2026-11'));

    const summary = (
      await user.api('GET', '/v1/transactions/summary?from=2026-11-01&to=2026-11-30')
    ).json<{ count: number; income: number; expense: number; net: number }>();
    const dashboard = (await user.api('GET', '/v1/dashboard?from=2026-11-01&to=2026-11-30')).json<{
      summary: { income: number; expense: number; net: number };
    }>();
    const expected = summarizeTransactions(november);

    expect(summary).toMatchObject({ count: november.length, ...expected, pendingCount: 0 });
    expect(dashboard.summary).toMatchObject({
      income: expected.income,
      expense: expected.expense,
      net: expected.net,
    });
  });
});
