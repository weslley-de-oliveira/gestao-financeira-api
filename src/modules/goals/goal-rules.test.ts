import { describe, expect, it } from 'vitest';
import {
  calculateGoalProgress,
  compareGoals,
  goalBalance,
  goalStatus,
  type GoalProgressInput,
} from './goal-rules.ts';

// Porte de `goal-rules.spec.ts` do front. A barra de progresso (`goalProgressBarValue`) é regra de
// tela e fica só no front; a validação do formulário é feita pelos schemas das rotas, com testes
// próprios.
const TODAY = '2026-11-15';

function goal(overrides: Partial<GoalProgressInput>): GoalProgressInput {
  return {
    name: 'Viagem',
    targetAmount: 1_000_000,
    initialAmount: 100_000,
    contributions: [],
    deadline: null,
    isPaused: false,
    ...overrides,
  };
}

describe('regras de meta', () => {
  it('acumula o valor inicial, os aportes e as retiradas', () => {
    expect(
      goalBalance(100_000, [
        { type: 'deposit', amount: 50_000 },
        { type: 'withdrawal', amount: 20_000 },
      ]),
    ).toBe(130_000);
  });

  it('tira o status: concluída > pausada > atrasada > em andamento', () => {
    const base = { targetAmount: 100, deadline: '2026-11-14', isPaused: false };

    expect(goalStatus(base, 100, TODAY)).toBe('completed');
    expect(goalStatus({ ...base, isPaused: true }, 100, TODAY)).toBe('completed');
    expect(goalStatus({ ...base, isPaused: true }, 50, TODAY)).toBe('paused');
    expect(goalStatus(base, 50, TODAY)).toBe('overdue');
    expect(goalStatus({ ...base, deadline: TODAY }, 50, TODAY)).toBe('in-progress');
    expect(goalStatus({ ...base, deadline: null }, 50, TODAY)).toBe('in-progress');
  });

  it('calcula o restante e o ritmo mensal contando o mês atual', () => {
    const progress = calculateGoalProgress(
      goal({ deadline: '2027-04-30', contributions: [{ type: 'deposit', amount: 100_000 }] }),
      TODAY,
    );

    expect(progress).toMatchObject({
      currentAmount: 200_000,
      remainingAmount: 800_000,
      excessAmount: 0,
      percent: 20,
      status: 'in-progress',
      monthsLeft: 6,
      // 800.000 / 6 = 133.333,33… → arredondado para cima.
      monthlyPace: 133_334,
    });
  });

  it('mantém o excedente', () => {
    expect(calculateGoalProgress(goal({ initialAmount: 1_250_000 }), TODAY)).toMatchObject({
      status: 'completed',
      remainingAmount: 0,
      excessAmount: 250_000,
      percent: 125,
      monthlyPace: null,
    });
  });

  it('não tem ritmo sem prazo ou depois dele', () => {
    expect(calculateGoalProgress(goal({}), TODAY).monthlyPace).toBeNull();
    expect(calculateGoalProgress(goal({ deadline: '2026-10-01' }), TODAY)).toMatchObject({
      status: 'overdue',
      monthsLeft: null,
      monthlyPace: null,
    });
    expect(
      calculateGoalProgress(goal({ deadline: '2026-10-01', isPaused: true }), TODAY).monthlyPace,
    ).toBeNull();
    expect(calculateGoalProgress(goal({ deadline: '2026-11-30' }), TODAY)).toMatchObject({
      monthsLeft: 1,
      monthlyPace: 900_000,
    });
  });

  it('conta os meses de calendário até o prazo, inclusive na virada do ano', () => {
    expect(calculateGoalProgress(goal({ deadline: '2027-01-01' }), TODAY).monthsLeft).toBe(3);
    expect(calculateGoalProgress(goal({ deadline: '2026-11-15' }), TODAY).monthsLeft).toBe(1);
  });

  it('lista o que pede ação primeiro', () => {
    const goals = [
      goal({ name: 'Sem prazo' }),
      goal({ name: 'Concluída', initialAmount: 1_000_000 }),
      goal({ name: 'Atrasada', deadline: '2026-10-01' }),
      goal({ name: 'Próxima', deadline: '2026-12-01' }),
      goal({ name: 'Pausada', isPaused: true }),
    ].map((item) => ({ ...item, ...calculateGoalProgress(item, TODAY) }));

    expect(goals.toSorted(compareGoals).map((item) => item.name)).toEqual([
      'Atrasada',
      'Próxima',
      'Sem prazo',
      'Pausada',
      'Concluída',
    ]);
  });
});
