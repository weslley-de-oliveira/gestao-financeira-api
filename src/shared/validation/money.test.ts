import { describe, expect, it } from 'vitest';
import { MAX_MONEY_CENTS } from '../utils/money.ts';
import { signedCentsSchema } from './money.ts';

describe('signedCentsSchema', () => {
  it.each([0, 123_456, -150_075, MAX_MONEY_CENTS, -MAX_MONEY_CENTS])('aceita %i', (value) => {
    expect(signedCentsSchema.parse(value)).toBe(value);
  });

  it.each([
    [12.5, 'Informe o valor em centavos inteiros.'],
    ['100', 'Informe o valor em centavos inteiros.'],
    [Number.NaN, 'Informe o valor em centavos inteiros.'],
    [MAX_MONEY_CENTS + 1, 'O valor deve ser de até R$ 1 bilhão.'],
    [-MAX_MONEY_CENTS - 1, 'O valor deve ser de até R$ 1 bilhão.'],
  ])('recusa %s', (value, message) => {
    const result = signedCentsSchema.safeParse(value);

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(message);
  });
});
