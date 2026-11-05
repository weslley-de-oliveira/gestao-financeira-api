import type { Account } from '../../db/schema/index.ts';
import { DomainError } from '../../shared/errors/domain-error.ts';
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

export interface AccountsService {
  list(userId: string, query: ListAccountsQuery): Promise<Account[]>;
  /** Conta do usuário; inexistente ou de outro usuário → `AccountNotFoundError`. */
  get(userId: string, accountId: string): Promise<Account>;
  /** Cria a conta para o usuário da sessão (o dono nunca vem do corpo da requisição). */
  create(userId: string, input: CreateAccountInput): Promise<Account>;
  /** Altera só os campos enviados; inexistente ou de outro usuário → `AccountNotFoundError`. */
  update(userId: string, accountId: string, changes: UpdateAccountInput): Promise<Account>;
}

export function createAccountsService(repository: AccountsRepository): AccountsService {
  async function get(userId: string, accountId: string): Promise<Account> {
    const account = await repository.findAccount(userId, accountId);
    if (!account) {
      throw new AccountNotFoundError();
    }
    return account;
  }

  return {
    list(userId, query) {
      return repository.listAccounts(userId, query);
    },

    get,

    create(userId, input) {
      return repository.insertAccount({ ...input, userId });
    },

    async update(userId, accountId, changes) {
      // Corpo vazio: nada a alterar, mas a conta ainda precisa existir e ser do usuário.
      if (Object.keys(changes).length === 0) {
        return get(userId, accountId);
      }
      const account = await repository.updateAccount(userId, accountId, changes);
      if (!account) {
        throw new AccountNotFoundError();
      }
      return account;
    },
  };
}
