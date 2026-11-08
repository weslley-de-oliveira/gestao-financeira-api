import { and, asc, eq, sql } from 'drizzle-orm';
import type { Database } from '../../db/client.ts';
import { alphabetical } from '../../db/order.ts';
import {
  accounts,
  goalContributions,
  goals,
  transactions,
  type Account,
  type NewAccount,
} from '../../db/schema/index.ts';
import { atVersion } from '../../shared/http/etag.ts';

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
  /**
   * Altera a conta só se for do usuário (e, com `version`, só se ainda estiver nessa versão);
   * devolve `null` se não encontrar.
   */
  updateAccount(
    userId: string,
    accountId: string,
    changes: AccountChanges,
    version?: Date,
  ): Promise<Account | null>;
  /**
   * Efeito somado das transações realizadas e das movimentações de metas com conta em cada conta
   * (sem o saldo inicial), com a regra de `movementEffect` e `goalMovement`. Com `before`, só as
   * anteriores a essa data (o saldo de abertura de um período). Contas sem movimentação ficam fora
   * do mapa.
   */
  movementTotals(
    userId: string,
    accountIds: readonly string[],
    options?: { before?: string },
  ): Promise<Map<string, number>>;
  /**
   * Guardado em metas por conta (regra `goalsTotal`): aportes que saíram dela − retiradas que
   * voltaram. Contas sem movimentação de metas ficam fora do mapa.
   */
  goalsTotals(userId: string, accountIds: readonly string[]): Promise<Map<string, number>>;
}

export function createAccountsRepository(db: Database): AccountsRepository {
  const ownedBy = (userId: string, accountId: string) =>
    and(eq(accounts.id, accountId), eq(accounts.userId, userId));

  /** `array[...]::uuid[]` com os ids, para `= any(...)`. */
  const idArray = (accountIds: readonly string[]) =>
    sql`array[${sql.join(
      accountIds.map((id) => sql`${id}`),
      sql`, `,
    )}]::uuid[]`;

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

    async updateAccount(userId, accountId, changes, version) {
      const [updated] = await db
        .update(accounts)
        .set(changes)
        .where(and(ownedBy(userId, accountId), version && atVersion(accounts.updatedAt, version)))
        .returning();
      return updated ?? null;
    },

    async movementTotals(userId, accountIds, { before } = {}) {
      if (accountIds.length === 0) {
        return new Map();
      }
      const ids = idArray(accountIds);
      const beforeDate = before ? sql`and ${transactions.date} < ${before}::date` : sql``;
      const contributionsBefore = before
        ? sql`and ${goalContributions.date} < ${before}::date`
        : sql``;
      // Mesma regra de `movementEffect`: pendentes não contam; receita e estorno creditam a conta; despesa,
      // pagamento de fatura e transferência debitam a conta de origem; a transferência credita o
      // destino. Compras no cartão não têm conta e ficam de fora. O aporte numa meta debita a conta
      // e a retirada credita (`goalMovement`); a tabela de movimentações chega ao dono pela meta.
      const { rows } = await db.execute<{ account_id: string; total: string }>(sql`
        select account_id, sum(effect) as total
        from (
          select ${transactions.accountId} as account_id,
            case when ${transactions.type} in ('income', 'refund') then ${transactions.amount}
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
          union all
          select ${goalContributions.accountId},
            case when ${goalContributions.type} = 'withdrawal' then ${goalContributions.amount}
              else -${goalContributions.amount} end
          from ${goalContributions}
          join ${goals} on ${goals.id} = ${goalContributions.goalId}
          where ${goals.userId} = ${userId}
            and ${goalContributions.accountId} = any(${ids})
            ${contributionsBefore}
        ) as movements
        group by account_id
      `);
      // `sum` de bigint vem como texto (numeric); os valores cabem com folga em um `number`.
      return new Map(rows.map((row) => [row.account_id, Number(row.total)]));
    },

    async goalsTotals(userId, accountIds) {
      if (accountIds.length === 0) {
        return new Map();
      }
      const rows = await db
        .select({
          accountId: goalContributions.accountId,
          total: sql<string>`sum(case when ${goalContributions.type} = 'deposit' then ${goalContributions.amount} else -${goalContributions.amount} end)`,
        })
        .from(goalContributions)
        .innerJoin(goals, eq(goals.id, goalContributions.goalId))
        .where(
          and(
            eq(goals.userId, userId),
            sql`${goalContributions.accountId} = any(${idArray(accountIds)})`,
          ),
        )
        .groupBy(goalContributions.accountId);
      return new Map(rows.map((row) => [row.accountId ?? '', Number(row.total)]));
    },
  };
}
