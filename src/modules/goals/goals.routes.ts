import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { currentAuth, requireSession } from '../../plugins/auth.ts';
import { problemDetailsSchema } from '../../shared/http/problem.ts';
import { createGoalsRepository } from './goals.repository.ts';
import {
  contributionParamsSchema,
  createContributionBodySchema,
  createGoalBodySchema,
  goalListSchema,
  goalParamsSchema,
  goalSchema,
  listGoalsQuerySchema,
  toGoalDto,
  updateGoalBodySchema,
} from './goals.schemas.ts';
import { createGoalsService } from './goals.service.ts';

export const GOALS_TAG = 'Metas';

/** Rotas de metas, registradas com o prefixo `/v1/goals`. Todas exigem sessão. */
export const goalsRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  requireSession(app);
  const service = createGoalsService({
    goals: createGoalsRepository(app.db),
    today: () => app.today(),
  });

  app.get(
    '',
    {
      schema: {
        tags: [GOALS_TAG],
        summary: 'Lista as metas',
        description: 'Metas do usuário. Por padrão, só as ativas (não arquivadas).',
        querystring: listGoalsQuerySchema,
        response: { 200: goalListSchema, 401: problemDetailsSchema, 422: problemDetailsSchema },
      },
    },
    async (request) => {
      const goals = await service.list(currentAuth(request).user.id, request.query);
      return goals.map(toGoalDto);
    },
  );

  app.get(
    '/:id',
    {
      schema: {
        tags: [GOALS_TAG],
        summary: 'Detalha uma meta',
        description: 'Meta inexistente ou de outro usuário responde 404.',
        params: goalParamsSchema,
        response: {
          200: goalSchema,
          401: problemDetailsSchema,
          404: problemDetailsSchema,
          422: problemDetailsSchema,
        },
      },
    },
    async (request) => {
      const goal = await service.get(currentAuth(request).user.id, request.params.id);
      return toGoalDto(goal);
    },
  );

  app.post(
    '',
    {
      schema: {
        tags: [GOALS_TAG],
        summary: 'Cadastra uma meta',
        description:
          'Sem `initialAmount`, a meta começa do zero. A data-limite é opcional, mas não pode estar no passado (422).',
        body: createGoalBodySchema,
        response: { 201: goalSchema, 401: problemDetailsSchema, 422: problemDetailsSchema },
      },
    },
    async (request, reply) => {
      const goal = await service.create(currentAuth(request).user.id, request.body);
      return reply.status(201).send(toGoalDto(goal));
    },
  );

  app.patch(
    '/:id',
    {
      schema: {
        tags: [GOALS_TAG],
        summary: 'Edita, pausa, arquiva ou reativa uma meta',
        description:
          'Altera só os campos enviados; `description: null` e `deadline: null` removem os valores. Uma data-limite já vencida pode ser mantida, mas não definida de novo. `isPaused` pausa ou retoma e `isArchived` arquiva ou reativa: metas não são excluídas. Meta inexistente ou de outro usuário responde 404.',
        params: goalParamsSchema,
        body: updateGoalBodySchema,
        response: {
          200: goalSchema,
          401: problemDetailsSchema,
          404: problemDetailsSchema,
          422: problemDetailsSchema,
        },
      },
    },
    async (request) => {
      const goal = await service.update(
        currentAuth(request).user.id,
        request.params.id,
        request.body,
      );
      return toGoalDto(goal);
    },
  );

  app.post(
    '/:id/contributions',
    {
      schema: {
        tags: [GOALS_TAG],
        summary: 'Registra um aporte ou uma retirada',
        description:
          'Movimentação manual da meta, com data de hoje ou anterior. Uma retirada maior que o valor acumulado responde 409. Devolve a meta atualizada.',
        params: goalParamsSchema,
        body: createContributionBodySchema,
        response: {
          201: goalSchema,
          401: problemDetailsSchema,
          404: problemDetailsSchema,
          409: problemDetailsSchema,
          422: problemDetailsSchema,
        },
      },
    },
    async (request, reply) => {
      const goal = await service.addContribution(
        currentAuth(request).user.id,
        request.params.id,
        request.body,
      );
      return reply.status(201).send(toGoalDto(goal));
    },
  );

  app.delete(
    '/:id/contributions/:contributionId',
    {
      schema: {
        tags: [GOALS_TAG],
        summary: 'Exclui um aporte ou uma retirada',
        description:
          'O acumulado é recalculado. Excluir um aporte que deixaria o acumulado negativo responde 409. Devolve a meta atualizada.',
        params: contributionParamsSchema,
        response: {
          200: goalSchema,
          401: problemDetailsSchema,
          404: problemDetailsSchema,
          409: problemDetailsSchema,
          422: problemDetailsSchema,
        },
      },
    },
    async (request) => {
      const { id, contributionId } = request.params;
      const goal = await service.removeContribution(
        currentAuth(request).user.id,
        id,
        contributionId,
      );
      return toGoalDto(goal);
    },
  );

  done();
};
