import { and, asc, eq, sql } from 'drizzle-orm';
import type { Database } from '../../db/client.ts';
import { alphabetical } from '../../db/order.ts';
import { accounts, transactions, type Account, type NewAccount } from '../../db/schema/index.ts';

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
  /**
   * Efeito somado das transações realizadas em cada conta (sem o saldo inicial), com a regra de
   * `movementEffect`. Com `before`, só as transações anteriores a essa data (o saldo de abertura
   * de um período). Contas sem movimentação ficam fora do mapa.
   */
  movementTotals(
    userId: string,
    accountIds: readonly string[],
    options?: { before?: string },
  ): Promise<Map<string, number>>;
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

    async movementTotals(userId, accountIds, { before } = {}) {
      if (accountIds.length === 0) {
        return new Map();
      }
      const ids = sql`array[${sql.join(
        accountIds.map((id) => sql`${id}`),
        sql`, `,
      )}]::uuid[]`;
      const beforeDate = before ? sql`and ${transactions.date} < ${before}::date` : sql``;
      // Mesma regra de `movementEffect`: pendentes não contam; receita credita a conta; despesa,
      // pagamento de fatura e transferência debitam a conta de origem; a transferência credita o
      // destino. Compras no cartão não têm conta e ficam de fora.
      const { rows } = await db.execute<{ account_id: string; total: string }>(sql`
        select account_id, sum(effect) as total
        from (
          select ${transactions.accountId} as account_id,
            case when ${transactions.type} = 'income' then ${transactions.amount}
              else -${transactions.amount} end as effect
          from ${transactions}
          where ${transactions.userId} = ${userId}
            and ${transactions.status} = 'completed'
            and ${transactions.accountId} = any(${ids})
            ${beforeDate}
          union all
          select ${transactions.destinationAccountId}, ${transactions.amount}
          from ${transactions}
          where ${transactions.userId} = ${userId}
            and ${transactions.status} = 'completed'
            and ${transactions.type} = 'transfer'
            and ${transactions.destinationAccountId} = any(${ids})
            ${beforeDate}
        ) as movements
        group by account_id
      `);
      // `sum` de bigint vem como texto (numeric); os valores cabem com folga em um `number`.
      return new Map(rows.map((row) => [row.account_id, Number(row.total)]));
    },
  };
}
