import { isIsoMonth, type IsoMonth } from '../../shared/utils/date.ts';
import type { Cents } from '../../shared/utils/money.ts';

/** Regras de orçamento, portadas do front (`budget-rules.ts`). */

/** Limite mensal em vigor a partir de `month` (inclusive) até a próxima vigência. */
export interface BudgetLimitPeriod {
  month: IsoMonth;
  amount: Cents;
}

/** Limite em vigor no mês, ou `null` se o orçamento ainda não existia nele. */
export function limitForMonth(limits: readonly BudgetLimitPeriod[], month: IsoMonth): Cents | null {
  let amount: Cents | null = null;
  for (const limit of limits) {
    if (limit.month > month) {
      break;
    }
    amount = limit.amount;
  }
  return amount;
}

/** Limite atual: o da vigência mais recente. */
export function currentLimit(limits: readonly BudgetLimitPeriod[]): Cents {
  const last = limits.at(-1);
  if (!last) throw new RangeError('A budget always has at least one limit');
  return last.amount;
}

/**
 * Aplica um novo limite a partir de `month`: substitui a vigência desse mês ou acrescenta uma
 * nova, descartando vigências posteriores. Os meses anteriores mantêm o limite que tinham.
 */
export function withLimitFrom(
  limits: readonly BudgetLimitPeriod[],
  month: IsoMonth,
  amount: Cents,
): BudgetLimitPeriod[] {
  if (!isIsoMonth(month)) {
    throw new RangeError(`Invalid month: ${String(month)}`);
  }
  const earlier = limits.filter((limit) => limit.month < month);
  if (earlier.length > 0 && earlier[earlier.length - 1]?.amount === amount) {
    return earlier;
  }
  return [...earlier, { month, amount }];
}
