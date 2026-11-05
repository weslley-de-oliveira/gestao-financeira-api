import { z } from 'zod';
import type { CreditCard } from '../../db/schema/index.ts';
import { APPEARANCE_COLORS } from '../../shared/models/appearance.ts';
import { MAX_MONEY_CENTS } from '../../shared/utils/money.ts';
import { collapseWhitespace } from '../../shared/utils/text.ts';
import { booleanQueryParam } from '../../shared/validation/query.ts';
import type { CardUsage } from './card-usage.ts';
import {
  CARD_BRANDS,
  CREDIT_CARD_NAME_MAX_LENGTH,
  MAX_CARD_DAY,
  MIN_CARD_DAY,
} from './credit-cards.constants.ts';

const brandSchema = z.enum(CARD_BRANDS, 'Selecione a bandeira.');
const colorSchema = z.enum(APPEARANCE_COLORS, 'Selecione uma cor válida.');

/** Dia do mês de 1 a 31; em meses mais curtos, vale o último dia. */
function cardDaySchema(requiredMessage: string) {
  return z
    .int(requiredMessage)
    .min(MIN_CARD_DAY, `Informe um dia entre ${MIN_CARD_DAY} e ${MAX_CARD_DAY}.`)
    .max(MAX_CARD_DAY, `Informe um dia entre ${MIN_CARD_DAY} e ${MAX_CARD_DAY}.`);
}

/** Período de uma fatura: compras de `start` a `end`, fechamento e vencimento. */
export const invoiceCycleSchema = z.object({
  referenceMonth: z.string().meta({
    description: 'Mês do vencimento (`yyyy-MM`): a "fatura de dezembro" vence em dezembro.',
    example: '2026-12',
  }),
  start: z.iso.date().meta({ description: 'Primeiro dia de compras (o fechamento anterior).' }),
  end: z.iso.date().meta({ description: 'Último dia de compras (a véspera do fechamento).' }),
  closingDate: z.iso.date(),
  dueDate: z.iso.date(),
});

/** Cartão como a API devolve. Só os quatro últimos dígitos existem: nunca o número completo. */
export const creditCardSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    brand: brandSchema,
    lastFourDigits: z.string().meta({ example: '4321' }),
    creditLimit: z.int().meta({ description: 'Limite em centavos.' }),
    closingDay: z.int().meta({ description: 'Dia do fechamento da fatura.' }),
    dueDay: z.int().meta({ description: 'Dia do vencimento da fatura.' }),
    paymentAccountId: z.uuid().meta({ description: 'Conta que paga as faturas.' }),
    color: colorSchema,
    isArchived: z.boolean(),
    createdAt: z.iso.datetime(),
    usedLimit: z.int().meta({
      description: 'Compras ainda não pagas, em centavos: compras menos faturas pagas.',
    }),
    availableLimit: z.int().meta({
      description: 'Limite menos o utilizado; negativo quando o limite foi ultrapassado.',
    }),
    nextInvoice: invoiceCycleSchema
      .extend({
        amount: z.int().meta({ description: 'Compras já lançadas nesta fatura, em centavos.' }),
      })
      .meta({ id: 'NextInvoice', description: 'A fatura aberta hoje.' }),
  })
  .meta({ id: 'CreditCard' });

export type CreditCardDto = z.infer<typeof creditCardSchema>;

export const creditCardListSchema = z.array(creditCardSchema);

export const creditCardParamsSchema = z.object({
  id: z.uuid('Identificador de cartão inválido.'),
});

export const listCreditCardsQuerySchema = z.object({
  includeArchived: booleanQueryParam(
    'Inclui os cartões arquivados na lista (padrão: só os ativos).',
  ),
});

export type ListCreditCardsQuery = z.infer<typeof listCreditCardsQuerySchema>;

/** Campos editáveis, com as mesmas regras e mensagens do formulário do front. */
const creditCardFields = {
  name: z
    .string('Informe o apelido do cartão.')
    .overwrite(collapseWhitespace)
    .min(1, 'Informe o apelido do cartão.')
    .max(
      CREDIT_CARD_NAME_MAX_LENGTH,
      `O apelido deve ter no máximo ${CREDIT_CARD_NAME_MAX_LENGTH} caracteres.`,
    )
    .meta({ example: 'Roxinho' }),
  brand: brandSchema,
  lastFourDigits: z
    .string('Informe os quatro últimos dígitos.')
    .regex(/^\d{4}$/, 'Informe exatamente quatro números.')
    .meta({ description: 'Só os quatro últimos dígitos do cartão.', example: '4321' }),
  creditLimit: z
    .int('Informe o limite em centavos inteiros.')
    .min(1, 'O limite deve ser maior que zero.')
    .max(MAX_MONEY_CENTS, 'O valor deve ser de até R$ 1 bilhão.')
    .meta({ description: 'Limite em centavos.', example: 500_000 }),
  closingDay: cardDaySchema('Selecione o dia de fechamento.'),
  dueDay: cardDaySchema('Selecione o dia de vencimento.'),
  paymentAccountId: z.uuid('Selecione a conta de pagamento.'),
  color: colorSchema,
};

// `strictObject`: campos desconhecidos (ex.: `userId`, o número completo) são rejeitados com 422.
export const createCreditCardBodySchema = z
  .strictObject(creditCardFields)
  .refine((card) => card.dueDay !== card.closingDay, {
    path: ['dueDay'],
    message: 'O vencimento deve ser diferente do fechamento.',
  });

export type CreateCreditCardInput = z.infer<typeof createCreditCardBodySchema>;

/**
 * Edição parcial. Os campos enviados são aplicados sobre o cartão e o resultado passa pelas regras
 * do cadastro (ex.: fechamento e vencimento diferentes, mesmo trocando só um deles).
 * `isArchived` arquiva ou reativa: cartões não são excluídos.
 */
export const updateCreditCardBodySchema = z
  .strictObject({
    ...creditCardFields,
    isArchived: z.boolean('Informe true ou false.').meta({
      description: 'true arquiva o cartão (não aceita novas compras); false o reativa.',
    }),
  })
  .partial();

export type UpdateCreditCardInput = z.infer<typeof updateCreditCardBodySchema>;

export function toCreditCardDto(card: CreditCard & CardUsage): CreditCardDto {
  return {
    id: card.id,
    name: card.name,
    brand: card.brand,
    lastFourDigits: card.lastFourDigits,
    creditLimit: card.creditLimit,
    closingDay: card.closingDay,
    dueDay: card.dueDay,
    paymentAccountId: card.paymentAccountId,
    // As constraints do banco garantem que a cor está na paleta.
    color: card.color as CreditCardDto['color'],
    isArchived: card.isArchived,
    createdAt: card.createdAt.toISOString(),
    usedLimit: card.usedLimit,
    availableLimit: card.availableLimit,
    nextInvoice: card.nextInvoice,
  };
}
