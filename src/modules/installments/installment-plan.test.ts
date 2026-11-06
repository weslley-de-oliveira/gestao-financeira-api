import { describe, expect, it } from 'vitest';
import { addDays, parseIsoDate, toIsoDate } from '../../shared/utils/date.ts';
import { invoiceCycleFor } from '../../shared/utils/invoice-cycle.ts';
import { installmentDates, planInstallments, splitAmount } from './installment-plan.ts';

/** Mês seguinte de um `yyyy-MM`. */
function nextMonth(month: string): string {
  const [year = 0, value = 0] = month.split('-').map(Number);
  return value === 12 ? `${year + 1}-01` : `${year}-${String(value + 1).padStart(2, '0')}`;
}

describe('splitAmount', () => {
  it.each([
    [10_000, 3, [3_334, 3_333, 3_333]],
    [120_000, 10, Array.from({ length: 10 }, () => 12_000)],
    [5, 5, [1, 1, 1, 1, 1]],
    [7, 2, [4, 3]],
  ])('divide %i centavos em %i parcelas', (total, count, expected) => {
    const parts = splitAmount(total, count);

    expect(parts).toEqual(expected);
    expect(parts.reduce((sum, part) => sum + part, 0)).toBe(total);
  });

  it('recusa menos de 1 centavo por parcela', () => {
    expect(() => splitAmount(4, 5)).toThrow(RangeError);
  });
});

describe('installmentDates', () => {
  const card = { closingDay: 5, dueDay: 12 };

  it('começa na data da compra e segue fatura por fatura, no mesmo dia', () => {
    expect(installmentDates(card, '2026-11-10', 3)).toEqual([
      { date: '2026-11-10', referenceMonth: '2026-12' },
      { date: '2026-12-10', referenceMonth: '2027-01' },
      { date: '2027-01-10', referenceMonth: '2027-02' },
    ]);
  });

  it('ajusta o dia ao ciclo da fatura no fim do mês', () => {
    // Fecha dia 30 e vence dia 7: a compra de 31/01 cai na fatura de março.
    expect(installmentDates({ closingDay: 30, dueDay: 7 }, '2026-01-31', 4)).toEqual([
      { date: '2026-01-31', referenceMonth: '2026-03' },
      { date: '2026-02-28', referenceMonth: '2026-04' },
      { date: '2026-03-31', referenceMonth: '2026-05' },
      { date: '2026-04-30', referenceMonth: '2026-06' },
    ]);
  });

  it('cada parcela cai na fatura seguinte à da anterior, para qualquer cartão e dia', () => {
    const start = parseIsoDate('2026-01-01');
    if (!start) throw new Error('data inválida');
    for (let closingDay = 1; closingDay <= 31; closingDay += 1) {
      for (const dueDay of [1, closingDay, 31]) {
        const days = { closingDay, dueDay };
        for (let offset = 0; offset < 366; offset += 1) {
          const purchase = toIsoDate(addDays(start, offset));
          const parcels = installmentDates(days, purchase, 13);

          expect(parcels[0]?.date).toBe(purchase);
          parcels.forEach(({ date, referenceMonth }, index) => {
            expect(invoiceCycleFor(days, date).referenceMonth).toBe(referenceMonth);
            if (index > 0) {
              expect(referenceMonth).toBe(nextMonth(parcels[index - 1]?.referenceMonth ?? ''));
            }
          });
        }
      }
    }
  }, 60_000);
});

describe('planInstallments', () => {
  it('junta valor, data e fatura de cada parcela', () => {
    expect(
      planInstallments({ closingDay: 5, dueDay: 12 }, { amount: 10_000, date: '2026-11-04' }, 3),
    ).toEqual([
      { installmentNumber: 1, amount: 3_334, date: '2026-11-04', referenceMonth: '2026-11' },
      { installmentNumber: 2, amount: 3_333, date: '2026-12-04', referenceMonth: '2026-12' },
      { installmentNumber: 3, amount: 3_333, date: '2027-01-04', referenceMonth: '2027-01' },
    ]);
  });
});
