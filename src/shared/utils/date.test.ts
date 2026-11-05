import { describe, expect, it } from 'vitest';
import {
  dayOfMonth,
  formatIsoDate,
  monthLabel,
  monthRange,
  parseIsoDate,
  parseIsoMonth,
  toIsoDate,
} from './date.ts';

describe('datas sem horário', () => {
  it.each(['2026-11-05', '2028-02-29', '2026-12-31'])('aceita %s', (value) => {
    expect(toIsoDate(parseIsoDate(value)!)).toBe(value);
  });

  it.each(['2026-02-29', '2026-04-31', '2026-13-01', '05/11/2026', '2026-1-5', ''])(
    'recusa %s',
    (value) => {
      expect(parseIsoDate(value)).toBeNull();
    },
  );

  it('lê o mês yyyy-MM', () => {
    expect(parseIsoMonth('2026-12')).toEqual({ year: 2026, month: 11 });
    expect(parseIsoMonth('2026-13')).toBeNull();
  });

  it('limita o dia ao último do mês e atravessa o ano', () => {
    expect(toIsoDate(dayOfMonth(2027, 1, 31))).toBe('2027-02-28');
    expect(toIsoDate(dayOfMonth(2026, 12, 5))).toBe('2027-01-05');
    expect(toIsoDate(dayOfMonth(2027, -1, 31))).toBe('2026-12-31');
  });

  it('dá o primeiro e o último dia do mês', () => {
    expect(monthRange('2026-11')).toEqual({ start: '2026-11-01', end: '2026-11-30' });
    expect(monthRange('2028-02')).toEqual({ start: '2028-02-01', end: '2028-02-29' });
    expect(() => monthRange('2026-13')).toThrow(RangeError);
  });

  it('formata o mês e a data como no front', () => {
    expect(monthLabel('2026-12')).toBe('12/2026');
    expect(formatIsoDate('2026-11-04')).toBe('04/11/2026');
  });
});
