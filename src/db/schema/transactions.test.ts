import { randomUUID, randomUUIDv7 } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { categoryNameKey } from '../../modules/categories/category-name.ts';
import { createDatabase } from '../client.ts';
import {
  accounts,
  categories,
  transactions,
  users,
  type Account,
  type Category,
  type NewTransaction,
  type User,
} from './index.ts';

// Os arquivos de teste rodam em paralelo no mesmo banco: cada teste cria o próprio usuário.
const { db, pool } = createDatabase(inject('databaseUrl'), 2);

afterAll(async () => {
  await pool.end();
});

interface Owner {
  user: User;
  checking: Account;
  savings: Account;
  food: Category;
  salary: Category;
}

/** Usuário com duas contas, uma categoria de despesa e uma de receita. */
async function createOwner(): Promise<Owner> {
  const [user] = await db
    .insert(users)
    .values({
      email: `${randomUUID()}@exemplo.com`,
      name: 'Pessoa de Teste',
      passwordHash: 'hash-fictício',
    })
    .returning();
  if (!user) throw new Error('usuário não inserido');
  const account = { userId: user.id, type: 'checking' as const, color: '#1565c0', icon: 'home' };
  const [checking, savings] = await db
    .insert(accounts)
    .values([
      { ...account, name: 'Corrente' },
      { ...account, name: 'Poupança' },
    ])
    .returning();
  const category = (name: string, type: 'expense' | 'income') => ({
    userId: user.id,
    name,
    nameNormalized: categoryNameKey(name),
    type,
    icon: 'more_horiz',
    color: '#546e7a',
  });
  const [food, salary] = await db
    .insert(categories)
    .values([category('Alimentação', 'expense'), category('Salário', 'income')])
    .returning();
  return { user, checking: checking!, savings: savings!, food: food!, salary: salary! };
}

const violation = (code: string, constraint: string) => ({ cause: { code, constraint } });
const shapeViolation = violation('23514', 'transactions_shape');

describe('tabela transactions', () => {
  let owner: Owner;
  /** Formas válidas de cada tipo, para o dono de teste. */
  let expense: NewTransaction;
  let income: NewTransaction;
  let cardPurchase: NewTransaction;
  let transfer: NewTransaction;
  let invoicePayment: NewTransaction;

  beforeAll(async () => {
    owner = await createOwner();
    const base = { userId: owner.user.id, description: 'Lançamento', amount: 12_345 };
    expense = {
      ...base,
      type: 'expense',
      date: '2026-11-05',
      accountId: owner.checking.id,
      categoryId: owner.food.id,
    };
    income = {
      ...base,
      type: 'income',
      date: '2026-11-05',
      accountId: owner.checking.id,
      categoryId: owner.salary.id,
      status: 'pending',
    };
    cardPurchase = {
      ...base,
      type: 'expense',
      date: '2026-11-05',
      creditCardId: randomUUIDv7(),
      categoryId: owner.food.id,
    };
    transfer = {
      ...base,
      type: 'transfer',
      date: '2026-11-05',
      accountId: owner.checking.id,
      destinationAccountId: owner.savings.id,
    };
    invoicePayment = {
      ...base,
      type: 'invoice-payment',
      date: '2026-11-05',
      accountId: owner.checking.id,
      creditCardId: randomUUIDv7(),
      invoiceMonth: '2026-10',
    };
  });

  const insert = (values: NewTransaction) => db.insert(transactions).values(values).returning();

  it('aceita a forma válida de cada tipo', async () => {
    for (const values of [expense, income, cardPurchase, transfer, invoicePayment]) {
      await expect(insert(values)).resolves.toHaveLength(1);
    }
  });

  it('guarda a data como texto yyyy-MM-dd e o valor em centavos como número', async () => {
    const [created] = await insert({ ...expense, date: '2026-01-31', amount: 100_000_000_000 });

    expect(created).toMatchObject({ date: '2026-01-31', amount: 100_000_000_000 });
    expect(created?.status).toBe('completed');
  });

  it.each([
    ['despesa sem categoria', () => ({ ...expense, categoryId: null })],
    ['despesa com conta e cartão', () => ({ ...expense, creditCardId: randomUUIDv7() })],
    [
      'despesa com conta de destino',
      () => ({ ...expense, destinationAccountId: owner.savings.id }),
    ],
    ['despesa com mês de fatura', () => ({ ...expense, invoiceMonth: '2026-10' })],
    ['despesa sem conta nem cartão', () => ({ ...expense, accountId: null })],
    [
      'receita no cartão',
      () => ({ ...cardPurchase, type: 'income' as const, categoryId: owner.salary.id }),
    ],
    ['compra no cartão pendente', () => ({ ...cardPurchase, status: 'pending' as const })],
    [
      'transferência para a mesma conta',
      () => ({ ...transfer, destinationAccountId: owner.checking.id }),
    ],
    ['transferência sem destino', () => ({ ...transfer, destinationAccountId: null })],
    ['transferência com cartão', () => ({ ...transfer, creditCardId: randomUUIDv7() })],
    ['pagamento de fatura sem mês', () => ({ ...invoicePayment, invoiceMonth: null })],
    ['pagamento de fatura sem cartão', () => ({ ...invoicePayment, creditCardId: null })],
    ['pagamento de fatura pendente', () => ({ ...invoicePayment, status: 'pending' as const })],
  ])('rejeita %s', async (_case, values) => {
    await expect(insert(values())).rejects.toMatchObject(shapeViolation);
  });

  it('rejeita transferência com categoria', async () => {
    await expect(insert({ ...transfer, categoryId: owner.food.id })).rejects.toMatchObject(
      shapeViolation,
    );
  });

  it.each([
    ['valor zero', { amount: 0 }, 'transactions_amount_range'],
    ['valor negativo', { amount: -100 }, 'transactions_amount_range'],
    ['valor acima de R$ 1 bilhão', { amount: 100_000_000_001 }, 'transactions_amount_range'],
    ['descrição vazia', { description: '' }, 'transactions_description_length'],
    [
      'descrição com 81 caracteres',
      { description: 'a'.repeat(81) },
      'transactions_description_length',
    ],
    ['observação vazia', { notes: '' }, 'transactions_notes_length'],
    ['observação com 501 caracteres', { notes: 'a'.repeat(501) }, 'transactions_notes_length'],
    [
      'status desconhecido',
      { status: 'canceled' as NewTransaction['status'] },
      'transactions_status_valid',
    ],
  ])('rejeita %s', async (_case, overrides, constraint) => {
    await expect(insert({ ...expense, ...overrides })).rejects.toMatchObject(
      violation('23514', constraint),
    );
  });

  it('rejeita mês de fatura fora do formato yyyy-MM', async () => {
    await expect(insert({ ...invoicePayment, invoiceMonth: '2026-13' })).rejects.toMatchObject(
      violation('23514', 'transactions_invoice_month_format'),
    );
  });

  it('rejeita um segundo pagamento da mesma fatura (cartão e mês)', async () => {
    const creditCardId = randomUUIDv7();
    await insert({ ...invoicePayment, creditCardId });

    await expect(insert({ ...invoicePayment, creditCardId })).rejects.toMatchObject(
      violation('23505', 'transactions_invoice_payment_unique'),
    );
    // Outro mês do mesmo cartão é outra fatura.
    await expect(
      insert({ ...invoicePayment, creditCardId, invoiceMonth: '2026-11' }),
    ).resolves.toHaveLength(1);
  });

  it('permite várias compras no mesmo cartão e mês (só o pagamento é único)', async () => {
    const creditCardId = randomUUIDv7();

    await insert({ ...cardPurchase, creditCardId });
    await expect(insert({ ...cardPurchase, creditCardId })).resolves.toHaveLength(1);
  });

  describe('referências a dados de outro usuário', () => {
    let other: Owner;

    beforeAll(async () => {
      other = await createOwner();
    });

    it.each([
      ['conta', () => ({ ...expense, accountId: other.checking.id }), 'transactions_account_fk'],
      [
        'conta de destino',
        () => ({ ...transfer, destinationAccountId: other.savings.id }),
        'transactions_destination_account_fk',
      ],
      ['categoria', () => ({ ...expense, categoryId: other.food.id }), 'transactions_category_fk'],
    ])('rejeita %s de outro usuário', async (_case, values, constraint) => {
      await expect(insert(values())).rejects.toMatchObject(violation('23503', constraint));
    });

    it('rejeita categoria de outro tipo (receita em despesa)', async () => {
      await expect(insert({ ...expense, categoryId: owner.salary.id })).rejects.toMatchObject(
        violation('23503', 'transactions_category_fk'),
      );
    });

    it('rejeita conta inexistente', async () => {
      await expect(insert({ ...expense, accountId: randomUUIDv7() })).rejects.toMatchObject(
        violation('23503', 'transactions_account_fk'),
      );
    });
  });

  it('apaga transações, contas e categorias junto com o usuário', async () => {
    const doomed = await createOwner();
    await insert({
      ...expense,
      userId: doomed.user.id,
      accountId: doomed.checking.id,
      categoryId: doomed.food.id,
    });
    await insert({
      ...transfer,
      userId: doomed.user.id,
      accountId: doomed.checking.id,
      destinationAccountId: doomed.savings.id,
    });

    await db.delete(users).where(eq(users.id, doomed.user.id));

    for (const table of [transactions, accounts, categories]) {
      expect(await db.select().from(table).where(eq(table.userId, doomed.user.id))).toEqual([]);
    }
  });

  it('impede apagar uma conta que tem transações', async () => {
    const [created] = await insert(expense);

    await expect(
      db.delete(accounts).where(eq(accounts.id, owner.checking.id)),
    ).rejects.toMatchObject(violation('23503', 'transactions_account_fk'));
    expect(created).toBeDefined();
  });
});
