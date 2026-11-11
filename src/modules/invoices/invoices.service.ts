import { DomainError, InvalidInputError } from '../../shared/errors/domain-error.ts';
import { LATER_INVOICE_PAYMENT_PROBLEM_TYPE } from '../../shared/http/problem.ts';
import { formatIsoDate, monthLabel, type IsoDate, type IsoMonth } from '../../shared/utils/date.ts';
import { formatCents, type Cents } from '../../shared/utils/money.ts';
import type { AccountsRepository } from '../accounts/accounts.repository.ts';
import type { CreditCardsRepository } from '../credit-cards/credit-cards.repository.ts';
import { CreditCardNotFoundError } from '../credit-cards/credit-cards.service.ts';
import {
  buildInvoice,
  canPayInvoice,
  listInvoices,
  nextMonth,
  type Invoice,
} from './invoice-rules.ts';
import type { InvoicesRepository } from './invoices.repository.ts';

/** A fatura não pode ser paga agora: aberta, sem saldo a pagar ou com o saldo já transferido. */
export class InvoiceNotPayableError extends DomainError {
  readonly kind = 'conflict';
}

/**
 * Desfazer o pagamento de uma fatura com uma fatura posterior paga: o saldo desta entra na
 * seguinte, então o pagamento da posterior deixaria de conferir. Desfaça os posteriores antes.
 */
export class LaterInvoicePaymentError extends DomainError {
  readonly kind = 'conflict';
  override readonly problemType = LATER_INVOICE_PAYMENT_PROBLEM_TYPE;

  constructor(laterMonth: IsoMonth) {
    super(
      `A fatura de ${monthLabel(laterMonth)} já tem pagamento. Desfaça antes os pagamentos das faturas seguintes.`,
    );
  }
}

/** A conta de pagamento do cartão está arquivada: reative-a ou troque a conta do cartão. */
export class PaymentAccountUnavailableError extends DomainError {
  readonly kind = 'conflict';

  constructor(accountName: string) {
    super(
      `A conta de pagamento "${accountName}" está arquivada. Reative-a ou troque a conta de pagamento do cartão.`,
    );
  }
}

/** "Fatura Roxinho 11/2026", com " (parcial)" quando o pagamento não quita o saldo. */
export function paymentDescription(cardName: string, referenceMonth: IsoMonth, partial: boolean) {
  return `Fatura ${cardName} ${monthLabel(referenceMonth)}${partial ? ' (parcial)' : ''}`;
}

export interface InvoicesServiceDependencies {
  invoices: InvoicesRepository;
  creditCards: CreditCardsRepository;
  accounts: AccountsRepository;
  /** Data de hoje (`yyyy-MM-dd`): define o status das faturas e a data do pagamento. */
  today: () => IsoDate;
}

export interface InvoicesService {
  /**
   * Faturas do cartão, da mais recente para a mais antiga: a aberta hoje e as que têm compras ou
   * pagamento. Cartão inexistente ou de outro usuário → `CreditCardNotFoundError`.
   */
  list(userId: string, creditCardId: string): Promise<Invoice[]>;
  /** Fatura do mês de referência (`yyyy-MM`, mês do vencimento), com as compras. */
  get(userId: string, creditCardId: string, referenceMonth: IsoMonth): Promise<Invoice>;
  /**
   * Paga a fatura, hoje, com a conta de pagamento do cartão: `amount` (até o saldo; acima →
   * `InvalidInputError` no `amount`) ou, sem ele, o saldo inteiro. Só fatura fechada ou vencida
   * com saldo a pagar (senão, `InvoiceNotPayableError`). O que faltar passa para a fatura seguinte
   * no fechamento dela. Devolve a fatura.
   */
  pay(
    userId: string,
    creditCardId: string,
    referenceMonth: IsoMonth,
    amount?: Cents,
  ): Promise<Invoice>;
  /**
   * Desfaz o pagamento mais recente: o valor volta para a conta e para o limite, e a fatura volta
   * ao status pelas datas e pelo saldo. Sem pagamento → `InvoiceNotPayableError`; com pagamento
   * numa fatura posterior → `LaterInvoicePaymentError`. Devolve a fatura.
   */
  undoPayment(userId: string, creditCardId: string, referenceMonth: IsoMonth): Promise<Invoice>;
}

export function createInvoicesService({
  invoices,
  creditCards,
  accounts,
  today,
}: InvoicesServiceDependencies): InvoicesService {
  async function findCard(userId: string, creditCardId: string) {
    const card = await creditCards.findCreditCard(userId, creditCardId);
    if (!card) {
      throw new CreditCardNotFoundError();
    }
    return card;
  }

  /** Cartão do usuário e as movimentações que formam as faturas dele. */
  async function load(userId: string, creditCardId: string) {
    const card = await findCard(userId, creditCardId);
    return { card, movements: await invoices.listCardMovements(userId, creditCardId) };
  }

  async function get(userId: string, creditCardId: string, referenceMonth: IsoMonth) {
    const { card, movements } = await load(userId, creditCardId);
    return buildInvoice(card, movements, referenceMonth, today());
  }

  /** Por que a fatura não pode ser paga, com a mesma regra de `canPayInvoice`. */
  function notPayable(invoice: Invoice): InvoiceNotPayableError {
    if (invoice.status === 'open') {
      return new InvoiceNotPayableError(
        `A fatura ainda está aberta: ela pode ser paga a partir do fechamento, em ${formatIsoDate(invoice.closingDate)}.`,
      );
    }
    if (invoice.status === 'carried-over') {
      return new InvoiceNotPayableError(
        `O saldo desta fatura passou para a fatura de ${monthLabel(nextMonth(invoice.referenceMonth))}: pague por ela.`,
      );
    }
    return new InvoiceNotPayableError(
      invoice.paidAmount > 0 ? 'Esta fatura já foi paga.' : 'A fatura não tem saldo a pagar.',
    );
  }

  return {
    async list(userId, creditCardId) {
      const { card, movements } = await load(userId, creditCardId);
      return listInvoices(card, movements, today());
    },

    get,

    async pay(userId, creditCardId, referenceMonth, amount) {
      const card = await findCard(userId, creditCardId);
      const date = today();
      const account = await accounts.findAccount(userId, card.paymentAccountId);

      await invoices.withLockedCard(userId, creditCardId, async ({ movements, insertPayment }) => {
        // Com o cartão travado, um pagamento simultâneo da mesma fatura já aparece aqui.
        const invoice = buildInvoice(card, movements, referenceMonth, date);
        if (!canPayInvoice(invoice)) {
          throw notPayable(invoice);
        }
        if (!account || account.isArchived) {
          throw new PaymentAccountUnavailableError(account?.name ?? '');
        }
        const paid = amount ?? invoice.balance;
        if (paid > invoice.balance) {
          throw new InvalidInputError([
            {
              field: 'amount',
              message: `O pagamento pode ser de no máximo ${formatCents(invoice.balance)}, o saldo da fatura.`,
            },
          ]);
        }
        await insertPayment({
          userId,
          type: 'invoice-payment',
          description: paymentDescription(card.name, referenceMonth, paid < invoice.balance),
          amount: paid,
          date,
          accountId: account.id,
          creditCardId: card.id,
          invoiceMonth: referenceMonth,
          status: 'completed',
        });
      });
      return get(userId, creditCardId, referenceMonth);
    },

    async undoPayment(userId, creditCardId, referenceMonth) {
      // Garante que o cartão é do usuário antes de apagar.
      const card = await findCard(userId, creditCardId);
      await invoices.withLockedCard(userId, creditCardId, async ({ movements, deletePayment }) => {
        const { payment } = buildInvoice(card, movements, referenceMonth, today());
        if (!payment) {
          throw new InvoiceNotPayableError('Esta fatura não tem pagamento para desfazer.');
        }
        const [later] = movements
          .filter(({ type }) => type === 'invoice-payment')
          .flatMap(({ invoiceMonth }) =>
            invoiceMonth && invoiceMonth > referenceMonth ? [invoiceMonth] : [],
          )
          .toSorted();
        if (later) {
          throw new LaterInvoicePaymentError(later);
        }
        await deletePayment(payment.id);
      });
      return get(userId, creditCardId, referenceMonth);
    },
  };
}
