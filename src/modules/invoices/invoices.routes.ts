import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { currentAuth, requireSession } from '../../plugins/auth.ts';
import { problemDetailsSchema } from '../../shared/http/problem.ts';
import { createCreditCardsRepository } from '../credit-cards/credit-cards.repository.ts';
import { createInvoicesRepository } from './invoices.repository.ts';
import {
  cardInvoicesParamsSchema,
  invoiceListSchema,
  invoiceParamsSchema,
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

  done();
};
