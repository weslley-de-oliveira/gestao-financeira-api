import type { FastifyInstance } from 'fastify';
import { inject } from 'vitest';
import { buildApp } from '../../src/app.ts';
import { loadEnv } from '../../src/config/env.ts';

/**
 * Cria a aplicação ligada ao Postgres de teste, sem abrir porta (use `app.inject()`). As variáveis
 * passam pela mesma validação da inicialização; `overrides` troca qualquer uma delas.
 * Feche com `await app.close()` ao final do teste.
 */
export async function createTestApp(
  overrides: Record<string, string> = {},
): Promise<FastifyInstance> {
  const env = loadEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DOCS_ENABLED: 'false',
    DATABASE_URL: inject('databaseUrl'),
    DATABASE_POOL_MAX: '2',
    ...overrides,
  });

  const app = await buildApp(env);
  await app.ready();
  return app;
}
