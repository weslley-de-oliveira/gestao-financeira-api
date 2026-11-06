import type { Goal, GoalContribution } from '../../db/schema/index.ts';
import { DomainError, InvalidInputError } from '../../shared/errors/domain-error.ts';
import type { IsoDate } from '../../shared/utils/date.ts';
import {
  calculateGoalProgress,
  compareGoals,
  goalBalance,
  type GoalProgress,
} from './goal-rules.ts';
import type { GoalsRepository } from './goals.repository.ts';
import {
  createGoalBodySchema,
  type CreateContributionInput,
  type CreateGoalInput,
  type ListGoalsQuery,
  type UpdateGoalInput,
} from './goals.schemas.ts';
import { assertIfMatch, PreconditionFailedError, type IfMatch } from '../../shared/http/etag.ts';

/** Meta inexistente ou de outro usuário: a mesma resposta, para não revelar o que existe. */
export class GoalNotFoundError extends DomainError {
  readonly kind = 'not-found';

  constructor() {
    super('Meta não encontrada.');
  }
}

export class ContributionNotFoundError extends DomainError {
  readonly kind = 'not-found';

  constructor() {
    super('Movimentação não encontrada.');
  }
}

/** A operação deixaria o valor acumulado da meta negativo. */
export class InsufficientGoalBalanceError extends DomainError {
  readonly kind = 'conflict';
}

/**
 * Meta com os aportes e retiradas (dos mais recentes para os mais antigos) e o progresso
 * calculado para hoje.
 */
export type GoalWithContributions = Goal & { contributions: GoalContribution[] } & GoalProgress;

export interface GoalsServiceDependencies {
  goals: GoalsRepository;
  /** Data de hoje (`yyyy-MM-dd`): prazo e movimentações não podem ser em datas inválidas. */
  today: () => IsoDate;
}

export interface GoalsService {
  /**
   * Metas do usuário, o que pede ação primeiro: atrasadas, em andamento, pausadas e concluídas;
   * depois o prazo mais próximo e o nome.
   */
  list(userId: string, query: ListGoalsQuery): Promise<GoalWithContributions[]>;
  /** Meta do usuário; inexistente ou de outro usuário → `GoalNotFoundError`. */
  get(userId: string, goalId: string): Promise<GoalWithContributions>;
  /** Cria a meta; data-limite no passado → `InvalidInputError`. */
  create(userId: string, input: CreateGoalInput): Promise<GoalWithContributions>;
  /**
   * Aplica os campos enviados e valida o resultado com as regras do cadastro. Uma data-limite já
   * vencida pode ser mantida, mas não definida de novo; o valor inicial não pode deixar o
   * acumulado negativo (`InsufficientGoalBalanceError`).
   */
  /** Com `ifMatch`, só grava se a meta ainda estiver na versão lida (aportes mudam a versão). */
  update(
    userId: string,
    goalId: string,
    changes: UpdateGoalInput,
    ifMatch?: IfMatch,
  ): Promise<GoalWithContributions>;
  /** Registra aporte ou retirada até hoje; retirada maior que o acumulado → 409. */
  addContribution(
    userId: string,
    goalId: string,
    input: CreateContributionInput,
  ): Promise<GoalWithContributions>;
  /** Exclui a movimentação; se isso deixar o acumulado negativo → 409. */
  removeContribution(
    userId: string,
    goalId: string,
    contributionId: string,
  ): Promise<GoalWithContributions>;
}

const PAST_DEADLINE = 'A data-limite deve ser hoje ou uma data futura.';

export function createGoalsService({ goals, today }: GoalsServiceDependencies): GoalsService {
  /** Movimentações de cada meta e o progresso calculado para hoje. */
  async function withContributions(list: Goal[]): Promise<GoalWithContributions[]> {
    const contributions = await goals.listContributions(list.map((goal) => goal.id));
    const date = today();
    return list.map((goal) => {
      const own = contributions.filter((item) => item.goalId === goal.id);
      return {
        ...goal,
        contributions: own,
        ...calculateGoalProgress({ ...goal, contributions: own }, date),
      };
    });
  }

  async function withOne(goal: Goal): Promise<GoalWithContributions> {
    const [result] = await withContributions([goal]);
    if (!result) throw new Error('Movimentações da meta não carregadas.');
    return result;
  }

  async function find(userId: string, goalId: string): Promise<Goal> {
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
    async list(userId, query) {
      const list = await withContributions(await goals.listGoals(userId, query));
      // O que pede ação primeiro, como na tela de metas do front.
      return list.toSorted(compareGoals);
    },

    async get(userId, goalId) {
      return withOne(await find(userId, goalId));
    },

    async create(userId, input) {
      assertDeadline(input.deadline);
      return withOne(await goals.insertGoal({ ...input, userId }));
    },

    async update(userId, goalId, { isPaused, isArchived, ...changes }, ifMatch) {
      const current = await withOne(await find(userId, goalId));
      assertIfMatch(ifMatch, current);
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
      if (goalBalance(result.data.initialAmount, current.contributions) < 0) {
        throw new InsufficientGoalBalanceError(
          'Com esse valor inicial, as retiradas deixariam o acumulado negativo.',
        );
      }

      const updated = await goals.updateGoal(
        userId,
        goalId,
        {
          ...result.data,
          ...(isPaused !== undefined && { isPaused }),
          ...(isArchived !== undefined && { isArchived }),
        },
        ifMatch && current.updatedAt,
      );
      if (!updated) {
        throw ifMatch ? new PreconditionFailedError() : new GoalNotFoundError();
      }
      return withOne(updated);
    },

    async addContribution(userId, goalId, input) {
      if (input.date > today()) {
        throw new InvalidInputError([{ field: 'date', message: 'A data não pode ser futura.' }]);
      }
      const result = await goals.insertContribution(userId, goalId, input);
      if (result.status === 'goal-not-found') {
        throw new GoalNotFoundError();
      }
      if (result.status === 'negative-balance') {
        throw new InsufficientGoalBalanceError('A retirada é maior que o valor acumulado.');
      }
      return withOne(await find(userId, goalId));
    },

    async removeContribution(userId, goalId, contributionId) {
      const result = await goals.deleteContribution(userId, goalId, contributionId);
      switch (result.status) {
        case 'goal-not-found':
          throw new GoalNotFoundError();
        case 'contribution-not-found':
          throw new ContributionNotFoundError();
        case 'negative-balance':
          throw new InsufficientGoalBalanceError(
            'Sem este aporte, as retiradas deixariam o acumulado negativo.',
          );
        case 'ok':
          return withOne(await find(userId, goalId));
      }
    },
  };
}
