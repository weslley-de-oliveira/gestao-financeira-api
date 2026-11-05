import { and, eq, gt } from 'drizzle-orm';
import type { Database } from '../../db/client.ts';
import { isUniqueViolation } from '../../db/errors.ts';
import {
  sessions,
  users,
  type NewSession,
  type NewUser,
  type User,
} from '../../db/schema/index.ts';

export interface AuthRepository {
  /** Insere o usuário; devolve `null` se o e-mail já estiver cadastrado. */
  insertUser(user: NewUser): Promise<User | null>;
  /** Busca pelo e-mail sem diferenciar maiúsculas (coluna `citext`). */
  findUserByEmail(email: string): Promise<User | null>;
  updatePasswordHash(userId: string, passwordHash: string): Promise<void>;
  insertSession(session: NewSession): Promise<void>;
  /** Sessão com este hash de token que ainda não expirou em `now`, com o usuário dela. */
  findActiveSession(
    tokenHash: string,
    now: Date,
  ): Promise<{ user: User; sessionId: string } | null>;
  deleteSession(tokenHash: string): Promise<void>;
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
        .select({ sessionId: sessions.id, user: users })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, now)))
        .limit(1);
      return row ?? null;
    },

    async deleteSession(tokenHash) {
      await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
    },
  };
}
