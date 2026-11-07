import { describe, expect, it } from 'vitest';
import {
  MAX_MONEY_CENTS,
  assertValidCents,
  formatCents,
  isValidCents,
  isWithinMoneyLimit,
} from './money.ts';

describe('dinheiro em centavos', () => {
  it('aceita só centavos inteiros e finitos', () => {
    expect(isValidCents(100)).toBe(true);
    expect(isValidCents(-100)).toBe(true);
    for (const value of [1.5, Number.NaN, Infinity, -Infinity, '100', null]) {
      expect(isValidCents(value)).toBe(false);
    }
    expect(() => assertValidCents(0.1, 'amount')).toThrow(RangeError);
    expect(() => assertValidCents(0.1, 'amount')).toThrow(
      'amount must be an integer amount of cents',
    );
    expect(() => assertValidCents(10)).not.toThrow();
  });

  it('recusa inteiros fora da faixa segura', () => {
    expect(isValidCents(Number.MAX_SAFE_INTEGER)).toBe(true);
    expect(isValidCents(Number.MAX_SAFE_INTEGER + 1)).toBe(false);
  });

  it('limita o valor a R$ 1 bilhão, positivo ou negativo', () => {
    expect(isWithinMoneyLimit(0)).toBe(true);
    expect(isWithinMoneyLimit(MAX_MONEY_CENTS)).toBe(true);
    expect(isWithinMoneyLimit(-MAX_MONEY_CENTS)).toBe(true);
    expect(isWithinMoneyLimit(MAX_MONEY_CENTS + 1)).toBe(false);
    expect(isWithinMoneyLimit(-MAX_MONEY_CENTS - 1)).toBe(false);
    expect(isWithinMoneyLimit(10.5)).toBe(false);
  });
});

describe('formatCents', () => {
  it.each([
    [123_456, 'R$ 1.234,56'],
    [5, 'R$ 0,05'],
    [100_000_000_000, 'R$ 1.000.000.000,00'],
  ])('formata %i centavos como %s', (cents, expected) => {
    expect(formatCents(cents)).toBe(expected);
  });
});
