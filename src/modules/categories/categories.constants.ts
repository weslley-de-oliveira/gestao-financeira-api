/** Regras de forma das categorias, as mesmas do front (`shared/models/category.ts`). */
export const CATEGORY_TYPES = ['expense', 'income'] as const;

export type CategoryType = (typeof CATEGORY_TYPES)[number];

/** Ícones do Material Symbols que o front oferece para categorias. */
export const CATEGORY_ICONS = [
  'restaurant',
  'shopping_cart',
  'home',
  'directions_car',
  'directions_bus',
  'local_hospital',
  'school',
  'sports_esports',
  'shopping_bag',
  'receipt_long',
  'bolt',
  'wifi',
  'pets',
  'flight',
  'fitness_center',
  'checkroom',
  'work',
  'laptop',
  'trending_up',
  'card_giftcard',
  'payments',
  'more_horiz',
] as const;

export type CategoryIcon = (typeof CATEGORY_ICONS)[number];

export const CATEGORY_NAME_MAX_LENGTH = 40;
