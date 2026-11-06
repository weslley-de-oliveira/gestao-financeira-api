import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { currentAuth, requireSession } from '../../plugins/auth.ts';
import { AUTH_RATE_LIMITS } from '../../plugins/rate-limit.ts';
import { problemDetailsSchema } from '../../shared/http/problem.ts';
import { toUserDto, userSchema } from '../auth/auth.schemas.ts';
import { clearSessionCookie } from '../auth/session-cookie.ts';
import { createUsersRepository } from './users.repository.ts';
import {
  changePasswordBodySchema,
  deleteAccountBodySchema,
  updateProfileBodySchema,
} from './users.schemas.ts';
import { createUsersService } from './users.service.ts';

export const PROFILE_TAG = 'Perfil';

/** Rotas do perfil do usuário da sessão, registradas com o prefixo `/v1/me`. Exigem sessão. */
export const usersRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  requireSession(app);
  const service = createUsersService({ users: createUsersRepository(app.db) });

  app.patch(
    '',
    {
      schema: {
        tags: [PROFILE_TAG],
        summary: 'Altera o nome do perfil',
        description:
          'Só o nome muda por aqui: enviar e-mail ou senha responde 422. Para ler o perfil, use `GET /v1/auth/me`.',
        body: updateProfileBodySchema,
        response: { 200: userSchema, 401: problemDetailsSchema, 422: problemDetailsSchema },
      },
    },
    async (request) => {
      const user = await service.updateProfile(currentAuth(request).user.id, request.body);
      return toUserDto(user);
    },
  );

  app.post(
    '/password',
    {
      config: { rateLimit: AUTH_RATE_LIMITS.changePassword },
      schema: {
        tags: [PROFILE_TAG],
        summary: 'Troca a senha',
        description:
          'Confirma com a senha atual (errada responde 422 em `currentPassword`). A senha nova segue as regras do cadastro e precisa ser diferente da atual. Esta sessão continua; as outras sessões da pessoa, em outros aparelhos, são encerradas.',
        body: changePasswordBodySchema,
        response: {
          204: z.null(),
          401: problemDetailsSchema,
          422: problemDetailsSchema,
          429: problemDetailsSchema,
        },
      },
    },
    async (request, reply) => {
      const { user, sessionId } = currentAuth(request);
      await service.changePassword(user.id, sessionId, request.body);
      return reply.status(204).send(null);
    },
  );

  app.delete(
    '',
    {
      config: { rateLimit: AUTH_RATE_LIMITS.deleteAccount },
      schema: {
        tags: [PROFILE_TAG],
        summary: 'Exclui a conta e todos os dados',
        description:
          'Confirma com a senha atual (errada responde 422) e apaga de vez a pessoa e tudo o que é dela: contas, categorias, transações, cartões, orçamentos e metas. Todas as sessões são encerradas, inclusive em outros aparelhos, e o cookie é apagado. Não há como desfazer.',
        body: deleteAccountBodySchema,
        response: {
          204: z.null(),
          401: problemDetailsSchema,
          422: problemDetailsSchema,
          429: problemDetailsSchema,
        },
      },
    },
    async (request, reply) => {
      await service.deleteAccount(currentAuth(request).user.id, request.body);
      clearSessionCookie(reply);
      return reply.status(204).send(null);
    },
  );

  done();
};
