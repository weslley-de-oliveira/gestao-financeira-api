import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '../../db/client.ts';
import { alphabetical } from '../../db/order.ts';
import {
  goalContributions,
  goals,
  type Goal,
  type GoalContribution,
  type NewGoal,
  type NewGoalContribution,
} from '../../db/schema/index.ts';
import { atVersion } from '../../shared/http/etag.ts';

/** Campos que o usuário pode alterar: nunca o dono, o id ou as datas de registro. */
export type GoalChanges = Partial<Omit<NewGoal, 'id' | 'userId' | 'createdAt' | 'updatedAt'>>;

/** Resultado de uma movimentação que mexe no acumulado. */
export type BalanceChange<T> =
  | { status: 'goal-not-found' }
  | { status: 'contribution-not-found' }
  | { status: 'negative-balance' }
  | { status: 'ok'; value: T };

export interface GoalsRepository {
  /** Metas do usuário: prazo mais próximo primeiro (sem prazo por último), depois o nome. */
  listGoals(userId: string, options: { includeArchived: boolean }): Promise<Goal[]>;
  /** Meta pelo id, só se for do usuário: a de outro usuário é tratada como inexistente. */
  findGoal(userId: string, goalId: string): Promise<Goal | null>;
  insertGoal(goal: NewGoal): Promise<Goal>;
  /** Altera a meta só se for do usuário; devolve `null` se não encontrar. */
  /** Com `version`, só altera se a meta ainda estiver nessa versão; `null` se não encontrar. */
  updateGoal(
    userId: string,
    goalId: string,
    changes: GoalChanges,
    version?: Date,
  ): Promise<Goal | null>;
  /** Aportes e retiradas das metas, das mais recentes para as mais antigas. */
  listContributions(goalIds: readonly string[]): Promise<GoalContribution[]>;
  /**
   * Registra o aporte ou a retirada, se a meta for do usuário e o acumulado não ficar negativo.
   * A meta fica travada durante a conta: duas retiradas simultâneas não passam juntas.
   */
  insertContribution(
    userId: string,
    goalId: string,
    contribution: Omit<NewGoalContribution, 'goalId'>,
  ): Promise<BalanceChange<GoalContribution>>;
  /** Exclui a movimentação, se o acumulado não ficar negativo (com a meta travada). */
  deleteContribution(
    userId: string,
    goalId: string,
    contributionId: string,
  ): Promise<BalanceChange<null>>;
}

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export function createGoalsRepository(db: Database): GoalsRepository {
  const ownedBy = (userId: string, goalId: string) =>
    and(eq(goals.id, goalId), eq(goals.userId, userId));

  /** Meta do usuário travada para atualização até o fim da transação. */
  async function lockGoal(tx: Transaction, userId: string, goalId: string) {
    const [goal] = await tx.select().from(goals).where(ownedBy(userId, goalId)).for('update');
    return goal;
  }

  /** Aportes e retiradas mudam a meta (o acumulado): ela ganha uma versão nova (ETag). */
  async function touchGoal(tx: Transaction, goalId: string): Promise<void> {
    await tx.update(goals).set({ updatedAt: new Date() }).where(eq(goals.id, goalId));
  }

  /** Aportes − retiradas da meta (sem o valor inicial). */
  async function contributionsTotal(tx: Transaction, goalId: string): Promise<number> {
    const [row] = await tx
      .select({
        total: sql<string>`coalesce(sum(case when ${goalContributions.type} = 'deposit' then ${goalContributions.amount} else -${goalContributions.amount} end), 0)`,
      })
      .from(goalContributions)
      .where(eq(goalContributions.goalId, goalId));
    return Number(row?.total ?? 0);
  }

  return {
    async listGoals(userId, { includeArchived }) {
      return db
        .select()
        .from(goals)
        .where(
          and(eq(goals.userId, userId), includeArchived ? undefined : eq(goals.isArchived, false)),
        )
        .orderBy(sql`${goals.deadline} asc nulls last`, alphabetical(goals.name), asc(goals.id));
    },

    async findGoal(userId, goalId) {
      const [goal] = await db.select().from(goals).where(ownedBy(userId, goalId));
      return goal ?? null;
    },

    async insertGoal(goal) {
      const [created] = await db.insert(goals).values(goal).returning();
      if (!created) throw new Error('A meta não foi inserida.');
      return created;
    },

    async updateGoal(userId, goalId, changes, version) {
      const [updated] = await db
        .update(goals)
        .set(changes)
        .where(and(ownedBy(userId, goalId), version && atVersion(goals.updatedAt, version)))
        .returning();
      return updated ?? null;
    },

    async listContributions(goalIds) {
      if (goalIds.length === 0) {
        return [];
      }
      return (
        db
          .select()
          .from(goalContributions)
          .where(inArray(goalContributions.goalId, [...goalIds]))
          // O id é UUID v7: no mesmo dia, a registrada por último vem primeiro.
          .orderBy(desc(goalContributions.date), desc(goalContributions.id))
      );
    },

    async insertContribution(userId, goalId, contribution) {
      return db.transaction(async (tx): Promise<BalanceChange<GoalContribution>> => {
        const goal = await lockGoal(tx, userId, goalId);
        if (!goal) {
          return { status: 'goal-not-found' };
        }
        const delta = contribution.type === 'deposit' ? contribution.amount : -contribution.amount;
        if (goal.initialAmount + (await contributionsTotal(tx, goalId)) + delta < 0) {
          return { status: 'negative-balance' };
        }
        const [created] = await tx
          .insert(goalContributions)
          .values({ ...contribution, goalId })
          .returning();
        if (!created) throw new Error('A movimentação não foi inserida.');
        await touchGoal(tx, goalId);
        return { status: 'ok', value: created };
      });
    },

    async deleteContribution(userId, goalId, contributionId) {
      return db.transaction(async (tx): Promise<BalanceChange<null>> => {
        const goal = await lockGoal(tx, userId, goalId);
        if (!goal) {
          return { status: 'goal-not-found' };
        }
        const [contribution] = await tx
          .select()
          .from(goalContributions)
          .where(
            and(eq(goalContributions.id, contributionId), eq(goalContributions.goalId, goalId)),
          );
        if (!contribution) {
          return { status: 'contribution-not-found' };
        }
        const delta = contribution.type === 'deposit' ? -contribution.amount : contribution.amount;
        if (goal.initialAmount + (await contributionsTotal(tx, goalId)) + delta < 0) {
          return { status: 'negative-balance' };
        }
        await tx.delete(goalContributions).where(eq(goalContributions.id, contributionId));
        await touchGoal(tx, goalId);
        return { status: 'ok', value: null };
      });
    },
  };
}
