import { asc, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

/**
 * Ordem alfabética como a do front (`localeCompare` em pt-BR): sem separar maiúsculas e com
 * acentos junto da letra ("Álvaro" antes de "banco"). A collation padrão da imagem do Postgres
 * ordenaria pelos bytes.
 */
export function alphabetical(column: AnyPgColumn): SQL {
  return asc(sql`${column} collate "und-x-icu"`);
}
