/** Regras de forma das transações, as mesmas do front (`shared/models/transaction.ts`). */
export const TRANSACTION_TYPES = [
  'expense',
  'income',
  'transfer',
  'invoice-payment',
  'refund',
] as const;

/**
 * `invoice-payment` é o pagamento de uma fatura de cartão: debita a conta de pagamento, mas não é
 * despesa (as compras já foram contadas). É criado e desfeito só pelas rotas de faturas.
 *
 * `refund` é o estorno de uma despesa realizada (em conta ou no cartão): devolve o valor à conta ou
 * abate a fatura, e reduz o gasto da categoria da despesa no mês do estorno. É criado pela rota de
 * estornos da despesa.
 */
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

/** Tipos que a pessoa cria e edita pelas rotas de transações. */
export const EDITABLE_TRANSACTION_TYPES = ['expense', 'income', 'transfer'] as const;

export type EditableTransactionType = (typeof EDITABLE_TRANSACTION_TYPES)[number];

/** Só transações realizadas alteram o saldo; pendentes ficam registradas para acompanhamento. */
export const TRANSACTION_STATUSES = ['completed', 'pending'] as const;

export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

export const TRANSACTION_DESCRIPTION_MAX_LENGTH = 80;
export const TRANSACTION_NOTES_MAX_LENGTH = 500;

/**
 * Ordenações da listagem, as mesmas do front (`transaction-query.ts`). O desempate é sempre a
 * registrada por último primeiro, exceto em `date-asc`, que inverte também o desempate.
 */
export const TRANSACTION_SORTS = ['date-desc', 'date-asc', 'amount-desc', 'amount-asc'] as const;

export type TransactionSort = (typeof TRANSACTION_SORTS)[number];

/** Parcelas de uma compra parcelada no cartão: de 2 a 24, como nos cartões em geral. */
export const MIN_INSTALLMENTS = 2;
export const MAX_INSTALLMENTS = 24;
