import type { Transaction } from '../../db/schema/index.ts';
import type { IsoDate, IsoMonth } from '../../shared/utils/date.ts';
import {
  invoiceCycleFor,
  invoiceCycleForMonth,
  type CardDays,
  type InvoiceCycle,
} from '../../shared/utils/invoice-cycle.ts';
import type { Cents } from '../../shared/utils/money.ts';

/** Regras de fatura, portadas do front (`invoice-rules.ts`). */
export const INVOICE_STATUSES = ['open', 'closed', 'paid', 'overdue'] as const;

export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

type Card = CardDays & { id: string };

/**
 * Fatura calculada a partir das transações: não é persistida. O total é sempre a soma das compras
 * do ciclo, e o pagamento é a transação `invoice-payment` do cartão e do mês de referência.
 */
export interface Invoice extends InvoiceCycle {
  creditCardId: string;
  total: Cents;
  /** Compras do ciclo, das mais recentes para as mais antigas. */
  purchases: Transaction[];
  payment: Transaction | null;
  status: InvoiceStatus;
}

const isCardPurchase = (transaction: Transaction, creditCardId: string) =>
  transaction.type === 'expense' && transaction.creditCardId === creditCardId;

const isInvoicePayment = (transaction: Transaction, creditCardId: string) =>
  transaction.type === 'invoice-payment' && transaction.creditCardId === creditCardId;

/**
 * Status pela data atual e pelo pagamento: paga quando há pagamento; aberta até a véspera do
 * fechamento; depois, fechada até o vencimento e vencida a partir do dia seguinte.
 */
export function invoiceStatus(
  cycle: Pick<InvoiceCycle, 'closingDate' | 'dueDate'>,
  payment: Transaction | null,
  today: IsoDate,
): InvoiceStatus {
  if (payment) {
    return 'paid';
  }
  if (today < cycle.closingDate) {
    return 'open';
  }
  return today > cycle.dueDate ? 'overdue' : 'closed';
}

export function buildInvoice(
  card: Card,
  transactions: readonly Transaction[],
  referenceMonth: IsoMonth,
  today: IsoDate,
): Invoice {
  const cycle = invoiceCycleForMonth(card, referenceMonth);
  const purchases = transactions
    .filter(
      (transaction) =>
        isCardPurchase(transaction, card.id) &&
        transaction.date >= cycle.start &&
        transaction.date <= cycle.end,
    )
    // O id é UUID v7: no mesmo dia, a registrada por último vem primeiro.
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  const payment = findPayment(card.id, transactions, referenceMonth);

  return {
    ...cycle,
    creditCardId: card.id,
    total: purchases.reduce((total, purchase) => total + purchase.amount, 0),
    purchases,
    payment,
    status: invoiceStatus(cycle, payment, today),
  };
}

/**
 * Faturas de um cartão, da mais recente para a mais antiga: a aberta hoje e todas as que têm
 * compras ou pagamento.
 */
export function listInvoices(
  card: Card,
  transactions: readonly Transaction[],
  today: IsoDate,
): Invoice[] {
  const months = new Set([invoiceCycleFor(card, today).referenceMonth]);
  for (const transaction of transactions) {
    if (isCardPurchase(transaction, card.id)) {
      months.add(invoiceCycleFor(card, transaction.date).referenceMonth);
    } else if (isInvoicePayment(transaction, card.id) && transaction.invoiceMonth) {
      months.add(transaction.invoiceMonth);
    }
  }
  return [...months]
    .sort((a, b) => b.localeCompare(a))
    .map((month) => buildInvoice(card, transactions, month, today));
}

/** Só se paga o valor total de uma fatura já fechada, com compras e ainda sem pagamento. */
export function canPayInvoice(invoice: Pick<Invoice, 'status' | 'total'>): boolean {
  return (invoice.status === 'closed' || invoice.status === 'overdue') && invoice.total > 0;
}

/**
 * Uma compra numa fatura já paga não pode ser criada, alterada nem excluída: o total pago
 * deixaria de conferir com os itens. Desfaça o pagamento antes.
 */
export function isInvoicePaidFor(
  card: Card,
  transactions: readonly Transaction[],
  purchaseDate: IsoDate,
): boolean {
  const { referenceMonth } = invoiceCycleFor(card, purchaseDate);
  return findPayment(card.id, transactions, referenceMonth) !== null;
}

function findPayment(
  creditCardId: string,
  transactions: readonly Transaction[],
  referenceMonth: IsoMonth,
): Transaction | null {
  return (
    transactions.find(
      (transaction) =>
        isInvoicePayment(transaction, creditCardId) && transaction.invoiceMonth === referenceMonth,
    ) ?? null
  );
}
