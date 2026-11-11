import { createHash } from 'node:crypto';
import { and, eq, lt } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Database } from '../../db/client.ts';
import { idempotencyKeys } from '../../db/schema/index.ts';
import { DomainError } from '../errors/domain-error.ts';

/** Por quanto tempo uma chave vale: depois disso, a mesma chave executa a operação de novo. */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export const IDEMPOTENT_REPLAYED_HEADER = 'idempotent-replayed';

export const idempotencyHeadersSchema = z.object({
  'idempotency-key': z.string().min(1).max(255).optional().meta({
    description:
      'Chave única por operação (ex.: um UUID gerado ao abrir a confirmação). Repetir a requisição com a mesma chave em até 24 horas devolve a resposta da primeira, sem executar de novo.',
    example: '0b9d6a3e-6c1f-4f7a-9d1e-2f0f5d7c9a11',
  }),
});

/** A chave já foi usada, pela mesma pessoa, numa requisição diferente. */
export class IdempotencyKeyReusedError extends DomainError {
  readonly kind = 'invalid';

  constructor() {
    super('Esta Idempotency-Key já foi usada em outra requisição. Gere uma chave nova.');
  }
}

/** A primeira requisição com esta chave ainda está em andamento. */
export class IdempotencyInProgressError extends DomainError {
  readonly kind = 'conflict';

  constructor() {
    super(
      'Uma requisição com esta Idempotency-Key ainda está em andamento. Tente de novo em instantes.',
    );
  }
}

export interface StoredResponse {
  statusCode: number;
  body: unknown;
}

interface IdempotencyOptions {
  db: Database;
  userId: string;
  /** Valor do cabeçalho; sem ele, a operação roda normalmente. */
  key: string | undefined;
  request: FastifyRequest;
  now: Date;
}

/**
 * Executa a operação uma vez por chave. A primeira requisição reserva a chave, executa e grava a
 * resposta de sucesso; as repetições recebem a resposta gravada (`Idempotent-Replayed: true`). Se
 * a operação falhar, a reserva é desfeita: o erro não é guardado e o cliente pode tentar de novo.
 */
export async function idempotent(
  reply: FastifyReply,
  { db, userId, key, request, now }: IdempotencyOptions,
  run: () => Promise<StoredResponse>,
): Promise<FastifyReply> {
  if (key === undefined) {
    const { statusCode, body } = await run();
    return reply.status(statusCode).send(body);
  }

  // O corpo também conta: a mesma chave com outro valor é outra requisição.
  const requestHash = createHash('sha256')
    .update(`${request.method} ${request.url} ${JSON.stringify(request.body ?? null)}`)
    .digest('hex');
  const owned = and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.key, key));
  // Chaves vencidas desta pessoa deixam de valer (e não acumulam).
  await db
    .delete(idempotencyKeys)
    .where(
      and(
        eq(idempotencyKeys.userId, userId),
        lt(idempotencyKeys.createdAt, new Date(now.getTime() - IDEMPOTENCY_TTL_MS)),
      ),
    );

  const [reserved] = await db
    .insert(idempotencyKeys)
    .values({ userId, key, requestHash, createdAt: now })
    .onConflictDoNothing()
    .returning();

  if (!reserved) {
    const [stored] = await db.select().from(idempotencyKeys).where(owned);
    if (!stored) {
      // Vencida e apagada entre as duas consultas: raríssimo; o cliente repete.
      throw new IdempotencyInProgressError();
    }
    if (stored.requestHash !== requestHash) {
      throw new IdempotencyKeyReusedError();
    }
    if (stored.statusCode === null) {
      throw new IdempotencyInProgressError();
    }
    return reply
      .header(IDEMPOTENT_REPLAYED_HEADER, 'true')
      .status(stored.statusCode)
      .send(stored.responseBody);
  }

  let response: StoredResponse;
  try {
    response = await run();
  } catch (error) {
    await db.delete(idempotencyKeys).where(owned);
    throw error;
  }
  await db
    .update(idempotencyKeys)
    .set({ statusCode: response.statusCode, responseBody: response.body })
    .where(owned);
  return reply.status(response.statusCode).send(response.body);
}
