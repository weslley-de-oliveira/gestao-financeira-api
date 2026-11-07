import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { currentAuth, requireSession } from '../../plugins/auth.ts';
import { idempotencyHeadersSchema, idempotent } from '../../shared/http/idempotency.ts';
import { problemDetailsSchema } from '../../shared/http/problem.ts';
import { ifMatchHeadersSchema, parseIfMatch, setEntityTag } from '../../shared/http/etag.ts';
import { createAccountsRepository } from '../accounts/accounts.repository.ts';
import { createCategoriesRepository } from '../categories/categories.repository.ts';
import { createCreditCardsRepository } from '../credit-cards/credit-cards.repository.ts';
import { createTransactionsRepository } from './transactions.repository.ts';
import {
  createRefundBodySchema,
  createTransactionBodySchema,
  listTransactionsQuerySchema,
  toTransactionDto,
  transactionFiltersQuerySchema,
  transactionPageSchema,
  transactionParamsSchema,
  transactionSchema,
  transactionSummarySchema,
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
    creditCards: createCreditCardsRepository(app.db),
    today: () => app.today(),
  });

  app.get(
    '',
    {
      schema: {
        tags: [TRANSACTIONS_TAG],
        summary: 'Lista as transações',
        description:
          'Transações do usuário, com filtros combináveis: período (`from`/`to`, inclusivos), tipo, status, conta (origem ou destino), cartão, categoria e busca `q` na descrição e nas observações, sem diferenciar maiúsculas e acentos. Ordenadas por `sort` (padrão: das mais recentes para as mais antigas). Paginada por cursor: para a próxima página, repita a consulta (filtros e `sort` iguais) com `cursor` igual ao `nextCursor` recebido.',
        querystring: listTransactionsQuerySchema,
        response: {
          200: transactionPageSchema,
          401: problemDetailsSchema,
          422: problemDetailsSchema,
        },
      },
    },
    async (request) => {
      const page = await service.list(currentAuth(request).user.id, request.query);
      return { items: page.items.map(toTransactionDto), nextCursor: page.nextCursor };
    },
  );

  app.get(
    '/summary',
    {
      schema: {
        tags: [TRANSACTIONS_TAG],
        summary: 'Resume as transações filtradas',
        description:
          'Totais de todas as transações que passam nos filtros (os mesmos da listagem), sem paginação: quantidade, receitas e despesas realizadas, resultado e pendentes. Transferências e pagamentos de fatura contam na quantidade, mas não nos totais; compras no cartão são despesas.',
        querystring: transactionFiltersQuerySchema,
        response: {
          200: transactionSummarySchema,
          401: problemDetailsSchema,
          422: problemDetailsSchema,
        },
      },
    },
    (request) => service.summarize(currentAuth(request).user.id, request.query),
  );

  app.post(
    '',
    {
      schema: {
        tags: [TRANSACTIONS_TAG],
        summary: 'Cadastra uma receita, despesa ou transferência',
        description:
          'Receita ou despesa em conta, com categoria obrigatória do mesmo tipo; compra no cartão (despesa com `creditCardId` no lugar de `accountId`, sempre realizada); ou transferência entre duas contas diferentes, sem categoria. Contas, cartão e categoria precisam ser do usuário (senão, 422 no campo) e estar ativos (arquivado responde 409). Compra que cairia numa fatura já paga também responde 409. Sem `status`, a transação é realizada.',
        body: createTransactionBodySchema,
        response: {
          201: transactionSchema,
          401: problemDetailsSchema,
          409: problemDetailsSchema,
          422: problemDetailsSchema,
        },
      },
    },
    async (request, reply) => {
      const transaction = await service.create(currentAuth(request).user.id, request.body);
      setEntityTag(reply, transaction);
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
    async (request, reply) => {
      const transaction = await service.get(currentAuth(request).user.id, request.params.id);
      setEntityTag(reply, transaction);
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
          'Os campos enviados são aplicados sobre a transação e o resultado segue as regras do cadastro. Ao trocar o tipo, os campos que não servem ao novo tipo são descartados (a categoria, ao virar transferência; a conta de destino, ao virar receita ou despesa). `notes: null` remove as observações. Contas e categoria que a transação já tinha continuam aceitas mesmo se arquivadas depois; trocar por uma arquivada responde 409, assim como editar pagamento de fatura e editar compra de fatura já paga (ou movê-la para uma fatura paga) e editar uma parcela sozinha (`/problems/installment`: altere a compra parcelada). Num estorno, só mudam descrição, valor (até o que falta estornar) e data. Uma despesa com estornos só muda descrição, categoria e observações; o resto responde 409 (`/problems/has-refunds`).',
        params: transactionParamsSchema,
        headers: ifMatchHeadersSchema,
        body: updateTransactionBodySchema,
        response: {
          200: transactionSchema,
          401: problemDetailsSchema,
          404: problemDetailsSchema,
          412: problemDetailsSchema,
          409: problemDetailsSchema,
          422: problemDetailsSchema,
        },
      },
    },
    async (request, reply) => {
      const transaction = await service.update(
        currentAuth(request).user.id,
        request.params.id,
        request.body,
        parseIfMatch(request.headers['if-match']),
      );
      setEntityTag(reply, transaction);
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
          'Remove a transação de vez. Pagamento de fatura responde 409 (é desfeito pela fatura), assim como compra de fatura já paga (desfaça o pagamento antes) e parcela de compra parcelada (`/problems/installment`: exclua a compra inteira). Despesa com estornos também responde 409 (`/problems/has-refunds`): exclua os estornos antes.',
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

  app.post(
    '/:id/refunds',
    {
      schema: {
        tags: [TRANSACTIONS_TAG],
        summary: 'Estorna uma despesa',
        description:
          'Cria um estorno (`refund`) da despesa realizada, na conta ou no cartão dela: devolve o valor à conta ou abate a fatura em que a data do estorno cai, e reduz o gasto da categoria da despesa no mês do estorno. Pode haver vários estornos, até o valor da despesa (passar disso, ou data anterior à despesa, responde 422 no campo). Outro tipo de transação, ou despesa pendente, responde 409; no cartão, estorno numa fatura já paga também. Com `Idempotency-Key`, repetir o pedido devolve o mesmo estorno.',
        params: transactionParamsSchema,
        headers: idempotencyHeadersSchema,
        body: createRefundBodySchema,
        response: {
          201: transactionSchema,
          401: problemDetailsSchema,
          404: problemDetailsSchema,
          409: problemDetailsSchema,
          422: problemDetailsSchema,
        },
      },
    },
    async (request, reply) => {
      const userId = currentAuth(request).user.id;
      return idempotent(
        reply,
        { db: app.db, userId, key: request.headers['idempotency-key'], request, now: new Date() },
        async () => ({
          statusCode: 201,
          body: toTransactionDto(
            await service.createRefund(userId, request.params.id, request.body),
          ),
        }),
      );
    },
  );

  app.get(
    '/:id/refunds',
    {
      schema: {
        tags: [TRANSACTIONS_TAG],
        summary: 'Lista os estornos de uma despesa',
        description: 'Estornos da despesa, dos mais antigos aos mais recentes.',
        params: transactionParamsSchema,
        response: {
          200: z.array(transactionSchema),
          401: problemDetailsSchema,
          404: problemDetailsSchema,
          422: problemDetailsSchema,
        },
      },
    },
    async (request) =>
      (await service.listRefunds(currentAuth(request).user.id, request.params.id)).map(
        toTransactionDto,
      ),
  );

  done();
};
