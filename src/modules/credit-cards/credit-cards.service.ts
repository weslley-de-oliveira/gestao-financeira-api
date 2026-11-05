import type { CreditCard } from '../../db/schema/index.ts';
import { DomainError, InvalidInputError } from '../../shared/errors/domain-error.ts';
import type { AccountsRepository } from '../accounts/accounts.repository.ts';
import type { CreditCardsRepository } from './credit-cards.repository.ts';
import {
  createCreditCardBodySchema,
  type CreateCreditCardInput,
  type ListCreditCardsQuery,
  type UpdateCreditCardInput,
} from './credit-cards.schemas.ts';

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

export interface CreditCardsServiceDependencies {
  creditCards: CreditCardsRepository;
  accounts: AccountsRepository;
}

export interface CreditCardsService {
  list(userId: string, query: ListCreditCardsQuery): Promise<CreditCard[]>;
  /** Cartão do usuário; inexistente ou de outro usuário → `CreditCardNotFoundError`. */
  get(userId: string, creditCardId: string): Promise<CreditCard>;
  /**
   * Cria o cartão. A conta de pagamento precisa ser do usuário (senão, `InvalidInputError`) e
   * estar ativa (senão, `ArchivedPaymentAccountError`).
   */
  create(userId: string, input: CreateCreditCardInput): Promise<CreditCard>;
  /**
   * Aplica os campos enviados e valida o resultado com as regras do cadastro. A conta de
   * pagamento que o cartão já tinha continua aceita mesmo se arquivada depois.
   */
  update(userId: string, creditCardId: string, changes: UpdateCreditCardInput): Promise<CreditCard>;
}

export function createCreditCardsService({
  creditCards,
  accounts,
}: CreditCardsServiceDependencies): CreditCardsService {
  async function get(userId: string, creditCardId: string): Promise<CreditCard> {
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
    list(userId, query) {
      return creditCards.listCreditCards(userId, query);
    },

    get,

    async create(userId, input) {
      await checkPaymentAccount(userId, input.paymentAccountId);
      return creditCards.insertCreditCard({ ...input, userId });
    },

    async update(userId, creditCardId, { isArchived, ...changes }) {
      const current = await get(userId, creditCardId);
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

      const updated = await creditCards.updateCreditCard(userId, creditCardId, {
        ...result.data,
        ...(isArchived !== undefined && { isArchived }),
      });
      if (!updated) {
        throw new CreditCardNotFoundError();
      }
      return updated;
    },
  };
}
