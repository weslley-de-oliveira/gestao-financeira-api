import type { IsoDate, IsoMonth } from '../../shared/utils/date.ts';
import type { CreditCardsRepository } from '../credit-cards/credit-cards.repository.ts';
import { CreditCardNotFoundError } from '../credit-cards/credit-cards.service.ts';
import { buildInvoice, listInvoices, type Invoice } from './invoice-rules.ts';
import type { InvoicesRepository } from './invoices.repository.ts';

export interface InvoicesServiceDependencies {
  invoices: InvoicesRepository;
  creditCards: CreditCardsRepository;
  /** Data de hoje (`yyyy-MM-dd`): define o status das faturas. */
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
}

export function createInvoicesService({
  invoices,
  creditCards,
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

  return {
    async list(userId, creditCardId) {
      const { card, movements } = await load(userId, creditCardId);
      return listInvoices(card, movements, today());
    },

    async get(userId, creditCardId, referenceMonth) {
      const { card, movements } = await load(userId, creditCardId);
      return buildInvoice(card, movements, referenceMonth, today());
    },
  };
}
