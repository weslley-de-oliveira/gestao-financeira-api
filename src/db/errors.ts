/** Código do Postgres para violação de `UNIQUE`. */
const UNIQUE_VIOLATION = '23505';

/**
 * Indica se o erro veio da violação de uma constraint `UNIQUE` específica. O Drizzle embrulha o
 * erro do driver em `cause`; aqui olhamos os dois níveis.
 */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  const candidates = [error, error instanceof Error ? error.cause : undefined];
  return candidates.some(
    (candidate) =>
      typeof candidate === 'object' &&
      candidate !== null &&
      'code' in candidate &&
      candidate.code === UNIQUE_VIOLATION &&
      'constraint' in candidate &&
      candidate.constraint === constraint,
  );
}
