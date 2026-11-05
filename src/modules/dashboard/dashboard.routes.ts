import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { currentAuth, requireSession } from '../../plugins/auth.ts';
import { problemDetailsSchema } from '../../shared/http/problem.ts';
import { createAccountsRepository } from '../accounts/accounts.repository.ts';
import { createBudgetsRepository } from '../budgets/budgets.repository.ts';
import { createBudgetsService } from '../budgets/budgets.service.ts';
import { createCategoriesRepository } from '../categories/categories.repository.ts';
import { createGoalsRepository } from '../goals/goals.repository.ts';
import { createGoalsService } from '../goals/goals.service.ts';
import { createDashboardRepository } from './dashboard.repository.ts';
import { dashboardQuerySchema, dashboardSchema, toDashboardDto } from './dashboard.schemas.ts';
import { createDashboardService } from './dashboard.service.ts';

export const DASHBOARD_TAG = 'Dashboard';

/** Rota do dashboard, registrada com o prefixo `/v1/dashboard`. Exige sessão. */
export const dashboardRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  requireSession(app);
  const today = () => app.today();
  const service = createDashboardService({
    dashboard: createDashboardRepository(app.db),
    accounts: createAccountsRepository(app.db),
    // Os mesmos serviços das rotas de orçamentos e metas: as regras não divergem.
    budgets: createBudgetsService({
      budgets: createBudgetsRepository(app.db),
      categories: createCategoriesRepository(app.db),
      today,
    }),
    goals: createGoalsService({ goals: createGoalsRepository(app.db), today }),
    today,
  });

  app.get(
    '',
    {
      schema: {
        tags: [DASHBOARD_TAG],
        summary: 'Dados do dashboard',
        description:
          'Tudo o que o dashboard mostra, numa chamada só, para o período `from`–`to` (inclusivo; até um ano): totais, gráficos, transações recentes e destaques de orçamentos (do mês atual) e metas. Sem período, usa o mês atual.',
        querystring: dashboardQuerySchema,
        response: { 200: dashboardSchema, 401: problemDetailsSchema, 422: problemDetailsSchema },
      },
    },
    async (request) =>
      toDashboardDto(await service.get(currentAuth(request).user.id, request.query)),
  );

  done();
};
