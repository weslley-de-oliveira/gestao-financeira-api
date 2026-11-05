import type { Cents } from '../../shared/utils/money.ts';
import type { ContributionType } from './goals.constants.ts';

/** Regras de meta, portadas do front (`goal-rules.ts`). */

/** Inicial + aportes − retiradas. */
export function goalBalance(
  initialAmount: Cents,
  contributions: readonly { type: ContributionType; amount: Cents }[],
): Cents {
  return contributions.reduce(
    (total, item) => total + (item.type === 'deposit' ? item.amount : -item.amount),
    initialAmount,
  );
}
