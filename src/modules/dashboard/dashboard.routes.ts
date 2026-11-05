import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { currentAuth, requireSession } from '../../plugins/auth.ts';
import { problemDetailsSchema } from '../../shared/http/problem.ts';
import { createAccountsRepository } from '../accounts/accounts.repository.ts';
import { createDashboardRepository } from './dashboard.repository.ts';
import { dashboardQuerySchema, dashboardSchema } from './dashboard.schemas.ts';
import { createDashboardService } from './dashboard.service.ts';

export const DASHBOARD_TAG = 'Dashboard';

/** Rota do dashboard, registrada com o prefixo `/v1/dashboard`. Exige sessão. */
export const dashboardRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  requireSession(app);
  const service = createDashboardService({
    dashboard: createDashboardRepository(app.db),
    accounts: createAccountsRepository(app.db),
    today: () => app.today(),
  });

  app.get(
    '',
    {
      schema: {
        tags: [DASHBOARD_TAG],
        summary: 'Dados do dashboard',
        description:
          'Tudo o que o dashboard mostra, numa chamada só, para o período `from`–`to` (inclusivo; até um ano). Sem período, usa o mês atual.',
        querystring: dashboardQuerySchema,
        response: { 200: dashboardSchema, 401: problemDetailsSchema, 422: problemDetailsSchema },
      },
    },
    async (request) => service.get(currentAuth(request).user.id, request.query),
  );

  done();
};
