import type { Transaction } from '../../db/schema/index.ts';
import { isIsoMonth, monthRange, type IsoMonth } from '../../shared/utils/date.ts';
import type { Cents } from '../../shared/utils/money.ts';

/** Situação do orçamento no mês. */
export const BUDGET_STATES = ['ok', 'warning', 'exceeded'] as const;

export type BudgetState = (typeof BUDGET_STATES)[number];

/** Consumo de um orçamento num mês, calculado a partir das transações (não é guardado). */
export interface BudgetProgress {
  month: IsoMonth;
  limit: Cents;
  /** Despesas realizadas da categoria no mês, incluindo compras no cartão. */
  spent: Cents;
  /** Despesas pendentes da categoria no mês, exibidas à parte como previstas. */
  pending: Cents;
  /** Limite − gasto; negativo quando excedido. */
  available: Cents;
  /** Percentual gasto, sem arredondamento nem teto em 100. */
  percent: number;
  state: BudgetState;
}

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

/** Excedido acima de 100%; em alerta a partir do percentual definido (100% inclusive). */
export function budgetState(percent: number, alertThreshold: number): BudgetState {
  if (percent > 100) {
    return 'exceeded';
  }
  return percent >= alertThreshold ? 'warning' : 'ok';
}

/** Consumo a partir do limite do mês e dos totais já somados (gasto e pendente). */
export function progressFrom(
  month: IsoMonth,
  limit: Cents,
  totals: { spent: Cents; pending: Cents },
  alertThreshold: number,
): BudgetProgress {
  const percent = (totals.spent / limit) * 100;
  return {
    month,
    limit,
    spent: totals.spent,
    pending: totals.pending,
    available: limit - totals.spent,
    percent,
    state: budgetState(percent, alertThreshold),
  };
}

/**
 * Consumo do orçamento no mês (porte de `budgetProgress` do front): despesas da categoria pela
 * data (compras no cartão incluídas, pela data da compra). Só as realizadas contam; as pendentes
 * ficam à parte como previstas. Transferências e pagamentos de fatura não são despesas e não
 * entram. `null` se o orçamento não vale no mês. A API soma no banco
 * (`BudgetsRepository.spendingByCategory`); esta função é a referência legível da regra.
 */
export function budgetProgress(
  budget: { categoryId: string; alertThreshold: number; limits: readonly BudgetLimitPeriod[] },
  transactions: readonly Pick<Transaction, 'type' | 'categoryId' | 'date' | 'status' | 'amount'>[],
  month: IsoMonth,
): BudgetProgress | null {
  const limit = limitForMonth(budget.limits, month);
  if (limit === null) {
    return null;
  }
  const { start, end } = monthRange(month);
  let spent = 0;
  let pending = 0;
  for (const transaction of transactions) {
    if (
      transaction.type !== 'expense' ||
      transaction.categoryId !== budget.categoryId ||
      transaction.date < start ||
      transaction.date > end
    ) {
      continue;
    }
    if (transaction.status === 'pending') {
      pending += transaction.amount;
    } else {
      spent += transaction.amount;
    }
  }
  return progressFrom(month, limit, { spent, pending }, budget.alertThreshold);
}
