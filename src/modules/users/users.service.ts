import type { User } from '../../db/schema/index.ts';
import type { UsersRepository } from './users.repository.ts';
import type { UpdateProfileInput } from './users.schemas.ts';

export interface UsersServiceDependencies {
  users: UsersRepository;
}

export interface UsersService {
  /** Altera o nome do perfil. E-mail e senha não mudam por aqui. */
  updateProfile(userId: string, input: UpdateProfileInput): Promise<User>;
}

export function createUsersService({ users }: UsersServiceDependencies): UsersService {
  return {
    async updateProfile(userId, { name }) {
      const updated = await users.updateName(userId, name);
      // A sessão acabou de ser validada: o usuário só some se for excluído no meio da requisição.
      if (!updated) throw new Error('Usuário da sessão não encontrado.');
      return updated;
    },
  };
}
