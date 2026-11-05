/** Regras de forma das transações, as mesmas do front (`shared/models/transaction.ts`). */
export const TRANSACTION_TYPES = ['expense', 'income', 'transfer', 'invoice-payment'] as const;

/**
 * `invoice-payment` é o pagamento de uma fatura de cartão: debita a conta de pagamento, mas não é
 * despesa (as compras já foram contadas). É criado e desfeito só pelas rotas de faturas.
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
