import { z } from 'zod';
import { invoiceCycleSchema } from '../credit-cards/credit-cards.schemas.ts';
import { toTransactionDto, transactionSchema } from '../transactions/transactions.schemas.ts';
import { INVOICE_STATUSES, type Invoice } from './invoice-rules.ts';

const invoiceFields = invoiceCycleSchema.extend({
  creditCardId: z.uuid(),
  total: z.int().meta({
    description:
      'Compras − estornos do ciclo, em centavos (negativo: os estornos superam as compras).',
  }),
  previousBalance: z.int().meta({
    description:
      'Saldo da fatura anterior, trazido no fechamento desta (zero enquanto aberta): positivo é o que faltou pagar; negativo, crédito.',
  }),
  amountDue: z.int().meta({ description: 'Total a pagar: saldo anterior + total do ciclo.' }),
  paidAmount: z.int().meta({ description: 'Soma dos pagamentos da fatura.' }),
  balance: z.int().meta({
    description:
      'Total a pagar − pago: positivo é o que falta pagar; negativo, crédito. Passa para a fatura seguinte no fechamento dela.',
  }),
  status: z.enum(INVOICE_STATUSES).meta({
    description:
      '`open` (aberta, até a véspera do fechamento), `paid` (fechada sem saldo a pagar), `closed` (fechada com saldo, até o vencimento), `overdue` (vencida com saldo, até o fechamento da seguinte) ou `carried-over` (o saldo passou para a fatura seguinte).',
  }),
  payment: transactionSchema
    .nullable()
    .meta({ description: 'O pagamento (`invoice-payment`) mais recente da fatura, se houver.' }),
});

/** Fatura na listagem: sem as compras, só a quantidade. */
export const invoiceSummarySchema = invoiceFields
  .extend({ purchaseCount: z.int() })
  .meta({ id: 'InvoiceSummary' });

/** Fatura completa, com as compras do ciclo (das mais recentes para as mais antigas). */
export const invoiceSchema = invoiceFields
  .extend({
    purchases: z.array(transactionSchema),
    refunds: z.array(transactionSchema).meta({ description: 'Estornos lançados no ciclo.' }),
    payments: z
      .array(transactionSchema)
      .meta({ description: 'Pagamentos da fatura, do mais recente para o mais antigo.' }),
  })
  .meta({ id: 'Invoice' });

export type InvoiceSummaryDto = z.infer<typeof invoiceSummarySchema>;
export type InvoiceDto = z.infer<typeof invoiceSchema>;

export const invoiceListSchema = z.array(invoiceSummarySchema);

export const cardInvoicesParamsSchema = z.object({
  id: z.uuid('Identificador de cartão inválido.'),
});

export const invoiceParamsSchema = cardInvoicesParamsSchema.extend({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Informe o mês no formato aaaa-mm.')
    .meta({
      description: 'Mês de referência da fatura (o mês do vencimento).',
      example: '2026-12',
    }),
});

function toInvoiceFields(invoice: Invoice) {
  return {
    referenceMonth: invoice.referenceMonth,
    start: invoice.start,
    end: invoice.end,
    closingDate: invoice.closingDate,
    dueDate: invoice.dueDate,
    creditCardId: invoice.creditCardId,
    total: invoice.total,
    previousBalance: invoice.previousBalance,
    amountDue: invoice.amountDue,
    paidAmount: invoice.paidAmount,
    balance: invoice.balance,
    status: invoice.status,
    payment: invoice.payment ? toTransactionDto(invoice.payment) : null,
  };
}

export function toInvoiceSummaryDto(invoice: Invoice): InvoiceSummaryDto {
  return { ...toInvoiceFields(invoice), purchaseCount: invoice.purchases.length };
}

export function toInvoiceDto(invoice: Invoice): InvoiceDto {
  return {
    ...toInvoiceFields(invoice),
    purchases: invoice.purchases.map(toTransactionDto),
    refunds: invoice.refunds.map(toTransactionDto),
    payments: invoice.payments.map(toTransactionDto),
  };
}
