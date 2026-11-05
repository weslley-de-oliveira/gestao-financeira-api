import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { currentAuth, requireSession } from '../../plugins/auth.ts';
import { problemDetailsSchema } from '../../shared/http/problem.ts';
import { createAccountsRepository } from '../accounts/accounts.repository.ts';
import { createCategoriesRepository } from '../categories/categories.repository.ts';
import { createTransactionsRepository } from './transactions.repository.ts';
import {
  createTransactionBodySchema,
  toTransactionDto,
  transactionParamsSchema,
  transactionSchema,
  updateTransactionBodySchema,
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
        summary: 'Cadastra uma receita, despesa ou transferência',
        description:
          'Receita ou despesa em conta, com categoria obrigatória do mesmo tipo; ou transferência entre duas contas diferentes, sem categoria. Contas e categoria precisam ser do usuário (senão, 422 no campo). Sem `status`, a transação é realizada.',
        body: createTransactionBodySchema,
        response: { 201: transactionSchema, 401: problemDetailsSchema, 422: problemDetailsSchema },
      },
    },
    async (request, reply) => {
      const transaction = await service.create(currentAuth(request).user.id, request.body);
      return reply.status(201).send(toTransactionDto(transaction));
    },
  );

  app.get(
    '/:id',
    {
      schema: {
        tags: [TRANSACTIONS_TAG],
        summary: 'Detalha uma transação',
        description:
          'Qualquer tipo, inclusive pagamento de fatura. Inexistente ou de outro usuário responde 404.',
        params: transactionParamsSchema,
        response: {
          200: transactionSchema,
          401: problemDetailsSchema,
          404: problemDetailsSchema,
          422: problemDetailsSchema,
        },
      },
    },
    async (request) => {
      const transaction = await service.get(currentAuth(request).user.id, request.params.id);
      return toTransactionDto(transaction);
    },
  );

  app.patch(
    '/:id',
    {
      schema: {
        tags: [TRANSACTIONS_TAG],
        summary: 'Edita uma transação',
        description:
          'Os campos enviados são aplicados sobre a transação e o resultado segue as regras do cadastro. Ao trocar o tipo, os campos que não servem ao novo tipo são descartados (a categoria, ao virar transferência; a conta de destino, ao virar receita ou despesa). `notes: null` remove as observações. Pagamento de fatura responde 409.',
        params: transactionParamsSchema,
        body: updateTransactionBodySchema,
        response: {
          200: transactionSchema,
          401: problemDetailsSchema,
          404: problemDetailsSchema,
          409: problemDetailsSchema,
          422: problemDetailsSchema,
        },
      },
    },
    async (request) => {
      const transaction = await service.update(
        currentAuth(request).user.id,
        request.params.id,
        request.body,
      );
      return toTransactionDto(transaction);
    },
  );

  app.delete(
    '/:id',
    {
      schema: {
        tags: [TRANSACTIONS_TAG],
        summary: 'Exclui uma transação',
        description:
          'Remove a transação de vez. Pagamento de fatura responde 409: é desfeito pela fatura.',
        params: transactionParamsSchema,
        response: {
          204: z.null(),
          401: problemDetailsSchema,
          404: problemDetailsSchema,
          409: problemDetailsSchema,
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
