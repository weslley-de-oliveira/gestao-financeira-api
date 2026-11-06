import { and, eq, ne } from 'drizzle-orm';
import type { Database } from '../../db/client.ts';
import { sessions, users, type User } from '../../db/schema/index.ts';

export interface UsersRepository {
  findUser(userId: string): Promise<User | null>;
  /** Altera o nome; devolve `null` se o usuário não existir mais. */
  updateName(userId: string, name: string): Promise<User | null>;
  /**
   * Exclui o usuário. As chaves estrangeiras levam junto, em cascata, todos os dados dele: contas,
   * categorias, transações, cartões, orçamentos, metas e sessões.
   */
  deleteUser(userId: string): Promise<void>;
  /**
   * Grava o hash da senha nova e encerra as outras sessões da pessoa (outros aparelhos), mantendo
   * a sessão `keepSessionId`, de onde a troca foi feita. Tudo numa transação.
   */
  changePassword(userId: string, passwordHash: string, keepSessionId: string): Promise<void>;
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

    async changePassword(userId, passwordHash, keepSessionId) {
      await db.transaction(async (tx) => {
        await tx.update(users).set({ passwordHash }).where(eq(users.id, userId));
        await tx
          .delete(sessions)
          .where(and(eq(sessions.userId, userId), ne(sessions.id, keepSessionId)));
      });
    },
  };
}
