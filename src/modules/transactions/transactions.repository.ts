import { and, asc, desc, eq, gte, lte, or, sql, type SQL } from 'drizzle-orm';
import type { Database } from '../../db/client.ts';
import { transactions, type NewTransaction, type Transaction } from '../../db/schema/index.ts';
import { toPage, type Page } from '../../shared/http/pagination.ts';
import { normalizeForSearch } from '../../shared/utils/text.ts';
import type { TransactionSort } from './transactions.constants.ts';
import type { ListTransactionsQuery } from './transactions.schemas.ts';
import { atVersion } from '../../shared/http/etag.ts';

/** Campos que a edição regrava: nunca o dono, o id ou as datas de criação. */
export type TransactionChanges = Omit<NewTransaction, 'id' | 'userId' | 'createdAt' | 'updatedAt'>;

export interface TransactionsRepository {
  /**
   * Uma página das transações do usuário que passam em todos os filtros, na ordenação pedida
   * (padrão: data, da mais recente para a mais antiga; no mesmo dia, a registrada por último).
   */
  listTransactions(userId: string, query: ListTransactionsQuery): Promise<Page<Transaction>>;
  /** Transação pelo id, só se for do usuário: a de outro usuário é tratada como inexistente. */
  findTransaction(userId: string, transactionId: string): Promise<Transaction | null>;
  insertTransaction(transaction: NewTransaction): Promise<Transaction>;
  /**
   * Regrava a transação só se for do usuário (e, com `version`, só se ainda estiver nessa versão);
   * devolve `null` se não encontrar.
   */
  updateTransaction(
    userId: string,
    transactionId: string,
    changes: TransactionChanges,
    version?: Date,
  ): Promise<Transaction | null>;
  /** Apaga a transação só se for do usuário; devolve se apagou. */
  deleteTransaction(userId: string, transactionId: string): Promise<boolean>;
  /** Se a fatura (cartão e mês de referência) do usuário já tem pagamento. */
  hasInvoicePayment(userId: string, creditCardId: string, invoiceMonth: string): Promise<boolean>;
}

export function createTransactionsRepository(db: Database): TransactionsRepository {
  const ownedBy = (userId: string, transactionId: string) =>
    and(eq(transactions.id, transactionId), eq(transactions.userId, userId));

  return {
    async listTransactions(userId, query) {
      const { cursor, limit, sort } = query;
      const order = SORT_ORDERS[sort];
      const rows = await db
        .select()
        .from(transactions)
        .where(
          and(
            eq(transactions.userId, userId),
            ...filterConditions(query),
            // Continua logo depois do último item da página anterior.
            cursor ? afterPosition(order, cursor.value, cursor.id) : undefined,
          ),
        )
        .orderBy(
          order.direction === 'desc' ? desc(order.column) : asc(order.column),
          // O id é UUID v7 (ordenado pelo momento do cadastro): desempata pela ordem de registro.
          order.tieBreak === 'desc' ? desc(transactions.id) : asc(transactions.id),
        )
        // Uma linha a mais só para saber se há próxima página.
        .limit(limit + 1);
      return toPage(rows, limit, (row) => ({
        sort,
        value: order.column === transactions.date ? row.date : row.amount,
        id: row.id,
      }));
    },

    async findTransaction(userId, transactionId) {
      const [transaction] = await db
        .select()
        .from(transactions)
        .where(ownedBy(userId, transactionId));
      return transaction ?? null;
    },

    async insertTransaction(transaction) {
      const [created] = await db.insert(transactions).values(transaction).returning();
      if (!created) throw new Error('A transação não foi inserida.');
      return created;
    },

    async updateTransaction(userId, transactionId, changes, version) {
      const [updated] = await db
        .update(transactions)
        .set(changes)
        .where(
          and(
            ownedBy(userId, transactionId),
            version && atVersion(transactions.updatedAt, version),
          ),
        )
        .returning();
      return updated ?? null;
    },

    async deleteTransaction(userId, transactionId) {
      const deleted = await db
        .delete(transactions)
        .where(ownedBy(userId, transactionId))
        .returning({ id: transactions.id });
      return deleted.length > 0;
    },

    async hasInvoicePayment(userId, creditCardId, invoiceMonth) {
      const [payment] = await db
        .select({ id: transactions.id })
        .from(transactions)
        .where(
          and(
            eq(transactions.userId, userId),
            eq(transactions.creditCardId, creditCardId),
            eq(transactions.type, 'invoice-payment'),
            eq(transactions.invoiceMonth, invoiceMonth),
          ),
        )
        .limit(1);
      return payment !== undefined;
    },
  };
}

interface SortOrder {
  column: typeof transactions.date | typeof transactions.amount;
  /** Tipo do valor do cursor no banco. */
  cast: 'date' | 'bigint';
  direction: 'asc' | 'desc';
  tieBreak: 'asc' | 'desc';
}

/** Cada ordenação da listagem, com o mesmo desempate do front (`transaction-query.ts`). */
const SORT_ORDERS: Record<TransactionSort, SortOrder> = {
  'date-desc': { column: transactions.date, cast: 'date', direction: 'desc', tieBreak: 'desc' },
  'date-asc': { column: transactions.date, cast: 'date', direction: 'asc', tieBreak: 'asc' },
  'amount-desc': {
    column: transactions.amount,
    cast: 'bigint',
    direction: 'desc',
    tieBreak: 'desc',
  },
  'amount-asc': { column: transactions.amount, cast: 'bigint', direction: 'asc', tieBreak: 'desc' },
};

/**
 * Itens depois da posição `(valor, id)` na ordenação. A chave e o desempate podem ter sentidos
 * diferentes (`amount-asc`), então não dá para comparar a tupla inteira de uma vez.
 */
function afterPosition(order: SortOrder, value: string | number, id: string): SQL {
  const keyOp = sql.raw(order.direction === 'desc' ? '<' : '>');
  const idOp = sql.raw(order.tieBreak === 'desc' ? '<' : '>');
  const cast = sql.raw(order.cast);
  return sql`(${order.column} ${keyOp} ${value}::${cast} or (${order.column} = ${value}::${cast} and ${transactions.id} ${idOp} ${id}::uuid))`;
}

/** Condições SQL dos filtros enviados; os ausentes não restringem nada. */
function filterConditions({
  from,
  to,
  type,
  status,
  accountId,
  creditCardId,
  categoryId,
  q,
}: ListTransactionsQuery): (SQL | undefined)[] {
  return [
    from ? gte(transactions.date, from) : undefined,
    to ? lte(transactions.date, to) : undefined,
    type ? eq(transactions.type, type) : undefined,
    status ? eq(transactions.status, status) : undefined,
    accountId
      ? or(eq(transactions.accountId, accountId), eq(transactions.destinationAccountId, accountId))
      : undefined,
    creditCardId ? eq(transactions.creditCardId, creditCardId) : undefined,
    categoryId ? eq(transactions.categoryId, categoryId) : undefined,
    q ? searchCondition(q) : undefined,
  ];
}

/**
 * Busca na descrição e nas observações sem diferenciar maiúsculas e acentos (`unaccent` no banco,
 * `normalizeForSearch` no termo). `%` e `_` digitados são procurados literalmente.
 */
function searchCondition(search: string): SQL | undefined {
  const pattern = `%${normalizeForSearch(search).replace(/[\\%_]/g, '\\$&')}%`;
  return or(
    sql`lower(unaccent(${transactions.description})) like ${pattern}`,
    sql`lower(unaccent(coalesce(${transactions.notes}, ''))) like ${pattern}`,
  );
}
