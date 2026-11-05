import { and, asc, eq, sql } from 'drizzle-orm';
import type { Database } from '../../db/client.ts';
import { alphabetical } from '../../db/order.ts';
import { goals, type Goal, type NewGoal } from '../../db/schema/index.ts';

/** Campos que o usuário pode alterar: nunca o dono, o id ou as datas de registro. */
export type GoalChanges = Partial<Omit<NewGoal, 'id' | 'userId' | 'createdAt' | 'updatedAt'>>;

export interface GoalsRepository {
  /** Metas do usuário: prazo mais próximo primeiro (sem prazo por último), depois o nome. */
  listGoals(userId: string, options: { includeArchived: boolean }): Promise<Goal[]>;
  /** Meta pelo id, só se for do usuário: a de outro usuário é tratada como inexistente. */
  findGoal(userId: string, goalId: string): Promise<Goal | null>;
  insertGoal(goal: NewGoal): Promise<Goal>;
  /** Altera a meta só se for do usuário; devolve `null` se não encontrar. */
  updateGoal(userId: string, goalId: string, changes: GoalChanges): Promise<Goal | null>;
}

export function createGoalsRepository(db: Database): GoalsRepository {
  const ownedBy = (userId: string, goalId: string) =>
    and(eq(goals.id, goalId), eq(goals.userId, userId));

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

    async updateGoal(userId, goalId, changes) {
      const [updated] = await db
        .update(goals)
        .set(changes)
        .where(ownedBy(userId, goalId))
        .returning();
      return updated ?? null;
    },
  };
}
