/** Regras de forma das contas, as mesmas do front (`shared/models/account.ts`). */
export const ACCOUNT_TYPES = ['checking', 'savings', 'cash', 'investment', 'other'] as const;

export type AccountType = (typeof ACCOUNT_TYPES)[number];

/** Ícones do Material Symbols que o front oferece para contas. */
export const ACCOUNT_ICONS = [
  'account_balance',
  'account_balance_wallet',
  'savings',
  'payments',
  'trending_up',
  'credit_card',
  'store',
  'home',
] as const;

export type AccountIcon = (typeof ACCOUNT_ICONS)[number];

export const ACCOUNT_NAME_MAX_LENGTH = 60;
export const ACCOUNT_INSTITUTION_MAX_LENGTH = 60;
