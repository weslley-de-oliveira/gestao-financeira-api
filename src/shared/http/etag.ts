import { sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { DomainError } from '../errors/domain-error.ts';

/**
 * Concorrência otimista (RFC 9110): o `ETag` é a versão do registro editável (o `updated_at`).
 * Valores calculados na resposta, como saldo e uso do limite, não mudam a versão. Um `PATCH` com
 * `If-Match` só grava se o registro ainda estiver na versão lida; senão, 412.
 */
export class PreconditionFailedError extends DomainError {
  readonly kind = 'precondition';

  constructor() {
    super('O registro mudou desde a última leitura. Carregue-o de novo e refaça a alteração.');
  }
}

/** `If-Match` lido: `*` (qualquer versão) ou as ETags aceitas. */
export type IfMatch = '*' | readonly string[];

/** ETag forte da versão: os milissegundos do `updated_at`, entre aspas. */
export function entityTag(updatedAt: Date): string {
  return `"${updatedAt.getTime()}"`;
}

export function setEntityTag(reply: FastifyReply, record: { updatedAt: Date }): void {
  void reply.header('etag', entityTag(record.updatedAt));
}

export function parseIfMatch(header: string | undefined): IfMatch | undefined {
  if (header === undefined) {
    return undefined;
  }
  const value = header.trim();
  return value === '*'
    ? '*'
    : value
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean);
}

/** Comparação forte: ETags fracas (`W/"…"`) nunca valem para `If-Match`. */
export function assertIfMatch(ifMatch: IfMatch | undefined, record: { updatedAt: Date }): void {
  if (ifMatch === undefined || ifMatch === '*') {
    return;
  }
  if (!ifMatch.includes(entityTag(record.updatedAt))) {
    throw new PreconditionFailedError();
  }
}

/**
 * Condição do `UPDATE` otimista: o registro ainda está na versão lida. O Postgres guarda
 * microssegundos e o JavaScript, milissegundos: a comparação usa a mesma precisão.
 */
export function atVersion(column: AnyPgColumn, updatedAt: Date): SQL {
  return sql`date_trunc('milliseconds', ${column}) = ${updatedAt.toISOString()}::timestamptz`;
}

export const ifMatchHeadersSchema = z.object({
  'if-match': z.string().optional().meta({
    description:
      'ETag recebida na leitura (`GET` ou `PATCH` anterior). Se o registro mudou desde então, responde 412 e nada é gravado.',
    example: '"1793928014821"',
  }),
});
