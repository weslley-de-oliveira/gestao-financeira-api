import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { TestProject } from 'vitest/node';
import { applyMigrations } from './helpers/database.ts';

declare module 'vitest' {
  interface ProvidedContext {
    /** URL do Postgres de teste, com as migrações aplicadas. Lida com `inject('databaseUrl')`. */
    databaseUrl: string;
  }
}

/** Mesma imagem do docker-compose.yml, para os testes rodarem na versão usada em desenvolvimento. */
const POSTGRES_IMAGE = 'postgres:17-alpine';

/**
 * Sobe um Postgres descartável (Testcontainers) uma vez por execução, aplica as migrações e
 * repassa a URL aos testes. A função devolvida para o contêiner ao final.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
  const databaseUrl = container.getConnectionUri();

  await applyMigrations(databaseUrl);
  project.provide('databaseUrl', databaseUrl);

  return async () => {
    await container.stop();
  };
}
