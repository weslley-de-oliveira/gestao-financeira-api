import { and, asc, desc, eq, gte, inArray, lte, or, sql, type SQL } from 'drizzle-orm';
import type { Database } from '../../db/client.ts';
import { transactions, type NewTransaction, type Transaction } from '../../db/schema/index.ts';
import { toPage, type Page } from '../../shared/http/pagination.ts';
import { normalizeForSearch } from '../../shared/utils/text.ts';
import type { TransactionSort } from './transactions.constants.ts';
import type {
  ListTransactionsQuery,
  TransactionFilters,
  TransactionSummary,
} from './transactions.schemas.ts';
import { atVersion } from '../../shared/http/etag.ts';

/** Campos que a edição regrava: nunca o dono, o id ou as datas de criação. */
export type TransactionChanges = Omit<NewTransaction, 'id' | 'userId' | 'createdAt' | 'updatedAt'>;

export interface TransactionsRepository {
  /**
   * Uma página das transações do usuário que passam em todos os filtros, na ordenação pedida
   * (padrão: data, da mais recente para a mais antiga; no mesmo dia, a registrada por último).
   */
  listTransactions(userId: string, query: ListTransactionsQuery): Promise<Page<Transaction>>;
  /**
   * Totais de todas as transações do usuário que passam nos filtros: receitas e despesas só
   * realizadas (transferências e pagamentos de fatura ficam fora; estornos reduzem as despesas) e
   * a quantidade de pendentes.
   */
  summarizeTransactions(userId: string, filters: TransactionFilters): Promise<TransactionSummary>;
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
  /** Grava várias transações numa instrução só: entram todas ou nenhuma. */
  insertTransactions(rows: NewTransaction[]): Promise<Transaction[]>;
  /** Parcelas de uma compra parcelada do usuário, da 1ª à última; vazio se não existir. */
  listInstallments(userId: string, groupId: string): Promise<Transaction[]>;
  /** Altera os mesmos campos em todas as parcelas da compra; devolve as parcelas alteradas. */
  updateInstallments(
    userId: string,
    groupId: string,
    changes: Partial<Pick<NewTransaction, 'description' | 'categoryId' | 'notes'>>,
  ): Promise<Transaction[]>;
  /** Apaga todas as parcelas da compra; devolve quantas apagou. */
  deleteInstallments(userId: string, groupId: string): Promise<number>;
  /** O primeiro destes meses de referência do cartão cuja fatura já tem pagamento, ou `null`. */
  firstPaidInvoiceMonth(
    userId: string,
    creditCardId: string,
    invoiceMonths: readonly string[],
  ): Promise<string | null>;
  /** Estornos de uma despesa do usuário, dos mais antigos aos mais recentes. */
  listRefunds(userId: string, transactionId: string): Promise<Transaction[]>;
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

    async summarizeTransactions(userId, filters) {
      const completedSum = (type: 'income' | 'expense' | 'refund') =>
        sql<number>`coalesce(sum(${transactions.amount}) filter (where ${transactions.status} = 'completed' and ${transactions.type} = ${type}), 0)`.mapWith(
          Number,
        );
      const [totals] = await db
        .select({
          count: sql<number>`count(*)`.mapWith(Number),
          income: completedSum('income'),
          expense: completedSum('expense'),
          refunds: completedSum('refund'),
          pendingCount:
            sql<number>`count(*) filter (where ${transactions.status} = 'pending')`.mapWith(Number),
        })
        .from(transactions)
        .where(and(eq(transactions.userId, userId), ...filterConditions(filters)));
      const { count = 0, income = 0, refunds = 0, pendingCount = 0 } = totals ?? {};
      // Estornos são despesa negativa (`summarizeTransactions`).
      const expense = (totals?.expense ?? 0) - refunds;
      return { count, income, expense, net: income - expense, pendingCount };
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

    async insertTransactions(rows) {
      return rows.length === 0 ? [] : db.insert(transactions).values(rows).returning();
    },

    async listInstallments(userId, groupId) {
      return db
        .select()
        .from(transactions)
        .where(and(eq(transactions.userId, userId), eq(transactions.installmentGroupId, groupId)))
        .orderBy(asc(transactions.installmentNumber));
    },

    async updateInstallments(userId, groupId, changes) {
      const updated = await db
        .update(transactions)
        .set(changes)
        .where(and(eq(transactions.userId, userId), eq(transactions.installmentGroupId, groupId)))
        .returning();
      return updated.toSorted((a, b) => (a.installmentNumber ?? 0) - (b.installmentNumber ?? 0));
    },

    async deleteInstallments(userId, groupId) {
      const deleted = await db
        .delete(transactions)
        .where(and(eq(transactions.userId, userId), eq(transactions.installmentGroupId, groupId)))
        .returning({ id: transactions.id });
      return deleted.length;
    },

    async firstPaidInvoiceMonth(userId, creditCardId, invoiceMonths) {
      if (invoiceMonths.length === 0) {
        return null;
      }
      const [payment] = await db
        .select({ invoiceMonth: transactions.invoiceMonth })
        .from(transactions)
        .where(
          and(
            eq(transactions.userId, userId),
            eq(transactions.creditCardId, creditCardId),
            eq(transactions.type, 'invoice-payment'),
            inArray(transactions.invoiceMonth, [...invoiceMonths]),
          ),
        )
        .orderBy(asc(transactions.invoiceMonth))
        .limit(1);
      return payment?.invoiceMonth ?? null;
    },

    async listRefunds(userId, transactionId) {
      return db
        .select()
        .from(transactions)
        .where(
          and(
            eq(transactions.userId, userId),
            eq(transactions.refundedTransactionId, transactionId),
          ),
        )
        .orderBy(asc(transactions.date), asc(transactions.id));
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
}: TransactionFilters): (SQL | undefined)[] {
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
