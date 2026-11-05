import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { currentAuth, requireSession } from '../../plugins/auth.ts';
import { problemDetailsSchema } from '../../shared/http/problem.ts';
import { createCategoriesRepository } from '../categories/categories.repository.ts';
import { createBudgetsRepository } from './budgets.repository.ts';
import {
  budgetParamsSchema,
  budgetSchema,
  createBudgetBodySchema,
  toBudgetDto,
} from './budgets.schemas.ts';
import { createBudgetsService } from './budgets.service.ts';

export const BUDGETS_TAG = 'Orçamentos';

/** Rotas de orçamentos, registradas com o prefixo `/v1/budgets`. Todas exigem sessão. */
export const budgetsRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  requireSession(app);
  const service = createBudgetsService({
    budgets: createBudgetsRepository(app.db),
    categories: createCategoriesRepository(app.db),
    today: () => app.today(),
  });

  app.get(
    '/:id',
    {
      schema: {
        tags: [BUDGETS_TAG],
        summary: 'Detalha um orçamento',
        description: 'Orçamento inexistente ou de outro usuário responde 404.',
        params: budgetParamsSchema,
        response: {
          200: budgetSchema,
          401: problemDetailsSchema,
          404: problemDetailsSchema,
          422: problemDetailsSchema,
        },
      },
    },
    async (request) => {
      const budget = await service.get(currentAuth(request).user.id, request.params.id);
      return toBudgetDto(budget);
    },
  );

  app.post(
    '',
    {
      schema: {
        tags: [BUDGETS_TAG],
        summary: 'Cadastra o orçamento de uma categoria',
        description:
          'Limite mensal recorrente de gastos de uma categoria de despesa, valendo do mês atual em diante. Um orçamento por categoria (repetido responde 409). Categoria de receita responde 422; arquivada, 409. Sem `alertThreshold`, o alerta é em 80%.',
        body: createBudgetBodySchema,
        response: {
          201: budgetSchema,
          401: problemDetailsSchema,
          409: problemDetailsSchema,
          422: problemDetailsSchema,
        },
      },
    },
    async (request, reply) => {
      const budget = await service.create(currentAuth(request).user.id, request.body);
      return reply.status(201).send(toBudgetDto(budget));
    },
  );

  done();
};
