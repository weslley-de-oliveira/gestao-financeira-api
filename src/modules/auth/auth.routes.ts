import type { FastifyRequest } from 'fastify';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { problemDetailsSchema } from '../../shared/http/problem.ts';
import { createAuthRepository } from './auth.repository.ts';
import { loginBodySchema, registerBodySchema, toUserDto, userSchema } from './auth.schemas.ts';
import { createAuthService, type ClientInfo } from './auth.service.ts';
import { SESSION_COOKIE, setSessionCookie } from './session-cookie.ts';

export const AUTH_TAG = 'Autenticação';

/** Tamanho máximo do user-agent guardado na sessão. */
const USER_AGENT_MAX_LENGTH = 512;

const SESSION_COOKIE_NOTE = `A resposta traz o cookie \`${SESSION_COOKIE}\` com o token da sessão (HttpOnly, Secure, SameSite=Lax).`;

/** Rotas de autenticação, registradas com o prefixo `/v1/auth`. */
export const authRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  const service = createAuthService(createAuthRepository(app.db));

  app.post(
    '/register',
    {
      schema: {
        tags: [AUTH_TAG],
        summary: 'Cadastra um usuário e abre a sessão',
        description: `Senha com pelo menos 8 caracteres, uma letra e um número. O e-mail é guardado em minúsculas. ${SESSION_COOKIE_NOTE}`,
        body: registerBodySchema,
        response: {
          201: userSchema,
          409: problemDetailsSchema,
          422: problemDetailsSchema,
        },
      },
    },
    async (request, reply) => {
      const session = await service.register(request.body, clientInfo(request));
      setSessionCookie(reply, session.token, session.expiresAt);
      return reply.status(201).send(toUserDto(session.user));
    },
  );

  app.post(
    '/login',
    {
      schema: {
        tags: [AUTH_TAG],
        summary: 'Entra com e-mail e senha',
        description: `Abre uma sessão nova a cada login. Credenciais inválidas respondem 401 com a mesma mensagem, exista o e-mail ou não. ${SESSION_COOKIE_NOTE}`,
        body: loginBodySchema,
        response: {
          200: userSchema,
          401: problemDetailsSchema,
          422: problemDetailsSchema,
        },
      },
    },
    async (request, reply) => {
      const session = await service.login(request.body, clientInfo(request));
      setSessionCookie(reply, session.token, session.expiresAt);
      return toUserDto(session.user);
    },
  );

  done();
};

function clientInfo(request: FastifyRequest): ClientInfo {
  const userAgent = request.headers['user-agent'];
  return {
    ip: request.ip || null,
    userAgent: userAgent ? userAgent.slice(0, USER_AGENT_MAX_LENGTH) : null,
  };
}
