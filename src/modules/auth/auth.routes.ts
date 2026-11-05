import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { problemDetailsSchema } from '../../shared/http/problem.ts';
import { createAuthRepository } from './auth.repository.ts';
import { registerBodySchema, toUserDto, userSchema } from './auth.schemas.ts';
import { createAuthService } from './auth.service.ts';

export const AUTH_TAG = 'Autenticação';

/** Rotas de autenticação, registradas com o prefixo `/v1/auth`. */
export const authRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  const service = createAuthService(createAuthRepository(app.db));

  app.post(
    '/register',
    {
      schema: {
        tags: [AUTH_TAG],
        summary: 'Cadastra um usuário',
        description:
          'Senha com pelo menos 8 caracteres, uma letra e um número. O e-mail é guardado em minúsculas.',
        body: registerBodySchema,
        response: {
          201: userSchema,
          409: problemDetailsSchema,
          422: problemDetailsSchema,
        },
      },
    },
    async (request, reply) => {
      const user = await service.register(request.body);
      return reply.status(201).send(toUserDto(user));
    },
  );

  done();
};
