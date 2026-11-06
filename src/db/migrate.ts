import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase } from './client.ts';

/** Pasta das migrações geradas pelo drizzle-kit; o build a copia para `dist/db/migrations`. */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL('./migrations', import.meta.url));

/** Chave da trava (advisory lock) que impede duas instâncias de migrarem ao mesmo tempo. */
const MIGRATION_LOCK_KEY = 4_815_162_342;

/**
 * Aplica as migrações pendentes (as já aplicadas ficam registradas em `drizzle.__drizzle_migrations`
 * e são puladas). Em produção, roda na subida da API (`MIGRATE_ON_START`): o plano gratuito do
 * Render não tem comando de pré-deploy. As migrações precisam ser compatíveis com a versão anterior
 * da API, que continua no ar até a nova ficar saudável.
 */
export async function runMigrations(databaseUrl: string): Promise<void> {
  if (!existsSync(`${MIGRATIONS_FOLDER}/meta/_journal.json`)) {
    return;
  }

  // Duas conexões: uma segura a trava enquanto a outra aplica as migrações.
  const { db, pool } = createDatabase(databaseUrl, 2);
  const lock = await pool.connect();
  try {
    await lock.query('select pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await lock.query('select pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]).catch(() => undefined);
    lock.release();
    await pool.end();
  }
}
