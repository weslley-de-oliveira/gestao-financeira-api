import { randomUUIDv7 } from 'node:crypto';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../../../test/helpers/app.ts';
import { createAccount, signUp, type TestUser } from '../../../test/helpers/users.ts';
import type { AccountDto } from '../accounts/accounts.schemas.ts';
import type { CategoryDto } from '../categories/categories.schemas.ts';
import type { CreditCardDto } from '../credit-cards/credit-cards.schemas.ts';
import type { TransactionDto } from './transactions.schemas.ts';

describe('compras no cartão de crédito', () => {
  let app: FastifyInstance;
  let user: TestUser;
  let account: { id: string };
  let savings: { id: string };
  let card: CreditCardDto;
  let food: CategoryDto;
  let salary: CategoryDto;

  beforeAll(async () => {
    app = await createTestApp();
    user = await signUp(app);
    account = await createAccount(user, { initialBalance: 100_000 });
    savings = await createAccount(user, { name: 'Poupança' });
    card = await createCard(user, account.id);
    const categories = (await user.api('GET', '/v1/categories')).json<CategoryDto[]>();
    food = categories.find((category) => category.name === 'Alimentação')!;
    salary = categories.find((category) => category.name === 'Salário')!;
  });

  afterAll(async () => {
    await app.close();
  });

  async function createCard(
    owner: TestUser,
    paymentAccountId: string,
    name = 'Roxinho',
  ): Promise<CreditCardDto> {
    const response = await owner.api('POST', '/v1/credit-cards', {
      name,
      brand: 'mastercard',
      lastFourDigits: '4321',
      creditLimit: 500_000,
      closingDay: 5,
      dueDay: 12,
      paymentAccountId,
      color: '#6a1b9a',
    });
    return response.json<CreditCardDto>();
  }

  const purchase = (overrides: Record<string, unknown> = {}) => ({
    type: 'expense',
    description: 'Tênis',
    amount: 39_990,
    date: '2026-11-10',
    creditCardId: card.id,
    categoryId: food.id,
    ...overrides,
  });

  const create = (body: Record<string, unknown>) => user.api('POST', '/v1/transactions', body);

  function expectInvalid(response: LightMyRequestResponse, field: string, message: string) {
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ errors: [{ field, message }] });
  }

  const balanceOf = async (id: string) =>
    (await user.api('GET', `/v1/accounts/${id}`)).json<AccountDto>().currentBalance;

  it('registra a compra no cartão, sem conta e sempre realizada', async () => {
    const response = await create(purchase({ status: 'pending' }));

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      type: 'expense',
      creditCardId: card.id,
      accountId: null,
      status: 'completed',
    });
  });

  it('não altera o saldo de nenhuma conta', async () => {
    const before = await balanceOf(account.id);

    await create(purchase({ amount: 1_000 }));

    expect(await balanceOf(account.id)).toBe(before);
  });

  it('aparece no filtro do cartão', async () => {
    const created = (await create(purchase({ description: 'Filtrada' }))).json<TransactionDto>();

    const page = (
      await user.api('GET', `/v1/transactions?creditCardId=${card.id}&q=filtrada`)
    ).json<{ items: TransactionDto[] }>();

    expect(page.items.map(({ id }) => id)).toEqual([created.id]);
  });

  it.each([
    [
      'receita no cartão',
      () => purchase({ type: 'income', categoryId: salary.id }),
      'body.creditCardId',
      'Receitas não podem ser no cartão: escolha uma conta.',
    ],
    [
      'conta e cartão juntos',
      () => purchase({ accountId: account.id }),
      'body.creditCardId',
      'Informe a conta ou o cartão, não os dois.',
    ],
  ])('responde 422 para %s', async (_case, body, field, message) => {
    expectInvalid(await create(body()), field, message);
  });

  it('responde 422 para transferência com cartão', async () => {
    const response = await create({
      ...purchase({ type: 'transfer', categoryId: undefined }),
      accountId: account.id,
      destinationAccountId: savings.id,
    });

    expect(response.statusCode).toBe(422);
  });

  it('trata cartão de outro usuário e cartão inexistente como inexistentes', async () => {
    const other = await signUp(app);
    const otherCard = await createCard(other, (await createAccount(other)).id);

    for (const creditCardId of [otherCard.id, randomUUIDv7()]) {
      expectInvalid(
        await create(purchase({ creditCardId })),
        'body.creditCardId',
        'Cartão não encontrado.',
      );
    }
  });

  describe('cartão arquivado', () => {
    it('não aceita compra nova; a compra que já existia continua editável', async () => {
      const archivable = await createCard(user, account.id, 'Antigo');
      const old = (await create(purchase({ creditCardId: archivable.id }))).json<TransactionDto>();
      await user.api('PATCH', `/v1/credit-cards/${archivable.id}`, { isArchived: true });

      const response = await create(purchase({ creditCardId: archivable.id }));
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        detail: 'O cartão "Antigo" está arquivado. Reative-o para lançar nele.',
      });

      const edited = await user.api('PATCH', `/v1/transactions/${old.id}`, { amount: 1 });
      expect(edited.statusCode).toBe(200);
    });
  });

  describe('edição', () => {
    const patch = (id: string, body: Record<string, unknown>) =>
      user.api('PATCH', `/v1/transactions/${id}`, body);

    it('informar a conta tira a compra do cartão', async () => {
      const created = (await create(purchase())).json<TransactionDto>();

      const response = await patch(created.id, { accountId: account.id, status: 'pending' });

      expect(response.json()).toMatchObject({
        accountId: account.id,
        creditCardId: null,
        status: 'pending',
      });
    });

    it('informar o cartão tira a despesa da conta e a deixa realizada', async () => {
      const created = (
        await create(
          purchase({ creditCardId: undefined, accountId: account.id, status: 'pending' }),
        )
      ).json<TransactionDto>();

      const response = await patch(created.id, { creditCardId: card.id });

      expect(response.json()).toMatchObject({
        accountId: null,
        creditCardId: card.id,
        status: 'completed',
      });
    });

    it('a compra não pode ficar pendente', async () => {
      const created = (await create(purchase())).json<TransactionDto>();

      const response = await patch(created.id, { status: 'pending' });

      expect(response.json()).toMatchObject({ status: 'completed' });
    });

    it('virar receita exige sair do cartão', async () => {
      const created = (await create(purchase())).json<TransactionDto>();

      expectInvalid(
        await patch(created.id, { type: 'income', categoryId: salary.id }),
        'body.creditCardId',
        'Receitas não podem ser no cartão: escolha uma conta.',
      );
      const moved = await patch(created.id, {
        type: 'income',
        categoryId: salary.id,
        accountId: account.id,
      });
      expect(moved.json()).toMatchObject({ type: 'income', creditCardId: null });
    });

    it('virar transferência descarta o cartão', async () => {
      const created = (await create(purchase())).json<TransactionDto>();

      const response = await patch(created.id, {
        type: 'transfer',
        accountId: account.id,
        destinationAccountId: savings.id,
      });

      expect(response.json()).toMatchObject({
        type: 'transfer',
        creditCardId: null,
        categoryId: null,
        accountId: account.id,
      });
    });
  });
});
