import type { Category } from '../../db/schema/index.ts';
import { DomainError } from '../../shared/errors/domain-error.ts';
import type { CategoriesRepository } from './categories.repository.ts';
import type { ListCategoriesQuery } from './categories.schemas.ts';

/** Categoria inexistente ou de outro usuário: a mesma resposta, para não revelar o que existe. */
export class CategoryNotFoundError extends DomainError {
  readonly kind = 'not-found';

  constructor() {
    super('Categoria não encontrada.');
  }
}

export interface CategoriesService {
  list(userId: string, query: ListCategoriesQuery): Promise<Category[]>;
  /** Categoria do usuário; inexistente ou de outro usuário → `CategoryNotFoundError`. */
  get(userId: string, categoryId: string): Promise<Category>;
}

export function createCategoriesService(repository: CategoriesRepository): CategoriesService {
  return {
    list(userId, query) {
      return repository.listCategories(userId, query);
    },

    async get(userId, categoryId) {
      const category = await repository.findCategory(userId, categoryId);
      if (!category) {
        throw new CategoryNotFoundError();
      }
      return category;
    },
  };
}
