/** Valores monetários circulam como centavos inteiros (R$ 1.234,56 → 123456), nunca como reais em ponto flutuante. */
export type Cents = number;

/**
 * Maior valor absoluto aceito: R$ 1 bilhão, o mesmo limite dos formulários do front. Cabe com folga
 * em um `Number` seguro e na coluna `bigint` do banco.
 */
export const MAX_MONEY_CENTS: Cents = 100_000_000_000;

export function isValidCents(value: unknown): value is Cents {
  return Number.isSafeInteger(value);
}

/** Garante que um valor recebido é um inteiro de centavos válido (finito, sem fração). */
export function assertValidCents(value: unknown, field = 'value'): asserts value is Cents {
  if (!isValidCents(value)) {
    throw new RangeError(`${field} must be an integer amount of cents`);
  }
}

/** Centavos válidos dentro do limite de R$ 1 bilhão, positivos ou negativos. */
export function isWithinMoneyLimit(value: unknown): value is Cents {
  return isValidCents(value) && Math.abs(value) <= MAX_MONEY_CENTS;
}

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** Centavos em reais, para mensagens: 123456 → "R$ 1.234,56". */
export function formatCents(cents: Cents): string {
  return BRL.format(cents / 100).replace(/\s/g, ' ');
}
