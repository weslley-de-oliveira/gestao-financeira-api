import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { currentAuth, requireSession } from '../../plugins/auth.ts';
import { problemDetailsSchema } from '../../shared/http/problem.ts';
import { createCategoriesRepository } from '../categories/categories.repository.ts';
import { createBudgetsRepository } from './budgets.repository.ts';
import {
  budgetListSchema,
  budgetMonthQuerySchema,
  budgetParamsSchema,
  budgetSchema,
  createBudgetBodySchema,
  toBudgetDto,
  updateBudgetBodySchema,
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
    '',
    {
      schema: {
        tags: [BUDGETS_TAG],
        summary: 'Lista os orçamentos com o consumo do mês',
        description:
          'Orçamentos que valem no mês (padrão: o atual), em ordem alfabética da categoria, com o consumo: só despesas realizadas contam (compras no cartão incluídas, pela data da compra); as pendentes aparecem à parte.',
        querystring: budgetMonthQuerySchema,
        response: { 200: budgetListSchema, 401: problemDetailsSchema, 422: problemDetailsSchema },
      },
    },
    async (request) => {
      const budgets = await service.list(currentAuth(request).user.id, request.query.month);
      return budgets.map(toBudgetDto);
    },
  );

  app.get(
    '/:id',
    {
      schema: {
        tags: [BUDGETS_TAG],
        summary: 'Detalha um orçamento',
        description:
          'Com o consumo do mês (padrão: o atual; `progress` nulo se o orçamento ainda não valia nele). Orçamento inexistente ou de outro usuário responde 404.',
        params: budgetParamsSchema,
        querystring: budgetMonthQuerySchema,
        response: {
          200: budgetSchema,
          401: problemDetailsSchema,
          404: problemDetailsSchema,
          422: problemDetailsSchema,
        },
      },
    },
    async (request) => {
      const budget = await service.get(
        currentAuth(request).user.id,
        request.params.id,
        request.query.month,
      );
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

  app.patch(
    '/:id',
    {
      schema: {
        tags: [BUDGETS_TAG],
        summary: 'Altera o limite ou o alerta de um orçamento',
        description:
          'O novo limite vale do mês atual em diante: os meses anteriores mantêm o limite que tinham (vigências). A categoria não muda (enviá-la responde 422). Orçamento inexistente ou de outro usuário responde 404.',
        params: budgetParamsSchema,
        body: updateBudgetBodySchema,
        response: {
          200: budgetSchema,
          401: problemDetailsSchema,
          404: problemDetailsSchema,
          422: problemDetailsSchema,
        },
      },
    },
    async (request) => {
      const budget = await service.update(
        currentAuth(request).user.id,
        request.params.id,
        request.body,
      );
      return toBudgetDto(budget);
    },
  );

  app.delete(
    '/:id',
    {
      schema: {
        tags: [BUDGETS_TAG],
        summary: 'Exclui um orçamento',
        description:
          'Remove o orçamento e o histórico de limites; as transações da categoria não mudam. A categoria fica livre para um orçamento novo. Orçamento inexistente ou de outro usuário responde 404.',
        params: budgetParamsSchema,
        response: {
          204: z.null(),
          401: problemDetailsSchema,
          404: problemDetailsSchema,
          422: problemDetailsSchema,
        },
      },
    },
    async (request, reply) => {
      await service.remove(currentAuth(request).user.id, request.params.id);
      return reply.status(204).send(null);
    },
  );

  done();
};
