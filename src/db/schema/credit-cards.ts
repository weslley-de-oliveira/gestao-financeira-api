import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  check,
  foreignKey,
  index,
  pgTable,
  smallint,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  CARD_BRANDS,
  CREDIT_CARD_NAME_MAX_LENGTH,
  MAX_CARD_DAY,
  MIN_CARD_DAY,
} from '../../modules/credit-cards/credit-cards.constants.ts';
import { APPEARANCE_COLORS } from '../../shared/models/appearance.ts';
import { MAX_MONEY_CENTS } from '../../shared/utils/money.ts';
import { accounts } from './accounts.ts';
import { oneOf, primaryId, timestamps } from './columns.ts';
import { users } from './users.ts';

/**
 * Cartões de crédito. Por segurança, guarda só os quatro últimos dígitos: nunca o número completo,
 * CVV, validade ou senha. Faturas não são tabela: são calculadas a partir das compras e dos
 * pagamentos (transações). Cartões não são excluídos, só arquivados.
 */
export const creditCards = pgTable(
  'credit_cards',
  {
    id: primaryId(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    brand: text({ enum: CARD_BRANDS }).notNull(),
    lastFourDigits: char({ length: 4 }).notNull(),
    /** Centavos, maior que zero. */
    creditLimit: bigint({ mode: 'number' }).notNull(),
    closingDay: smallint().notNull(),
    dueDay: smallint().notNull(),
    /** Conta que paga as faturas; sempre do mesmo usuário (chave composta). */
    paymentAccountId: uuid().notNull(),
    color: text().notNull(),
    isArchived: boolean().notNull().default(false),
    ...timestamps(),
  },
  // As mesmas regras são validadas na API; aqui protegem contra gravações fora dela.
  (table) => [
    index('credit_cards_user_id_idx').on(table.userId),
    // Alvo das chaves estrangeiras compostas (cartão + dono) de outras tabelas, como transações.
    unique('credit_cards_id_user_id_unique').on(table.id, table.userId),
    foreignKey({
      name: 'credit_cards_payment_account_fk',
      columns: [table.paymentAccountId, table.userId],
      foreignColumns: [accounts.id, accounts.userId],
    }),
    check(
      'credit_cards_name_length',
      sql`char_length(${table.name}) between 1 and ${sql.raw(String(CREDIT_CARD_NAME_MAX_LENGTH))}`,
    ),
    check('credit_cards_brand_valid', oneOf(table.brand, CARD_BRANDS)),
    check('credit_cards_last_four_digits', sql`${table.lastFourDigits} ~ '^[0-9]{4}$'`),
    check(
      'credit_cards_credit_limit_range',
      sql`${table.creditLimit} > 0 and ${table.creditLimit} <= ${sql.raw(String(MAX_MONEY_CENTS))}`,
    ),
    check(
      'credit_cards_days_range',
      sql`${table.closingDay} between ${sql.raw(String(MIN_CARD_DAY))} and ${sql.raw(String(MAX_CARD_DAY))}
        and ${table.dueDay} between ${sql.raw(String(MIN_CARD_DAY))} and ${sql.raw(String(MAX_CARD_DAY))}`,
    ),
    check('credit_cards_days_differ', sql`${table.closingDay} <> ${table.dueDay}`),
    check('credit_cards_color_valid', oneOf(table.color, APPEARANCE_COLORS)),
  ],
);

export type CreditCard = typeof creditCards.$inferSelect;
export type NewCreditCard = typeof creditCards.$inferInsert;
