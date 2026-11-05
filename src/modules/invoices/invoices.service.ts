import { DomainError } from '../../shared/errors/domain-error.ts';
import { formatIsoDate, monthLabel, type IsoDate, type IsoMonth } from '../../shared/utils/date.ts';
import type { AccountsRepository } from '../accounts/accounts.repository.ts';
import type { CreditCardsRepository } from '../credit-cards/credit-cards.repository.ts';
import { CreditCardNotFoundError } from '../credit-cards/credit-cards.service.ts';
import { buildInvoice, canPayInvoice, listInvoices, type Invoice } from './invoice-rules.ts';
import type { InvoicesRepository } from './invoices.repository.ts';

/** A fatura não pode ser paga agora: aberta, sem compras ou já paga. */
export class InvoiceNotPayableError extends DomainError {
  readonly kind = 'conflict';
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
   * Paga a fatura pelo valor total, hoje, com a conta de pagamento do cartão. Só fatura fechada ou
   * vencida, com compras e sem pagamento (senão, `InvoiceNotPayableError`). Devolve a fatura paga.
   */
  pay(userId: string, creditCardId: string, referenceMonth: IsoMonth): Promise<Invoice>;
}

export function createInvoicesService({
  invoices,
  creditCards,
  accounts,
  today,
}: InvoicesServiceDependencies): InvoicesService {
  /** Cartão do usuário e as movimentações que formam as faturas dele. */
  async function load(userId: string, creditCardId: string) {
    const card = await creditCards.findCreditCard(userId, creditCardId);
    if (!card) {
      throw new CreditCardNotFoundError();
    }
    return { card, movements: await invoices.listCardMovements(userId, creditCardId) };
  }

  async function get(userId: string, creditCardId: string, referenceMonth: IsoMonth) {
    const { card, movements } = await load(userId, creditCardId);
    return buildInvoice(card, movements, referenceMonth, today());
  }

  /** Por que a fatura não pode ser paga, com a mesma regra de `canPayInvoice`. */
  function notPayable(invoice: Invoice): InvoiceNotPayableError {
    if (invoice.status === 'paid') {
      return new InvoiceNotPayableError('Esta fatura já foi paga.');
    }
    if (invoice.status === 'open') {
      return new InvoiceNotPayableError(
        `A fatura ainda está aberta: ela pode ser paga a partir do fechamento, em ${formatIsoDate(invoice.closingDate)}.`,
      );
    }
    return new InvoiceNotPayableError('A fatura não tem compras para pagar.');
  }

  return {
    async list(userId, creditCardId) {
      const { card, movements } = await load(userId, creditCardId);
      return listInvoices(card, movements, today());
    },

    get,

    async pay(userId, creditCardId, referenceMonth) {
      const { card, movements } = await load(userId, creditCardId);
      const date = today();
      const invoice = buildInvoice(card, movements, referenceMonth, date);
      if (!canPayInvoice(invoice)) {
        throw notPayable(invoice);
      }
      const account = await accounts.findAccount(userId, card.paymentAccountId);
      if (!account || account.isArchived) {
        throw new PaymentAccountUnavailableError(account?.name ?? '');
      }

      const payment = await invoices.insertPayment({
        userId,
        type: 'invoice-payment',
        description: `Fatura ${card.name} ${monthLabel(referenceMonth)}`,
        amount: invoice.total,
        date,
        accountId: account.id,
        creditCardId: card.id,
        invoiceMonth: referenceMonth,
        status: 'completed',
      });
      if (!payment) {
        // Outro pagamento da mesma fatura entrou entre a consulta e a gravação.
        throw new InvoiceNotPayableError('Esta fatura já foi paga.');
      }
      return get(userId, creditCardId, referenceMonth);
    },
  };
}
