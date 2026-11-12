import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { CLIENT_ERRORS_RATE_LIMIT } from '../../plugins/rate-limit.ts';
import { problemDetailsSchema } from '../../shared/http/problem.ts';
import { clientErrorBodySchema, clientErrorLogEntry } from './client-errors.schemas.ts';

/**
 * Relatos de erro do front, registrados com o prefixo `/v1/client-errors`. A rota é pública (erros
 * do login também importam) e só grava um log `warn` com `source: "front"`: os erros do front ficam
 * nos mesmos logs da API, ligados pelo id da requisição.
 */
export const clientErrorsRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  app.post(
    '',
    {
      config: { rateLimit: CLIENT_ERRORS_RATE_LIMIT },
      schema: {
        tags: ['Operação'],
        summary: 'Registra um erro do front',
        description:
          'Grava o erro nos logs da API, com o `User-Agent` e, se houver sessão, o id do usuário. Não exige sessão; limitado a 10 relatos por minuto por IP.',
        body: clientErrorBodySchema,
        response: { 204: z.null(), 422: problemDetailsSchema, 429: problemDetailsSchema },
      },
    },
    async (request, reply) => {
      const user = await app.identify(request);
      request.log.warn(
        clientErrorLogEntry(request.body, {
          userAgent: request.headers['user-agent'],
          userId: user?.id ?? null,
        }),
        'erro no front',
      );
      return reply.status(204).send(null);
    },
  );

  done();
};
