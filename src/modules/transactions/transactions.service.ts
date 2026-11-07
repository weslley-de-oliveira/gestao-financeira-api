import { randomUUIDv7 } from 'node:crypto';
import type { Transaction } from '../../db/schema/index.ts';
import type { Page } from '../../shared/http/pagination.ts';
import {
  DomainError,
  InvalidInputError,
  type InvalidField,
} from '../../shared/errors/domain-error.ts';
import {
  ARCHIVED_REFERENCE_PROBLEM_TYPE,
  HAS_REFUNDS_PROBLEM_TYPE,
  INSTALLMENT_PROBLEM_TYPE,
  PAID_INVOICE_PROBLEM_TYPE,
} from '../../shared/http/problem.ts';
import { monthLabel, type IsoDate } from '../../shared/utils/date.ts';
import { formatCents } from '../../shared/utils/money.ts';
import { TRANSACTION_DESCRIPTION_MAX_LENGTH } from './transactions.constants.ts';
import { invoiceCycleFor } from '../../shared/utils/invoice-cycle.ts';
import type { AccountsRepository } from '../accounts/accounts.repository.ts';
import type { CategoriesRepository } from '../categories/categories.repository.ts';
import type { CreditCardsRepository } from '../credit-cards/credit-cards.repository.ts';
import {
  anticipatableInstallments,
  plannedCancellations,
  type PlannedCancellation,
} from '../installments/installment-actions.ts';
import { planInstallments } from '../installments/installment-plan.ts';
import type {
  AnticipateInstallmentsInput,
  CreateInstallmentPurchaseInput,
  UpdateInstallmentPurchaseInput,
} from '../installments/installments.schemas.ts';
import type { TransactionsRepository } from './transactions.repository.ts';
import {
  createTransactionBodySchema,
  type CreateEntryInput,
  type CreateTransactionInput,
  type CreateTransferInput,
  type ListTransactionsQuery,
  type TransactionFilters,
  type TransactionSummary,
  type CreateRefundInput,
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
  override readonly problemType = PAID_INVOICE_PROBLEM_TYPE;

  constructor(cardName: string, referenceMonth: string) {
    super(
      `A fatura de ${monthLabel(referenceMonth)} do cartão "${cardName}" já foi paga. Desfaça o pagamento para alterar as compras dela.`,
    );
  }
}

/** Conta ou categoria arquivada numa transação nova (ou trocada na edição). */
/** A despesa tem estornos: exclua-os antes de excluí-la ou de mudar valor, data, conta ou tipo. */
export class HasRefundsError extends DomainError {
  readonly kind = 'conflict';
  override readonly problemType = HAS_REFUNDS_PROBLEM_TYPE;

  constructor() {
    super(
      'Esta despesa tem estornos: exclua os estornos antes de excluí-la ou de mudar valor, data, conta, cartão ou tipo.',
    );
  }
}

/** Só despesas realizadas recebem estorno. */
export class NotRefundableError extends DomainError {
  readonly kind = 'conflict';

  constructor() {
    super('Só despesas realizadas podem ser estornadas.');
  }
}

/** Parcela alterada ou excluída sozinha: as parcelas só mudam pela compra parcelada. */
export class InstallmentNotEditableError extends DomainError {
  readonly kind = 'conflict';
  override readonly problemType = INSTALLMENT_PROBLEM_TYPE;

  constructor() {
    super(
      'Esta transação é uma parcela: altere ou exclua a compra parcelada inteira (/v1/installment-purchases).',
    );
  }
}

/** Nenhuma parcela de fatura futura sem estornos: não há o que antecipar. */
export class NothingToAnticipateError extends DomainError {
  readonly kind = 'conflict';

  constructor() {
    super('Não há parcelas a antecipar: as que faltam já estão na fatura atual ou têm estornos.');
  }
}

/** Nada a estornar na fatura atual nem nas futuras: não há o que cancelar. */
export class NothingToCancelError extends DomainError {
  readonly kind = 'conflict';

  constructor() {
    super(
      'Não há parcelas a cancelar: as que faltam já estão em faturas fechadas ou foram estornadas.',
    );
  }
}

/** Compra parcelada inexistente ou de outro usuário. */
export class InstallmentPurchaseNotFoundError extends DomainError {
  readonly kind = 'not-found';

  constructor() {
    super('Compra parcelada não encontrada.');
  }
}

export class ArchivedReferenceError extends DomainError {
  readonly kind = 'conflict';
  override readonly problemType = ARCHIVED_REFERENCE_PROBLEM_TYPE;
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
  /** Data de hoje no fuso do app: define a fatura atual de uma compra parcelada. */
  today: () => IsoDate;
}

/**
 * As parcelas de uma compra, da 1ª à última, com o que a pessoa ainda pode fazer com elas hoje:
 * antecipar as de faturas futuras e cancelar o que não foi cobrado.
 */
export interface InstallmentPurchaseDetails {
  installments: Transaction[];
  /** Parcelas que podem ir para a fatura atual, da última para a primeira. */
  anticipatable: Transaction[];
  /** Os estornos que o cancelamento criaria, da primeira parcela à última. */
  cancellations: PlannedCancellation[];
}

export interface TransactionsService {
  /** Uma página das transações do usuário que passam nos filtros, das mais recentes às antigas. */
  list(userId: string, query: ListTransactionsQuery): Promise<Page<Transaction>>;
  /** Totais e contagens de todas as transações do usuário que passam nos filtros. */
  summarize(userId: string, filters: TransactionFilters): Promise<TransactionSummary>;
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
  /**
   * Registra a compra no cartão em parcelas, uma por fatura (`planInstallments`), com as regras
   * de uma compra comum: cartão e categoria de despesa do usuário e ativos. Se alguma parcela
   * cairia numa fatura já paga → `PaidInvoiceError`. Devolve as parcelas, da 1ª à última.
   */
  createInstallmentPurchase(
    userId: string,
    input: CreateInstallmentPurchaseInput,
  ): Promise<InstallmentPurchaseDetails>;
  /**
   * Registra o estorno de uma despesa realizada (inclusive uma parcela): na conta ou no cartão dela,
   * até o valor que falta estornar e não antes da data dela. Outro tipo, ou pendente →
   * `NotRefundableError`; no cartão, fatura já paga → `PaidInvoiceError`.
   */
  createRefund(
    userId: string,
    transactionId: string,
    input: CreateRefundInput,
  ): Promise<Transaction>;
  /** Estornos de uma despesa do usuário; inexistente → `TransactionNotFoundError`. */
  listRefunds(userId: string, transactionId: string): Promise<Transaction[]>;
  /** Parcelas da compra; inexistente ou de outro usuário → `InstallmentPurchaseNotFoundError`. */
  getInstallmentPurchase(userId: string, groupId: string): Promise<InstallmentPurchaseDetails>;
  /**
   * Altera descrição, categoria e observações de todas as parcelas. Vale mesmo com faturas pagas:
   * esses campos não mudam os valores. Categoria nova precisa ser de despesa, do usuário e ativa.
   */
  updateInstallmentPurchase(
    userId: string,
    groupId: string,
    changes: UpdateInstallmentPurchaseInput,
  ): Promise<InstallmentPurchaseDetails>;
  /** Apaga todas as parcelas; alguma numa fatura já paga → `PaidInvoiceError`. */
  removeInstallmentPurchase(userId: string, groupId: string): Promise<void>;
  /**
   * Leva as últimas `count` parcelas que podem ser antecipadas para a fatura atual (a data delas
   * passa a ser hoje). Nenhuma → `NothingToAnticipateError`; mais do que as possíveis →
   * `InvalidInputError` no `count`.
   */
  anticipateInstallments(
    userId: string,
    groupId: string,
    input: AnticipateInstallmentsInput,
  ): Promise<InstallmentPurchaseDetails>;
  /**
   * Estorna o que falta de cada parcela da fatura atual e das futuras (`plannedCancellations`),
   * numa só gravação. Nada a estornar → `NothingToCancelError`. Devolve os estornos criados.
   */
  cancelInstallments(userId: string, groupId: string): Promise<Transaction[]>;
}

export function createTransactionsService({
  transactions,
  accounts,
  categories,
  creditCards,
  today,
}: TransactionsServiceDependencies): TransactionsService {
  async function get(userId: string, transactionId: string): Promise<Transaction> {
    const transaction = await transactions.findTransaction(userId, transactionId);
    if (!transaction) {
      throw new TransactionNotFoundError();
    }
    return transaction;
  }

  /**
   * Transação que pode ser alterada ou apagada por aqui: não é pagamento de fatura, parcela de
   * compra parcelada (muda pela compra) nem compra de uma fatura já paga.
   */
  async function getEditable(userId: string, transactionId: string): Promise<Transaction> {
    const transaction = await get(userId, transactionId);
    if (transaction.type === 'invoice-payment') {
      throw new InvoicePaymentNotEditableError();
    }
    if (transaction.installmentGroupId) {
      throw new InstallmentNotEditableError();
    }
    if (transaction.creditCardId) {
      await assertInvoiceNotPaid(userId, transaction.creditCardId, transaction.date);
    }
    return transaction;
  }

  /**
   * Edição de um estorno: só descrição, valor, data e observações (a conta, o cartão e a categoria
   * são os da despesa). Valor até o que falta estornar (contando o dele), data não anterior à
   * despesa e, no cartão, fora de fatura paga.
   */
  async function updateRefund(
    userId: string,
    current: Transaction,
    changes: UpdateTransactionInput,
    ifMatch: IfMatch | undefined,
  ): Promise<Transaction> {
    const fixed = Object.keys(changes).filter(
      (key) => !['description', 'amount', 'date', 'notes'].includes(key),
    );
    if (fixed.length > 0) {
      throw new InvalidInputError(
        fixed.map((field) => ({
          field,
          message: 'Num estorno, só mudam descrição, valor, data e observações.',
        })),
      );
    }
    const original = await get(userId, current.refundedTransactionId ?? '');
    const others = (await transactions.listRefunds(userId, original.id))
      .filter((refund) => refund.id !== current.id)
      .reduce((total, refund) => total + refund.amount, 0);
    const amount = changes.amount ?? current.amount;
    const date = changes.date ?? current.date;
    const invalid: InvalidField[] = [];
    if (amount > original.amount - others) {
      invalid.push({
        field: 'amount',
        message: `O estorno pode ser de no máximo ${formatCents(original.amount - others)}, o que falta estornar.`,
      });
    }
    if (date < original.date) {
      invalid.push({ field: 'date', message: 'O estorno não pode ser anterior à despesa.' });
    }
    if (invalid.length > 0) {
      throw new InvalidInputError(invalid);
    }
    if (current.creditCardId) {
      await assertInvoiceNotPaid(userId, current.creditCardId, date);
    }
    const updated = await transactions.updateTransaction(
      userId,
      current.id,
      {
        type: 'refund',
        description: changes.description ?? current.description,
        amount,
        date,
        accountId: current.accountId,
        creditCardId: current.creditCardId,
        categoryId: null,
        destinationAccountId: null,
        status: 'completed',
        notes: changes.notes === undefined ? current.notes : changes.notes,
        refundedTransactionId: current.refundedTransactionId,
      },
      ifMatch && current.updatedAt,
    );
    if (!updated) {
      throw ifMatch ? new PreconditionFailedError() : new TransactionNotFoundError();
    }
    return updated;
  }

  async function getInstallments(userId: string, groupId: string): Promise<Transaction[]> {
    const installments = await transactions.listInstallments(userId, groupId);
    if (installments.length === 0) {
      throw new InstallmentPurchaseNotFoundError();
    }
    return installments;
  }

  /** As parcelas com o que dá para antecipar e cancelar hoje, pelos estornos de cada uma. */
  async function describeInstallments(
    userId: string,
    installments: Transaction[],
  ): Promise<InstallmentPurchaseDetails> {
    const cardId = installments[0]?.creditCardId;
    const card = cardId ? await creditCards.findCreditCard(userId, cardId) : null;
    if (!card) {
      return { installments, anticipatable: [], cancellations: [] };
    }
    const refunded = await transactions.refundedTotals(
      userId,
      installments.map((installment) => installment.id),
    );
    const states = installments.map((installment) => ({
      ...installment,
      installmentNumber: installment.installmentNumber ?? 0,
      refunded: refunded.get(installment.id) ?? 0,
    }));
    const date = today();
    return {
      installments,
      anticipatable: anticipatableInstallments(card, states, date),
      cancellations: plannedCancellations(card, states, date),
    };
  }

  /** Nenhuma destas faturas do cartão pode estar paga; a primeira paga → `PaidInvoiceError`. */
  async function assertInvoicesNotPaid(
    userId: string,
    card: { id: string; name: string },
    invoiceMonths: readonly string[],
  ): Promise<void> {
    const paid = await transactions.firstPaidInvoiceMonth(userId, card.id, invoiceMonths);
    if (paid) {
      throw new PaidInvoiceError(card.name, paid);
    }
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

    summarize(userId, filters) {
      return transactions.summarizeTransactions(userId, filters);
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
      // Corpo vazio: nada a gravar (nem uma versão nova).
      if (Object.keys(changes).length === 0) {
        return current;
      }
      if (current.type === 'refund') {
        return updateRefund(userId, current, changes, ifMatch);
      }
      // Com estornos, a despesa só muda descrição, categoria e observações.
      const keepsRefunds = Object.keys(changes).every((key) =>
        ['description', 'categoryId', 'notes'].includes(key),
      );
      if (!keepsRefunds && (await transactions.listRefunds(userId, transactionId)).length > 0) {
        throw new HasRefundsError();
      }
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
      if ((await transactions.listRefunds(userId, transactionId)).length > 0) {
        throw new HasRefundsError();
      }
      if (!(await transactions.deleteTransaction(userId, transactionId))) {
        throw new TransactionNotFoundError();
      }
    },

    async createInstallmentPurchase(userId, input) {
      const { description, amount, date, creditCardId, categoryId, notes } = input;
      await checkReferences(userId, {
        type: 'expense',
        description,
        amount,
        date,
        creditCardId,
        categoryId,
        status: 'completed',
        notes,
      });
      const card = await creditCards.findCreditCard(userId, creditCardId);
      if (!card) {
        throw new InvalidInputError([{ field: 'creditCardId', message: 'Cartão não encontrado.' }]);
      }
      const plan = planInstallments(card, { amount, date }, input.installmentCount);
      await assertInvoicesNotPaid(
        userId,
        card,
        plan.map((installment) => installment.referenceMonth),
      );
      const installmentGroupId = randomUUIDv7();
      const installments = await transactions.insertTransactions(
        plan.map((installment) => ({
          userId,
          type: 'expense',
          description,
          amount: installment.amount,
          date: installment.date,
          creditCardId,
          categoryId,
          status: 'completed',
          notes,
          installmentGroupId,
          installmentNumber: installment.installmentNumber,
          installmentCount: input.installmentCount,
        })),
      );
      return describeInstallments(userId, installments);
    },

    async getInstallmentPurchase(userId, groupId) {
      return describeInstallments(userId, await getInstallments(userId, groupId));
    },

    async createRefund(userId, transactionId, input) {
      const original = await get(userId, transactionId);
      if (original.type !== 'expense' || original.status !== 'completed') {
        throw new NotRefundableError();
      }
      const refunded = (await transactions.listRefunds(userId, transactionId)).reduce(
        (total, refund) => total + refund.amount,
        0,
      );
      const remaining = original.amount - refunded;
      const invalid: InvalidField[] = [];
      if (input.amount > remaining) {
        invalid.push({
          field: 'amount',
          message:
            remaining > 0
              ? `O estorno pode ser de no máximo ${formatCents(remaining)}, o que falta estornar.`
              : 'Esta despesa já foi estornada por inteiro.',
        });
      }
      if (input.date < original.date) {
        invalid.push({ field: 'date', message: 'O estorno não pode ser anterior à despesa.' });
      }
      if (invalid.length > 0) {
        throw new InvalidInputError(invalid);
      }
      if (original.creditCardId) {
        await assertInvoiceNotPaid(userId, original.creditCardId, input.date);
      }
      return transactions.insertTransaction({
        userId,
        type: 'refund',
        description:
          input.description ??
          `Estorno: ${original.description}`.slice(0, TRANSACTION_DESCRIPTION_MAX_LENGTH),
        amount: input.amount,
        date: input.date,
        accountId: original.accountId,
        creditCardId: original.creditCardId,
        status: 'completed',
        notes: input.notes ?? null,
        refundedTransactionId: original.id,
      });
    },

    async listRefunds(userId, transactionId) {
      await get(userId, transactionId);
      return transactions.listRefunds(userId, transactionId);
    },

    async updateInstallmentPurchase(userId, groupId, { description, categoryId, notes }) {
      const installments = await getInstallments(userId, groupId);
      const current = installments[0];
      if (categoryId !== undefined && categoryId !== current?.categoryId) {
        const category = await categories.findCategory(userId, categoryId);
        if (category?.type !== 'expense') {
          throw new InvalidInputError([
            {
              field: 'categoryId',
              message: category
                ? 'Selecione uma categoria de despesa.'
                : 'Categoria não encontrada.',
            },
          ]);
        }
        if (category.isArchived) {
          throw new ArchivedReferenceError(
            `A categoria "${category.name}" está arquivada. Reative-a para usá-la.`,
          );
        }
      }
      const changes = {
        ...(description !== undefined && { description }),
        ...(categoryId !== undefined && { categoryId }),
        ...(notes !== undefined && { notes }),
      };
      // Corpo vazio: nada a gravar (nem uma versão nova).
      if (Object.keys(changes).length === 0) {
        return describeInstallments(userId, installments);
      }
      return describeInstallments(
        userId,
        await transactions.updateInstallments(userId, groupId, changes),
      );
    },

    async removeInstallmentPurchase(userId, groupId) {
      const installments = await getInstallments(userId, groupId);
      const refunds = await Promise.all(
        installments.map((installment) => transactions.listRefunds(userId, installment.id)),
      );
      if (refunds.some((list) => list.length > 0)) {
        throw new HasRefundsError();
      }
      const cardId = installments[0]?.creditCardId;
      const card = cardId ? await creditCards.findCreditCard(userId, cardId) : null;
      if (card) {
        await assertInvoicesNotPaid(
          userId,
          card,
          installments.map((installment) => invoiceCycleFor(card, installment.date).referenceMonth),
        );
      }
      if ((await transactions.deleteInstallments(userId, groupId)) === 0) {
        throw new InstallmentPurchaseNotFoundError();
      }
    },

    async anticipateInstallments(userId, groupId, { count }) {
      const { installments, anticipatable } = await describeInstallments(
        userId,
        await getInstallments(userId, groupId),
      );
      if (anticipatable.length === 0) {
        throw new NothingToAnticipateError();
      }
      if (count > anticipatable.length) {
        throw new InvalidInputError([
          {
            field: 'count',
            message:
              anticipatable.length === 1
                ? 'Só 1 parcela pode ser antecipada.'
                : `Só ${anticipatable.length} parcelas podem ser antecipadas.`,
          },
        ]);
      }
      const date = today();
      const cardId = installments[0]?.creditCardId;
      if (cardId) {
        await assertInvoiceNotPaid(userId, cardId, date);
      }
      await transactions.moveTransactions(
        userId,
        anticipatable.slice(0, count).map((installment) => installment.id),
        date,
      );
      return describeInstallments(userId, await getInstallments(userId, groupId));
    },

    async cancelInstallments(userId, groupId) {
      const { installments, cancellations } = await describeInstallments(
        userId,
        await getInstallments(userId, groupId),
      );
      if (cancellations.length === 0) {
        throw new NothingToCancelError();
      }
      const byId = new Map(installments.map((installment) => [installment.id, installment]));
      const cardId = installments[0]?.creditCardId ?? null;
      const card = cardId ? await creditCards.findCreditCard(userId, cardId) : null;
      if (card) {
        await assertInvoicesNotPaid(
          userId,
          card,
          cancellations.map(({ date }) => invoiceCycleFor(card, date).referenceMonth),
        );
      }
      return transactions.insertTransactions(
        cancellations.map(({ installmentId, amount, date }) => {
          const installment = byId.get(installmentId);
          const suffix = ` (${installment?.installmentNumber}/${installment?.installmentCount})`;
          return {
            userId,
            type: 'refund' as const,
            description:
              `Cancelamento: ${installment?.description ?? ''}`.slice(
                0,
                TRANSACTION_DESCRIPTION_MAX_LENGTH - suffix.length,
              ) + suffix,
            amount,
            date,
            accountId: null,
            creditCardId: cardId,
            status: 'completed' as const,
            notes: null,
            refundedTransactionId: installmentId,
          };
        }),
      );
    },
  };
}
