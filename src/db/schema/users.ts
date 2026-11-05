import { sql } from 'drizzle-orm';
import { check, pgTable, text } from 'drizzle-orm/pg-core';
import { citext, primaryId, timestamps } from './columns.ts';

/** Usuários. O e-mail é único sem diferenciar maiúsculas; a senha fica só como hash Argon2id. */
export const users = pgTable(
  'users',
  {
    id: primaryId(),
    email: citext().notNull().unique(),
    name: text().notNull(),
    passwordHash: text().notNull(),
    ...timestamps(),
  },
  // Os limites também são validados na API; aqui protegem contra gravações fora dela.
  (table) => [
    check('users_email_length', sql`char_length(${table.email}) between 3 and 254`),
    check('users_name_length', sql`char_length(${table.name}) between 1 and 80`),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
