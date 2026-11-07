import { randomUUID, randomUUIDv7 } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { insertCreditCard } from '../../../test/helpers/fixtures.ts';
import { categoryNameKey } from '../../modules/categories/category-name.ts';
import { createDatabase } from '../client.ts';
import {
  accounts,
  categories,
  transactions,
  users,
  type Account,
  type Category,
  type CreditCard,
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
  card: CreditCard;
}

/** Usuário com duas contas, uma categoria de despesa, uma de receita e um cartão. */
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
  const card = await newCard({ userId: user.id, checking: checking! });
  return { user, checking: checking!, savings: savings!, food: food!, salary: salary!, card };
}

/** Outro cartão do dono, pago pela conta corrente. */
function newCard(owner: { userId: string; checking: Account }): Promise<CreditCard> {
  return insertCreditCard(db, { userId: owner.userId, paymentAccountId: owner.checking.id });
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
      creditCardId: owner.card.id,
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
      creditCardId: owner.card.id,
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

  describe('estornos', () => {
    const refundOf = async (original: NewTransaction, overrides: Partial<NewTransaction> = {}) => {
      const [expenseRow] = await insert(original);
      return {
        userId: original.userId,
        description: 'Estorno',
        amount: 1_000,
        type: 'refund' as const,
        date: '2026-11-08',
        accountId: original.accountId ?? null,
        creditCardId: original.creditCardId ?? null,
        categoryId: null,
        refundedTransactionId: expenseRow!.id,
        ...overrides,
      };
    };

    it('aceita o estorno de uma despesa em conta e de uma compra no cartão', async () => {
      await expect(insert(await refundOf(expense))).resolves.toHaveLength(1);
      await expect(insert(await refundOf(cardPurchase))).resolves.toHaveLength(1);
    });

    it.each([
      [
        'estorno sem despesa',
        (refund: NewTransaction) => ({ ...refund, refundedTransactionId: null }),
        'transactions_refund_link',
      ],
      [
        'despesa apontando para outra',
        (refund: NewTransaction) => ({
          ...expense,
          refundedTransactionId: refund.refundedTransactionId,
        }),
        'transactions_refund_link',
      ],
      [
        'estorno com categoria',
        (refund: NewTransaction) => ({ ...refund, categoryId: owner.food.id }),
        'transactions_shape',
      ],
      [
        'estorno sem conta nem cartão',
        (refund: NewTransaction) => ({ ...refund, accountId: null }),
        'transactions_shape',
      ],
      [
        'estorno pendente',
        (refund: NewTransaction) => ({ ...refund, status: 'pending' as const }),
        'transactions_shape',
      ],
    ])('rejeita %s', async (_case, change, constraint) => {
      const refund = await refundOf(expense);

      await expect(insert(change(refund))).rejects.toMatchObject(violation('23514', constraint));
    });

    it('rejeita estorno de despesa de outro usuário', async () => {
      const other = await createOwner();
      const refund = await refundOf(expense);

      await expect(
        insert({ ...refund, userId: other.user.id, accountId: other.checking.id }),
      ).rejects.toMatchObject(violation('23503', 'transactions_refunded_transaction_fk'));
    });
  });

  describe('parcelas', () => {
    const installmentViolation = violation('23514', 'transactions_installment_shape');
    const parcel = (overrides: Partial<NewTransaction> = {}): NewTransaction => ({
      ...cardPurchase,
      installmentGroupId: randomUUIDv7(),
      installmentNumber: 1,
      installmentCount: 3,
      ...overrides,
    });

    it('aceita as parcelas de uma compra no cartão', async () => {
      const group = randomUUIDv7();
      for (const installmentNumber of [1, 2, 3]) {
        await expect(
          insert(parcel({ installmentGroupId: group, installmentNumber })),
        ).resolves.toHaveLength(1);
      }
    });

    it.each([
      [
        'grupo sem número e total',
        () => parcel({ installmentNumber: null, installmentCount: null }),
      ],
      ['número sem grupo', () => parcel({ installmentGroupId: null })],
      ['número maior que o total', () => parcel({ installmentNumber: 4 })],
      ['número zero', () => parcel({ installmentNumber: 0 })],
      ['uma parcela só', () => parcel({ installmentCount: 1 })],
      ['mais de 24 parcelas', () => parcel({ installmentCount: 25 })],
      [
        'parcela de despesa em conta',
        () => ({
          ...expense,
          ...parcel(),
          ...{ creditCardId: null, accountId: owner.checking.id },
        }),
      ],
    ])('rejeita %s', async (_case, values) => {
      await expect(insert(values())).rejects.toMatchObject(installmentViolation);
    });

    it('rejeita o mesmo número de parcela duas vezes na compra', async () => {
      const group = randomUUIDv7();
      await insert(parcel({ installmentGroupId: group }));

      await expect(insert(parcel({ installmentGroupId: group }))).rejects.toMatchObject(
        violation('23505', 'transactions_installment_unique'),
      );
    });
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
    const creditCardId = (await newCard({ userId: owner.user.id, checking: owner.checking })).id;
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
    await insert(cardPurchase);
    await expect(insert(cardPurchase)).resolves.toHaveLength(1);
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
      [
        'cartão',
        () => ({ ...cardPurchase, creditCardId: other.card.id }),
        'transactions_credit_card_fk',
      ],
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

    it('rejeita cartão inexistente', async () => {
      await expect(insert({ ...cardPurchase, creditCardId: randomUUIDv7() })).rejects.toMatchObject(
        violation('23503', 'transactions_credit_card_fk'),
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
