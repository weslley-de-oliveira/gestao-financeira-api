import { runMigrations } from '../../src/db/migrate.ts';

/** Aplica as migrações no banco de teste, como a API faz na subida em produção. */
export async function applyMigrations(databaseUrl: string): Promise<void> {
  await runMigrations(databaseUrl);
}
