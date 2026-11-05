import { and, asc, eq } from 'drizzle-orm';
import type { Database } from '../../db/client.ts';
import { alphabetical } from '../../db/order.ts';
import { accounts, type Account, type NewAccount } from '../../db/schema/index.ts';

/** Campos que o usuário pode alterar: nunca o dono, o id ou as datas. */
export type AccountChanges = Partial<
  Pick<
    NewAccount,
    'name' | 'type' | 'institution' | 'initialBalance' | 'color' | 'icon' | 'isArchived'
  >
>;

export interface AccountsRepository {
  /** Contas do usuário em ordem alfabética (sem diferenciar maiúsculas e acentos). */
  listAccounts(userId: string, options: { includeArchived: boolean }): Promise<Account[]>;
  /** Conta pelo id, só se for do usuário: a de outro usuário é tratada como inexistente. */
  findAccount(userId: string, accountId: string): Promise<Account | null>;
  insertAccount(account: NewAccount): Promise<Account>;
  /** Altera a conta só se for do usuário; devolve `null` se não encontrar. */
  updateAccount(
    userId: string,
    accountId: string,
    changes: AccountChanges,
  ): Promise<Account | null>;
}

export function createAccountsRepository(db: Database): AccountsRepository {
  const ownedBy = (userId: string, accountId: string) =>
    and(eq(accounts.id, accountId), eq(accounts.userId, userId));

  return {
    async listAccounts(userId, { includeArchived }) {
      return db
        .select()
        .from(accounts)
        .where(
          and(
            eq(accounts.userId, userId),
            includeArchived ? undefined : eq(accounts.isArchived, false),
          ),
        )
        .orderBy(alphabetical(accounts.name), asc(accounts.id));
    },

    async findAccount(userId, accountId) {
      const [account] = await db.select().from(accounts).where(ownedBy(userId, accountId));
      return account ?? null;
    },

    async insertAccount(account) {
      const [created] = await db.insert(accounts).values(account).returning();
      if (!created) throw new Error('A conta não foi inserida.');
      return created;
    },

    async updateAccount(userId, accountId, changes) {
      const [updated] = await db
        .update(accounts)
        .set(changes)
        .where(ownedBy(userId, accountId))
        .returning();
      return updated ?? null;
    },
  };
}
