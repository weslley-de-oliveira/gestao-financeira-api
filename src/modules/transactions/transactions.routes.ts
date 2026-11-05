import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { currentAuth, requireSession } from '../../plugins/auth.ts';
import { problemDetailsSchema } from '../../shared/http/problem.ts';
import { createAccountsRepository } from '../accounts/accounts.repository.ts';
import { createCategoriesRepository } from '../categories/categories.repository.ts';
import { createTransactionsRepository } from './transactions.repository.ts';
import {
  createTransactionBodySchema,
  toTransactionDto,
  transactionSchema,
} from './transactions.schemas.ts';
import { createTransactionsService } from './transactions.service.ts';

export const TRANSACTIONS_TAG = 'Transações';

/** Rotas de transações, registradas com o prefixo `/v1/transactions`. Todas exigem sessão. */
export const transactionsRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  requireSession(app);
  const service = createTransactionsService({
    transactions: createTransactionsRepository(app.db),
    accounts: createAccountsRepository(app.db),
    categories: createCategoriesRepository(app.db),
  });

  app.post(
    '',
    {
      schema: {
        tags: [TRANSACTIONS_TAG],
        summary: 'Cadastra uma receita ou despesa',
        description:
          'Receita ou despesa em conta. A categoria é obrigatória e do mesmo tipo da transação; conta e categoria precisam ser do usuário (senão, 422 no campo). Sem `status`, a transação é realizada.',
        body: createTransactionBodySchema,
        response: { 201: transactionSchema, 401: problemDetailsSchema, 422: problemDetailsSchema },
      },
    },
    async (request, reply) => {
      const transaction = await service.create(currentAuth(request).user.id, request.body);
      return reply.status(201).send(toTransactionDto(transaction));
    },
  );

  done();
};
