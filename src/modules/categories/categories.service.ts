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

export interface CategoriesService {
  list(userId: string, query: ListCategoriesQuery): Promise<Category[]>;
  /** Categoria do usuário; inexistente ou de outro usuário → `CategoryNotFoundError`. */
  get(userId: string, categoryId: string): Promise<Category>;
  /** Cria a categoria do usuário; nome repetido no tipo → `DuplicateCategoryNameError`. */
  create(userId: string, input: CreateCategoryInput): Promise<Category>;
  /** Altera só os campos enviados (nunca o tipo); nome repetido → `DuplicateCategoryNameError`. */
  update(userId: string, categoryId: string, changes: UpdateCategoryInput): Promise<Category>;
}

export function createCategoriesService(repository: CategoriesRepository): CategoriesService {
  async function get(userId: string, categoryId: string): Promise<Category> {
    const category = await repository.findCategory(userId, categoryId);
    if (!category) {
      throw new CategoryNotFoundError();
    }
    return category;
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
    list(userId, query) {
      return repository.listCategories(userId, query);
    },

    get,

    async create(userId, input) {
      const nameNormalized = categoryNameKey(input.name);
      const result = await repository.insertCategory({ ...input, nameNormalized, userId });
      if ('duplicate' in result) {
        throw await duplicateError(userId, input.type, nameNormalized);
      }
      return result.category;
    },

    async update(userId, categoryId, { name, icon, color, isArchived }) {
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
        return get(userId, categoryId);
      }
      const result = await repository.updateCategory(userId, categoryId, changes);
      if (!result) {
        throw new CategoryNotFoundError();
      }
      if ('duplicate' in result) {
        // Só o nome causa duplicata, e o tipo é o da própria categoria.
        const { type } = await get(userId, categoryId);
        throw await duplicateError(userId, type, nameNormalized ?? '');
      }
      return result.category;
    },
  };
}
