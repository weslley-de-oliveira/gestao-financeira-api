/** Regras de forma dos cartões, as mesmas do front (`shared/models/credit-card.ts`). */
export const CARD_BRANDS = ['visa', 'mastercard', 'elo', 'amex', 'hipercard', 'other'] as const;

export type CardBrand = (typeof CARD_BRANDS)[number];

export const CREDIT_CARD_NAME_MAX_LENGTH = 40;

/** Dias de fechamento e vencimento; em meses mais curtos, o dia vira o último do mês. */
export const MIN_CARD_DAY = 1;
export const MAX_CARD_DAY = 31;
