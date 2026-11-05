import type { Transaction } from '../../db/schema/index.ts';
import { InvalidInputError, type InvalidField } from '../../shared/errors/domain-error.ts';
import type { AccountsRepository } from '../accounts/accounts.repository.ts';
import type { CategoriesRepository } from '../categories/categories.repository.ts';
import type { TransactionsRepository } from './transactions.repository.ts';
import type { CreateTransactionInput } from './transactions.schemas.ts';

export interface TransactionsServiceDependencies {
  transactions: TransactionsRepository;
  accounts: AccountsRepository;
  categories: CategoriesRepository;
}

export interface TransactionsService {
  /**
   * Cria a receita ou despesa em conta. Conta e categoria precisam ser do usuário, e a categoria do
   * mesmo tipo da transação; senão → `InvalidInputError` com os campos.
   */
  create(userId: string, input: CreateTransactionInput): Promise<Transaction>;
}

export function createTransactionsService({
  transactions,
  accounts,
  categories,
}: TransactionsServiceDependencies): TransactionsService {
  return {
    async create(userId, input) {
      const [account, category] = await Promise.all([
        accounts.findAccount(userId, input.accountId),
        categories.findCategory(userId, input.categoryId),
      ]);

      // Conta e categoria de outro usuário respondem como inexistentes, sem revelar que existem.
      const invalid: InvalidField[] = [];
      if (!account) {
        invalid.push({ field: 'accountId', message: 'Conta não encontrada.' });
      }
      if (!category) {
        invalid.push({ field: 'categoryId', message: 'Categoria não encontrada.' });
      } else if (category.type !== input.type) {
        invalid.push({
          field: 'categoryId',
          message: `Selecione uma categoria de ${input.type === 'income' ? 'receita' : 'despesa'}.`,
        });
      }
      if (invalid.length > 0) {
        throw new InvalidInputError(invalid);
      }

      return transactions.insertTransaction({ ...input, userId });
    },
  };
}
