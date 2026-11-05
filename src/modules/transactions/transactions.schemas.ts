import { z } from 'zod';
import type { Transaction } from '../../db/schema/index.ts';
import { pageQueryFields, pageSchema } from '../../shared/http/pagination.ts';
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

/**
 * Receita ou despesa: categoria obrigatória, do mesmo tipo, e conta **ou** cartão. Despesa no
 * cartão é uma compra: entra na fatura, não move a conta e é sempre realizada.
 */
const entryBodySchema = z
  .strictObject({
    type: z.enum(['expense', 'income']),
    ...commonFields,
    accountId: commonFields.accountId.optional().meta({
      description: 'Conta da receita ou despesa. Ausente nas compras no cartão.',
    }),
    creditCardId: z
      .uuid('Selecione o cartão.')
      .optional()
      .meta({ description: 'Cartão da compra (só despesas). Ausente quando há conta.' }),
    categoryId: z.uuid('Selecione a categoria.'),
  })
  .superRefine((body, context) => {
    if (body.creditCardId && body.type === 'income') {
      context.addIssue({
        code: 'custom',
        path: ['creditCardId'],
        message: 'Receitas não podem ser no cartão: escolha uma conta.',
      });
    } else if (body.creditCardId && body.accountId) {
      context.addIssue({
        code: 'custom',
        path: ['creditCardId'],
        message: 'Informe a conta ou o cartão, não os dois.',
      });
    } else if (!body.creditCardId && !body.accountId) {
      context.addIssue({
        code: 'custom',
        path: ['accountId'],
        message: 'Selecione a conta ou o cartão.',
      });
    }
  })
  .meta({
    id: 'CreateEntry',
    description: 'Receita ou despesa em conta, ou compra no cartão (despesa com `creditCardId`).',
  });

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
    accountId: z
      .uuid('Selecione a conta.')
      .meta({ description: 'Ao informar a conta, a compra deixa de ser no cartão.' }),
    creditCardId: z
      .uuid('Selecione o cartão.')
      .meta({ description: 'Ao informar o cartão, a despesa vira compra e deixa a conta.' }),
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

export const TRANSACTION_SEARCH_MAX_LENGTH = 100;

/** Filtros da listagem, todos opcionais e combináveis, e a página. */
export const listTransactionsQuerySchema = z
  .object({
    ...pageQueryFields,
    from: isoDateSchema.optional().meta({ description: 'Data inicial do período, inclusiva.' }),
    to: isoDateSchema.optional().meta({ description: 'Data final do período, inclusiva.' }),
    type: z
      .enum(TRANSACTION_TYPES, 'Tipo de transação inválido.')
      .optional()
      .meta({ description: 'Só as transações deste tipo.' }),
    status: transactionStatusSchema.optional(),
    accountId: z
      .uuid('Identificador de conta inválido.')
      .optional()
      .meta({ description: 'Transações que saem ou entram nesta conta (origem ou destino).' }),
    creditCardId: z
      .uuid('Identificador de cartão inválido.')
      .optional()
      .meta({ description: 'Compras e pagamentos de fatura deste cartão.' }),
    categoryId: z.uuid('Identificador de categoria inválido.').optional(),
    q: z
      .string()
      .trim()
      .max(
        TRANSACTION_SEARCH_MAX_LENGTH,
        `A busca deve ter no máximo ${TRANSACTION_SEARCH_MAX_LENGTH} caracteres.`,
      )
      .optional()
      // Só espaços: sem busca.
      .transform((value) => (value === '' ? undefined : value))
      .meta({
        description: 'Busca na descrição e nas observações, sem diferenciar maiúsculas e acentos.',
      }),
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    path: ['to'],
    message: 'A data final deve ser igual ou posterior à data inicial.',
  });

export type ListTransactionsQuery = z.infer<typeof listTransactionsQuerySchema>;

export const transactionPageSchema = pageSchema(transactionSchema, 'TransactionPage');

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
