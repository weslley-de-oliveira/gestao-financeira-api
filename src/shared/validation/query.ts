import { z } from 'zod';

/**
 * Parâmetro booleano de query string: só `true` ou `false` (padrão `false`). Outro valor → 422.
 * Explícito, em vez de `z.stringbool()`, para a documentação mostrar os dois valores aceitos.
 */
export function booleanQueryParam(description: string) {
  return z
    .enum(['true', 'false'], 'Use true ou false.')
    .default('false')
    .meta({ description })
    .transform((value) => value === 'true');
}
