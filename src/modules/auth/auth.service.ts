import type { User } from '../../db/schema/index.ts';
import { DomainError } from '../../shared/errors/domain-error.ts';
import type { AuthRepository } from './auth.repository.ts';
import type { RegisterInput } from './auth.schemas.ts';
import { hashPassword } from './password.ts';

export class EmailAlreadyRegisteredError extends DomainError {
  readonly kind = 'conflict';

  constructor() {
    super('Este e-mail já está cadastrado.');
  }
}

export interface AuthService {
  /** Cadastra o usuário com a senha em Argon2id. E-mail repetido → `EmailAlreadyRegisteredError`. */
  register(input: RegisterInput): Promise<User>;
}

export function createAuthService(repository: AuthRepository): AuthService {
  return {
    async register({ name, email, password }) {
      const passwordHash = await hashPassword(password);
      const user = await repository.insertUser({ name, email, passwordHash });
      if (!user) {
        throw new EmailAlreadyRegisteredError();
      }
      return user;
    },
  };
}
