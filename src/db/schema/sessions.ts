import { sql } from 'drizzle-orm';
import { char, check, index, inet, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { primaryId } from './columns.ts';
import { users } from './users.ts';

/**
 * Sessões de login. O token fica só no cookie do navegador; aqui guardamos o SHA-256 dele (em hex),
 * então um vazamento do banco não permite entrar como ninguém. A sessão vale até `expires_at`
 * (renovado com o uso) e é apagada no logout.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: primaryId(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: char({ length: 64 }).notNull().unique('sessions_token_hash_unique'),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    lastSeenAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    userAgent: text(),
    ip: inet(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Revogar todas as sessões de um usuário (exclusão de conta) sem varrer a tabela.
    index('sessions_user_id_idx').on(table.userId),
    check('sessions_token_hash_hex', sql`${table.tokenHash} ~ '^[0-9a-f]{64}$'`),
  ],
);

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
