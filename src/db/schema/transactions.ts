import { sql } from 'drizzle-orm';
import {
  bigint,
  char,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  TRANSACTION_DESCRIPTION_MAX_LENGTH,
  TRANSACTION_NOTES_MAX_LENGTH,
  TRANSACTION_STATUSES,
  TRANSACTION_TYPES,
  MAX_INSTALLMENTS,
  MIN_INSTALLMENTS,
} from '../../modules/transactions/transactions.constants.ts';
import { MAX_MONEY_CENTS } from '../../shared/utils/money.ts';
import { accounts } from './accounts.ts';
import { categories } from './categories.ts';
import { creditCards } from './credit-cards.ts';
import { oneOf, primaryId, timestamps } from './columns.ts';
import { users } from './users.ts';

/**
 * Receitas, despesas, transferências e pagamentos de fatura. O valor é sempre positivo: o tipo
 * define o efeito no saldo. Quais colunas cada tipo usa é garantido pela constraint
 * `transactions_shape` (abaixo), além da validação da API.
 *
 * As referências a conta e categoria incluem o `user_id` (chaves estrangeiras compostas): o banco
 * recusa uma transação que aponte para a conta ou a categoria de outro usuário. A da categoria
 * inclui também o tipo, então uma despesa só aceita categoria de despesa.
 */
export const transactions = pgTable(
  'transactions',
  {
    id: primaryId(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text({ enum: TRANSACTION_TYPES }).notNull(),
    description: text().notNull(),
    /** Centavos, sempre positivo. */
    amount: bigint({ mode: 'number' }).notNull(),
    /** Dia da transação, sem horário (`yyyy-MM-dd`). */
    date: date({ mode: 'string' }).notNull(),
    /** Conta da receita/despesa, origem da transferência ou conta que pagou a fatura. */
    accountId: uuid(),
    /** Cartão da compra ou da fatura paga. */
    creditCardId: uuid(),
    /** Mês de referência (`yyyy-MM`) da fatura paga; só em `invoice-payment`. */
    invoiceMonth: char({ length: 7 }),
    /** Só em transferências. */
    destinationAccountId: uuid(),
    /** Obrigatória em receitas e despesas; nula nos demais tipos. */
    categoryId: uuid(),
    status: text({ enum: TRANSACTION_STATUSES }).notNull().default('completed'),
    notes: text(),
    /**
     * Parcela de uma compra parcelada no cartão: o grupo (o mesmo em todas as parcelas), o número
     * da parcela e o total de parcelas. Nulos nas demais transações.
     */
    installmentGroupId: uuid(),
    installmentNumber: integer(),
    installmentCount: integer(),
    /** Despesa estornada; só em `refund`. A categoria do estorno é a dela. */
    refundedTransactionId: uuid(),
    ...timestamps(),
  },
  (table) => [
    // Alvo da chave estrangeira dos estornos (a despesa estornada é do mesmo usuário).
    unique('transactions_id_user_id_unique').on(table.id, table.userId),
    // Estornos de uma despesa.
    index('transactions_refunded_transaction_id_idx').on(table.refundedTransactionId),
    // As parcelas de uma compra, para editar e excluir a compra inteira.
    index('transactions_user_id_installment_group_id_idx').on(
      table.userId,
      table.installmentGroupId,
    ),
    // Cada número de parcela aparece uma vez por compra.
    uniqueIndex('transactions_installment_unique').on(
      table.installmentGroupId,
      table.installmentNumber,
    ),
    // Listagem por período (e o cálculo de saldo), sempre filtrados pelo dono.
    index('transactions_user_id_date_idx').on(table.userId, table.date),
    // Compras de um cartão por período (faturas).
    index('transactions_credit_card_id_date_idx').on(table.creditCardId, table.date),
    // Filtros da listagem por conta (origem ou destino) e por categoria, e a contagem de uso das
    // categorias. Também servem às chaves estrangeiras, que o Postgres não indexa sozinho.
    index('transactions_user_id_account_id_idx').on(table.userId, table.accountId),
    index('transactions_user_id_destination_account_id_idx').on(
      table.userId,
      table.destinationAccountId,
    ),
    index('transactions_user_id_category_id_idx').on(table.userId, table.categoryId),
    // Ordenação por valor, com o id como desempate (paginação por cursor).
    index('transactions_user_id_amount_id_idx').on(table.userId, table.amount, table.id),
    // Cada fatura (cartão + mês) é paga no máximo uma vez.
    uniqueIndex('transactions_invoice_payment_unique')
      .on(table.creditCardId, table.invoiceMonth)
      .where(sql`${table.type} = 'invoice-payment'`),

    foreignKey({
      name: 'transactions_account_fk',
      columns: [table.accountId, table.userId],
      foreignColumns: [accounts.id, accounts.userId],
    }),
    foreignKey({
      name: 'transactions_destination_account_fk',
      columns: [table.destinationAccountId, table.userId],
      foreignColumns: [accounts.id, accounts.userId],
    }),
    foreignKey({
      name: 'transactions_category_fk',
      columns: [table.categoryId, table.userId, table.type],
      foreignColumns: [categories.id, categories.userId, categories.type],
    }),
    foreignKey({
      name: 'transactions_refunded_transaction_fk',
      columns: [table.refundedTransactionId, table.userId],
      foreignColumns: [table.id, table.userId],
    }),
    foreignKey({
      name: 'transactions_credit_card_fk',
      columns: [table.creditCardId, table.userId],
      foreignColumns: [creditCards.id, creditCards.userId],
    }),

    check('transactions_type_valid', oneOf(table.type, TRANSACTION_TYPES)),
    check('transactions_status_valid', oneOf(table.status, TRANSACTION_STATUSES)),
    check(
      'transactions_amount_range',
      sql`${table.amount} > 0 and ${table.amount} <= ${sql.raw(String(MAX_MONEY_CENTS))}`,
    ),
    check(
      'transactions_description_length',
      sql`char_length(${table.description}) between 1 and ${sql.raw(String(TRANSACTION_DESCRIPTION_MAX_LENGTH))}`,
    ),
    check(
      'transactions_notes_length',
      sql`char_length(${table.notes}) between 1 and ${sql.raw(String(TRANSACTION_NOTES_MAX_LENGTH))}`,
    ),
    check(
      'transactions_invoice_month_format',
      sql`${table.invoiceMonth} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`,
    ),
    // Parcela: os três campos juntos, número entre 1 e o total, e só em compra no cartão.
    check(
      'transactions_installment_shape',
      sql`(
        ${table.installmentGroupId} is null
        and ${table.installmentNumber} is null
        and ${table.installmentCount} is null
      ) or (
        ${table.installmentGroupId} is not null
        and ${table.installmentNumber} is not null
        and ${table.installmentCount} is not null
        and ${table.installmentCount} between ${sql.raw(String(MIN_INSTALLMENTS))} and ${sql.raw(String(MAX_INSTALLMENTS))}
        and ${table.installmentNumber} between 1 and ${table.installmentCount}
        and ${table.type} = 'expense'
        and ${table.creditCardId} is not null
        and ${table.accountId} is null
      )`,
    ),
    // Só o estorno aponta para uma despesa, e todo estorno aponta para uma.
    check(
      'transactions_refund_link',
      sql`(${table.type} = 'refund') = (${table.refundedTransactionId} is not null)`,
    ),
    // Forma de cada tipo, como no front:
    // - receita/despesa em conta: conta e categoria, sem cartão, destino ou fatura;
    // - compra no cartão: despesa com cartão e categoria, sem conta, sempre realizada;
    // - transferência: contas de origem e destino diferentes, sem categoria nem cartão;
    // - pagamento de fatura: conta, cartão e mês, sem categoria, sempre realizado;
    // - estorno: conta ou cartão (os da despesa), sem categoria (é a da despesa), sempre realizado.
    check(
      'transactions_shape',
      sql`(
        ${table.type} in ('expense', 'income')
        and ${table.categoryId} is not null
        and ${table.destinationAccountId} is null
        and ${table.invoiceMonth} is null
        and (
          (${table.accountId} is not null and ${table.creditCardId} is null)
          or (
            ${table.type} = 'expense'
            and ${table.accountId} is null
            and ${table.creditCardId} is not null
            and ${table.status} = 'completed'
          )
        )
      ) or (
        ${table.type} = 'transfer'
        and ${table.accountId} is not null
        and ${table.destinationAccountId} is not null
        and ${table.accountId} <> ${table.destinationAccountId}
        and ${table.categoryId} is null
        and ${table.creditCardId} is null
        and ${table.invoiceMonth} is null
      ) or (
        ${table.type} = 'invoice-payment'
        and ${table.accountId} is not null
        and ${table.creditCardId} is not null
        and ${table.invoiceMonth} is not null
        and ${table.categoryId} is null
        and ${table.destinationAccountId} is null
        and ${table.status} = 'completed'
      ) or (
        ${table.type} = 'refund'
        and ((${table.accountId} is null) <> (${table.creditCardId} is null))
        and ${table.categoryId} is null
        and ${table.destinationAccountId} is null
        and ${table.invoiceMonth} is null
        and ${table.status} = 'completed'
      )`,
    ),
  ],
);

export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
