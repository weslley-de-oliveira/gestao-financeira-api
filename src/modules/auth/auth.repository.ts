import type { Database } from '../../db/client.ts';
import { isUniqueViolation } from '../../db/errors.ts';
import { users, type NewUser, type User } from '../../db/schema/index.ts';

export interface AuthRepository {
  /** Insere o usuário; devolve `null` se o e-mail já estiver cadastrado. */
  insertUser(user: NewUser): Promise<User | null>;
}

export function createAuthRepository(db: Database): AuthRepository {
  return {
    async insertUser(user) {
      try {
        const [created] = await db.insert(users).values(user).returning();
        return created ?? null;
      } catch (error) {
        // A constraint resolve a corrida de dois cadastros simultâneos com o mesmo e-mail.
        if (isUniqueViolation(error, 'users_email_unique')) {
          return null;
        }
        throw error;
      }
    },
  };
}
