import { and, asc, eq, sql } from 'drizzle-orm';
import type { Database } from '../../db/client.ts';
import { accounts, type Account } from '../../db/schema/index.ts';

export interface AccountsRepository {
  /** Contas do usuário em ordem alfabética (sem diferenciar maiúsculas e acentos). */
  listAccounts(userId: string, options: { includeArchived: boolean }): Promise<Account[]>;
  /** Conta pelo id, só se for do usuário: a de outro usuário é tratada como inexistente. */
  findAccount(userId: string, accountId: string): Promise<Account | null>;
}

export function createAccountsRepository(db: Database): AccountsRepository {
  return {
    async listAccounts(userId, { includeArchived }) {
      return (
        db
          .select()
          .from(accounts)
          .where(
            and(
              eq(accounts.userId, userId),
              includeArchived ? undefined : eq(accounts.isArchived, false),
            ),
          )
          // Collation ICU: ordena como o `localeCompare` do front ("Álvaro" antes de "banco").
          .orderBy(asc(sql`${accounts.name} collate "und-x-icu"`), asc(accounts.id))
      );
    },

    async findAccount(userId, accountId) {
      const [account] = await db
        .select()
        .from(accounts)
        .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)));
      return account ?? null;
    },
  };
}
