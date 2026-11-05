import { describe, expect, it } from 'vitest';
import { invoiceCycleFor, invoiceCycleForMonth } from './invoice-cycle.ts';

// Porte de `invoice-cycle.spec.ts` do front: os mesmos casos, para o ciclo dar o mesmo resultado
// nos dois lados.
describe('invoiceCycleFor', () => {
  const card = { closingDay: 5, dueDay: 12 };

  it('compra antes do dia de fechamento cai na fatura que fecha neste mês', () => {
    expect(invoiceCycleFor(card, '2026-11-04')).toEqual({
      referenceMonth: '2026-11',
      start: '2026-10-05',
      end: '2026-11-04',
      closingDate: '2026-11-05',
      dueDate: '2026-11-12',
    });
  });

  it('compra no dia do fechamento ou depois vai para a fatura seguinte', () => {
    expect(invoiceCycleFor(card, '2026-11-05')).toMatchObject({
      referenceMonth: '2026-12',
      start: '2026-11-05',
      end: '2026-12-04',
      closingDate: '2026-12-05',
      dueDate: '2026-12-12',
    });
    expect(invoiceCycleFor(card, '2026-11-30').closingDate).toBe('2026-12-05');
  });

  it('vence no mês seguinte quando o dia de vencimento não é depois do fechamento', () => {
    expect(invoiceCycleFor({ closingDay: 25, dueDay: 5 }, '2026-11-10')).toMatchObject({
      closingDate: '2026-11-25',
      dueDate: '2026-12-05',
      referenceMonth: '2026-12',
    });
  });

  it('atravessa a virada do ano', () => {
    expect(invoiceCycleFor({ closingDay: 25, dueDay: 5 }, '2026-12-28')).toMatchObject({
      start: '2026-12-25',
      closingDate: '2027-01-25',
      dueDate: '2027-02-05',
      referenceMonth: '2027-02',
    });
  });

  it('usa o último dia dos meses curtos, mantendo os ciclos contíguos', () => {
    const lastDay = { closingDay: 31, dueDay: 10 };

    expect(invoiceCycleFor(lastDay, '2027-02-27')).toMatchObject({
      start: '2027-01-31',
      end: '2027-02-27',
      closingDate: '2027-02-28',
      dueDate: '2027-03-10',
    });
    expect(invoiceCycleFor(lastDay, '2027-02-28')).toMatchObject({
      start: '2027-02-28',
      end: '2027-03-30',
      closingDate: '2027-03-31',
    });
    expect(invoiceCycleFor({ closingDay: 20, dueDay: 31 }, '2026-11-10').dueDate).toBe(
      '2026-11-30',
    );
  });

  it('considera fevereiro de ano bissexto', () => {
    expect(invoiceCycleFor({ closingDay: 31, dueDay: 10 }, '2028-02-15')).toMatchObject({
      closingDate: '2028-02-29',
      end: '2028-02-28',
    });
  });

  it('recusa data inválida', () => {
    expect(() => invoiceCycleFor(card, '2026-02-30')).toThrow(RangeError);
  });
});

describe('invoiceCycleForMonth', () => {
  it('encontra a fatura que vence no mês de referência', () => {
    expect(invoiceCycleForMonth({ closingDay: 5, dueDay: 12 }, '2026-12')).toEqual(
      invoiceCycleFor({ closingDay: 5, dueDay: 12 }, '2026-11-20'),
    );
    expect(invoiceCycleForMonth({ closingDay: 25, dueDay: 5 }, '2027-01')).toMatchObject({
      closingDate: '2026-12-25',
      dueDate: '2027-01-05',
      referenceMonth: '2027-01',
    });
  });

  it('ida e volta com o ciclo de qualquer data de compra', () => {
    const card = { closingDay: 31, dueDay: 10 };
    for (const date of ['2027-01-31', '2027-02-27', '2027-02-28', '2027-03-15']) {
      const cycle = invoiceCycleFor(card, date);
      expect(invoiceCycleForMonth(card, cycle.referenceMonth)).toEqual(cycle);
    }
  });

  it('cobre todos os dias de um ano sem buracos nem sobreposição', () => {
    for (const card of [
      { closingDay: 5, dueDay: 12 },
      { closingDay: 25, dueDay: 5 },
      { closingDay: 31, dueDay: 10 },
    ]) {
      let previous = invoiceCycleForMonth(card, '2026-01');
      for (let month = 2; month <= 24; month++) {
        const year = 2026 + Math.floor((month - 1) / 12);
        const reference = `${year}-${String(((month - 1) % 12) + 1).padStart(2, '0')}`;
        const cycle = invoiceCycleForMonth(card, reference);
        // Cada fatura começa no fechamento da anterior.
        expect(cycle.start).toBe(previous.closingDate);
        previous = cycle;
      }
    }
  });

  it('recusa mês inválido', () => {
    expect(() => invoiceCycleForMonth({ closingDay: 5, dueDay: 12 }, '2026-13')).toThrow(
      RangeError,
    );
  });
});
