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

/** Campos comuns a todos os tipos que a pessoa cadastra. */
const commonFields = {
  description: descriptionSchema,
  amount: positiveCentsSchema,
  date: isoDateSchema,
  accountId: z.uuid('Selecione a conta.'),
  status: transactionStatusSchema.default('completed'),
  notes: notesSchema,
};

/** Receita ou despesa em conta: categoria obrigatória, do mesmo tipo. */
const entryBodySchema = z
  .strictObject({
    type: z.enum(['expense', 'income']),
    ...commonFields,
    categoryId: z.uuid('Selecione a categoria.'),
  })
  .meta({ id: 'CreateEntry', description: 'Receita ou despesa em conta.' });

/** Transferência: sai de `accountId` e entra em `destinationAccountId`, sem categoria. */
const transferBodySchema = z
  .strictObject({
    type: z.literal('transfer'),
    ...commonFields,
    accountId: z.uuid('Selecione a conta de origem.'),
    destinationAccountId: z.uuid('Selecione a conta de destino.'),
  })
  .refine((body) => body.accountId !== body.destinationAccountId, {
    path: ['destinationAccountId'],
    message: 'Escolha uma conta diferente da conta de origem.',
  })
  .meta({ id: 'CreateTransfer', description: 'Transferência entre duas contas do usuário.' });

// `strictObject`: campos de outro tipo (ex.: `categoryId` numa transferência) e desconhecidos
// (ex.: `userId`) são rejeitados com 422.
export const createTransactionBodySchema = z.discriminatedUnion(
  'type',
  [entryBodySchema, transferBodySchema],
  { error: 'Selecione despesa, receita ou transferência.' },
);

export type CreateTransactionInput = z.infer<typeof createTransactionBodySchema>;
export type CreateEntryInput = z.infer<typeof entryBodySchema>;
export type CreateTransferInput = z.infer<typeof transferBodySchema>;

/**
 * Edição parcial. Os campos enviados são aplicados sobre a transação atual e o resultado passa
 * pelas mesmas regras do cadastro. Ao trocar o tipo, os campos que não servem ao novo tipo são
 * descartados (ex.: a categoria, ao virar transferência), como no formulário do front.
 */
export const updateTransactionBodySchema = z
  .strictObject({
    type: z.enum(['expense', 'income', 'transfer'], 'Selecione despesa, receita ou transferência.'),
    description: descriptionSchema,
    amount: positiveCentsSchema,
    date: isoDateSchema,
    accountId: z.uuid('Selecione a conta.'),
    destinationAccountId: z.uuid('Selecione a conta de destino.'),
    categoryId: z.uuid('Selecione a categoria.'),
    status: transactionStatusSchema,
    notes: notesSchema,
  })
  .partial();

export type UpdateTransactionInput = z.infer<typeof updateTransactionBodySchema>;

export const transactionParamsSchema = z.object({
  id: z.uuid('Identificador de transação inválido.'),
});

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
