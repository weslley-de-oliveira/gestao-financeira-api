import type { Category } from '../../db/schema/index.ts';
import { DomainError } from '../../shared/errors/domain-error.ts';
import type { CategoryType } from './categories.constants.ts';
import type { CategoriesRepository, CategoryChanges } from './categories.repository.ts';
import type {
  CreateCategoryInput,
  ListCategoriesQuery,
  UpdateCategoryInput,
} from './categories.schemas.ts';
import { categoryNameKey } from './category-name.ts';
import { assertIfMatch, PreconditionFailedError, type IfMatch } from '../../shared/http/etag.ts';

/** Categoria inexistente ou de outro usuário: a mesma resposta, para não revelar o que existe. */
export class CategoryNotFoundError extends DomainError {
  readonly kind = 'not-found';

  constructor() {
    super('Categoria não encontrada.');
  }
}

/**
 * Já existe categoria do mesmo tipo com o mesmo nome (sem diferenciar acentos, maiúsculas e
 * espaços). Se ela estiver arquivada, a mensagem sugere reativá-la, como no front.
 */
export class DuplicateCategoryNameError extends DomainError {
  readonly kind = 'conflict';

  constructor(type: CategoryType, archived: boolean) {
    const kind = type === 'income' ? 'receita' : 'despesa';
    super(
      archived
        ? `Já existe uma categoria de ${kind} arquivada com este nome. Reative-a em vez de criar outra.`
        : `Já existe uma categoria de ${kind} com este nome.`,
    );
  }
}

/** Categoria com a quantidade de transações que a usam (todos os períodos, qualquer status). */
export type CategoryWithUsage = Category & { transactionCount: number };

export interface CategoriesService {
  list(userId: string, query: ListCategoriesQuery): Promise<CategoryWithUsage[]>;
  /** Categoria do usuário; inexistente ou de outro usuário → `CategoryNotFoundError`. */
  get(userId: string, categoryId: string): Promise<CategoryWithUsage>;
  /** Cria a categoria do usuário; nome repetido no tipo → `DuplicateCategoryNameError`. */
  create(userId: string, input: CreateCategoryInput): Promise<CategoryWithUsage>;
  /** Altera só os campos enviados (nunca o tipo); nome repetido → `DuplicateCategoryNameError`. */
  /** Com `ifMatch`, só grava se a categoria ainda estiver na versão lida. */
  update(
    userId: string,
    categoryId: string,
    changes: UpdateCategoryInput,
    ifMatch?: IfMatch,
  ): Promise<CategoryWithUsage>;
}

export function createCategoriesService(repository: CategoriesRepository): CategoriesService {
  async function find(userId: string, categoryId: string): Promise<Category> {
    const category = await repository.findCategory(userId, categoryId);
    if (!category) {
      throw new CategoryNotFoundError();
    }
    return category;
  }

  async function withUsages(userId: string, categories: Category[]): Promise<CategoryWithUsage[]> {
    const counts = await repository.transactionCounts(
      userId,
      categories.map((category) => category.id),
    );
    return categories.map((category) => ({
      ...category,
      transactionCount: counts.get(category.id) ?? 0,
    }));
  }

  async function withUsage(userId: string, category: Category): Promise<CategoryWithUsage> {
    const [result] = await withUsages(userId, [category]);
    if (!result) throw new Error('Uso da categoria não calculado.');
    return result;
  }

  /** Monta o erro de duplicata olhando a categoria que já usa o nome. */
  async function duplicateError(
    userId: string,
    type: CategoryType,
    nameNormalized: string,
  ): Promise<DuplicateCategoryNameError> {
    const existing = await repository.findCategoryByName(userId, type, nameNormalized);
    return new DuplicateCategoryNameError(type, existing?.isArchived ?? false);
  }

  return {
    async list(userId, query) {
      return withUsages(userId, await repository.listCategories(userId, query));
    },

    async get(userId, categoryId) {
      return withUsage(userId, await find(userId, categoryId));
    },

    async create(userId, input) {
      const nameNormalized = categoryNameKey(input.name);
      const result = await repository.insertCategory({ ...input, nameNormalized, userId });
      if ('duplicate' in result) {
        throw await duplicateError(userId, input.type, nameNormalized);
      }
      // Recém-criada: nenhuma transação a usa ainda.
      return { ...result.category, transactionCount: 0 };
    },

    async update(userId, categoryId, { name, icon, color, isArchived }, ifMatch) {
      const current = ifMatch ? await find(userId, categoryId) : undefined;
      if (current) {
        assertIfMatch(ifMatch, current);
      }
      const nameNormalized = name === undefined ? undefined : categoryNameKey(name);
      const changes: CategoryChanges = {
        ...(name !== undefined && { name, nameNormalized }),
        ...(icon !== undefined && { icon }),
        ...(color !== undefined && { color }),
        // Reativar nunca colide: a unicidade do nome já conta as arquivadas.
        ...(isArchived !== undefined && { isArchived }),
      };
      // Corpo vazio: nada a alterar, mas a categoria ainda precisa existir e ser do usuário.
      if (Object.keys(changes).length === 0) {
        return withUsage(userId, current ?? (await find(userId, categoryId)));
      }
      const result = await repository.updateCategory(
        userId,
        categoryId,
        changes,
        current?.updatedAt,
      );
      if (!result) {
        throw current ? new PreconditionFailedError() : new CategoryNotFoundError();
      }
      if ('duplicate' in result) {
        // Só o nome causa duplicata, e o tipo é o da própria categoria.
        const { type } = await find(userId, categoryId);
        throw await duplicateError(userId, type, nameNormalized ?? '');
      }
      return withUsage(userId, result.category);
    },
  };
}
