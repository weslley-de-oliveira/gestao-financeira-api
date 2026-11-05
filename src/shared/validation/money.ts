import { z } from 'zod';
import { MAX_MONEY_CENTS } from '../utils/money.ts';

const MONEY_LIMIT_MESSAGE = 'O valor deve ser de até R$ 1 bilhão.';

/** Valor em centavos inteiros (nunca reais com fração), até R$ 1 bilhão em qualquer sentido. */
export const signedCentsSchema = z
  .int('Informe o valor em centavos inteiros.')
  .min(-MAX_MONEY_CENTS, MONEY_LIMIT_MESSAGE)
  .max(MAX_MONEY_CENTS, MONEY_LIMIT_MESSAGE)
  .meta({ description: 'Centavos inteiros (R$ 1.234,56 → 123456).', example: 123456 });

/** Valor positivo em centavos inteiros, até R$ 1 bilhão (ex.: o valor de uma transação). */
export const positiveCentsSchema = z
  .int('Informe o valor em centavos inteiros.')
  .min(1, 'O valor deve ser maior que zero.')
  .max(MAX_MONEY_CENTS, MONEY_LIMIT_MESSAGE)
  .meta({
    description: 'Centavos inteiros, maior que zero (R$ 1.234,56 → 123456).',
    example: 123456,
  });
