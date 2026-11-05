import { and, asc, eq } from 'drizzle-orm';
import type { Database } from '../../db/client.ts';
import { alphabetical } from '../../db/order.ts';
import { categories, type Category } from '../../db/schema/index.ts';
import type { CategoryType } from './categories.constants.ts';

export interface CategoriesRepository {
  /** Categorias do usuário em ordem alfabética, opcionalmente de um tipo só. */
  listCategories(
    userId: string,
    options: { type?: CategoryType | undefined; includeArchived: boolean },
  ): Promise<Category[]>;
  /** Categoria pelo id, só se for do usuário: a de outro usuário é tratada como inexistente. */
  findCategory(userId: string, categoryId: string): Promise<Category | null>;
}

export function createCategoriesRepository(db: Database): CategoriesRepository {
  return {
    async listCategories(userId, { type, includeArchived }) {
      return db
        .select()
        .from(categories)
        .where(
          and(
            eq(categories.userId, userId),
            type ? eq(categories.type, type) : undefined,
            includeArchived ? undefined : eq(categories.isArchived, false),
          ),
        )
        .orderBy(alphabetical(categories.name), asc(categories.id));
    },

    async findCategory(userId, categoryId) {
      const [category] = await db
        .select()
        .from(categories)
        .where(and(eq(categories.id, categoryId), eq(categories.userId, userId)));
      return category ?? null;
    },
  };
}
