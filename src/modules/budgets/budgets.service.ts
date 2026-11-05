import { DomainError, InvalidInputError } from '../../shared/errors/domain-error.ts';
import type { IsoDate } from '../../shared/utils/date.ts';
import type { CategoriesRepository } from '../categories/categories.repository.ts';
import type { BudgetsRepository, BudgetWithLimits } from './budgets.repository.ts';
import type { CreateBudgetInput } from './budgets.schemas.ts';

/** Orçamento inexistente ou de outro usuário: a mesma resposta, para não revelar o que existe. */
export class BudgetNotFoundError extends DomainError {
  readonly kind = 'not-found';

  constructor() {
    super('Orçamento não encontrado.');
  }
}

/** Orçamento por categoria: um segundo para a mesma categoria é recusado. */
export class DuplicateBudgetError extends DomainError {
  readonly kind = 'conflict';

  constructor(categoryName: string) {
    super(`Já existe um orçamento para a categoria "${categoryName}". Altere o limite dele.`);
  }
}

/** Categoria arquivada não recebe orçamento novo. */
export class ArchivedBudgetCategoryError extends DomainError {
  readonly kind = 'conflict';

  constructor(categoryName: string) {
    super(`A categoria "${categoryName}" está arquivada. Reative-a para criar o orçamento.`);
  }
}

export interface BudgetsServiceDependencies {
  budgets: BudgetsRepository;
  categories: CategoriesRepository;
  /** Data de hoje (`yyyy-MM-dd`): o limite informado vale do mês atual em diante. */
  today: () => IsoDate;
}

export interface BudgetsService {
  /** Orçamento do usuário; inexistente ou de outro usuário → `BudgetNotFoundError`. */
  get(userId: string, budgetId: string): Promise<BudgetWithLimits>;
  /**
   * Cria o orçamento de uma categoria de despesa do usuário, com o limite valendo do mês atual em
   * diante. Categoria inexistente ou de receita → `InvalidInputError`; arquivada →
   * `ArchivedBudgetCategoryError`; com orçamento → `DuplicateBudgetError`.
   */
  create(userId: string, input: CreateBudgetInput): Promise<BudgetWithLimits>;
}

export function createBudgetsService({
  budgets,
  categories,
  today,
}: BudgetsServiceDependencies): BudgetsService {
  const currentMonth = () => today().slice(0, 7);

  return {
    async get(userId, budgetId) {
      const budget = await budgets.findBudget(userId, budgetId);
      if (!budget) {
        throw new BudgetNotFoundError();
      }
      return budget;
    },

    async create(userId, { categoryId, limitAmount, alertThreshold }) {
      // Categoria de outro usuário responde como inexistente, sem revelar que existe.
      const category = await categories.findCategory(userId, categoryId);
      if (!category) {
        throw new InvalidInputError([
          { field: 'categoryId', message: 'Categoria não encontrada.' },
        ]);
      }
      if (category.type !== 'expense') {
        throw new InvalidInputError([
          { field: 'categoryId', message: 'Orçamentos são de categorias de despesa.' },
        ]);
      }
      if (category.isArchived) {
        throw new ArchivedBudgetCategoryError(category.name);
      }

      const created = await budgets.insertBudget(
        { userId, categoryId, alertThreshold },
        { month: currentMonth(), amount: limitAmount },
      );
      if (!created) {
        throw new DuplicateBudgetError(category.name);
      }
      return created;
    },
  };
}
