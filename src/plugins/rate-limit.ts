import rateLimit, { type RateLimitOptions } from '@fastify/rate-limit';
import type { FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

export interface RateLimitPluginOptions {
  /** Desligado nos testes que não tratam do limite (fazem muitas requisições do mesmo IP). */
  enabled: boolean;
}

/** Limite geral por IP, folgado para o uso normal do app. */
const GLOBAL_MAX_PER_MINUTE = 300;

/**
 * Limita requisições por IP em toda a API (429 com `Retry-After`). As rotas sensíveis aplicam
 * limites próprios com `config: { rateLimit: ... }` (ver `AUTH_RATE_LIMITS`), e as de operação o
 * desligam com `rateLimit: false`. Contadores em memória: suficiente para uma instância só.
 */
export const rateLimitPlugin = fp<RateLimitPluginOptions>(
  async (app, { enabled }) => {
    if (!enabled) {
      return;
    }
    await app.register(rateLimit, {
      global: true,
      max: GLOBAL_MAX_PER_MINUTE,
      timeWindow: '1 minute',
      cache: 10_000,
      errorResponseBuilder: (_request, { ttl }) => tooManyRequests(ttl),
    });
  },
  { name: 'rate-limit' },
);

/** Limites mais rígidos para as rotas de autenticação (força bruta e cadastro em massa). */
export const AUTH_RATE_LIMITS = {
  /**
   * 5 tentativas por minuto por IP + e-mail. Roda no `preHandler`, depois da validação, para usar
   * o e-mail já normalizado (minúsculas): variar a caixa não gera tentativas extras.
   */
  login: {
    max: 5,
    timeWindow: '1 minute',
    hook: 'preHandler',
    keyGenerator: (request: FastifyRequest) => `login:${request.ip}:${emailFromBody(request.body)}`,
  },
  /** 5 cadastros por minuto por IP. */
  register: {
    max: 5,
    timeWindow: '1 minute',
    keyGenerator: (request: FastifyRequest) => `register:${request.ip}`,
  },
} as const satisfies Record<string, RateLimitOptions>;

function emailFromBody(body: unknown): string {
  return typeof body === 'object' && body !== null && 'email' in body ? String(body.email) : '';
}

/** Erro que o plugin `errors` transforma em Problem Details 429. */
function tooManyRequests(ttlMs: number): Error & { statusCode: number } {
  const seconds = Math.max(1, Math.ceil(ttlMs / 1000));
  const unit = seconds === 1 ? 'segundo' : 'segundos';
  return Object.assign(new Error(`Muitas tentativas. Tente novamente em ${seconds} ${unit}.`), {
    statusCode: 429,
  });
}
