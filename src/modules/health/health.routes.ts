import { sql } from 'drizzle-orm';
import type { FastifyPluginCallback } from 'fastify';

/** Tempo máximo da checagem do banco: o orquestrador não pode ficar esperando. */
const READY_TIMEOUT_MS = 2_000;

/**
 * Rotas de operação, fora do prefixo `/v1`:
 * - `/health` (liveness): o processo está de pé; não toca dependências.
 * - `/ready` (readiness): a API consegue atender, ou seja, o banco responde.
 * Ficam fora dos logs de requisição (são chamadas a cada poucos segundos).
 */
export const healthRoutes: FastifyPluginCallback = (app, _options, done) => {
  app.get('/health', { logLevel: 'warn' }, (_request, reply) => reply.send({ status: 'ok' }));

  app.get('/ready', { logLevel: 'warn' }, async (request) => {
    try {
      await withTimeout(app.db.execute(sql`select 1`), READY_TIMEOUT_MS);
      return { status: 'ready' };
    } catch (error) {
      request.log.warn({ err: error }, 'banco indisponível na checagem de prontidão');
      throw app.httpErrors.serviceUnavailable('O banco de dados não está respondendo.');
    }
  });

  done();
};

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Tempo esgotado após ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
