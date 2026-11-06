import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { currentAuth, requireSession } from '../../plugins/auth.ts';
import { problemDetailsSchema } from '../../shared/http/problem.ts';
import { ifMatchHeadersSchema, parseIfMatch, setEntityTag } from '../../shared/http/etag.ts';
import { createAccountsRepository } from '../accounts/accounts.repository.ts';
import { createCreditCardsRepository } from './credit-cards.repository.ts';
import {
  createCreditCardBodySchema,
  creditCardListSchema,
  creditCardParamsSchema,
  creditCardSchema,
  listCreditCardsQuerySchema,
  toCreditCardDto,
  updateCreditCardBodySchema,
} from './credit-cards.schemas.ts';
import { createCreditCardsService } from './credit-cards.service.ts';

export const CREDIT_CARDS_TAG = 'Cartões';

/** Rotas de cartões, registradas com o prefixo `/v1/credit-cards`. Todas exigem sessão. */
export const creditCardsRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  requireSession(app);
  const service = createCreditCardsService({
    creditCards: createCreditCardsRepository(app.db),
    accounts: createAccountsRepository(app.db),
    today: () => app.today(),
  });

  app.get(
    '',
    {
      schema: {
        tags: [CREDIT_CARDS_TAG],
        summary: 'Lista os cartões',
        description: 'Cartões do usuário em ordem alfabética. Por padrão, só os ativos.',
        querystring: listCreditCardsQuerySchema,
        response: {
          200: creditCardListSchema,
          401: problemDetailsSchema,
          422: problemDetailsSchema,
        },
      },
    },
    async (request) => {
      const cards = await service.list(currentAuth(request).user.id, request.query);
      return cards.map(toCreditCardDto);
    },
  );

  app.get(
    '/:id',
    {
      schema: {
        tags: [CREDIT_CARDS_TAG],
        summary: 'Detalha um cartão',
        description: 'Cartão inexistente ou de outro usuário responde 404.',
        params: creditCardParamsSchema,
        response: {
          200: creditCardSchema,
          401: problemDetailsSchema,
          404: problemDetailsSchema,
          422: problemDetailsSchema,
        },
      },
    },
    async (request, reply) => {
      const card = await service.get(currentAuth(request).user.id, request.params.id);
      setEntityTag(reply, card);
      return toCreditCardDto(card);
    },
  );

  app.post(
    '',
    {
      schema: {
        tags: [CREDIT_CARDS_TAG],
        summary: 'Cadastra um cartão',
        description:
          'Só os quatro últimos dígitos são aceitos. Fechamento e vencimento em dias diferentes (1 a 31; em meses curtos vale o último dia). A conta de pagamento precisa ser do usuário (senão, 422) e estar ativa (arquivada responde 409).',
        body: createCreditCardBodySchema,
        response: {
          201: creditCardSchema,
          401: problemDetailsSchema,
          409: problemDetailsSchema,
          422: problemDetailsSchema,
        },
      },
    },
    async (request, reply) => {
      const card = await service.create(currentAuth(request).user.id, request.body);
      setEntityTag(reply, card);
      return reply.status(201).send(toCreditCardDto(card));
    },
  );

  app.patch(
    '/:id',
    {
      schema: {
        tags: [CREDIT_CARDS_TAG],
        summary: 'Edita, arquiva ou reativa um cartão',
        description:
          'Altera só os campos enviados; o resultado segue as regras do cadastro. Arquivar é `{ "isArchived": true }` e reativar, `false`: cartões não são excluídos, para preservar as compras e as faturas. A conta de pagamento que o cartão já tinha continua aceita mesmo se arquivada; trocar por uma arquivada responde 409.',
        params: creditCardParamsSchema,
        headers: ifMatchHeadersSchema,
        body: updateCreditCardBodySchema,
        response: {
          200: creditCardSchema,
          401: problemDetailsSchema,
          404: problemDetailsSchema,
          412: problemDetailsSchema,
          409: problemDetailsSchema,
          422: problemDetailsSchema,
        },
      },
    },
    async (request, reply) => {
      const card = await service.update(
        currentAuth(request).user.id,
        request.params.id,
        request.body,
        parseIfMatch(request.headers['if-match']),
      );
      setEntityTag(reply, card);
      return toCreditCardDto(card);
    },
  );

  done();
};
