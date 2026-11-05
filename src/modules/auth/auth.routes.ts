import type { FastifyRequest } from 'fastify';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { currentAuth } from '../../plugins/auth.ts';
import { problemDetailsSchema } from '../../shared/http/problem.ts';
import { createAuthRepository } from './auth.repository.ts';
import { loginBodySchema, registerBodySchema, toUserDto, userSchema } from './auth.schemas.ts';
import { createAuthService, type ClientInfo } from './auth.service.ts';
import { SESSION_COOKIE, clearSessionCookie, setSessionCookie } from './session-cookie.ts';

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

  // Não exige sessão válida: sair com o cookie já expirado também responde 204 e limpa o cookie.
  app.post(
    '/logout',
    {
      schema: {
        tags: [AUTH_TAG],
        summary: 'Sai da conta',
        description: 'Encerra a sessão do cookie no servidor e pede ao navegador para apagá-lo.',
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      await service.logout(request.cookies[SESSION_COOKIE]);
      clearSessionCookie(reply);
      return reply.status(204).send(null);
    },
  );

  app.register((privateScope, _privateOptions, privateDone) => {
    privateScope.addHook('onRequest', privateScope.authenticate);

    privateScope.get(
      '/me',
      {
        schema: {
          tags: [AUTH_TAG],
          summary: 'Usuário da sessão atual',
          description:
            'Usado pelo front ao abrir o app para restaurar a sessão a partir do cookie.',
          response: { 200: userSchema, 401: problemDetailsSchema },
        },
      },
      async (request) => toUserDto(currentAuth(request).user),
    );

    privateDone();
  });

  done();
};

function clientInfo(request: FastifyRequest): ClientInfo {
  const userAgent = request.headers['user-agent'];
  return {
    ip: request.ip || null,
    userAgent: userAgent ? userAgent.slice(0, USER_AGENT_MAX_LENGTH) : null,
  };
}
