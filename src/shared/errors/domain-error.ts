/**
 * Erro de regra de negócio lançado pelos serviços, que não conhecem HTTP: o plugin `errors`
 * converte o `kind` no status (ex.: `conflict` → 409) e usa a mensagem como `detail`.
 */
export type DomainErrorKind =
  'unauthorized' | 'not-found' | 'conflict' | 'precondition' | 'invalid';

export abstract class DomainError extends Error {
  abstract readonly kind: DomainErrorKind;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Campo do corpo que não passou numa regra que depende do banco (ex.: conta inexistente). */
export interface InvalidField {
  /** Nome do campo no corpo da requisição (ex.: `accountId`). */
  field: string;
  message: string;
}

/**
 * Dados que passaram na validação do schema mas falham numa regra do serviço (ex.: a categoria
 * não existe ou é de outro tipo). Vira 422 no mesmo formato dos erros de validação, com o campo.
 */
export class InvalidInputError extends DomainError {
  readonly kind = 'invalid';
  readonly fields: readonly InvalidField[];

  constructor(fields: readonly InvalidField[]) {
    super('Um ou mais campos são inválidos.');
    this.fields = fields;
  }
}
