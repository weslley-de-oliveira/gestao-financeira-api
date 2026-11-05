import { eq } from 'drizzle-orm';
import type { Database } from '../../db/client.ts';
import { users, type User } from '../../db/schema/index.ts';

export interface UsersRepository {
  /** Altera o nome; devolve `null` se o usuário não existir mais. */
  updateName(userId: string, name: string): Promise<User | null>;
}

export function createUsersRepository(db: Database): UsersRepository {
  return {
    async updateName(userId, name) {
      const [updated] = await db
        .update(users)
        .set({ name })
        .where(eq(users.id, userId))
        .returning();
      return updated ?? null;
    },
  };
}
