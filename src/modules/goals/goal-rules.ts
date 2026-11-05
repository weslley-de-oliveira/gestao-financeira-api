import { parseIsoDate, type IsoDate } from '../../shared/utils/date.ts';
import type { Cents } from '../../shared/utils/money.ts';
import type { ContributionType } from './goals.constants.ts';

/** Regras de meta, portadas do front (`goal-rules.ts` e `goal-query.ts`). */

/** Status calculado: concluída > pausada > atrasada > em andamento. */
export const GOAL_STATUSES = ['in-progress', 'completed', 'paused', 'overdue'] as const;

export type GoalStatus = (typeof GOAL_STATUSES)[number];

export interface GoalProgressInput {
  name: string;
  targetAmount: Cents;
  initialAmount: Cents;
  deadline: IsoDate | null;
  isPaused: boolean;
  contributions: readonly { type: ContributionType; amount: Cents }[];
}

/** Progresso calculado (não é guardado). */
export interface GoalProgress {
  /** Inicial + aportes − retiradas. */
  currentAmount: Cents;
  /** Quanto falta para o alvo; zero quando atingido. */
  remainingAmount: Cents;
  /** Quanto passou do alvo; zero enquanto não atingido. */
  excessAmount: Cents;
  /** Percentual atingido, sem limite superior. */
  percent: number;
  status: GoalStatus;
  /** Meses até o prazo, contando o atual; `null` sem prazo, concluída ou com prazo vencido. */
  monthsLeft: number | null;
  /** Aporte mensal necessário para atingir o alvo no prazo; mesmo critério de `monthsLeft`. */
  monthlyPace: Cents | null;
}

/** Inicial + aportes − retiradas. */
export function goalBalance(
  initialAmount: Cents,
  contributions: readonly { type: ContributionType; amount: Cents }[],
): Cents {
  return contributions.reduce(
    (total, item) => total + (item.type === 'deposit' ? item.amount : -item.amount),
    initialAmount,
  );
}

/**
 * Status pela regra única: concluída quando o acumulado atinge o alvo; senão pausada (escolha da
 * pessoa); senão atrasada quando o prazo já passou; senão em andamento.
 */
export function goalStatus(
  goal: Pick<GoalProgressInput, 'targetAmount' | 'deadline' | 'isPaused'>,
  currentAmount: Cents,
  today: IsoDate,
): GoalStatus {
  if (currentAmount >= goal.targetAmount) {
    return 'completed';
  }
  if (goal.isPaused) {
    return 'paused';
  }
  return goal.deadline && goal.deadline < today ? 'overdue' : 'in-progress';
}

/**
 * Progresso, valor restante, excedente (não é descartado) e ritmo: o aporte mensal necessário
 * divide o que falta pelos meses até o prazo, contando o mês atual, arredondado para cima.
 */
export function calculateGoalProgress(goal: GoalProgressInput, today: IsoDate): GoalProgress {
  const currentAmount = goalBalance(goal.initialAmount, goal.contributions);
  const status = goalStatus(goal, currentAmount, today);
  const remainingAmount = Math.max(0, goal.targetAmount - currentAmount);

  // Sem ritmo quando concluída, sem prazo ou com prazo vencido (inclusive se pausada).
  let monthsLeft: number | null = null;
  const deadline = goal.deadline && goal.deadline >= today ? parseIsoDate(goal.deadline) : null;
  const now = parseIsoDate(today);
  if (deadline && now && status !== 'completed') {
    monthsLeft = calendarMonthsBetween(now, deadline) + 1;
  }

  return {
    currentAmount,
    remainingAmount,
    excessAmount: Math.max(0, currentAmount - goal.targetAmount),
    percent: (currentAmount / goal.targetAmount) * 100,
    status,
    monthsLeft,
    monthlyPace: monthsLeft === null ? null : Math.ceil(remainingAmount / monthsLeft),
  };
}

/** Prioridade na listagem: o que pede ação primeiro. */
const STATUS_ORDER: Readonly<Record<GoalStatus, number>> = {
  overdue: 0,
  'in-progress': 1,
  paused: 2,
  completed: 3,
};

/** Ordem da listagem do front: status, depois prazo mais próximo (sem prazo por último), nome. */
export function compareGoals(
  a: Pick<GoalProgressInput, 'name' | 'deadline'> & { status: GoalStatus },
  b: Pick<GoalProgressInput, 'name' | 'deadline'> & { status: GoalStatus },
): number {
  return (
    STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
    (a.deadline ?? '9999').localeCompare(b.deadline ?? '9999') ||
    a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' })
  );
}

/** Meses de calendário entre duas datas, como o `differenceInCalendarMonths` do date-fns. */
function calendarMonthsBetween(from: Date, to: Date): number {
  return (
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth())
  );
}
