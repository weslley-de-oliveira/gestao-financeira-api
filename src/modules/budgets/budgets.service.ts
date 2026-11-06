import { DomainError, InvalidInputError } from '../../shared/errors/domain-error.ts';
import { monthRange, type IsoDate, type IsoMonth } from '../../shared/utils/date.ts';
import type { CategoriesRepository } from '../categories/categories.repository.ts';
import { limitForMonth, progressFrom, withLimitFrom, type BudgetProgress } from './budget-rules.ts';
import type { BudgetsRepository, BudgetWithLimits } from './budgets.repository.ts';
import type { CreateBudgetInput, UpdateBudgetInput } from './budgets.schemas.ts';
import { assertIfMatch, PreconditionFailedError, type IfMatch } from '../../shared/http/etag.ts';

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

/** Orçamento com o consumo do mês consultado; `null` se o orçamento ainda não valia nele. */
export type BudgetWithProgress = BudgetWithLimits & { progress: BudgetProgress | null };

export interface BudgetsService {
  /** Orçamentos que valem no mês (padrão: o atual), com o consumo do mês. */
  list(userId: string, month?: IsoMonth): Promise<BudgetWithProgress[]>;
  /**
   * Orçamento do usuário com o consumo do mês (padrão: o atual); inexistente ou de outro usuário
   * → `BudgetNotFoundError`.
   */
  get(userId: string, budgetId: string, month?: IsoMonth): Promise<BudgetWithProgress>;
  /**
   * Cria o orçamento de uma categoria de despesa do usuário, com o limite valendo do mês atual em
   * diante. Categoria inexistente ou de receita → `InvalidInputError`; arquivada →
   * `ArchivedBudgetCategoryError`; com orçamento → `DuplicateBudgetError`.
   */
  create(userId: string, input: CreateBudgetInput): Promise<BudgetWithProgress>;
  /**
   * Altera o alerta e o limite. O novo limite vale do mês atual em diante (vigência nova); os
   * meses anteriores mantêm o limite que tinham.
   */
  /** Com `ifMatch`, só grava se o orçamento ainda estiver na versão lida. */
  update(
    userId: string,
    budgetId: string,
    changes: UpdateBudgetInput,
    ifMatch?: IfMatch,
  ): Promise<BudgetWithProgress>;
  /** Exclui o orçamento e o histórico de limites; as transações não mudam. */
  remove(userId: string, budgetId: string): Promise<void>;
}

export function createBudgetsService({
  budgets,
  categories,
  today,
}: BudgetsServiceDependencies): BudgetsService {
  const currentMonth = () => today().slice(0, 7);

  /** Consumo do mês de cada orçamento, com os gastos somados no banco numa consulta só. */
  async function withProgress(
    userId: string,
    list: BudgetWithLimits[],
    month: IsoMonth,
  ): Promise<BudgetWithProgress[]> {
    const spending = await budgets.spendingByCategory(
      userId,
      list.map((budget) => budget.categoryId),
      monthRange(month),
    );
    return list.map((budget) => {
      const limit = limitForMonth(budget.limits, month);
      const totals = spending.get(budget.categoryId) ?? { spent: 0, pending: 0 };
      return {
        ...budget,
        progress: limit === null ? null : progressFrom(month, limit, totals, budget.alertThreshold),
      };
    });
  }

  async function withOneProgress(
    userId: string,
    budget: BudgetWithLimits,
    month: IsoMonth = currentMonth(),
  ): Promise<BudgetWithProgress> {
    const [result] = await withProgress(userId, [budget], month);
    if (!result) throw new Error('Consumo do orçamento não calculado.');
    return result;
  }

  async function find(userId: string, budgetId: string): Promise<BudgetWithLimits> {
    const budget = await budgets.findBudget(userId, budgetId);
    if (!budget) {
      throw new BudgetNotFoundError();
    }
    return budget;
  }

  return {
    async list(userId, month = currentMonth()) {
      const all = await withProgress(userId, await budgets.listBudgets(userId), month);
      // Só os que já valiam no mês consultado.
      return all.filter((budget) => budget.progress !== null);
    },

    async get(userId, budgetId, month) {
      return withOneProgress(userId, await find(userId, budgetId), month);
    },

    async update(userId, budgetId, { limitAmount, alertThreshold }, ifMatch) {
      const current = await find(userId, budgetId);
      assertIfMatch(ifMatch, current);
      // Corpo vazio: nada a gravar (nem uma versão nova).
      if (limitAmount === undefined && alertThreshold === undefined) {
        return withOneProgress(userId, current);
      }
      const month = currentMonth();
      const updated = await budgets.updateBudget(
        userId,
        budgetId,
        {
          alertThreshold,
          limitsFrom:
            limitAmount === undefined
              ? undefined
              : { month, limits: withLimitFrom(current.limits, month, limitAmount) },
        },
        ifMatch && current.updatedAt,
      );
      if (!updated) {
        throw ifMatch ? new PreconditionFailedError() : new BudgetNotFoundError();
      }
      return withOneProgress(userId, updated);
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
      return withOneProgress(userId, created);
    },

    async remove(userId, budgetId) {
      if (!(await budgets.deleteBudget(userId, budgetId))) {
        throw new BudgetNotFoundError();
      }
    },
  };
}
