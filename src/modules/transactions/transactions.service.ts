import type { Transaction } from '../../db/schema/index.ts';
import { InvalidInputError, type InvalidField } from '../../shared/errors/domain-error.ts';
import type { AccountsRepository } from '../accounts/accounts.repository.ts';
import type { CategoriesRepository } from '../categories/categories.repository.ts';
import type { TransactionsRepository } from './transactions.repository.ts';
import type {
  CreateEntryInput,
  CreateTransactionInput,
  CreateTransferInput,
} from './transactions.schemas.ts';

export interface TransactionsServiceDependencies {
  transactions: TransactionsRepository;
  accounts: AccountsRepository;
  categories: CategoriesRepository;
}

export interface TransactionsService {
  /**
   * Cria a receita, a despesa ou a transferência. Contas e categoria precisam ser do usuário, e a
   * categoria do mesmo tipo da transação; senão → `InvalidInputError` com os campos.
   */
  create(userId: string, input: CreateTransactionInput): Promise<Transaction>;
}

export function createTransactionsService({
  transactions,
  accounts,
  categories,
}: TransactionsServiceDependencies): TransactionsService {
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

  return {
    async create(userId, input) {
      const invalid =
        input.type === 'transfer'
          ? await checkTransfer(userId, input)
          : await checkEntry(userId, input);
      if (invalid.length > 0) {
        throw new InvalidInputError(invalid);
      }
      return transactions.insertTransaction({ ...input, userId });
    },
  };
}
