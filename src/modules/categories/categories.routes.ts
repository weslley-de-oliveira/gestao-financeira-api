import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { currentAuth, requireSession } from '../../plugins/auth.ts';
import { problemDetailsSchema } from '../../shared/http/problem.ts';
import { createCategoriesRepository } from './categories.repository.ts';
import {
  categoryListSchema,
  categoryParamsSchema,
  categorySchema,
  listCategoriesQuerySchema,
  toCategoryDto,
} from './categories.schemas.ts';
import { createCategoriesService } from './categories.service.ts';

export const CATEGORIES_TAG = 'Categorias';

/** Rotas de categorias, registradas com o prefixo `/v1/categories`. Todas exigem sessão. */
export const categoriesRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  requireSession(app);
  const service = createCategoriesService(createCategoriesRepository(app.db));

  app.get(
    '',
    {
      schema: {
        tags: [CATEGORIES_TAG],
        summary: 'Lista as categorias',
        description:
          'Categorias do usuário em ordem alfabética, de um tipo ou dos dois. Por padrão, só as ativas.',
        querystring: listCategoriesQuerySchema,
        response: { 200: categoryListSchema, 401: problemDetailsSchema, 422: problemDetailsSchema },
      },
    },
    async (request) => {
      const categories = await service.list(currentAuth(request).user.id, request.query);
      return categories.map(toCategoryDto);
    },
  );

  app.get(
    '/:id',
    {
      schema: {
        tags: [CATEGORIES_TAG],
        summary: 'Detalha uma categoria',
        description: 'Categoria inexistente ou de outro usuário responde 404.',
        params: categoryParamsSchema,
        response: {
          200: categorySchema,
          401: problemDetailsSchema,
          404: problemDetailsSchema,
          422: problemDetailsSchema,
        },
      },
    },
    async (request) => {
      const category = await service.get(currentAuth(request).user.id, request.params.id);
      return toCategoryDto(category);
    },
  );

  done();
};
