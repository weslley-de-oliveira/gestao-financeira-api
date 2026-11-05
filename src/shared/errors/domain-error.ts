/**
 * Erro de regra de negócio lançado pelos serviços, que não conhecem HTTP: o plugin `errors`
 * converte o `kind` no status (ex.: `conflict` → 409) e usa a mensagem como `detail`.
 */
export type DomainErrorKind = 'conflict' | 'not-found';

export abstract class DomainError extends Error {
  abstract readonly kind: DomainErrorKind;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}
