import { describe, expect, it } from 'vitest';
import type { Transaction } from '../../db/schema/index.ts';
import { budgetProgress, budgetState, limitForMonth, withLimitFrom } from './budget-rules.ts';

// Porte de `budget-rules.spec.ts` do front. Ficam só no front o resumo da tela
// (`summarizeBudgets`), a barra de progresso (`progressBarValue`) e a validação do formulário (aqui
// feita pelos schemas das rotas, com testes próprios).
const budget = {
  categoryId: 'food',
  alertThreshold: 80,
  limits: [
    { month: '2026-09', amount: 50_000 },
    { month: '2026-11', amount: 80_000 },
  ],
};

type Movement = Pick<Transaction, 'type' | 'categoryId' | 'date' | 'status' | 'amount'> & {
  description: string;
};

function transaction(overrides: Partial<Movement>): Movement {
  return {
    description: 'Compra',
    type: 'expense',
    amount: 1_000,
    date: '2026-11-10',
    categoryId: 'food',
    status: 'completed',
    ...overrides,
  };
}

describe('regras de orçamento', () => {
  it('usa o limite em vigor em cada mês', () => {
    expect(limitForMonth(budget.limits, '2026-08')).toBeNull();
    expect(limitForMonth(budget.limits, '2026-09')).toBe(50_000);
    expect(limitForMonth(budget.limits, '2026-10')).toBe(50_000);
    expect(limitForMonth(budget.limits, '2026-11')).toBe(80_000);
    expect(limitForMonth(budget.limits, '2027-03')).toBe(80_000);
  });

  it('aplica um novo limite a partir de um mês, preservando os anteriores', () => {
    expect(withLimitFrom(budget.limits, '2026-12', 90_000)).toEqual([
      ...budget.limits,
      { month: '2026-12', amount: 90_000 },
    ]);
    expect(withLimitFrom(budget.limits, '2026-11', 70_000)).toEqual([
      { month: '2026-09', amount: 50_000 },
      { month: '2026-11', amount: 70_000 },
    ]);
    // Voltar ao valor anterior no mesmo mês dispensa a vigência nova.
    expect(withLimitFrom(budget.limits, '2026-11', 50_000)).toEqual([
      { month: '2026-09', amount: 50_000 },
    ]);
    expect(withLimitFrom(budget.limits, '2026-12', 80_000)).toEqual(budget.limits);
    expect(() => withLimitFrom(budget.limits, '2026-13', 1)).toThrow(RangeError);
  });

  it('conta as despesas realizadas da categoria no mês, com as pendentes à parte', () => {
    const progress = budgetProgress(
      budget,
      [
        transaction({ description: 'Mercado', amount: 40_000 }),
        transaction({ description: 'Cartão', amount: 20_000 }),
        transaction({ description: 'Pendente', amount: 5_000, status: 'pending' }),
        transaction({ description: 'Outubro', amount: 9_999, date: '2026-10-31' }),
        transaction({ description: 'Outra categoria', categoryId: 'fun' }),
        transaction({ description: 'Receita', type: 'income' }),
        transaction({ description: 'Transferência', type: 'transfer', categoryId: null }),
      ],
      '2026-11',
    );

    expect(progress).toMatchObject({
      limit: 80_000,
      spent: 60_000,
      pending: 5_000,
      available: 20_000,
      percent: 75,
      state: 'ok',
    });
  });

  it('não vale antes do primeiro mês', () => {
    expect(budgetProgress(budget, [], '2026-08')).toBeNull();
  });

  it('alerta a partir do percentual definido e excede acima de 100%', () => {
    expect(budgetState(79.9, 80)).toBe('ok');
    expect(budgetState(80, 80)).toBe('warning');
    expect(budgetState(100, 80)).toBe('warning');
    expect(budgetState(100.01, 80)).toBe('exceeded');
    expect(budgetState(100, 100)).toBe('warning');
  });

  it('fica negativo quando excedido', () => {
    const over = budgetProgress(
      { ...budget, categoryId: 'fun' },
      [transaction({ amount: 100_000, categoryId: 'fun' })],
      '2026-11',
    );

    expect(over).toMatchObject({ available: -20_000, percent: 125, state: 'exceeded' });
  });
});
