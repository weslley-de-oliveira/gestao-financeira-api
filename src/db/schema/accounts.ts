import { sql } from 'drizzle-orm';
import { bigint, boolean, check, index, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import {
  ACCOUNT_ICONS,
  ACCOUNT_INSTITUTION_MAX_LENGTH,
  ACCOUNT_NAME_MAX_LENGTH,
  ACCOUNT_TYPES,
} from '../../modules/accounts/accounts.constants.ts';
import { APPEARANCE_COLORS } from '../../shared/models/appearance.ts';
import { MAX_MONEY_CENTS } from '../../shared/utils/money.ts';
import { oneOf, primaryId, timestamps } from './columns.ts';
import { users } from './users.ts';

/**
 * Contas do usuário (corrente, poupança, dinheiro...). O saldo atual não é guardado: é calculado a
 * partir do saldo inicial e das transações. Contas não são excluídas, só arquivadas.
 */
export const accounts = pgTable(
  'accounts',
  {
    id: primaryId(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    type: text({ enum: ACCOUNT_TYPES }).notNull(),
    institution: text(),
    /** Centavos; pode ser negativo (conta que começa no cheque especial). */
    initialBalance: bigint({ mode: 'number' }).notNull().default(0),
    color: text().notNull(),
    icon: text().notNull(),
    isArchived: boolean().notNull().default(false),
    ...timestamps(),
  },
  // As mesmas regras são validadas na API; aqui protegem contra gravações fora dela.
  (table) => [
    // Toda consulta filtra pelo dono da conta.
    index('accounts_user_id_idx').on(table.userId),
    // Alvo das chaves estrangeiras compostas (conta + dono) de outras tabelas, como transações.
    unique('accounts_id_user_id_unique').on(table.id, table.userId),
    check(
      'accounts_name_length',
      sql`char_length(${table.name}) between 1 and ${sql.raw(String(ACCOUNT_NAME_MAX_LENGTH))}`,
    ),
    check(
      'accounts_institution_length',
      sql`char_length(${table.institution}) between 1 and ${sql.raw(String(ACCOUNT_INSTITUTION_MAX_LENGTH))}`,
    ),
    check('accounts_type_valid', oneOf(table.type, ACCOUNT_TYPES)),
    check('accounts_color_valid', oneOf(table.color, APPEARANCE_COLORS)),
    check('accounts_icon_valid', oneOf(table.icon, ACCOUNT_ICONS)),
    check(
      'accounts_initial_balance_range',
      sql`abs(${table.initialBalance}) <= ${sql.raw(String(MAX_MONEY_CENTS))}`,
    ),
  ],
);

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
