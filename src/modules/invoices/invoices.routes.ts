import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { currentAuth, requireSession } from '../../plugins/auth.ts';
import { idempotencyHeadersSchema, idempotent } from '../../shared/http/idempotency.ts';
import { problemDetailsSchema } from '../../shared/http/problem.ts';
import { createAccountsRepository } from '../accounts/accounts.repository.ts';
import { createCreditCardsRepository } from '../credit-cards/credit-cards.repository.ts';
import { createInvoicesRepository } from './invoices.repository.ts';
import {
  cardInvoicesParamsSchema,
  invoiceListSchema,
  invoiceParamsSchema,
  invoicePaymentBodySchema,
  invoiceSchema,
  toInvoiceDto,
  toInvoiceSummaryDto,
} from './invoices.schemas.ts';
import { createInvoicesService } from './invoices.service.ts';

export const INVOICES_TAG = 'Faturas';

/**
 * Rotas de faturas, registradas com o prefixo `/v1/credit-cards` (são do cartão). Todas exigem
 * sessão. Faturas não são guardadas: são calculadas das compras e dos pagamentos a cada consulta.
 */
export const invoicesRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  requireSession(app);
  const creditCards = createCreditCardsRepository(app.db);
  const service = createInvoicesService({
    invoices: createInvoicesRepository(app.db),
    creditCards,
    accounts: createAccountsRepository(app.db),
    today: () => app.today(),
  });

  app.get(
    '/:id/invoices',
    {
      schema: {
        tags: [INVOICES_TAG],
        summary: 'Lista as faturas do cartão',
        description:
          'Da mais recente para a mais antiga: a fatura aberta hoje e todas as que têm compras ou pagamento. Cartão inexistente ou de outro usuário responde 404.',
        params: cardInvoicesParamsSchema,
        response: {
          200: invoiceListSchema,
          401: problemDetailsSchema,
          404: problemDetailsSchema,
          422: problemDetailsSchema,
        },
      },
    },
    async (request) => {
      const invoices = await service.list(currentAuth(request).user.id, request.params.id);
      return invoices.map(toInvoiceSummaryDto);
    },
  );

  app.get(
    '/:id/invoices/:month',
    {
      schema: {
        tags: [INVOICES_TAG],
        summary: 'Detalha uma fatura',
        description:
          'A fatura do mês de referência (o mês do vencimento), com as compras do ciclo e o pagamento, se houver. Um mês sem compras devolve a fatura vazia.',
        params: invoiceParamsSchema,
        response: {
          200: invoiceSchema,
          401: problemDetailsSchema,
          404: problemDetailsSchema,
          422: problemDetailsSchema,
        },
      },
    },
    async (request) => {
      const { id, month } = request.params;
      const invoice = await service.get(currentAuth(request).user.id, id, month);
      return toInvoiceDto(invoice);
    },
  );

  app.post(
    '/:id/invoices/:month/payment',
    {
      schema: {
        tags: [INVOICES_TAG],
        summary: 'Paga a fatura (inteira ou em parte)',
        description:
          'Paga `amount` (até o saldo da fatura; acima, 422) ou, sem corpo, o saldo inteiro, com a data de hoje, debitando a conta de pagamento do cartão (cria uma transação `invoice-payment`; a parcial leva " (parcial)" na descrição). Uma fatura aceita vários pagamentos: o que faltar passa para a fatura seguinte no fechamento dela. Só fatura fechada ou vencida com saldo a pagar; senão (aberta, quitada ou com o saldo já transferido), ou com a conta de pagamento arquivada, responde 409. Devolve a fatura. Com `Idempotency-Key`, repetir o pedido (ex.: depois de uma falha de rede) devolve o mesmo pagamento em vez de pagar de novo: a chave reaproveitada em outra requisição (ou com outro valor) responde 422, e enquanto a primeira ainda roda, 409.',
        params: invoiceParamsSchema,
        headers: idempotencyHeadersSchema,
        body: invoicePaymentBodySchema,
        response: {
          201: invoiceSchema,
          401: problemDetailsSchema,
          404: problemDetailsSchema,
          409: problemDetailsSchema,
          422: problemDetailsSchema,
        },
      },
    },
    async (request, reply) => {
      const { id, month } = request.params;
      const userId = currentAuth(request).user.id;
      return idempotent(
        reply,
        { db: app.db, userId, key: request.headers['idempotency-key'], request, now: new Date() },
        async () => ({
          statusCode: 201,
          body: toInvoiceDto(await service.pay(userId, id, month, request.body?.amount)),
        }),
      );
    },
  );

  app.delete(
    '/:id/invoices/:month/payment',
    {
      schema: {
        tags: [INVOICES_TAG],
        summary: 'Desfaz o pagamento da fatura',
        description:
          'Apaga a transação `invoice-payment`: o valor volta para a conta, as compras voltam a ocupar o limite e a fatura volta ao status pelas datas. Fatura sem pagamento responde 409. Devolve a fatura.',
        params: invoiceParamsSchema,
        response: {
          200: invoiceSchema,
          401: problemDetailsSchema,
          404: problemDetailsSchema,
          409: problemDetailsSchema,
          422: problemDetailsSchema,
        },
      },
    },
    async (request) => {
      const { id, month } = request.params;
      const invoice = await service.undoPayment(currentAuth(request).user.id, id, month);
      return toInvoiceDto(invoice);
    },
  );

  done();
};
