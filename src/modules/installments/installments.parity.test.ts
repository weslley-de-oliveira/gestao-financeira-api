import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../../../test/helpers/app.ts';
import { createAccount, signUp, type TestUser } from '../../../test/helpers/users.ts';
import { transactions, type Transaction } from '../../db/schema/index.ts';
import { budgetProgress } from '../budgets/budget-rules.ts';
import type { BudgetDto } from '../budgets/budgets.schemas.ts';
import type { CategoryDto } from '../categories/categories.schemas.ts';
import { calculateCardUsage } from '../credit-cards/card-usage.ts';
import type { CreditCardDto } from '../credit-cards/credit-cards.schemas.ts';
import { listInvoices } from '../invoices/invoice-rules.ts';
import type { InstallmentPurchaseDto } from './installments.schemas.ts';

/**
 * Uma compra em 10x atravessando faturas pagas e abertas: fatura, uso do limite e orçamento
 * calculados em SQL pela API têm de bater com as regras de referência (as mesmas do front),
 * aplicadas às parcelas como compras comuns.
 */
describe('compras parceladas: paridade com as regras de fatura, limite e orçamento', () => {
  const TODAY = '2026-11-15';
  let app: FastifyInstance;
  let user: TestUser;
  let card: CreditCardDto;
  let food: CategoryDto;
  let purchase: InstallmentPurchaseDto;

  beforeAll(async () => {
    app = await createTestApp({ today: TODAY });
    user = await signUp(app);
    const account = await createAccount(user, { initialBalance: 1_000_000 });
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

    // Compra comum na mesma fatura da 1ª parcela, e a parcelada (sobra de 5 centavos na 1ª).
    await user.api('POST', '/v1/transactions', {
      type: 'expense',
      description: 'Mercado',
      amount: 25_000,
      date: '2026-09-20',
      creditCardId: card.id,
      categoryId: food.id,
    });
    purchase = (
      await user.api('POST', '/v1/installment-purchases', {
        description: 'Geladeira',
        amount: 100_005,
        date: '2026-09-10',
        creditCardId: card.id,
        categoryId: food.id,
        installmentCount: 10,
      })
    ).json<InstallmentPurchaseDto>();
    // Faturas de outubro (paga em dia: depois do fechamento de novembro, o saldo dela já teria
    // passado para novembro) e novembro pagas; dezembro em diante, abertas.
    const october = await createTestApp({ today: '2026-10-10' });
    try {
      const paid = await october.inject({
        method: 'POST',
        url: `/v1/credit-cards/${card.id}/invoices/2026-10/payment`,
        cookies: user.cookies,
      });
      expect(paid.statusCode).toBe(201);
    } finally {
      await october.close();
    }
    const paid = await user.api('POST', `/v1/credit-cards/${card.id}/invoices/2026-11/payment`);
    expect(paid.statusCode).toBe(201);
    await user.api('POST', '/v1/budgets', { categoryId: food.id, limitAmount: 60_000 });
  });

  afterAll(async () => {
    await app.close();
  });

  async function rows(): Promise<Transaction[]> {
    return app.db.select().from(transactions).where(eq(transactions.userId, user.userId));
  }

  it('divide em 10 parcelas, a sobra na 1ª, uma por fatura de outubro a julho', () => {
    expect(purchase.installments.map((parcel) => parcel.amount)).toEqual([
      10_005, 10_000, 10_000, 10_000, 10_000, 10_000, 10_000, 10_000, 10_000, 10_000,
    ]);
    expect(purchase.installments.map((parcel) => parcel.date)).toEqual([
      '2026-09-10',
      '2026-10-10',
      '2026-11-10',
      '2026-12-10',
      '2027-01-10',
      '2027-02-10',
      '2027-03-10',
      '2027-04-10',
      '2027-05-10',
      '2027-06-10',
    ]);
  });

  it('as faturas da API são as da regra de referência', async () => {
    const api = (await user.api('GET', `/v1/credit-cards/${card.id}/invoices`)).json<
      { referenceMonth: string; total: number; status: string; purchaseCount: number }[]
    >();
    const expected = listInvoices(card, await rows(), TODAY);

    expect(api.map(({ referenceMonth, total, status }) => [referenceMonth, total, status])).toEqual(
      expected.map(({ referenceMonth, total, status }) => [referenceMonth, total, status]),
    );
    expect(api.map((invoice) => invoice.referenceMonth)).toEqual([
      '2027-07',
      '2027-06',
      '2027-05',
      '2027-04',
      '2027-03',
      '2027-02',
      '2027-01',
      '2026-12',
      '2026-11',
      '2026-10',
    ]);
    // Outubro: a 1ª parcela e o mercado.
    expect(api.at(-1)).toMatchObject({ total: 35_005, status: 'paid', purchaseCount: 2 });
  });

  it('o limite reserva as parcelas ainda não pagas', async () => {
    const listed = (await user.api('GET', `/v1/credit-cards/${card.id}`)).json<CreditCardDto>();
    const { usedLimit, availableLimit, nextInvoice } = listed;

    expect({ usedLimit, availableLimit, nextInvoice }).toEqual(
      calculateCardUsage(listed, await rows(), TODAY),
    );
    expect(usedLimit).toBe(80_000);
  });

  it('o orçamento conta cada parcela no mês dela', async () => {
    const all = await rows();
    const [budget] = (await user.api('GET', '/v1/budgets')).json<BudgetDto[]>();
    if (!budget) throw new Error('orçamento não criado');

    for (const month of ['2026-09', '2026-10', '2026-11', '2026-12', '2027-01']) {
      const progress = (
        await user.api('GET', `/v1/budgets/${budget.id}?month=${month}`)
      ).json<BudgetDto>().progress;
      expect(progress).toEqual(budgetProgress(budget, all, month));
    }
    // O orçamento vale de novembro em diante (criado hoje): uma parcela de R$ 100,00 por mês.
    expect(budgetProgress(budget, all, '2026-11')?.spent).toBe(10_000);
    expect(budgetProgress(budget, all, '2026-12')?.spent).toBe(10_000);
  });
});
