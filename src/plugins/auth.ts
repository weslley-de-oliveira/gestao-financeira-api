import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { User } from '../db/schema/index.ts';
import { createAuthRepository } from '../modules/auth/auth.repository.ts';
import {
  SESSION_COOKIE,
  clearSessionCookie,
  setSessionCookie,
} from '../modules/auth/session-cookie.ts';
import { exceedsMaxLifetime, shouldTouch, slidingExpiry } from '../modules/auth/session-rules.ts';
import { hashSessionToken } from '../modules/auth/session-token.ts';
import { DomainError } from '../shared/errors/domain-error.ts';

/** Quem fez a requisição, conforme a sessão do cookie. */
export interface AuthContext {
  user: User;
  sessionId: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    /**
     * Hook que exige sessão válida. Os módulos privados o registram no seu escopo:
     * `app.addHook('onRequest', app.authenticate)`.
     */
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }

  interface FastifyRequest {
    /** Preenchido por `app.authenticate`; `null` em rotas públicas. Leia com `currentAuth()`. */
    auth: AuthContext | null;
  }
}

export class SessionRequiredError extends DomainError {
  readonly kind = 'unauthorized';

  constructor() {
    super('Sessão ausente, expirada ou encerrada. Entre novamente.');
  }
}

/**
 * Valida a sessão das rotas privadas: lê o token do cookie, procura o hash dele entre as sessões
 * não expiradas e decora a requisição com o usuário. Sem cookie, sessão expirada ou encerrada
 * (apagada no logout) → 401; nos dois últimos casos o cookie velho também é removido.
 *
 * Expiração deslizante: com o uso, a validade volta a 7 dias (no máximo a cada 5 minutos, sem
 * passar de 30 dias do login), no banco e no cookie.
 */
export const authPlugin = fp(
  (app, _options, done) => {
    const repository = createAuthRepository(app.db);

    app.decorateRequest('auth', null);
    app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
      const token = request.cookies[SESSION_COOKIE];
      if (!token) {
        throw new SessionRequiredError();
      }

      const now = new Date();
      const found = await repository.findActiveSession(hashSessionToken(token), now);
      if (!found || exceedsMaxLifetime(found.session.createdAt, now)) {
        clearSessionCookie(reply);
        throw new SessionRequiredError();
      }

      const { session, user } = found;
      if (shouldTouch(session.lastSeenAt, now)) {
        const expiresAt = slidingExpiry(session.createdAt, now);
        await repository.touchSession(session.id, now, expiresAt);
        setSessionCookie(reply, token, expiresAt);
      }
      request.auth = { user, sessionId: session.id };
    });

    done();
  },
  { name: 'auth', dependencies: ['database', '@fastify/cookie'] },
);

/** Sessão da requisição numa rota privada. Erro de programação se a rota não exigir sessão. */
export function currentAuth(request: FastifyRequest): AuthContext {
  if (!request.auth) {
    throw new Error(
      `A rota ${request.routeOptions.url ?? request.url} não registrou app.authenticate.`,
    );
  }
  return request.auth;
}
