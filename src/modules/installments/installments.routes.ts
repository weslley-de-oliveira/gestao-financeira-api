import { z } from 'zod';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { currentAuth, requireSession } from '../../plugins/auth.ts';
import { idempotencyHeadersSchema, idempotent } from '../../shared/http/idempotency.ts';
import { problemDetailsSchema } from '../../shared/http/problem.ts';
import { createAccountsRepository } from '../accounts/accounts.repository.ts';
import { createCategoriesRepository } from '../categories/categories.repository.ts';
import { createCreditCardsRepository } from '../credit-cards/credit-cards.repository.ts';
import { createTransactionsRepository } from '../transactions/transactions.repository.ts';
import { toTransactionDto } from '../transactions/transactions.schemas.ts';
import {
  createTransactionsService,
  type InstallmentPurchaseDetails,
} from '../transactions/transactions.service.ts';
import {
  createInstallmentPurchaseBodySchema,
  installmentPurchaseParamsSchema,
  installmentPurchaseSchema,
  updateInstallmentPurchaseBodySchema,
  type InstallmentPurchaseDto,
} from './installments.schemas.ts';

export const INSTALLMENTS_TAG = 'Compras parceladas';

/** A compra parcelada a partir das parcelas (todas do mesmo grupo, da 1ª à última). */
export function toInstallmentPurchaseDto({
  installments,
  anticipatable,
  cancellations,
}: InstallmentPurchaseDetails): InstallmentPurchaseDto {
  const [first] = installments;
  if (!first?.installmentGroupId || !first.creditCardId || !first.categoryId) {
    throw new Error('Parcelas sem grupo, cartão ou categoria.');
  }
  return {
    id: first.installmentGroupId,
    description: first.description,
    amount: installments.reduce((total, installment) => total + installment.amount, 0),
    installmentCount: first.installmentCount ?? installments.length,
    creditCardId: first.creditCardId,
    categoryId: first.categoryId,
    notes: first.notes,
    installments: installments.map(toTransactionDto),
    anticipatableCount: anticipatable.length,
    cancellable: {
      count: cancellations.length,
      amount: cancellations.reduce((total, cancellation) => total + cancellation.amount, 0),
    },
  };
}

/**
 * Rotas das compras parceladas no cartão, registradas com o prefixo `/v1/installment-purchases`.
 * Cada parcela é uma transação comum (compra no cartão) na fatura do seu mês; a compra é o grupo.
 */
export const installmentsRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  requireSession(app);
  const service = createTransactionsService({
    transactions: createTransactionsRepository(app.db),
    accounts: createAccountsRepository(app.db),
    categories: createCategoriesRepository(app.db),
    creditCards: createCreditCardsRepository(app.db),
    today: () => app.today(),
  });

  app.post(
    '',
    {
      schema: {
        tags: [INSTALLMENTS_TAG],
        summary: 'Registra uma compra parcelada',
        description:
          'Divide o valor total em `installmentCount` parcelas (2 a 24; a sobra dos centavos fica na 1ª), uma por fatura seguida: a 1ª na data da compra e as demais no mesmo dia, ajustado ao ciclo de cada fatura. Cartão e categoria de despesa precisam ser do usuário (senão, 422 no campo) e estar ativos (arquivado responde 409). Se alguma parcela cairia numa fatura já paga, responde 409. Com `Idempotency-Key`, repetir o pedido devolve a mesma compra, sem duplicar as parcelas.',
        headers: idempotencyHeadersSchema,
        body: createInstallmentPurchaseBodySchema,
        response: {
          201: installmentPurchaseSchema,
          401: problemDetailsSchema,
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
          body: toInstallmentPurchaseDto(
            await service.createInstallmentPurchase(userId, request.body),
          ),
        }),
      );
    },
  );

  app.get(
    '/:id',
    {
      schema: {
        tags: [INSTALLMENTS_TAG],
        summary: 'Detalha uma compra parcelada',
        description:
          'O resumo da compra e todas as parcelas, da 1ª à última. Inexistente ou de outro usuário responde 404.',
        params: installmentPurchaseParamsSchema,
        response: {
          200: installmentPurchaseSchema,
          401: problemDetailsSchema,
          404: problemDetailsSchema,
          422: problemDetailsSchema,
        },
      },
    },
    async (request) =>
      toInstallmentPurchaseDto(
        await service.getInstallmentPurchase(currentAuth(request).user.id, request.params.id),
      ),
  );

  app.patch(
    '/:id',
    {
      schema: {
        tags: [INSTALLMENTS_TAG],
        summary: 'Altera a compra parcelada',
        description:
          'Altera descrição, categoria e observações de todas as parcelas, inclusive as de faturas já pagas (esses campos não mudam os valores). Valor, número de parcelas, cartão e data não mudam: exclua a compra e registre de novo. Categoria nova precisa ser de despesa, do usuário (senão, 422) e ativa (arquivada responde 409).',
        params: installmentPurchaseParamsSchema,
        body: updateInstallmentPurchaseBodySchema,
        response: {
          200: installmentPurchaseSchema,
          401: problemDetailsSchema,
          404: problemDetailsSchema,
          409: problemDetailsSchema,
          422: problemDetailsSchema,
        },
      },
    },
    async (request) =>
      toInstallmentPurchaseDto(
        await service.updateInstallmentPurchase(
          currentAuth(request).user.id,
          request.params.id,
          request.body,
        ),
      ),
  );

  app.delete(
    '/:id',
    {
      schema: {
        tags: [INSTALLMENTS_TAG],
        summary: 'Exclui a compra parcelada',
        description:
          'Apaga todas as parcelas. Se alguma estiver numa fatura já paga, responde 409 e nada muda: desfaça o pagamento antes.',
        params: installmentPurchaseParamsSchema,
        response: {
          204: z.null().meta({ description: 'Compra excluída.' }),
          401: problemDetailsSchema,
          404: problemDetailsSchema,
          409: problemDetailsSchema,
          422: problemDetailsSchema,
        },
      },
    },
    async (request, reply) => {
      await service.removeInstallmentPurchase(currentAuth(request).user.id, request.params.id);
      return reply.status(204).send(null);
    },
  );

  done();
};
