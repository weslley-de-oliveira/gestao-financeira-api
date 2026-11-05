import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase } from '../../src/db/client.ts';

const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));

/** Aplica as migrações geradas pelo drizzle-kit. Sem migrações ainda (etapa 0), não faz nada. */
export async function applyMigrations(databaseUrl: string): Promise<void> {
  if (!existsSync(`${MIGRATIONS_FOLDER}/meta/_journal.json`)) {
    return;
  }

  const { db, pool } = createDatabase(databaseUrl, 1);
  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await pool.end();
  }
}
