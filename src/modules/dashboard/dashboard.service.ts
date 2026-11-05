import { monthRange, type IsoDate } from '../../shared/utils/date.ts';
import type { AccountsRepository } from '../accounts/accounts.repository.ts';
import type { DashboardRepository } from './dashboard.repository.ts';
import { summarizeTransactions } from './dashboard-metrics.ts';
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
  /** Saldo atual somado das contas ativas (a mesma regra de `currentBalance`). */
  async function activeBalance(userId: string) {
    const active = await accounts.listAccounts(userId, { includeArchived: false });
    const totals = await accounts.movementTotals(
      userId,
      active.map((account) => account.id),
    );
    return {
      total: active.reduce(
        (sum, account) => sum + account.initialBalance + (totals.get(account.id) ?? 0),
        0,
      ),
      activeAccounts: active.length,
    };
  }

  return {
    async get(userId, query) {
      const { start, end } = monthRange(today().slice(0, 7));
      const from = query.from ?? start;
      const to = query.to ?? end;
      const [period, balance] = await Promise.all([
        dashboard.periodTransactions(userId, { from, to }),
        activeBalance(userId),
      ]);
      return { from, to, summary: summarizeTransactions(period), balance };
    },
  };
}
