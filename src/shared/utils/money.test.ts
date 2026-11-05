import { describe, expect, it } from 'vitest';
import { MAX_MONEY_CENTS, assertValidCents, isValidCents, isWithinMoneyLimit } from './money.ts';

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
