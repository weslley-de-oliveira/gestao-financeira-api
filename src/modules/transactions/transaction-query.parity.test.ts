import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../../../test/helpers/app.ts';
import { insertCreditCard } from '../../../test/helpers/fixtures.ts';
import { createAccount, signUp, type TestUser } from '../../../test/helpers/users.ts';
import type { CategoryDto } from '../categories/categories.schemas.ts';
import { TRANSACTION_SORTS, type TransactionSort } from './transactions.constants.ts';
import type { TransactionDto, TransactionSummary } from './transactions.schemas.ts';

/**
 * Referência do front (`transaction-query.ts` e `summarizeTransactions`), copiada para comparar
 * com a ordenação e o resumo feitos em SQL. O front desempata por `createdAt`; a API, pelo id
 * UUID v7, que segue a mesma ordem de cadastro.
 */
function compareLikeFront(a: TransactionDto, b: TransactionDto, sort: TransactionSort): number {
  const byCreation = b.id.localeCompare(a.id);
  switch (sort) {
    case 'date-desc':
      return b.date.localeCompare(a.date) || byCreation;
    case 'date-asc':
      return a.date.localeCompare(b.date) || -byCreation;
    case 'amount-desc':
      return b.amount - a.amount || byCreation;
    case 'amount-asc':
      return a.amount - b.amount || byCreation;
  }
}

function summarizeLikeFront(transactions: readonly TransactionDto[]): TransactionSummary {
  let income = 0;
  let expense = 0;
  let pendingCount = 0;
  for (const transaction of transactions) {
    if (transaction.status === 'pending') {
      pendingCount++;
    } else if (transaction.type === 'income') {
      income += transaction.amount;
    } else if (transaction.type === 'expense') {
      expense += transaction.amount;
    }
  }
  return { count: transactions.length, income, expense, net: income - expense, pendingCount };
}

describe('paridade da consulta de transações com o front', () => {
  let app: FastifyInstance;
  let user: TestUser;
  let checkingId: string;
  let cardId: string;
  let all: TransactionDto[];

  beforeAll(async () => {
    app = await createTestApp();
    user = await signUp(app);
    const checking = await createAccount(user, { name: 'Corrente' });
    const savings = await createAccount(user, { name: 'Poupança' });
    checkingId = checking.id;
    cardId = (
      await insertCreditCard(app.db, { userId: user.userId, paymentAccountId: checking.id })
    ).id;
    const categories = (await user.api('GET', '/v1/categories')).json<CategoryDto[]>();
    const expenseCategory = categories.find((category) => category.type === 'expense')!;
    const incomeCategory = categories.find((category) => category.type === 'income')!;

    // Cenário reproduzível, com poucos valores e datas possíveis para forçar muitos empates.
    let seed = 20_261_106;
    const next = (max: number) => {
      seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
      return seed % max;
    };
    for (let index = 0; index < 40; index++) {
      const base = {
        description: index % 5 === 0 ? `Mercado ${index}` : `Lançamento ${index}`,
        amount: [1_000, 2_500, 2_500, 10_000][next(4)],
        date: `2026-10-${String(1 + next(4) * 7).padStart(2, '0')}`,
        status: next(4) === 0 ? 'pending' : 'completed',
      };
      const bodies = [
        { ...base, type: 'expense', accountId: checking.id, categoryId: expenseCategory.id },
        { ...base, type: 'income', accountId: checking.id, categoryId: incomeCategory.id },
        {
          ...base,
          type: 'transfer',
          accountId: checking.id,
          destinationAccountId: savings.id,
        },
        { ...base, type: 'expense', creditCardId: cardId, categoryId: expenseCategory.id },
      ];
      const response = await user.api('POST', '/v1/transactions', bodies[next(4)]);
      expect(response.statusCode).toBe(201);
    }
    all = await pages('');
  });

  afterAll(async () => {
    await app.close();
  });

  /** Todas as páginas da consulta, em sequência, como o front as percorreria. */
  async function pages(query: string, limit = 7): Promise<TransactionDto[]> {
    const items: TransactionDto[] = [];
    let cursor: string | null = null;
    do {
      const page: { items: TransactionDto[]; nextCursor: string | null } = (
        await user.api(
          'GET',
          `/v1/transactions?limit=${limit}${query}${cursor ? `&cursor=${cursor}` : ''}`,
        )
      ).json();
      items.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor);
    return items;
  }

  it.each(TRANSACTION_SORTS)('ordena e pagina em %s como o front', async (sort) => {
    const expected = all.toSorted((a, b) => compareLikeFront(a, b, sort)).map(({ id }) => id);

    expect((await pages(`&sort=${sort}`)).map(({ id }) => id)).toEqual(expected);
    expect((await pages(`&sort=${sort}`, 1)).map(({ id }) => id)).toEqual(expected);
  });

  it.each([
    ['sem filtros', () => ''],
    ['período', () => '&from=2026-10-08&to=2026-10-15'],
    ['tipo', () => '&type=expense'],
    ['pendentes', () => '&status=pending'],
    ['conta', () => `&accountId=${checkingId}`],
    ['cartão', () => `&creditCardId=${cardId}`],
    ['busca', () => '&q=mercado'],
  ])('resume com %s como o front', async (_case, query) => {
    const filtered = await pages(query());

    const response = await user.api('GET', `/v1/transactions/summary?${query().slice(1)}`);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(summarizeLikeFront(filtered));
  });
});
