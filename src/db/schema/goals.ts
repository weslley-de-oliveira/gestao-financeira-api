import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  CONTRIBUTION_NOTE_MAX_LENGTH,
  CONTRIBUTION_TYPES,
  GOAL_DESCRIPTION_MAX_LENGTH,
  GOAL_ICONS,
  GOAL_NAME_MAX_LENGTH,
} from '../../modules/goals/goals.constants.ts';
import { APPEARANCE_COLORS } from '../../shared/models/appearance.ts';
import { MAX_MONEY_CENTS } from '../../shared/utils/money.ts';
import { oneOf, primaryId, timestamps } from './columns.ts';
import { users } from './users.ts';

const maxMoney = sql.raw(String(MAX_MONEY_CENTS));

/**
 * Metas de economia. O acumulado não é guardado: é o valor inicial mais os aportes menos as
 * retiradas (`goal_contributions`), e o progresso, o status e o ritmo são calculados.
 */
export const goals = pgTable(
  'goals',
  {
    id: primaryId(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    description: text(),
    /** Centavos, maior que zero. */
    targetAmount: bigint({ mode: 'number' }).notNull(),
    /** Valor já guardado quando a meta foi criada, em centavos. */
    initialAmount: bigint({ mode: 'number' }).notNull().default(0),
    /** Data-limite (`yyyy-MM-dd`), opcional. */
    deadline: date({ mode: 'string' }),
    color: text().notNull(),
    icon: text().notNull(),
    /** Pausada pela pessoa: não fica atrasada enquanto pausada. */
    isPaused: boolean().notNull().default(false),
    isArchived: boolean().notNull().default(false),
    ...timestamps(),
  },
  // As mesmas regras são validadas na API; aqui protegem contra gravações fora dela.
  (table) => [
    index('goals_user_id_idx').on(table.userId),
    check(
      'goals_name_length',
      sql`char_length(${table.name}) between 1 and ${sql.raw(String(GOAL_NAME_MAX_LENGTH))}`,
    ),
    check(
      'goals_description_length',
      sql`char_length(${table.description}) between 1 and ${sql.raw(String(GOAL_DESCRIPTION_MAX_LENGTH))}`,
    ),
    check(
      'goals_target_amount_range',
      sql`${table.targetAmount} > 0 and ${table.targetAmount} <= ${maxMoney}`,
    ),
    check(
      'goals_initial_amount_range',
      sql`${table.initialAmount} >= 0 and ${table.initialAmount} <= ${maxMoney}`,
    ),
    check('goals_color_valid', oneOf(table.color, APPEARANCE_COLORS)),
    check('goals_icon_valid', oneOf(table.icon, GOAL_ICONS)),
  ],
);

/** Aportes e retiradas manuais de uma meta (não ligados a contas nem transações). */
export const goalContributions = pgTable(
  'goal_contributions',
  {
    id: primaryId(),
    goalId: uuid()
      .notNull()
      .references(() => goals.id, { onDelete: 'cascade' }),
    type: text({ enum: CONTRIBUTION_TYPES }).notNull(),
    /** Centavos, sempre positivo: o tipo define se soma ou subtrai. */
    amount: bigint({ mode: 'number' }).notNull(),
    date: date({ mode: 'string' }).notNull(),
    note: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('goal_contributions_goal_id_idx').on(table.goalId),
    check('goal_contributions_type_valid', oneOf(table.type, CONTRIBUTION_TYPES)),
    check(
      'goal_contributions_amount_range',
      sql`${table.amount} > 0 and ${table.amount} <= ${maxMoney}`,
    ),
    check(
      'goal_contributions_note_length',
      sql`char_length(${table.note}) between 1 and ${sql.raw(String(CONTRIBUTION_NOTE_MAX_LENGTH))}`,
    ),
  ],
);

export type Goal = typeof goals.$inferSelect;
export type NewGoal = typeof goals.$inferInsert;
export type GoalContribution = typeof goalContributions.$inferSelect;
export type NewGoalContribution = typeof goalContributions.$inferInsert;
