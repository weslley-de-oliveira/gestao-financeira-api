import type { Transaction } from '../../db/schema/index.ts';
import {
  addDays,
  dayOfMonth,
  parseIsoDate,
  toIsoDate,
  type IsoDate,
} from '../../shared/utils/date.ts';
import type { Cents } from '../../shared/utils/money.ts';
import { movementEffect, type BalanceMovement } from '../accounts/account-balance.ts';

/** Métricas do dashboard, portadas do front (`summarizeTransactions` e `dashboard-metrics.ts`). */

export interface TransactionSummary {
  /** Receitas realizadas. */
  income: Cents;
  /** Despesas realizadas, incluindo compras no cartão. */
  expense: Cents;
  /** Receitas − despesas. */
  net: Cents;
  /** Transações pendentes do período (de qualquer tipo), contadas à parte. */
  pendingCount: number;
}

/**
 * Totais do período: só as realizadas entram em receitas e despesas; transferências e pagamentos
 * de fatura não são receita nem despesa (as compras do cartão já foram contadas).
 */
export function summarizeTransactions(
  transactions: readonly Pick<Transaction, 'type' | 'amount' | 'status'>[],
): TransactionSummary {
  let income = 0;
  let expense = 0;
  let pendingCount = 0;
  for (const transaction of transactions) {
    if (transaction.status === 'pending') {
      pendingCount++;
    } else if (transaction.type === 'income') {
      income += transaction.amount;
    } else if (transaction.type === 'expense') {
      expense += transaction.amount;
    }
  }
  return { income, expense, net: income - expense, pendingCount };
}

/** Faixa de datas agrupada num ponto do gráfico de receitas × despesas. */
export interface PeriodBucket {
  start: IsoDate;
  end: IsoDate;
  label: string;
}

/** Dias por bloco quando o período tem um único mês. */
const DAYS_PER_BLOCK = 7;

const MONTH_ABBREVIATIONS = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
];

/**
 * Divide o período para o gráfico: um bloco por mês quando abrange vários meses; num único mês,
 * blocos de 7 dias a partir do dia 1 (o último fica com o que sobrar).
 */
export function periodBuckets(range: { start: IsoDate; end: IsoDate }): PeriodBucket[] {
  const start = parseIsoDate(range.start);
  const end = parseIsoDate(range.end);
  if (!start || !end || range.start > range.end) {
    return [];
  }
  const singleMonth = range.start.slice(0, 7) === range.end.slice(0, 7);
  const buckets: PeriodBucket[] = [];

  for (let first = start; first <= end; ) {
    const blockEnd = singleMonth
      ? addDays(first, DAYS_PER_BLOCK - 1)
      : dayOfMonth(first.getUTCFullYear(), first.getUTCMonth(), 31);
    const last = blockEnd <= end ? blockEnd : end;
    const firstIso = toIsoDate(first);
    const lastIso = toIsoDate(last);
    buckets.push({
      start: firstIso,
      end: lastIso,
      label: singleMonth
        ? `${firstIso.slice(8)}–${lastIso.slice(8)}`
        : `${MONTH_ABBREVIATIONS[first.getUTCMonth()] ?? ''}/${firstIso.slice(2, 4)}`,
    });
    first = addDays(last, 1);
  }
  return buckets;
}

export interface IncomeExpensePoint extends PeriodBucket {
  income: Cents;
  expense: Cents;
}

/**
 * Receitas e despesas de cada bloco do período, pela mesma regra dos totais
 * (`summarizeTransactions`): só realizadas, sem transferências nem pagamentos de fatura.
 */
export function incomeVsExpense(
  transactions: readonly Pick<Transaction, 'type' | 'amount' | 'status' | 'date'>[],
  range: { start: IsoDate; end: IsoDate },
): IncomeExpensePoint[] {
  return periodBuckets(range).map((bucket) => {
    const { income, expense } = summarizeTransactions(
      transactions.filter(
        (transaction) => transaction.date >= bucket.start && transaction.date <= bucket.end,
      ),
    );
    return { ...bucket, income, expense };
  });
}

export interface BalancePoint {
  date: IsoDate;
  balance: Cents;
}

/**
 * Saldo consolidado das contas ativas ao fim de cada dia do período: saldos iniciais + efeito
 * das transações até aquele dia, pela regra única do saldo (`movementEffect`; pendentes não
 * contam e transferências entre contas ativas se anulam).
 */
export function balanceEvolution(
  accounts: readonly { id: string; initialBalance: Cents; isArchived: boolean }[],
  transactions: readonly (BalanceMovement & { date: IsoDate })[],
  range: { start: IsoDate; end: IsoDate },
): BalancePoint[] {
  const start = parseIsoDate(range.start);
  const end = parseIsoDate(range.end);
  if (!start || !end) {
    return [];
  }
  const active = accounts.filter((account) => !account.isArchived);
  const effect = (transaction: BalanceMovement) =>
    active.reduce((total, account) => total + movementEffect(transaction, account.id), 0);
  const chronological = [...transactions].sort((a, b) => a.date.localeCompare(b.date));

  let balance = active.reduce((total, account) => total + account.initialBalance, 0);
  let next = 0;
  const points: BalancePoint[] = [];
  for (let day = start; day <= end; day = addDays(day, 1)) {
    const date = toIsoDate(day);
    while (next < chronological.length && (chronological[next]?.date ?? '') <= date) {
      balance += effect(chronological[next++]!);
    }
    points.push({ date, balance });
  }
  return points;
}
