import type { Goal } from '../../db/schema/index.ts';
import { DomainError, InvalidInputError } from '../../shared/errors/domain-error.ts';
import type { IsoDate } from '../../shared/utils/date.ts';
import type { GoalsRepository } from './goals.repository.ts';
import {
  createGoalBodySchema,
  type CreateGoalInput,
  type ListGoalsQuery,
  type UpdateGoalInput,
} from './goals.schemas.ts';

/** Meta inexistente ou de outro usuário: a mesma resposta, para não revelar o que existe. */
export class GoalNotFoundError extends DomainError {
  readonly kind = 'not-found';

  constructor() {
    super('Meta não encontrada.');
  }
}

export interface GoalsServiceDependencies {
  goals: GoalsRepository;
  /** Data de hoje (`yyyy-MM-dd`): a data-limite não pode ficar no passado. */
  today: () => IsoDate;
}

export interface GoalsService {
  list(userId: string, query: ListGoalsQuery): Promise<Goal[]>;
  /** Meta do usuário; inexistente ou de outro usuário → `GoalNotFoundError`. */
  get(userId: string, goalId: string): Promise<Goal>;
  /** Cria a meta; data-limite no passado → `InvalidInputError`. */
  create(userId: string, input: CreateGoalInput): Promise<Goal>;
  /**
   * Aplica os campos enviados e valida o resultado com as regras do cadastro. Uma data-limite já
   * vencida pode ser mantida, mas não definida de novo.
   */
  update(userId: string, goalId: string, changes: UpdateGoalInput): Promise<Goal>;
}

const PAST_DEADLINE = 'A data-limite deve ser hoje ou uma data futura.';

export function createGoalsService({ goals, today }: GoalsServiceDependencies): GoalsService {
  async function get(userId: string, goalId: string): Promise<Goal> {
    const goal = await goals.findGoal(userId, goalId);
    if (!goal) {
      throw new GoalNotFoundError();
    }
    return goal;
  }

  function assertDeadline(deadline: IsoDate | null): void {
    if (deadline !== null && deadline < today()) {
      throw new InvalidInputError([{ field: 'deadline', message: PAST_DEADLINE }]);
    }
  }

  return {
    list(userId, query) {
      return goals.listGoals(userId, query);
    },

    get,

    async create(userId, input) {
      assertDeadline(input.deadline);
      return goals.insertGoal({ ...input, userId });
    },

    async update(userId, goalId, { isPaused, isArchived, ...changes }) {
      const current = await get(userId, goalId);
      // O resultado da edição precisa valer como um cadastro.
      const result = createGoalBodySchema.safeParse({
        name: changes.name ?? current.name,
        description: changes.description === undefined ? current.description : changes.description,
        targetAmount: changes.targetAmount ?? current.targetAmount,
        initialAmount: changes.initialAmount ?? current.initialAmount,
        deadline: changes.deadline === undefined ? current.deadline : changes.deadline,
        color: changes.color ?? current.color,
        icon: changes.icon ?? current.icon,
      });
      if (!result.success) {
        throw new InvalidInputError(
          result.error.issues.map((issue) => ({
            field: issue.path.map(String).join('.'),
            message: issue.message,
          })),
        );
      }
      if (result.data.deadline !== current.deadline) {
        assertDeadline(result.data.deadline);
      }

      const updated = await goals.updateGoal(userId, goalId, {
        ...result.data,
        ...(isPaused !== undefined && { isPaused }),
        ...(isArchived !== undefined && { isArchived }),
      });
      if (!updated) {
        throw new GoalNotFoundError();
      }
      return updated;
    },
  };
}
