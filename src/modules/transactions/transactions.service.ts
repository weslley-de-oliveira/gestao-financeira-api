import type { Transaction } from '../../db/schema/index.ts';
import type { Page } from '../../shared/http/pagination.ts';
import {
  DomainError,
  InvalidInputError,
  type InvalidField,
} from '../../shared/errors/domain-error.ts';
import { monthLabel } from '../../shared/utils/date.ts';
import { invoiceCycleFor } from '../../shared/utils/invoice-cycle.ts';
import type { AccountsRepository } from '../accounts/accounts.repository.ts';
import type { CategoriesRepository } from '../categories/categories.repository.ts';
import type { CreditCardsRepository } from '../credit-cards/credit-cards.repository.ts';
import type { TransactionsRepository } from './transactions.repository.ts';
import {
  createTransactionBodySchema,
  type CreateEntryInput,
  type CreateTransactionInput,
  type CreateTransferInput,
  type ListTransactionsQuery,
  type UpdateTransactionInput,
} from './transactions.schemas.ts';
import { assertIfMatch, PreconditionFailedError, type IfMatch } from '../../shared/http/etag.ts';

/** Transação inexistente ou de outro usuário: a mesma resposta, para não revelar o que existe. */
export class TransactionNotFoundError extends DomainError {
  readonly kind = 'not-found';

  constructor() {
    super('Transação não encontrada.');
  }
}

/** O pagamento de fatura só é feito e desfeito pelas rotas de faturas, que mantêm a fatura certa. */
export class InvoicePaymentNotEditableError extends DomainError {
  readonly kind = 'conflict';

  constructor() {
    super('Pagamentos de fatura não são alterados por aqui: desfaça o pagamento pela fatura.');
  }
}

/**
 * Compra numa fatura já paga: não pode ser criada, alterada nem excluída, senão o total pago
 * deixaria de conferir com os itens. É preciso desfazer o pagamento antes.
 */
export class PaidInvoiceError extends DomainError {
  readonly kind = 'conflict';

  constructor(cardName: string, referenceMonth: string) {
    super(
      `A fatura de ${monthLabel(referenceMonth)} do cartão "${cardName}" já foi paga. Desfaça o pagamento para alterar as compras dela.`,
    );
  }
}

/** Conta ou categoria arquivada numa transação nova (ou trocada na edição). */
export class ArchivedReferenceError extends DomainError {
  readonly kind = 'conflict';
}

/**
 * Compra no cartão é sempre realizada: compromete o limite desde a data da compra (como o
 * `normalizeTransactionInput` do front, que ignora o status escolhido).
 */
function withCardRules(input: CreateTransactionInput): CreateTransactionInput {
  return input.type !== 'transfer' && input.creditCardId
    ? { ...input, status: 'completed' }
    : input;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export interface TransactionsServiceDependencies {
  transactions: TransactionsRepository;
  accounts: AccountsRepository;
  categories: CategoriesRepository;
  creditCards: CreditCardsRepository;
}

export interface TransactionsService {
  /** Uma página das transações do usuário que passam nos filtros, das mais recentes às antigas. */
  list(userId: string, query: ListTransactionsQuery): Promise<Page<Transaction>>;
  /** Transação do usuário; inexistente ou de outro usuário → `TransactionNotFoundError`. */
  get(userId: string, transactionId: string): Promise<Transaction>;
  /**
   * Cria a receita, a despesa ou a transferência. Contas e categoria precisam ser do usuário, e a
   * categoria do mesmo tipo da transação; senão → `InvalidInputError` com os campos. Conta ou
   * categoria arquivada → `ArchivedReferenceError`.
   */
  create(userId: string, input: CreateTransactionInput): Promise<Transaction>;
  /**
   * Aplica os campos enviados e valida o resultado com as regras do cadastro. Pagamento de fatura
   * → `InvoicePaymentNotEditableError`.
   */
  update(
    userId: string,
    transactionId: string,
    changes: UpdateTransactionInput,
    ifMatch?: IfMatch,
  ): Promise<Transaction>;
  /** Apaga a transação. Pagamento de fatura → `InvoicePaymentNotEditableError`. */
  remove(userId: string, transactionId: string): Promise<void>;
}

export function createTransactionsService({
  transactions,
  accounts,
  categories,
  creditCards,
}: TransactionsServiceDependencies): TransactionsService {
  async function get(userId: string, transactionId: string): Promise<Transaction> {
    const transaction = await transactions.findTransaction(userId, transactionId);
    if (!transaction) {
      throw new TransactionNotFoundError();
    }
    return transaction;
  }

  /**
   * Transação que pode ser alterada ou apagada por aqui: não é pagamento de fatura nem compra de
   * uma fatura já paga.
   */
  async function getEditable(userId: string, transactionId: string): Promise<Transaction> {
    const transaction = await get(userId, transactionId);
    if (transaction.type === 'invoice-payment') {
      throw new InvoicePaymentNotEditableError();
    }
    if (transaction.creditCardId) {
      await assertInvoiceNotPaid(userId, transaction.creditCardId, transaction.date);
    }
    return transaction;
  }

  /** A fatura em que cai uma compra do cartão nesta data não pode estar paga. */
  async function assertInvoiceNotPaid(
    userId: string,
    creditCardId: string,
    date: string,
  ): Promise<void> {
    const card = await creditCards.findCreditCard(userId, creditCardId);
    if (!card) {
      return;
    }
    const { referenceMonth } = invoiceCycleFor(card, date);
    if (await transactions.hasInvoicePayment(userId, creditCardId, referenceMonth)) {
      throw new PaidInvoiceError(card.name, referenceMonth);
    }
  }

  /**
   * Problemas das referências de uma transação: as inexistentes (ou de outro usuário, que
   * respondem igual, sem revelar que existem) e as arquivadas.
   */
  interface ReferenceCheck {
    invalid: InvalidField[];
    archived: string[];
  }

  /**
   * Na edição, as referências que a transação já tinha continuam valendo mesmo se arquivadas
   * depois (como no front): só uma conta ou categoria *nova* precisa estar ativa.
   */
  async function checkAccount(
    check: ReferenceCheck,
    userId: string,
    reference: { id: string; field: string; label: string },
    previous: Transaction | undefined,
  ): Promise<void> {
    const account = await accounts.findAccount(userId, reference.id);
    const label = reference.label ? `conta ${reference.label}` : 'conta';
    if (!account) {
      check.invalid.push({
        field: reference.field,
        message: `${capitalize(label)} não encontrada.`,
      });
    } else if (
      account.isArchived &&
      account.id !== previous?.accountId &&
      account.id !== previous?.destinationAccountId
    ) {
      check.archived.push(
        `A ${label} "${account.name}" está arquivada. Reative-a para lançar nela.`,
      );
    }
  }

  async function checkCreditCard(
    check: ReferenceCheck,
    userId: string,
    creditCardId: string,
    previous: Transaction | undefined,
  ): Promise<void> {
    const card = await creditCards.findCreditCard(userId, creditCardId);
    if (!card) {
      check.invalid.push({ field: 'creditCardId', message: 'Cartão não encontrado.' });
    } else if (card.isArchived && card.id !== previous?.creditCardId) {
      check.archived.push(`O cartão "${card.name}" está arquivado. Reative-o para lançar nele.`);
    }
  }

  async function checkEntry(
    check: ReferenceCheck,
    userId: string,
    input: CreateEntryInput,
    previous: Transaction | undefined,
  ): Promise<void> {
    const [category] = await Promise.all([
      categories.findCategory(userId, input.categoryId),
      // O schema garante que há exatamente um dos dois.
      input.creditCardId
        ? checkCreditCard(check, userId, input.creditCardId, previous)
        : checkAccount(
            check,
            userId,
            { id: input.accountId ?? '', field: 'accountId', label: '' },
            previous,
          ),
    ]);
    if (!category) {
      check.invalid.push({ field: 'categoryId', message: 'Categoria não encontrada.' });
    } else if (category.type !== input.type) {
      check.invalid.push({
        field: 'categoryId',
        message: `Selecione uma categoria de ${input.type === 'income' ? 'receita' : 'despesa'}.`,
      });
    } else if (category.isArchived && category.id !== previous?.categoryId) {
      check.archived.push(`A categoria "${category.name}" está arquivada. Reative-a para usá-la.`);
    }
  }

  async function checkTransfer(
    check: ReferenceCheck,
    userId: string,
    input: CreateTransferInput,
    previous: Transaction | undefined,
  ): Promise<void> {
    await Promise.all([
      checkAccount(
        check,
        userId,
        { id: input.accountId, field: 'accountId', label: 'de origem' },
        previous,
      ),
      checkAccount(
        check,
        userId,
        { id: input.destinationAccountId, field: 'destinationAccountId', label: 'de destino' },
        previous,
      ),
    ]);
  }

  /**
   * Contas e categoria inexistentes → `InvalidInputError` (422, por campo); se todas existem, uma
   * arquivada → `ArchivedReferenceError` (409).
   */
  async function checkReferences(
    userId: string,
    input: CreateTransactionInput,
    previous?: Transaction,
  ): Promise<void> {
    const check: ReferenceCheck = { invalid: [], archived: [] };
    if (input.type === 'transfer') {
      await checkTransfer(check, userId, input, previous);
    } else {
      await checkEntry(check, userId, input, previous);
    }
    // Campos na ordem do corpo, independente de qual consulta terminou primeiro.
    const order = ['accountId', 'creditCardId', 'destinationAccountId', 'categoryId'];
    if (check.invalid.length > 0) {
      throw new InvalidInputError(
        check.invalid.toSorted((a, b) => order.indexOf(a.field) - order.indexOf(b.field)),
      );
    }
    const [archived] = check.archived;
    if (archived) {
      throw new ArchivedReferenceError(archived);
    }
  }

  /**
   * Junta a transação atual com os campos enviados, deixando só os que servem ao tipo final, e
   * valida com o schema do cadastro (forma, limites, contas diferentes na transferência...).
   */
  function mergeChanges(
    current: Transaction,
    changes: UpdateTransactionInput,
  ): CreateTransactionInput {
    // Conta e cartão se excluem: informar um deles descarta o outro (como no formulário do front).
    let accountId = current.accountId;
    let creditCardId = current.creditCardId;
    if (changes.accountId !== undefined) {
      accountId = changes.accountId;
      creditCardId = changes.creditCardId ?? null;
    } else if (changes.creditCardId !== undefined) {
      creditCardId = changes.creditCardId;
      accountId = null;
    }
    const merged = {
      type: changes.type ?? current.type,
      description: changes.description ?? current.description,
      amount: changes.amount ?? current.amount,
      date: changes.date ?? current.date,
      accountId: accountId ?? undefined,
      status: changes.status ?? current.status,
      notes: changes.notes === undefined ? current.notes : changes.notes,
    };
    const candidate =
      merged.type === 'transfer'
        ? {
            ...merged,
            // Cartão informado numa transferência: o schema recusa o campo.
            ...(changes.creditCardId !== undefined && { creditCardId: changes.creditCardId }),
            destinationAccountId: changes.destinationAccountId ?? current.destinationAccountId,
          }
        : {
            ...merged,
            creditCardId: creditCardId ?? undefined,
            categoryId: changes.categoryId ?? current.categoryId,
          };

    // Sem chaves `undefined`: elas passariam pelo schema e apagariam os nulos padrão na gravação.
    const result = createTransactionBodySchema.safeParse(
      Object.fromEntries(Object.entries(candidate).filter(([, value]) => value !== undefined)),
    );
    if (!result.success) {
      throw new InvalidInputError(
        result.error.issues.map((issue) => ({
          field: issue.path.map(String).join('.') || 'type',
          message: issue.message,
        })),
      );
    }
    return result.data;
  }

  return {
    list(userId, query) {
      return transactions.listTransactions(userId, query);
    },

    get,

    async create(userId, input) {
      await checkReferences(userId, input);
      if (input.type !== 'transfer' && input.creditCardId) {
        await assertInvoiceNotPaid(userId, input.creditCardId, input.date);
      }
      return transactions.insertTransaction({ ...withCardRules(input), userId });
    },

    async update(userId, transactionId, changes, ifMatch) {
      // Compra de fatura paga não muda (nem para sair dela); e nenhuma pode entrar numa paga.
      const current = await getEditable(userId, transactionId);
      assertIfMatch(ifMatch, current);
      const next = mergeChanges(current, changes);
      await checkReferences(userId, next, current);
      if (next.type !== 'transfer' && next.creditCardId) {
        await assertInvoiceNotPaid(userId, next.creditCardId, next.date);
      }
      const updated = await transactions.updateTransaction(
        userId,
        transactionId,
        {
          // Os campos que o novo tipo não usa voltam a ser nulos.
          accountId: null,
          creditCardId: null,
          categoryId: null,
          destinationAccountId: null,
          ...withCardRules(next),
        },
        ifMatch && current.updatedAt,
      );
      if (!updated) {
        throw ifMatch ? new PreconditionFailedError() : new TransactionNotFoundError();
      }
      return updated;
    },

    async remove(userId, transactionId) {
      await getEditable(userId, transactionId);
      if (!(await transactions.deleteTransaction(userId, transactionId))) {
        throw new TransactionNotFoundError();
      }
    },
  };
}
