import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { currentAuth, requireSession } from '../../plugins/auth.ts';
import { problemDetailsSchema } from '../../shared/http/problem.ts';
import { ifMatchHeadersSchema, parseIfMatch, setEntityTag } from '../../shared/http/etag.ts';
import { createAccountsRepository } from './accounts.repository.ts';
import {
  accountListSchema,
  accountParamsSchema,
  accountSchema,
  createAccountBodySchema,
  listAccountsQuerySchema,
  toAccountDto,
  updateAccountBodySchema,
} from './accounts.schemas.ts';
import { createAccountsService } from './accounts.service.ts';

export const ACCOUNTS_TAG = 'Contas';

/** Rotas de contas, registradas com o prefixo `/v1/accounts`. Todas exigem sessão. */
export const accountsRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  requireSession(app);
  const service = createAccountsService(createAccountsRepository(app.db));

  app.get(
    '',
    {
      schema: {
        tags: [ACCOUNTS_TAG],
        summary: 'Lista as contas',
        description: 'Contas do usuário em ordem alfabética. Por padrão, só as ativas.',
        querystring: listAccountsQuerySchema,
        response: { 200: accountListSchema, 401: problemDetailsSchema, 422: problemDetailsSchema },
      },
    },
    async (request) => {
      const accounts = await service.list(currentAuth(request).user.id, request.query);
      return accounts.map(toAccountDto);
    },
  );

  app.get(
    '/:id',
    {
      schema: {
        tags: [ACCOUNTS_TAG],
        summary: 'Detalha uma conta',
        description: 'Conta inexistente ou de outro usuário responde 404.',
        params: accountParamsSchema,
        response: {
          200: accountSchema,
          401: problemDetailsSchema,
          404: problemDetailsSchema,
          422: problemDetailsSchema,
        },
      },
    },
    async (request, reply) => {
      const account = await service.get(currentAuth(request).user.id, request.params.id);
      setEntityTag(reply, account);
      return toAccountDto(account);
    },
  );

  app.post(
    '',
    {
      schema: {
        tags: [ACCOUNTS_TAG],
        summary: 'Cadastra uma conta',
        description:
          'A conta pertence ao usuário da sessão. Instituição vazia é gravada como `null`; sem `initialBalance`, o saldo inicial é zero.',
        body: createAccountBodySchema,
        response: { 201: accountSchema, 401: problemDetailsSchema, 422: problemDetailsSchema },
      },
    },
    async (request, reply) => {
      const account = await service.create(currentAuth(request).user.id, request.body);
      setEntityTag(reply, account);
      return reply.status(201).send(toAccountDto(account));
    },
  );

  app.patch(
    '/:id',
    {
      schema: {
        tags: [ACCOUNTS_TAG],
        summary: 'Edita, arquiva ou reativa uma conta',
        description:
          'Altera só os campos enviados; `institution: null` remove a instituição. Arquivar é `{ "isArchived": true }` e reativar, `false`: contas não são excluídas, para preservar o histórico das transações. Conta inexistente ou de outro usuário responde 404.',
        params: accountParamsSchema,
        headers: ifMatchHeadersSchema,
        body: updateAccountBodySchema,
        response: {
          200: accountSchema,
          401: problemDetailsSchema,
          404: problemDetailsSchema,
          412: problemDetailsSchema,
          422: problemDetailsSchema,
        },
      },
    },
    async (request, reply) => {
      const account = await service.update(
        currentAuth(request).user.id,
        request.params.id,
        request.body,
        parseIfMatch(request.headers['if-match']),
      );
      setEntityTag(reply, account);
      return toAccountDto(account);
    },
  );

  done();
};
