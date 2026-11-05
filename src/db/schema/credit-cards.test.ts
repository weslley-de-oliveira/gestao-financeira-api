import { randomUUID, randomUUIDv7 } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase } from '../client.ts';
import { accounts, creditCards, users, type Account, type NewCreditCard } from './index.ts';

// Os arquivos de teste rodam em paralelo no mesmo banco: cada teste cria o próprio usuário.
const { db, pool } = createDatabase(inject('databaseUrl'), 2);

afterAll(async () => {
  await pool.end();
});

/** Usuário com uma conta para pagar as faturas. */
async function createOwner(): Promise<Account> {
  const [user] = await db
    .insert(users)
    .values({
      email: `${randomUUID()}@exemplo.com`,
      name: 'Pessoa de Teste',
      passwordHash: 'hash-fictício',
    })
    .returning();
  const [account] = await db
    .insert(accounts)
    .values({
      userId: user!.id,
      name: 'Corrente',
      type: 'checking',
      color: '#1565c0',
      icon: 'home',
    })
    .returning();
  return account!;
}

const violation = (code: string, constraint: string) => ({ cause: { code, constraint } });

describe('tabela credit_cards', () => {
  let account: Account;

  beforeAll(async () => {
    account = await createOwner();
  });

  const card = (overrides: Partial<NewCreditCard> = {}): NewCreditCard => ({
    userId: account.userId,
    paymentAccountId: account.id,
    name: 'Roxinho',
    brand: 'mastercard',
    lastFourDigits: '4321',
    creditLimit: 100_000,
    closingDay: 5,
    dueDay: 12,
    color: '#6a1b9a',
    ...overrides,
  });

  const insert = (values: NewCreditCard) => db.insert(creditCards).values(values).returning();

  it('grava o cartão ativo, com o limite em centavos como número', async () => {
    const [created] = await insert(card({ creditLimit: 100_000_000_000 }));

    expect(created).toMatchObject({
      lastFourDigits: '4321',
      creditLimit: 100_000_000_000,
      closingDay: 5,
      dueDay: 12,
      isArchived: false,
    });
  });

  it.each([
    ['nome vazio', { name: '' }, 'credit_cards_name_length'],
    ['nome com 41 caracteres', { name: 'a'.repeat(41) }, 'credit_cards_name_length'],
    [
      'bandeira desconhecida',
      { brand: 'diners' as NewCreditCard['brand'] },
      'credit_cards_brand_valid',
    ],
    ['dígitos com letra', { lastFourDigits: '12a4' }, 'credit_cards_last_four_digits'],
    ['menos de quatro dígitos', { lastFourDigits: '123 ' }, 'credit_cards_last_four_digits'],
    ['limite zero', { creditLimit: 0 }, 'credit_cards_credit_limit_range'],
    [
      'limite acima de R$ 1 bilhão',
      { creditLimit: 100_000_000_001 },
      'credit_cards_credit_limit_range',
    ],
    ['dia de fechamento 0', { closingDay: 0 }, 'credit_cards_days_range'],
    ['dia de vencimento 32', { dueDay: 32 }, 'credit_cards_days_range'],
    [
      'fechamento e vencimento no mesmo dia',
      { closingDay: 10, dueDay: 10 },
      'credit_cards_days_differ',
    ],
    ['cor fora da paleta', { color: '#000000' }, 'credit_cards_color_valid'],
  ])('rejeita %s', async (_case, overrides, constraint) => {
    await expect(insert(card(overrides))).rejects.toMatchObject(violation('23514', constraint));
  });

  it('não guarda mais que quatro dígitos', async () => {
    // A coluna é char(4): um número de cartão completo nem cabe nela.
    await expect(insert(card({ lastFourDigits: '4111111111111111' }))).rejects.toMatchObject({
      cause: { code: '22001' },
    });
  });

  it.each([
    ['conta de outro usuário', async () => (await createOwner()).id],
    ['conta inexistente', () => Promise.resolve(randomUUIDv7())],
  ])('rejeita conta de pagamento: %s', async (_case, paymentAccountId) => {
    await expect(
      insert(card({ paymentAccountId: await paymentAccountId() })),
    ).rejects.toMatchObject(violation('23503', 'credit_cards_payment_account_fk'));
  });

  it('apaga os cartões junto com o usuário', async () => {
    const doomed = await createOwner();
    await insert(card({ userId: doomed.userId, paymentAccountId: doomed.id }));

    await db.delete(users).where(eq(users.id, doomed.userId));

    expect(
      await db.select().from(creditCards).where(eq(creditCards.userId, doomed.userId)),
    ).toEqual([]);
  });

  it('impede apagar a conta que paga as faturas', async () => {
    const owner = await createOwner();
    await insert(card({ userId: owner.userId, paymentAccountId: owner.id }));

    await expect(db.delete(accounts).where(eq(accounts.id, owner.id))).rejects.toMatchObject(
      violation('23503', 'credit_cards_payment_account_fk'),
    );
  });
});
