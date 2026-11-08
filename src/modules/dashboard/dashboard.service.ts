import { monthRange, type IsoDate } from '../../shared/utils/date.ts';
import { goalMovements } from '../accounts/account-balance.ts';
import type { AccountsRepository } from '../accounts/accounts.repository.ts';
import type { BudgetsService } from '../budgets/budgets.service.ts';
import type { GoalsService } from '../goals/goals.service.ts';
import type { DashboardRepository } from './dashboard.repository.ts';
import {
  balanceEvolution,
  incomeVsExpense,
  recentTransactions,
  summarizeTransactions,
} from './dashboard-metrics.ts';
import type { DashboardData, DashboardQuery } from './dashboard.schemas.ts';

/** Quantidades exibidas nos widgets do dashboard do front. */
export const RECENT_LIMIT = 5;
export const BUDGET_HIGHLIGHTS = 3;
export const GOAL_HIGHLIGHTS = 3;

export interface DashboardServiceDependencies {
  dashboard: DashboardRepository;
  accounts: AccountsRepository;
  budgets: BudgetsService;
  goals: GoalsService;
  /** Data de hoje (`yyyy-MM-dd`): o período padrão e os orçamentos usam o mês atual. */
  today: () => IsoDate;
}

export interface DashboardService {
  /** Tudo o que o dashboard mostra, numa chamada só. Sem período, usa o mês atual. */
  get(userId: string, query: DashboardQuery): Promise<DashboardData>;
}

export function createDashboardService({
  dashboard,
  accounts,
  budgets,
  goals,
  today,
}: DashboardServiceDependencies): DashboardService {
  /**
   * Contas ativas com o saldo atual e o saldo de abertura do período (antes de `from`), pela
   * mesma regra de `currentBalance`.
   */
  async function activeAccounts(userId: string, from: IsoDate) {
    const active = await accounts.listAccounts(userId, { includeArchived: false });
    const ids = active.map((account) => account.id);
    const [current, beforePeriod] = await Promise.all([
      accounts.movementTotals(userId, ids),
      accounts.movementTotals(userId, ids, { before: from }),
    ]);
    return active.map((account) => ({
      id: account.id,
      isArchived: false,
      currentBalance: account.initialBalance + (current.get(account.id) ?? 0),
      openingBalance: account.initialBalance + (beforePeriod.get(account.id) ?? 0),
    }));
  }

  /** Orçamentos mais consumidos no mês atual (o widget não segue o período escolhido). */
  async function budgetHighlights(userId: string) {
    const list = await budgets.list(userId);
    return list
      .toSorted((a, b) => (b.progress?.percent ?? 0) - (a.progress?.percent ?? 0))
      .slice(0, BUDGET_HIGHLIGHTS);
  }

  /** Metas ativas ainda não concluídas: atrasadas primeiro, depois o prazo mais próximo. */
  async function goalHighlights(userId: string) {
    const list = await goals.list(userId, { includeArchived: false });
    return list.filter((goal) => goal.status !== 'completed').slice(0, GOAL_HIGHLIGHTS);
  }

  return {
    async get(userId, query) {
      const { start, end } = monthRange(today().slice(0, 7));
      const range = { start: query.from ?? start, end: query.to ?? end };
      const [period, periodContributions, active, budgetList, goalList] = await Promise.all([
        dashboard.periodTransactions(userId, { from: range.start, to: range.end }),
        dashboard.periodGoalContributions(userId, { from: range.start, to: range.end }),
        activeAccounts(userId, range.start),
        budgetHighlights(userId),
        goalHighlights(userId),
      ]);

      return {
        from: range.start,
        to: range.end,
        summary: summarizeTransactions(period),
        balance: {
          total: active.reduce((sum, account) => sum + account.currentBalance, 0),
          activeAccounts: active.length,
        },
        incomeVsExpense: incomeVsExpense(period, range),
        // Parte do saldo de abertura e aplica só as transações e as movimentações de metas com
        // conta do período.
        balanceEvolution: balanceEvolution(
          active.map((account) => ({ ...account, initialBalance: account.openingBalance })),
          [...period, ...goalMovements(periodContributions)],
          range,
        ),
        recentTransactions: recentTransactions(period, range, RECENT_LIMIT),
        budgetHighlights: budgetList,
        goalHighlights: goalList,
      };
    },
  };
}
