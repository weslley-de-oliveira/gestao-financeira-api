import { eq } from 'drizzle-orm';
import type { Database } from '../../db/client.ts';
import { users, type User } from '../../db/schema/index.ts';

export interface UsersRepository {
  findUser(userId: string): Promise<User | null>;
  /** Altera o nome; devolve `null` se o usuário não existir mais. */
  updateName(userId: string, name: string): Promise<User | null>;
  /**
   * Exclui o usuário. As chaves estrangeiras levam junto, em cascata, todos os dados dele: contas,
   * categorias, transações, cartões, orçamentos, metas e sessões.
   */
  deleteUser(userId: string): Promise<void>;
}

export function createUsersRepository(db: Database): UsersRepository {
  return {
    async findUser(userId) {
      const [user] = await db.select().from(users).where(eq(users.id, userId));
      return user ?? null;
    },

    async updateName(userId, name) {
      const [updated] = await db
        .update(users)
        .set({ name })
        .where(eq(users.id, userId))
        .returning();
      return updated ?? null;
    },

    async deleteUser(userId) {
      await db.delete(users).where(eq(users.id, userId));
    },
  };
}
