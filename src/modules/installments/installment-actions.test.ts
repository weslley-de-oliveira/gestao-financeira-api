import { describe, expect, it } from 'vitest';
import {
  anticipatableInstallments,
  plannedCancellations,
  type InstallmentState,
} from './installment-actions.ts';

// O cartão fecha dia 5 e vence dia 12. Hoje é 15/11/2026: a fatura atual é a de 12/2026, com
// compras de 05/11 a 04/12.
const card = { closingDay: 5, dueDay: 12 };
const today = '2026-11-15';

/** Compra de R$ 500,00 em 5x a partir de 10/09: faturas de 10/2026 a 02/2027. */
function installments(refunded: Record<number, number> = {}): InstallmentState[] {
  return ['2026-09-10', '2026-10-10', '2026-11-10', '2026-12-10', '2027-01-10'].map(
    (date, index) => ({
      id: `p${index + 1}`,
      installmentNumber: index + 1,
      amount: 10_000,
      date,
      refunded: refunded[index + 1] ?? 0,
    }),
  );
}

const ids = (items: readonly { id: string }[]) => items.map((item) => item.id);

describe('anticipatableInstallments', () => {
  it('são as parcelas de faturas depois da atual, da última para a primeira', () => {
    expect(ids(anticipatableInstallments(card, installments(), today))).toEqual(['p5', 'p4']);
  });

  it('deixa de fora as parcelas com estorno, mesmo parcial', () => {
    expect(ids(anticipatableInstallments(card, installments({ 5: 1 }), today))).toEqual(['p4']);
  });

  it('no dia do fechamento, a fatura atual já é a seguinte', () => {
    // Em 05/12, a fatura atual é a de 01/2027 (compras de 05/12 a 04/01).
    expect(ids(anticipatableInstallments(card, installments(), '2026-12-05'))).toEqual(['p5']);
  });

  it('na véspera do fechamento, a parcela de 10/12 ainda é de uma fatura futura', () => {
    expect(ids(anticipatableInstallments(card, installments(), '2026-12-04'))).toEqual([
      'p5',
      'p4',
    ]);
  });

  it('não há o que antecipar quando a última parcela está na fatura atual', () => {
    expect(anticipatableInstallments(card, installments(), '2027-01-10')).toEqual([]);
  });
});

describe('plannedCancellations', () => {
  it('estorna a parcela da fatura atual (hoje) e as futuras (na data delas)', () => {
    expect(plannedCancellations(card, installments(), today)).toEqual([
      { installmentId: 'p3', amount: 10_000, date: today },
      { installmentId: 'p4', amount: 10_000, date: '2026-12-10' },
      { installmentId: 'p5', amount: 10_000, date: '2027-01-10' },
    ]);
  });

  it('estorna só o que falta das parcelas com estorno parcial e pula as já estornadas', () => {
    expect(plannedCancellations(card, installments({ 3: 2_500, 4: 10_000 }), today)).toEqual([
      { installmentId: 'p3', amount: 7_500, date: today },
      { installmentId: 'p5', amount: 10_000, date: '2027-01-10' },
    ]);
  });

  it('parcela antecipada (com a data de hoje) entra no cancelamento', () => {
    const anticipated = installments().map((installment) =>
      installment.id === 'p5' ? { ...installment, date: today } : installment,
    );

    const planned = plannedCancellations(card, anticipated, today);

    expect(planned.map((item) => item.installmentId)).toEqual(['p3', 'p4', 'p5']);
    expect(planned[2]).toMatchObject({ amount: 10_000, date: today });
  });

  it('nada a cancelar quando todas as faturas da compra já fecharam', () => {
    expect(plannedCancellations(card, installments(), '2027-02-05')).toEqual([]);
  });
});
