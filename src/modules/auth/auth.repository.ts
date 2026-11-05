import { and, eq, gt } from 'drizzle-orm';
import type { Database } from '../../db/client.ts';
import { isUniqueViolation } from '../../db/errors.ts';
import {
  categories,
  sessions,
  users,
  type NewSession,
  type NewUser,
  type Session,
  type User,
} from '../../db/schema/index.ts';
import {
  DEFAULT_CATEGORIES,
  defaultCategoriesFor,
  type DefaultCategory,
} from '../categories/default-categories.ts';

export interface AuthRepository {
  /**
   * Insere o usuário e o conjunto inicial de categorias na mesma transação: ou entra tudo, ou
   * nada. Devolve `null` se o e-mail já estiver cadastrado.
   */
  insertUser(user: NewUser): Promise<User | null>;
  /** Busca pelo e-mail sem diferenciar maiúsculas (coluna `citext`). */
  findUserByEmail(email: string): Promise<User | null>;
  updatePasswordHash(userId: string, passwordHash: string): Promise<void>;
  insertSession(session: NewSession): Promise<void>;
  /** Sessão com este hash de token que ainda não expirou em `now`, com o usuário dela. */
  findActiveSession(tokenHash: string, now: Date): Promise<{ user: User; session: Session } | null>;
  /** Registra o uso da sessão e estende a validade (expiração deslizante). */
  touchSession(sessionId: string, lastSeenAt: Date, expiresAt: Date): Promise<void>;
  deleteSession(tokenHash: string): Promise<void>;
}

/**
 * `defaultCategories` existe para os testes provarem a transação (um conjunto inválido desfaz o
 * cadastro); a aplicação usa sempre o padrão.
 */
export function createAuthRepository(
  db: Database,
  defaultCategories: readonly DefaultCategory[] = DEFAULT_CATEGORIES,
): AuthRepository {
  return {
    async insertUser(user) {
      try {
        return await db.transaction(async (tx) => {
          const [created] = await tx.insert(users).values(user).returning();
          if (!created) throw new Error('O usuário não foi inserido.');
          await tx.insert(categories).values(defaultCategoriesFor(created.id, defaultCategories));
          return created;
        });
      } catch (error) {
        // A constraint resolve a corrida de dois cadastros simultâneos com o mesmo e-mail.
        if (isUniqueViolation(error, 'users_email_unique')) {
          return null;
        }
        throw error;
      }
    },

    async findUserByEmail(email) {
      const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
      return user ?? null;
    },

    async updatePasswordHash(userId, passwordHash) {
      await db.update(users).set({ passwordHash }).where(eq(users.id, userId));
    },

    async insertSession(session) {
      await db.insert(sessions).values(session);
    },

    async findActiveSession(tokenHash, now) {
      const [row] = await db
        .select({ session: sessions, user: users })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, now)))
        .limit(1);
      return row ?? null;
    },

    async touchSession(sessionId, lastSeenAt, expiresAt) {
      await db.update(sessions).set({ lastSeenAt, expiresAt }).where(eq(sessions.id, sessionId));
    },

    async deleteSession(tokenHash) {
      await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
    },
  };
}
