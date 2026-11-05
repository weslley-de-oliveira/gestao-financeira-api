import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { currentAuth, requireSession } from '../../plugins/auth.ts';
import { problemDetailsSchema } from '../../shared/http/problem.ts';
import { toUserDto, userSchema } from '../auth/auth.schemas.ts';
import { createUsersRepository } from './users.repository.ts';
import { updateProfileBodySchema } from './users.schemas.ts';
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

  done();
};
