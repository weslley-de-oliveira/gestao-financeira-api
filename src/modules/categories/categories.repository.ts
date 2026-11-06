import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '../../db/client.ts';
import { isUniqueViolation } from '../../db/errors.ts';
import { alphabetical } from '../../db/order.ts';
import {
  categories,
  transactions,
  type Category,
  type NewCategory,
} from '../../db/schema/index.ts';
import type { CategoryType } from './categories.constants.ts';
import { atVersion } from '../../shared/http/etag.ts';

/** Campos que o usuário pode alterar: nunca o dono, o tipo, o id ou as datas. */
export type CategoryChanges = Partial<
  Pick<NewCategory, 'name' | 'nameNormalized' | 'icon' | 'color' | 'isArchived'>
>;

/** Resultado de uma gravação: a categoria, ou o aviso de que o nome já existe no tipo. */
export type CategoryWrite = { category: Category } | { duplicate: true };

const NAME_UNIQUE_CONSTRAINT = 'categories_user_type_name_unique';

export interface CategoriesRepository {
  /** Categorias do usuário em ordem alfabética, opcionalmente de um tipo só. */
  listCategories(
    userId: string,
    options: { type?: CategoryType | undefined; includeArchived: boolean },
  ): Promise<Category[]>;
  /** Categoria pelo id, só se for do usuário: a de outro usuário é tratada como inexistente. */
  findCategory(userId: string, categoryId: string): Promise<Category | null>;
  /** Categoria do usuário com este nome normalizado no tipo, arquivada ou não. */
  findCategoryByName(
    userId: string,
    type: CategoryType,
    nameNormalized: string,
  ): Promise<Category | null>;
  insertCategory(category: NewCategory): Promise<CategoryWrite>;
  /**
   * Altera a categoria só se for do usuário (e, com `version`, só se ainda estiver nessa versão);
   * devolve `null` se não encontrar.
   */
  updateCategory(
    userId: string,
    categoryId: string,
    changes: CategoryChanges,
    version?: Date,
  ): Promise<CategoryWrite | null>;
  /**
   * Quantidade de transações de cada categoria, em todos os períodos e de qualquer status.
   * Categorias sem transações ficam fora do mapa.
   */
  transactionCounts(userId: string, categoryIds: readonly string[]): Promise<Map<string, number>>;
}

export function createCategoriesRepository(db: Database): CategoriesRepository {
  /** A constraint `UNIQUE` decide a duplicata, inclusive em gravações simultâneas. */
  async function guardDuplicate(
    write: () => Promise<Category | undefined>,
  ): Promise<CategoryWrite | null> {
    try {
      const category = await write();
      return category ? { category } : null;
    } catch (error) {
      if (isUniqueViolation(error, NAME_UNIQUE_CONSTRAINT)) {
        return { duplicate: true };
      }
      throw error;
    }
  }

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

    async findCategoryByName(userId, type, nameNormalized) {
      const [category] = await db
        .select()
        .from(categories)
        .where(
          and(
            eq(categories.userId, userId),
            eq(categories.type, type),
            eq(categories.nameNormalized, nameNormalized),
          ),
        );
      return category ?? null;
    },

    async insertCategory(category) {
      const result = await guardDuplicate(async () => {
        const [created] = await db.insert(categories).values(category).returning();
        return created;
      });
      if (!result) throw new Error('A categoria não foi inserida.');
      return result;
    },

    async updateCategory(userId, categoryId, changes, version) {
      return guardDuplicate(async () => {
        const [updated] = await db
          .update(categories)
          .set(changes)
          .where(
            and(
              eq(categories.id, categoryId),
              eq(categories.userId, userId),
              version && atVersion(categories.updatedAt, version),
            ),
          )
          .returning();
        return updated;
      });
    },

    async transactionCounts(userId, categoryIds) {
      if (categoryIds.length === 0) {
        return new Map();
      }
      const rows = await db
        .select({
          categoryId: transactions.categoryId,
          count: sql<number>`count(*)`.mapWith(Number),
        })
        .from(transactions)
        .where(
          and(eq(transactions.userId, userId), inArray(transactions.categoryId, [...categoryIds])),
        )
        .groupBy(transactions.categoryId);
      return new Map(
        rows.flatMap(({ categoryId, count }) => (categoryId ? [[categoryId, count] as const] : [])),
      );
    },
  };
}
