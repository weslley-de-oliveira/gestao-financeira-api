import { monthRange, type IsoDate } from '../../shared/utils/date.ts';
import type { AccountsRepository } from '../accounts/accounts.repository.ts';
import type { DashboardRepository } from './dashboard.repository.ts';
import { balanceEvolution, incomeVsExpense, summarizeTransactions } from './dashboard-metrics.ts';
import type { DashboardDto, DashboardQuery } from './dashboard.schemas.ts';

export interface DashboardServiceDependencies {
  dashboard: DashboardRepository;
  accounts: AccountsRepository;
  /** Data de hoje (`yyyy-MM-dd`): o período padrão é o mês atual. */
  today: () => IsoDate;
}

export interface DashboardService {
  /** Tudo o que o dashboard mostra, numa chamada só. Sem período, usa o mês atual. */
  get(userId: string, query: DashboardQuery): Promise<DashboardDto>;
}

export function createDashboardService({
  dashboard,
  accounts,
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

  return {
    async get(userId, query) {
      const { start, end } = monthRange(today().slice(0, 7));
      const range = { start: query.from ?? start, end: query.to ?? end };
      const [period, active] = await Promise.all([
        dashboard.periodTransactions(userId, { from: range.start, to: range.end }),
        activeAccounts(userId, range.start),
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
        // Parte do saldo de abertura e aplica só as transações do período.
        balanceEvolution: balanceEvolution(
          active.map((account) => ({ ...account, initialBalance: account.openingBalance })),
          period,
          range,
        ),
      };
    },
  };
}
