/**
 * Cores de identificação de contas, categorias etc.: as mesmas do front (`APPEARANCE_COLORS`). O
 * nome de cada cor é rótulo de interface e fica só no front.
 */
export const APPEARANCE_COLORS = [
  '#1565c0',
  '#2e7d32',
  '#6a1b9a',
  '#c62828',
  '#ef6c00',
  '#00838f',
  '#ad1457',
  '#546e7a',
] as const;

export type AppearanceColor = (typeof APPEARANCE_COLORS)[number];
