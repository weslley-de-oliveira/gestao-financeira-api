import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { currentAuth, requireSession } from '../../plugins/auth.ts';
import { problemDetailsSchema } from '../../shared/http/problem.ts';
import { ifMatchHeadersSchema, parseIfMatch, setEntityTag } from '../../shared/http/etag.ts';
import { createCategoriesRepository } from './categories.repository.ts';
import {
  categoryListSchema,
  categoryParamsSchema,
  categorySchema,
  createCategoryBodySchema,
  listCategoriesQuerySchema,
  toCategoryDto,
  updateCategoryBodySchema,
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
    async (request, reply) => {
      const category = await service.get(currentAuth(request).user.id, request.params.id);
      setEntityTag(reply, category);
      return toCategoryDto(category);
    },
  );

  app.post(
    '',
    {
      schema: {
        tags: [CATEGORIES_TAG],
        summary: 'Cadastra uma categoria',
        description:
          'O nome é único por tipo, sem diferenciar acentos, maiúsculas e espaços extras, contando as arquivadas: repetido responde 409.',
        body: createCategoryBodySchema,
        response: {
          201: categorySchema,
          401: problemDetailsSchema,
          409: problemDetailsSchema,
          422: problemDetailsSchema,
        },
      },
    },
    async (request, reply) => {
      const category = await service.create(currentAuth(request).user.id, request.body);
      setEntityTag(reply, category);
      return reply.status(201).send(toCategoryDto(category));
    },
  );

  app.patch(
    '/:id',
    {
      schema: {
        tags: [CATEGORIES_TAG],
        summary: 'Edita, arquiva ou reativa uma categoria',
        description:
          'Altera só os campos enviados. O tipo não muda (enviá-lo responde 422). Arquivar é `{ "isArchived": true }` e reativar, `false`: categorias não são excluídas, inclusive as padrão. Nome já usado por outra categoria do mesmo tipo responde 409; categoria inexistente ou de outro usuário, 404.',
        params: categoryParamsSchema,
        headers: ifMatchHeadersSchema,
        body: updateCategoryBodySchema,
        response: {
          200: categorySchema,
          401: problemDetailsSchema,
          404: problemDetailsSchema,
          412: problemDetailsSchema,
          409: problemDetailsSchema,
          422: problemDetailsSchema,
        },
      },
    },
    async (request, reply) => {
      const category = await service.update(
        currentAuth(request).user.id,
        request.params.id,
        request.body,
        parseIfMatch(request.headers['if-match']),
      );
      setEntityTag(reply, category);
      return toCategoryDto(category);
    },
  );

  done();
};
