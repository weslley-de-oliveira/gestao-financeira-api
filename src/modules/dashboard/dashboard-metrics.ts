import type { Transaction } from '../../db/schema/index.ts';
import type { Cents } from '../../shared/utils/money.ts';

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
