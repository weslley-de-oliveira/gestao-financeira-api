import type { FastifyInstance } from 'fastify';
import { inject } from 'vitest';
import { buildApp } from '../../src/app.ts';
import { loadEnv } from '../../src/config/env.ts';

export interface TestAppOptions {
  /** Troca qualquer variável de ambiente. */
  env?: Record<string, string>;
  /** Roda antes do `ready()`: permite registrar rotas só de teste. */
  setup?: (app: FastifyInstance) => void | Promise<void>;
  /** Fixa o "hoje" da aplicação (`yyyy-MM-dd`, ao meio-dia em Brasília). */
  today?: string;
}

/**
 * Cria a aplicação ligada ao Postgres de teste, sem abrir porta (use `app.inject()`). As variáveis
 * passam pela mesma validação da inicialização. Feche com `await app.close()` ao final do teste.
 */
export async function createTestApp({
  env,
  setup,
  today,
}: TestAppOptions = {}): Promise<FastifyInstance> {
  const app = await buildApp(
    loadEnv({
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DOCS_ENABLED: 'false',
      // Os testes fazem muitas requisições do mesmo IP; os de limite o ligam com `env`.
      RATE_LIMIT_ENABLED: 'false',
      DATABASE_URL: inject('databaseUrl'),
      DATABASE_POOL_MAX: '2',
      ...env,
    }),
    today ? { now: () => new Date(`${today}T12:00:00-03:00`) } : {},
  );
  await setup?.(app);
  await app.ready();
  return app;
}
