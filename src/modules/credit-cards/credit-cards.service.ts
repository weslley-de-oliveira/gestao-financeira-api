import type { CreditCard } from '../../db/schema/index.ts';
import { DomainError, InvalidInputError } from '../../shared/errors/domain-error.ts';
import type { IsoDate } from '../../shared/utils/date.ts';
import { invoiceCycleFor } from '../../shared/utils/invoice-cycle.ts';
import type { AccountsRepository } from '../accounts/accounts.repository.ts';
import type { CardUsage } from './card-usage.ts';
import type { CreditCardsRepository } from './credit-cards.repository.ts';
import {
  createCreditCardBodySchema,
  type CreateCreditCardInput,
  type ListCreditCardsQuery,
  type UpdateCreditCardInput,
} from './credit-cards.schemas.ts';
import { assertIfMatch, PreconditionFailedError, type IfMatch } from '../../shared/http/etag.ts';

/** Cartão inexistente ou de outro usuário: a mesma resposta, para não revelar o que existe. */
export class CreditCardNotFoundError extends DomainError {
  readonly kind = 'not-found';

  constructor() {
    super('Cartão não encontrado.');
  }
}

/** A conta de pagamento escolhida está arquivada. */
export class ArchivedPaymentAccountError extends DomainError {
  readonly kind = 'conflict';

  constructor(accountName: string) {
    super(
      `A conta "${accountName}" está arquivada. Reative-a ou escolha outra para pagar as faturas.`,
    );
  }
}

/** Cartão com o uso do limite e a próxima fatura, calculados (não são guardados). */
export type CreditCardWithUsage = CreditCard & CardUsage;

export interface CreditCardsServiceDependencies {
  creditCards: CreditCardsRepository;
  accounts: AccountsRepository;
  /** Data de hoje (`yyyy-MM-dd`): define qual é a fatura aberta. */
  today: () => IsoDate;
}

export interface CreditCardsService {
  list(userId: string, query: ListCreditCardsQuery): Promise<CreditCardWithUsage[]>;
  /** Cartão do usuário; inexistente ou de outro usuário → `CreditCardNotFoundError`. */
  get(userId: string, creditCardId: string): Promise<CreditCardWithUsage>;
  /**
   * Cria o cartão. A conta de pagamento precisa ser do usuário (senão, `InvalidInputError`) e
   * estar ativa (senão, `ArchivedPaymentAccountError`).
   */
  create(userId: string, input: CreateCreditCardInput): Promise<CreditCardWithUsage>;
  /**
   * Aplica os campos enviados e valida o resultado com as regras do cadastro. A conta de
   * pagamento que o cartão já tinha continua aceita mesmo se arquivada depois.
   */
  update(
    userId: string,
    creditCardId: string,
    changes: UpdateCreditCardInput,
    ifMatch?: IfMatch,
  ): Promise<CreditCardWithUsage>;
}

export function createCreditCardsService({
  creditCards,
  accounts,
  today,
}: CreditCardsServiceDependencies): CreditCardsService {
  /**
   * Uso do limite com a regra de `calculateCardUsage`: utilizado = compras − faturas pagas (nunca
   * negativo); próxima fatura = a aberta hoje, com as compras já lançadas nela.
   */
  async function withUsage(userId: string, cards: CreditCard[]): Promise<CreditCardWithUsage[]> {
    const date = today();
    const cycles = new Map(cards.map((card) => [card.id, invoiceCycleFor(card, date)]));
    const totals = await creditCards.usageTotals(
      userId,
      [...cycles].map(([creditCardId, { start, end }]) => ({ creditCardId, start, end })),
    );
    return cards.map((card) => {
      const cardTotals = totals.get(card.id) ?? { purchases: 0, payments: 0, cyclePurchases: 0 };
      const usedLimit = Math.max(0, cardTotals.purchases - cardTotals.payments);
      return {
        ...card,
        usedLimit,
        availableLimit: card.creditLimit - usedLimit,
        nextInvoice: { ...cycles.get(card.id)!, amount: cardTotals.cyclePurchases },
      };
    });
  }

  async function withOneUsage(userId: string, card: CreditCard): Promise<CreditCardWithUsage> {
    const [result] = await withUsage(userId, [card]);
    if (!result) throw new Error('Uso do cartão não calculado.');
    return result;
  }

  async function find(userId: string, creditCardId: string): Promise<CreditCard> {
    const card = await creditCards.findCreditCard(userId, creditCardId);
    if (!card) {
      throw new CreditCardNotFoundError();
    }
    return card;
  }

  async function checkPaymentAccount(
    userId: string,
    paymentAccountId: string,
    previous?: CreditCard,
  ): Promise<void> {
    // Conta de outro usuário responde como inexistente, sem revelar que existe.
    const account = await accounts.findAccount(userId, paymentAccountId);
    if (!account) {
      throw new InvalidInputError([
        { field: 'paymentAccountId', message: 'Conta não encontrada.' },
      ]);
    }
    if (account.isArchived && account.id !== previous?.paymentAccountId) {
      throw new ArchivedPaymentAccountError(account.name);
    }
  }

  return {
    async list(userId, query) {
      return withUsage(userId, await creditCards.listCreditCards(userId, query));
    },

    async get(userId, creditCardId) {
      return withOneUsage(userId, await find(userId, creditCardId));
    },

    async create(userId, input) {
      await checkPaymentAccount(userId, input.paymentAccountId);
      return withOneUsage(userId, await creditCards.insertCreditCard({ ...input, userId }));
    },

    async update(userId, creditCardId, { isArchived, ...changes }, ifMatch) {
      const current = await find(userId, creditCardId);
      assertIfMatch(ifMatch, current);
      // O resultado da edição precisa valer como um cadastro (ex.: dias diferentes).
      const result = createCreditCardBodySchema.safeParse({
        name: changes.name ?? current.name,
        brand: changes.brand ?? current.brand,
        lastFourDigits: changes.lastFourDigits ?? current.lastFourDigits,
        creditLimit: changes.creditLimit ?? current.creditLimit,
        closingDay: changes.closingDay ?? current.closingDay,
        dueDay: changes.dueDay ?? current.dueDay,
        paymentAccountId: changes.paymentAccountId ?? current.paymentAccountId,
        color: changes.color ?? current.color,
      });
      if (!result.success) {
        throw new InvalidInputError(
          result.error.issues.map((issue) => ({
            field: issue.path.map(String).join('.'),
            message: issue.message,
          })),
        );
      }
      await checkPaymentAccount(userId, result.data.paymentAccountId, current);

      const updated = await creditCards.updateCreditCard(
        userId,
        creditCardId,
        { ...result.data, ...(isArchived !== undefined && { isArchived }) },
        ifMatch && current.updatedAt,
      );
      if (!updated) {
        throw ifMatch ? new PreconditionFailedError() : new CreditCardNotFoundError();
      }
      return withOneUsage(userId, updated);
    },
  };
}
