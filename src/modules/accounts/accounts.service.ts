import type { Account } from '../../db/schema/index.ts';
import { DomainError } from '../../shared/errors/domain-error.ts';
import type { AccountsRepository } from './accounts.repository.ts';
import type { ListAccountsQuery } from './accounts.schemas.ts';

/** Conta inexistente ou de outro usuário: a mesma resposta, para não revelar o que existe. */
export class AccountNotFoundError extends DomainError {
  readonly kind = 'not-found';

  constructor() {
    super('Conta não encontrada.');
  }
}

export interface AccountsService {
  list(userId: string, query: ListAccountsQuery): Promise<Account[]>;
  /** Conta do usuário; inexistente ou de outro usuário → `AccountNotFoundError`. */
  get(userId: string, accountId: string): Promise<Account>;
}

export function createAccountsService(repository: AccountsRepository): AccountsService {
  return {
    list(userId, query) {
      return repository.listAccounts(userId, query);
    },

    async get(userId, accountId) {
      const account = await repository.findAccount(userId, accountId);
      if (!account) {
        throw new AccountNotFoundError();
      }
      return account;
    },
  };
}
