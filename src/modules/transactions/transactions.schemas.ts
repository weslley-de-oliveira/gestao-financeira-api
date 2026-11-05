import { z } from 'zod';
import type { Transaction } from '../../db/schema/index.ts';
import { collapseWhitespace } from '../../shared/utils/text.ts';
import { positiveCentsSchema } from '../../shared/validation/money.ts';
import {
  TRANSACTION_DESCRIPTION_MAX_LENGTH,
  TRANSACTION_NOTES_MAX_LENGTH,
  TRANSACTION_STATUSES,
  TRANSACTION_TYPES,
} from './transactions.constants.ts';

export const transactionStatusSchema = z
  .enum(TRANSACTION_STATUSES, 'Selecione realizada ou pendente.')
  .meta({
    description: '`completed` (realizada, altera o saldo) ou `pending` (pendente, não altera).',
  });

/** Data sem horário, `yyyy-MM-dd`, que exista no calendário (31/02 não passa). */
export const isoDateSchema = z.iso
  .date('Informe uma data válida no formato aaaa-mm-dd.')
  .meta({ example: '2026-11-05' });

/** Transação como a API devolve, com os campos de todos os tipos (os que não se aplicam vêm `null`). */
export const transactionSchema = z
  .object({
    id: z.uuid(),
    type: z.enum(TRANSACTION_TYPES).meta({
      description:
        '`expense` (despesa), `income` (receita), `transfer` (transferência) ou `invoice-payment` (pagamento de fatura).',
    }),
    description: z.string(),
    amount: z.int().meta({ description: 'Centavos, sempre positivo: o tipo define o efeito.' }),
    date: isoDateSchema,
    accountId: z.uuid().nullable(),
    creditCardId: z.uuid().nullable(),
    invoiceMonth: z.string().nullable().meta({ description: 'Mês da fatura paga (`yyyy-MM`).' }),
    destinationAccountId: z.uuid().nullable(),
    categoryId: z.uuid().nullable(),
    status: transactionStatusSchema,
    notes: z.string().nullable(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'Transaction' });

export type TransactionDto = z.infer<typeof transactionSchema>;

/** Descrição com os espaços extras removidos (como no front) antes de checar os limites. */
const descriptionSchema = z
  .string('Informe a descrição.')
  .overwrite(collapseWhitespace)
  .min(1, 'Informe a descrição.')
  .max(
    TRANSACTION_DESCRIPTION_MAX_LENGTH,
    `A descrição deve ter no máximo ${TRANSACTION_DESCRIPTION_MAX_LENGTH} caracteres.`,
  )
  .meta({ example: 'Mercado do mês' });

/** Observações opcionais; vazio ou só espaços vira `null`. */
const notesSchema = z
  .string('Informe as observações como texto.')
  .trim()
  .max(
    TRANSACTION_NOTES_MAX_LENGTH,
    `As observações devem ter no máximo ${TRANSACTION_NOTES_MAX_LENGTH} caracteres.`,
  )
  .nullable()
  .optional()
  .transform((value) => (value === '' ? null : (value ?? null)));

// `strictObject`: campos desconhecidos (ex.: `userId`, `creditCardId`) são rejeitados com 422.
export const createTransactionBodySchema = z.strictObject({
  type: z.enum(['expense', 'income'], 'Selecione despesa ou receita.'),
  description: descriptionSchema,
  amount: positiveCentsSchema,
  date: isoDateSchema,
  accountId: z.uuid('Selecione a conta.'),
  categoryId: z.uuid('Selecione a categoria.'),
  status: transactionStatusSchema.default('completed'),
  notes: notesSchema,
});

export type CreateTransactionInput = z.infer<typeof createTransactionBodySchema>;

export function toTransactionDto(transaction: Transaction): TransactionDto {
  return {
    id: transaction.id,
    type: transaction.type,
    description: transaction.description,
    amount: transaction.amount,
    date: transaction.date,
    accountId: transaction.accountId,
    creditCardId: transaction.creditCardId,
    invoiceMonth: transaction.invoiceMonth,
    destinationAccountId: transaction.destinationAccountId,
    categoryId: transaction.categoryId,
    status: transaction.status,
    notes: transaction.notes,
    createdAt: transaction.createdAt.toISOString(),
  };
}
