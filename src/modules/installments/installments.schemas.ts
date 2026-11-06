import { z } from 'zod';
import { positiveCentsSchema } from '../../shared/validation/money.ts';
import { MAX_INSTALLMENTS, MIN_INSTALLMENTS } from '../transactions/transactions.constants.ts';
import {
  descriptionSchema,
  isoDateSchema,
  notesSchema,
  transactionSchema,
} from '../transactions/transactions.schemas.ts';

/** Compra no cartão em parcelas: o total, a data da compra e o número de parcelas. */
export const createInstallmentPurchaseBodySchema = z
  .strictObject({
    description: descriptionSchema,
    amount: positiveCentsSchema.meta({
      description: 'Valor total da compra, em centavos; a sobra da divisão fica na 1ª parcela.',
    }),
    date: isoDateSchema.meta({ description: 'Data da compra: a data da 1ª parcela.' }),
    creditCardId: z.uuid('Selecione o cartão.'),
    categoryId: z.uuid('Selecione a categoria.'),
    installmentCount: z
      .int('Informe o número de parcelas.')
      .min(MIN_INSTALLMENTS, `Parcele em pelo menos ${MIN_INSTALLMENTS} vezes.`)
      .max(MAX_INSTALLMENTS, `Parcele em no máximo ${MAX_INSTALLMENTS} vezes.`),
    notes: notesSchema,
  })
  .refine((body) => body.amount >= body.installmentCount, {
    path: ['amount'],
    message: 'O valor precisa ter pelo menos R$ 0,01 por parcela.',
  })
  .meta({ id: 'CreateInstallmentPurchase' });

export type CreateInstallmentPurchaseInput = z.infer<typeof createInstallmentPurchaseBodySchema>;

/** O que muda em todas as parcelas: valores, datas e cartão não mudam (exclua e registre de novo). */
export const updateInstallmentPurchaseBodySchema = z
  .strictObject({
    description: descriptionSchema,
    categoryId: z.uuid('Selecione a categoria.'),
    notes: notesSchema,
  })
  .partial()
  .meta({ id: 'UpdateInstallmentPurchase' });

export type UpdateInstallmentPurchaseInput = z.infer<typeof updateInstallmentPurchaseBodySchema>;

export const installmentPurchaseParamsSchema = z.object({
  id: z.uuid('Identificador de compra parcelada inválido.'),
});

/** A compra parcelada: o resumo e as parcelas, da 1ª à última. */
export const installmentPurchaseSchema = z
  .object({
    id: z.uuid().meta({ description: 'O `installmentGroupId` das parcelas.' }),
    description: z.string(),
    amount: z.int().meta({ description: 'Soma das parcelas, em centavos.' }),
    installmentCount: z.int(),
    creditCardId: z.uuid(),
    categoryId: z.uuid(),
    notes: z.string().nullable(),
    installments: z.array(transactionSchema),
  })
  .meta({ id: 'InstallmentPurchase' });

export type InstallmentPurchaseDto = z.infer<typeof installmentPurchaseSchema>;
