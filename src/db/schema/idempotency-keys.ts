import { sql } from 'drizzle-orm';
import {
  char,
  check,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './users.ts';

/**
 * Respostas guardadas pelo cabeçalho `Idempotency-Key` (ex.: pagamento de fatura): repetir a mesma
 * requisição com a mesma chave devolve a resposta gravada, sem executar a operação de novo. A
 * chave é de cada pessoa; `status_code` nulo = operação em andamento. Valem por 24 horas.
 */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    key: text().notNull(),
    /** SHA-256 (hex) do método e da URL: a mesma chave não vale para outra requisição. */
    requestHash: char({ length: 64 }).notNull(),
    statusCode: integer(),
    responseBody: jsonb(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.key] }),
    check('idempotency_keys_key_length', sql`char_length(${table.key}) between 1 and 255`),
    check('idempotency_keys_request_hash_hex', sql`${table.requestHash} ~ '^[0-9a-f]{64}$'`),
  ],
);

export type IdempotencyKey = typeof idempotencyKeys.$inferSelect;
