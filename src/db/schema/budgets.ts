import { sql } from 'drizzle-orm';
import {
  bigint,
  char,
  check,
  foreignKey,
  pgTable,
  smallint,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  ALERT_THRESHOLD_OPTIONS,
  DEFAULT_ALERT_THRESHOLD,
} from '../../modules/budgets/budgets.constants.ts';
import { MAX_MONEY_CENTS } from '../../shared/utils/money.ts';
import { categories } from './categories.ts';
import { primaryId, timestamps } from './columns.ts';
import { users } from './users.ts';

/**
 * Orçamentos: limite mensal recorrente de gastos de uma categoria de despesa, no máximo um por
 * categoria. O valor do limite fica nas vigências (`budget_limits`), e o consumo do mês é
 * calculado a partir das transações (não é guardado).
 */
export const budgets = pgTable(
  'budgets',
  {
    id: primaryId(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Categoria de despesa do mesmo usuário (chave composta); não muda depois da criação. */
    categoryId: uuid().notNull(),
    /** Percentual do limite a partir do qual o orçamento fica em alerta. */
    alertThreshold: smallint().notNull().default(DEFAULT_ALERT_THRESHOLD),
    ...timestamps(),
  },
  (table) => [
    // Um orçamento por categoria; também atende às consultas por usuário.
    unique('budgets_user_category_unique').on(table.userId, table.categoryId),
    foreignKey({
      name: 'budgets_category_fk',
      columns: [table.categoryId, table.userId],
      foreignColumns: [categories.id, categories.userId],
    }),
    check(
      'budgets_alert_threshold_valid',
      sql`${table.alertThreshold} in (${sql.raw(ALERT_THRESHOLD_OPTIONS.join(', '))})`,
    ),
  ],
);

/**
 * Vigências do limite de um orçamento: o valor vale do mês (`yyyy-MM`) em diante, até a vigência
 * seguinte. Mudar o limite cria uma vigência a partir do mês atual, preservando os anteriores.
 */
export const budgetLimits = pgTable(
  'budget_limits',
  {
    id: primaryId(),
    budgetId: uuid()
      .notNull()
      .references(() => budgets.id, { onDelete: 'cascade' }),
    month: char({ length: 7 }).notNull(),
    /** Centavos, maior que zero. */
    amount: bigint({ mode: 'number' }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Uma vigência por mês; também atende à busca das vigências de um orçamento.
    unique('budget_limits_budget_month_unique').on(table.budgetId, table.month),
    check('budget_limits_month_format', sql`${table.month} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
    check(
      'budget_limits_amount_range',
      sql`${table.amount} > 0 and ${table.amount} <= ${sql.raw(String(MAX_MONEY_CENTS))}`,
    ),
  ],
);

export type Budget = typeof budgets.$inferSelect;
export type NewBudget = typeof budgets.$inferInsert;
export type BudgetLimit = typeof budgetLimits.$inferSelect;
export type NewBudgetLimit = typeof budgetLimits.$inferInsert;
