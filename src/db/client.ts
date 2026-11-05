import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index.ts';

export type Database = NodePgDatabase<typeof schema>;

export interface DatabaseConnection {
  db: Database;
  pool: pg.Pool;
}

/**
 * Pool de conexões e cliente Drizzle. As colunas usam `snake_case` no banco e `camelCase` no
 * código. O pool só abre conexões na primeira consulta.
 */
export function createDatabase(url: string, maxConnections: number): DatabaseConnection {
  const pool = new pg.Pool({ connectionString: url, max: maxConnections });
  const db = drizzle(pool, { schema, casing: 'snake_case' });
  return { db, pool };
}
