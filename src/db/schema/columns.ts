import { randomUUIDv7 } from 'node:crypto';
import { customType, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Chave primária UUID v7, gerada pela API (ordenável por tempo: bom para índice e paginação por
 * cursor). O Postgres 17 não gera v7; o Node 26 sim.
 */
export const primaryId = () =>
  uuid()
    .primaryKey()
    .$defaultFn(() => randomUUIDv7());

/** Texto que compara sem diferenciar maiúsculas (extensão `citext`), usado no e-mail. */
export const citext = customType<{ data: string }>({
  dataType: () => 'citext',
});

/** `created_at` e `updated_at` (timestamptz); o `updated_at` muda a cada update feito pelo Drizzle. */
export const timestamps = () => ({
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
