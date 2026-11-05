import type { User } from '../../db/schema/index.ts';
import { InvalidInputError } from '../../shared/errors/domain-error.ts';
import { verifyPassword } from '../auth/password.ts';
import type { UsersRepository } from './users.repository.ts';
import type { DeleteAccountInput, UpdateProfileInput } from './users.schemas.ts';

export interface UsersServiceDependencies {
  users: UsersRepository;
}

export interface UsersService {
  /** Altera o nome do perfil. E-mail e senha não mudam por aqui. */
  updateProfile(userId: string, input: UpdateProfileInput): Promise<User>;
  /**
   * Exclui a conta e todos os dados, confirmando com a senha atual (senha errada →
   * `InvalidInputError`). Todas as sessões do usuário são encerradas junto.
   */
  deleteAccount(userId: string, input: DeleteAccountInput): Promise<void>;
}

export function createUsersService({ users }: UsersServiceDependencies): UsersService {
  return {
    async updateProfile(userId, { name }) {
      const updated = await users.updateName(userId, name);
      // A sessão acabou de ser validada: o usuário só some se for excluído no meio da requisição.
      if (!updated) throw new Error('Usuário da sessão não encontrado.');
      return updated;
    },

    async deleteAccount(userId, { password }) {
      const user = await users.findUser(userId);
      if (!user) throw new Error('Usuário da sessão não encontrado.');
      const { valid } = await verifyPassword(user.passwordHash, password);
      if (!valid) {
        throw new InvalidInputError([{ field: 'password', message: 'Senha incorreta.' }]);
      }
      await users.deleteUser(userId);
    },
  };
}
