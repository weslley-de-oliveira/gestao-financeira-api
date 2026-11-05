/** Regras de forma das metas, as mesmas do front (`shared/models/goal.ts`). */
export const GOAL_NAME_MAX_LENGTH = 60;
export const GOAL_DESCRIPTION_MAX_LENGTH = 300;
export const CONTRIBUTION_NOTE_MAX_LENGTH = 120;

/** Aporte soma ao acumulado; retirada subtrai. */
export const CONTRIBUTION_TYPES = ['deposit', 'withdrawal'] as const;

export type ContributionType = (typeof CONTRIBUTION_TYPES)[number];

/** Ícones do Material Symbols que o front oferece para metas. */
export const GOAL_ICONS = [
  'savings',
  'flight',
  'home',
  'directions_car',
  'school',
  'health_and_safety',
  'devices',
  'celebration',
] as const;

export type GoalIcon = (typeof GOAL_ICONS)[number];
