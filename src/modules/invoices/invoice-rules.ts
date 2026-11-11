import type { Transaction } from '../../db/schema/index.ts';
import { parseIsoMonth, toIsoMonth, type IsoDate, type IsoMonth } from '../../shared/utils/date.ts';
import {
  invoiceCycleFor,
  invoiceCycleForMonth,
  type CardDays,
  type InvoiceCycle,
} from '../../shared/utils/invoice-cycle.ts';
import type { Cents } from '../../shared/utils/money.ts';

/** Regras de fatura, portadas do front (`invoice-rules.ts`). */
export const INVOICE_STATUSES = ['open', 'closed', 'paid', 'overdue', 'carried-over'] as const;

export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

type Card = CardDays & { id: string };

/**
 * Fatura calculada a partir das transações: não é persistida. O total é a soma das compras do
 * ciclo menos os estornos lançados nele. O saldo que sobra (o que faltou pagar, ou o crédito)
 * passa para a fatura seguinte quando ela fecha, como saldo anterior. Os pagamentos são as
 * transações `invoice-payment` do cartão e do mês de referência.
 */
export interface Invoice extends InvoiceCycle {
  creditCardId: string;
  /** Compras − estornos do ciclo; negativo quando os estornos superam as compras. */
  total: Cents;
  /**
   * Saldo da fatura anterior, trazido no fechamento desta (zero enquanto ela está aberta):
   * positivo é o que faltou pagar; negativo, crédito.
   */
  previousBalance: Cents;
  /** Saldo anterior + total do ciclo. */
  amountDue: Cents;
  /** Soma dos pagamentos. */
  paidAmount: Cents;
  /** Total a pagar − pago: positivo é o que falta pagar; negativo, crédito. */
  balance: Cents;
  /** Compras do ciclo, das mais recentes para as mais antigas. */
  purchases: Transaction[];
  /** Estornos lançados no ciclo, dos mais recentes para os mais antigos. */
  refunds: Transaction[];
  /** Pagamentos, do mais recente para o mais antigo. */
  payments: Transaction[];
  /** O pagamento mais recente. */
  payment: Transaction | null;
  status: InvoiceStatus;
}

const isCardPurchase = (transaction: Transaction, creditCardId: string) =>
  transaction.type === 'expense' && transaction.creditCardId === creditCardId;

const isCardRefund = (transaction: Transaction, creditCardId: string) =>
  transaction.type === 'refund' && transaction.creditCardId === creditCardId;

const isInvoicePayment = (transaction: Transaction, creditCardId: string) =>
  transaction.type === 'invoice-payment' && transaction.creditCardId === creditCardId;

/**
 * Status pela data atual e pelo saldo:
 * - aberta até a véspera do fechamento;
 * - paga quando fechada sem saldo a pagar (inclui a zerada pelos estornos e a com crédito);
 * - com saldo: fechada até o vencimento, vencida depois dele e transferida a partir do fechamento
 *   da fatura seguinte, quando o saldo passa para ela.
 */
export function invoiceStatus(
  cycle: Pick<InvoiceCycle, 'closingDate' | 'dueDate'>,
  balance: Cents,
  nextClosingDate: IsoDate,
  today: IsoDate,
): InvoiceStatus {
  if (today < cycle.closingDate) {
    return 'open';
  }
  if (balance <= 0) {
    return 'paid';
  }
  if (today >= nextClosingDate) {
    return 'carried-over';
  }
  return today > cycle.dueDate ? 'overdue' : 'closed';
}

/** Fatura de um mês de referência, com o saldo trazido das anteriores. */
export function buildInvoice(
  card: Card,
  transactions: readonly Transaction[],
  referenceMonth: IsoMonth,
  today: IsoDate,
): Invoice {
  const invoice = invoiceChain(card, transactions, today, referenceMonth).get(referenceMonth);
  if (!invoice) {
    throw new RangeError(`Invalid reference month: ${referenceMonth}`);
  }
  return invoice;
}

/**
 * Faturas de um cartão, da mais recente para a mais antiga: a aberta hoje e todas as que têm
 * compras, estornos, pagamentos ou saldo anterior.
 */
export function listInvoices(
  card: Card,
  transactions: readonly Transaction[],
  today: IsoDate,
): Invoice[] {
  const groups = groupByInvoice(card, transactions);
  const current = invoiceCycleFor(card, today).referenceMonth;
  return [...invoiceChain(card, transactions, today).values()]
    .filter(
      (invoice) =>
        invoice.referenceMonth === current ||
        groups.has(invoice.referenceMonth) ||
        invoice.previousBalance !== 0,
    )
    .reverse();
}

/** Paga-se, em uma ou mais partes, a fatura fechada ou vencida que ainda tem saldo. */
export function canPayInvoice(invoice: Pick<Invoice, 'status' | 'balance'>): boolean {
  return (invoice.status === 'closed' || invoice.status === 'overdue') && invoice.balance > 0;
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
  return transactions.some(
    (transaction) =>
      isInvoicePayment(transaction, card.id) && transaction.invoiceMonth === referenceMonth,
  );
}

/** "2026-12" → "2027-01". */
export function nextMonth(month: IsoMonth): IsoMonth {
  const parsed = parseIsoMonth(month);
  if (!parsed) {
    throw new RangeError(`Invalid month: ${month}`);
  }
  return toIsoMonth(new Date(Date.UTC(parsed.year, parsed.month + 1, 1)));
}

interface InvoiceItems {
  purchases: Transaction[];
  refunds: Transaction[];
  payments: Transaction[];
}

/** Compras e estornos pela fatura da data; pagamentos pelo mês da fatura paga. */
function groupByInvoice(card: Card, transactions: readonly Transaction[]) {
  const groups = new Map<IsoMonth, InvoiceItems>();
  const add = (month: IsoMonth, key: keyof InvoiceItems, transaction: Transaction) => {
    const group = groups.get(month) ?? { purchases: [], refunds: [], payments: [] };
    group[key].push(transaction);
    groups.set(month, group);
  };
  for (const transaction of transactions) {
    if (isCardPurchase(transaction, card.id)) {
      add(invoiceCycleFor(card, transaction.date).referenceMonth, 'purchases', transaction);
    } else if (isCardRefund(transaction, card.id)) {
      add(invoiceCycleFor(card, transaction.date).referenceMonth, 'refunds', transaction);
    } else if (isInvoicePayment(transaction, card.id) && transaction.invoiceMonth) {
      add(transaction.invoiceMonth, 'payments', transaction);
    }
  }
  return groups;
}

/**
 * Todas as faturas, mês a mês, da primeira com movimentação até a última (ou até `until`), em
 * ordem cronológica. O saldo de cada uma entra na seguinte quando a seguinte fecha.
 */
function invoiceChain(
  card: Card,
  transactions: readonly Transaction[],
  today: IsoDate,
  until?: IsoMonth,
): Map<IsoMonth, Invoice> {
  const groups = groupByInvoice(card, transactions);
  const months = [...groups.keys(), invoiceCycleFor(card, today).referenceMonth];
  if (until) {
    months.push(until);
  }
  months.sort();
  const first = months[0];
  const last = months.at(-1);
  const chain = new Map<IsoMonth, Invoice>();
  if (!first || !last) {
    return chain;
  }

  let carried = 0;
  for (let month = first; month <= last; month = nextMonth(month)) {
    const cycle = invoiceCycleForMonth(card, month);
    const items = groups.get(month) ?? { purchases: [], refunds: [], payments: [] };
    const purchases = newestFirst(items.purchases);
    const refunds = newestFirst(items.refunds);
    const payments = newestFirst(items.payments);
    const total = sum(purchases) - sum(refunds);
    const previousBalance = today >= cycle.closingDate ? carried : 0;
    const amountDue = previousBalance + total;
    const paidAmount = sum(payments);
    const balance = amountDue - paidAmount;
    const nextClosingDate = invoiceCycleForMonth(card, nextMonth(month)).closingDate;
    chain.set(month, {
      ...cycle,
      creditCardId: card.id,
      total,
      previousBalance,
      amountDue,
      paidAmount,
      balance,
      purchases,
      refunds,
      payments,
      payment: payments[0] ?? null,
      status: invoiceStatus(cycle, balance, nextClosingDate, today),
    });
    carried = balance;
  }
  return chain;
}

/** O id é UUID v7: no mesmo dia, a registrada por último vem primeiro. */
function newestFirst(transactions: readonly Transaction[]): Transaction[] {
  return [...transactions].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
}

function sum(transactions: readonly Transaction[]): Cents {
  return transactions.reduce((total, transaction) => total + transaction.amount, 0);
}
