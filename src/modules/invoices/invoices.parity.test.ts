import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp } from '../../../test/helpers/app.ts';
import { createAccount, signUp, type TestUser } from '../../../test/helpers/users.ts';
import type { AccountDto } from '../accounts/accounts.schemas.ts';
import type { CategoryDto } from '../categories/categories.schemas.ts';
import type { CreditCardDto } from '../credit-cards/credit-cards.schemas.ts';
import type { TransactionDto } from '../transactions/transactions.schemas.ts';
import type { InvoiceDto } from './invoices.schemas.ts';

/**
 * Paridade com `invoices.facade.spec.ts` do front: os mesmos cenários, agora pela API, incluindo o
 * fluxo pagar → bloquear as compras → desfazer. Hoje: 15/11/2026. O cartão fecha dia 5 e vence
 * dia 12: a fatura 2026-11 (compras de 05/10 a 04/11) está vencida e a 2026-12 está aberta.
 */
describe('paridade com a facade de faturas do front', () => {
  let app: FastifyInstance;
  let user: TestUser;
  let account: { id: string };
  let card: CreditCardDto;
  let shopping: CategoryDto;
  let shoe: TransactionDto;

  beforeAll(async () => {
    app = await createTestApp({ today: '2026-11-15' });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    user = await signUp(app);
    account = await createAccount(user, { name: 'Corrente', initialBalance: 100_000 });
    card = (
      await user.api('POST', '/v1/credit-cards', {
        name: 'Roxinho',
        brand: 'mastercard',
        lastFourDigits: '4321',
        creditLimit: 300_000,
        closingDay: 5,
        dueDay: 12,
        paymentAccountId: account.id,
        color: '#6a1b9a',
      })
    ).json<CreditCardDto>();
    shopping = (await user.api('GET', '/v1/categories?type=expense'))
      .json<CategoryDto[]>()
      .find((category) => category.name === 'Compras')!;
    shoe = (await purchase('Sapato', 20_000, '2026-10-20')).json<TransactionDto>();
    await purchase('Notebook', 9_990, '2026-11-10');
  });

  function purchase(description: string, amount: number, date: string) {
    return user.api('POST', '/v1/transactions', {
      type: 'expense',
      description,
      amount,
      date,
      creditCardId: card.id,
      categoryId: shopping.id,
    });
  }

  const pay = (month: string, creditCardId = card.id) =>
    user.api('POST', `/v1/credit-cards/${creditCardId}/invoices/${month}/payment`);

  const allTransactions = async () =>
    (await user.api('GET', '/v1/transactions?limit=100')).json<{ items: TransactionDto[] }>().items;

  it('paga a fatura inteira pela conta de pagamento do cartão, hoje', async () => {
    const payment = (await pay('2026-11')).json<InvoiceDto>().payment;

    expect(payment).toMatchObject({
      type: 'invoice-payment',
      amount: 20_000,
      date: '2026-11-15',
      accountId: account.id,
      creditCardId: card.id,
      invoiceMonth: '2026-11',
      categoryId: null,
      status: 'completed',
    });
    expect(await allTransactions()).toContainEqual(payment);
  });

  it('debita a conta e libera o limite sem contar uma despesa nova', async () => {
    const expensesBefore = (await allTransactions()).filter((t) => t.type === 'expense');

    await pay('2026-11');

    expect((await allTransactions()).filter((t) => t.type === 'expense')).toEqual(expensesBefore);
    const balance = (await user.api('GET', `/v1/accounts/${account.id}`)).json<AccountDto>();
    expect(balance.currentBalance).toBe(80_000);
    const usage = (await user.api('GET', `/v1/credit-cards/${card.id}`)).json<CreditCardDto>();
    expect(usage.usedLimit).toBe(9_990);
  });

  it('recusa fatura aberta, vazia, já paga, de cartão desconhecido ou mês inválido', async () => {
    expect((await pay('2026-12')).statusCode).toBe(409);
    expect((await pay('2026-10')).statusCode).toBe(409);
    expect((await pay('2026-11')).statusCode).toBe(201);
    expect((await pay('2026-11')).statusCode).toBe(409);
    expect((await pay('2026-11', '01900000-0000-7000-8000-000000000000')).statusCode).toBe(404);
    expect((await pay('invalid')).statusCode).toBe(422);
    expect((await allTransactions()).filter((t) => t.type === 'invoice-payment')).toHaveLength(1);
  });

  it('recusa conta de pagamento arquivada', async () => {
    await user.api('PATCH', `/v1/accounts/${account.id}`, { isArchived: true });

    expect((await pay('2026-11')).statusCode).toBe(409);
  });

  it('bloqueia as compras da fatura paga até o pagamento ser desfeito', async () => {
    await pay('2026-11');

    expect((await user.api('DELETE', `/v1/transactions/${shoe.id}`)).statusCode).toBe(409);
    expect((await purchase('Atrasada', 1_000, '2026-10-25')).statusCode).toBe(409);

    const undone = await user.api('DELETE', `/v1/credit-cards/${card.id}/invoices/2026-11/payment`);

    expect(undone.statusCode).toBe(200);
    expect((await allTransactions()).some((t) => t.type === 'invoice-payment')).toBe(false);
    expect((await user.api('DELETE', `/v1/transactions/${shoe.id}`)).statusCode).toBe(204);
  });

  it('não mexe em cartões de outros usuários', async () => {
    const other = await signUp(app);

    const response = await other.api(
      'POST',
      `/v1/credit-cards/${card.id}/invoices/2026-11/payment`,
    );

    expect(response.statusCode).toBe(404);
  });
});
