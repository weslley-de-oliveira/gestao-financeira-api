import type { Transaction } from '../../db/schema/index.ts';
import {
  DomainError,
  InvalidInputError,
  type InvalidField,
} from '../../shared/errors/domain-error.ts';
import type { AccountsRepository } from '../accounts/accounts.repository.ts';
import type { CategoriesRepository } from '../categories/categories.repository.ts';
import type { TransactionsRepository } from './transactions.repository.ts';
import {
  createTransactionBodySchema,
  type CreateEntryInput,
  type CreateTransactionInput,
  type CreateTransferInput,
  type ListTransactionsQuery,
  type UpdateTransactionInput,
} from './transactions.schemas.ts';

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

export interface TransactionsServiceDependencies {
  transactions: TransactionsRepository;
  accounts: AccountsRepository;
  categories: CategoriesRepository;
}

export interface TransactionsService {
  /** Transações do usuário que passam nos filtros, das mais recentes para as mais antigas. */
  list(userId: string, filters: ListTransactionsQuery): Promise<Transaction[]>;
  /** Transação do usuário; inexistente ou de outro usuário → `TransactionNotFoundError`. */
  get(userId: string, transactionId: string): Promise<Transaction>;
  /**
   * Cria a receita, a despesa ou a transferência. Contas e categoria precisam ser do usuário, e a
   * categoria do mesmo tipo da transação; senão → `InvalidInputError` com os campos.
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
  ): Promise<Transaction>;
  /** Apaga a transação. Pagamento de fatura → `InvoicePaymentNotEditableError`. */
  remove(userId: string, transactionId: string): Promise<void>;
}

export function createTransactionsService({
  transactions,
  accounts,
  categories,
}: TransactionsServiceDependencies): TransactionsService {
  async function get(userId: string, transactionId: string): Promise<Transaction> {
    const transaction = await transactions.findTransaction(userId, transactionId);
    if (!transaction) {
      throw new TransactionNotFoundError();
    }
    return transaction;
  }

  /** Transação que pode ser alterada ou apagada por aqui. */
  async function getEditable(userId: string, transactionId: string): Promise<Transaction> {
    const transaction = await get(userId, transactionId);
    if (transaction.type === 'invoice-payment') {
      throw new InvoicePaymentNotEditableError();
    }
    return transaction;
  }

  // Conta e categoria de outro usuário respondem como inexistentes, sem revelar que existem.
  async function missingAccount(
    userId: string,
    accountId: string,
    field: string,
    message: string,
  ): Promise<InvalidField | null> {
    return (await accounts.findAccount(userId, accountId)) ? null : { field, message };
  }

  async function checkEntry(userId: string, input: CreateEntryInput): Promise<InvalidField[]> {
    const [account, category] = await Promise.all([
      missingAccount(userId, input.accountId, 'accountId', 'Conta não encontrada.'),
      categories.findCategory(userId, input.categoryId),
    ]);
    const invalid = account ? [account] : [];
    if (!category) {
      invalid.push({ field: 'categoryId', message: 'Categoria não encontrada.' });
    } else if (category.type !== input.type) {
      invalid.push({
        field: 'categoryId',
        message: `Selecione uma categoria de ${input.type === 'income' ? 'receita' : 'despesa'}.`,
      });
    }
    return invalid;
  }

  async function checkTransfer(
    userId: string,
    input: CreateTransferInput,
  ): Promise<InvalidField[]> {
    const results = await Promise.all([
      missingAccount(userId, input.accountId, 'accountId', 'Conta de origem não encontrada.'),
      missingAccount(
        userId,
        input.destinationAccountId,
        'destinationAccountId',
        'Conta de destino não encontrada.',
      ),
    ]);
    return results.filter((field) => field !== null);
  }

  async function checkReferences(userId: string, input: CreateTransactionInput): Promise<void> {
    const invalid =
      input.type === 'transfer'
        ? await checkTransfer(userId, input)
        : await checkEntry(userId, input);
    if (invalid.length > 0) {
      throw new InvalidInputError(invalid);
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
    const merged = {
      type: changes.type ?? current.type,
      description: changes.description ?? current.description,
      amount: changes.amount ?? current.amount,
      date: changes.date ?? current.date,
      accountId: changes.accountId ?? current.accountId,
      status: changes.status ?? current.status,
      notes: changes.notes === undefined ? current.notes : changes.notes,
    };
    const candidate =
      merged.type === 'transfer'
        ? {
            ...merged,
            destinationAccountId: changes.destinationAccountId ?? current.destinationAccountId,
          }
        : { ...merged, categoryId: changes.categoryId ?? current.categoryId };

    const result = createTransactionBodySchema.safeParse(candidate);
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
    list(userId, filters) {
      return transactions.listTransactions(userId, filters);
    },

    get,

    async create(userId, input) {
      await checkReferences(userId, input);
      return transactions.insertTransaction({ ...input, userId });
    },

    async update(userId, transactionId, changes) {
      const current = await getEditable(userId, transactionId);
      const next = mergeChanges(current, changes);
      await checkReferences(userId, next);
      const updated = await transactions.updateTransaction(userId, transactionId, {
        // Os campos que o novo tipo não usa voltam a ser nulos.
        categoryId: null,
        destinationAccountId: null,
        ...next,
      });
      if (!updated) {
        throw new TransactionNotFoundError();
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
