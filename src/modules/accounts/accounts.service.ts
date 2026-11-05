import type { Account } from '../../db/schema/index.ts';
import { DomainError } from '../../shared/errors/domain-error.ts';
import type { Cents } from '../../shared/utils/money.ts';
import type { AccountsRepository } from './accounts.repository.ts';
import type {
  CreateAccountInput,
  ListAccountsQuery,
  UpdateAccountInput,
} from './accounts.schemas.ts';

/** Conta inexistente ou de outro usuário: a mesma resposta, para não revelar o que existe. */
export class AccountNotFoundError extends DomainError {
  readonly kind = 'not-found';

  constructor() {
    super('Conta não encontrada.');
  }
}

/** Conta com o saldo atual, calculado a partir das transações (não é guardado). */
export type AccountWithBalance = Account & { currentBalance: Cents };

export interface AccountsService {
  list(userId: string, query: ListAccountsQuery): Promise<AccountWithBalance[]>;
  /** Conta do usuário; inexistente ou de outro usuário → `AccountNotFoundError`. */
  get(userId: string, accountId: string): Promise<AccountWithBalance>;
  /** Cria a conta para o usuário da sessão (o dono nunca vem do corpo da requisição). */
  create(userId: string, input: CreateAccountInput): Promise<AccountWithBalance>;
  /** Altera só os campos enviados; inexistente ou de outro usuário → `AccountNotFoundError`. */
  update(
    userId: string,
    accountId: string,
    changes: UpdateAccountInput,
  ): Promise<AccountWithBalance>;
}

export function createAccountsService(repository: AccountsRepository): AccountsService {
  /** Saldo atual = saldo inicial + efeito das transações realizadas (regra `calculateBalance`). */
  async function withBalances(userId: string, accounts: Account[]): Promise<AccountWithBalance[]> {
    const totals = await repository.movementTotals(
      userId,
      accounts.map((account) => account.id),
    );
    return accounts.map((account) => ({
      ...account,
      currentBalance: account.initialBalance + (totals.get(account.id) ?? 0),
    }));
  }

  async function withBalance(userId: string, account: Account): Promise<AccountWithBalance> {
    const [result] = await withBalances(userId, [account]);
    if (!result) throw new Error('Saldo não calculado.');
    return result;
  }

  async function find(userId: string, accountId: string): Promise<Account> {
    const account = await repository.findAccount(userId, accountId);
    if (!account) {
      throw new AccountNotFoundError();
    }
    return account;
  }

  return {
    async list(userId, query) {
      return withBalances(userId, await repository.listAccounts(userId, query));
    },

    async get(userId, accountId) {
      return withBalance(userId, await find(userId, accountId));
    },

    async create(userId, input) {
      return withBalance(userId, await repository.insertAccount({ ...input, userId }));
    },

    async update(userId, accountId, changes) {
      // Corpo vazio: nada a alterar, mas a conta ainda precisa existir e ser do usuário.
      if (Object.keys(changes).length === 0) {
        return withBalance(userId, await find(userId, accountId));
      }
      const account = await repository.updateAccount(userId, accountId, changes);
      if (!account) {
        throw new AccountNotFoundError();
      }
      return withBalance(userId, account);
    },
  };
}
