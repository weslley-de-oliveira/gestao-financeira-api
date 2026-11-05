import { randomUUID } from 'node:crypto';
import type { User } from '../../db/schema/index.ts';
import { DomainError } from '../../shared/errors/domain-error.ts';
import type { AuthRepository } from './auth.repository.ts';
import type { LoginInput, RegisterInput } from './auth.schemas.ts';
import { hashPassword, verifyPassword } from './password.ts';
import {
  SESSION_IDLE_TIMEOUT_MS,
  generateSessionToken,
  hashSessionToken,
} from './session-token.ts';

export class EmailAlreadyRegisteredError extends DomainError {
  readonly kind = 'conflict';

  constructor() {
    super('Este e-mail já está cadastrado.');
  }
}

/** Mesma mensagem para e-mail inexistente e senha errada: não revela quem tem conta. */
export class InvalidCredentialsError extends DomainError {
  readonly kind = 'unauthorized';

  constructor() {
    super('E-mail ou senha inválidos.');
  }
}

/** Dados da requisição guardados na sessão, para o usuário reconhecer seus acessos. */
export interface ClientInfo {
  ip: string | null;
  userAgent: string | null;
}

export interface AuthenticatedSession {
  user: User;
  /** Token em claro: vai só para o cookie; o banco guarda o hash. */
  token: string;
  expiresAt: Date;
}

export interface AuthService {
  /** Cadastra o usuário e já abre a sessão. E-mail repetido → `EmailAlreadyRegisteredError`. */
  register(input: RegisterInput, client: ClientInfo): Promise<AuthenticatedSession>;
  /** Confere as credenciais e abre uma sessão nova. Falha → `InvalidCredentialsError`. */
  login(input: LoginInput, client: ClientInfo): Promise<AuthenticatedSession>;
}

export function createAuthService(repository: AuthRepository, now = () => new Date()): AuthService {
  async function openSession(user: User, client: ClientInfo): Promise<AuthenticatedSession> {
    const token = generateSessionToken();
    const issuedAt = now();
    const expiresAt = new Date(issuedAt.getTime() + SESSION_IDLE_TIMEOUT_MS);
    await repository.insertSession({
      userId: user.id,
      tokenHash: hashSessionToken(token),
      expiresAt,
      lastSeenAt: issuedAt,
      ip: client.ip,
      userAgent: client.userAgent,
    });
    return { user, token, expiresAt };
  }

  return {
    async register({ name, email, password }, client) {
      const passwordHash = await hashPassword(password);
      const user = await repository.insertUser({ name, email, passwordHash });
      if (!user) {
        throw new EmailAlreadyRegisteredError();
      }
      return openSession(user, client);
    },

    async login({ email, password }, client) {
      const user = await repository.findUserByEmail(email);
      if (!user) {
        // Gasta o mesmo tempo de uma verificação real: o tempo de resposta não revela o e-mail.
        await verifyPassword(await dummyPasswordHash(), password);
        throw new InvalidCredentialsError();
      }

      const { valid, needsRehash } = await verifyPassword(user.passwordHash, password);
      if (!valid) {
        throw new InvalidCredentialsError();
      }
      if (needsRehash) {
        await repository.updatePasswordHash(user.id, await hashPassword(password));
      }
      return openSession(user, client);
    },
  };
}

let dummyHash: Promise<string> | undefined;

/** Hash de uma senha aleatória com os parâmetros atuais, gerado uma vez no primeiro uso. */
function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword(randomUUID());
  return dummyHash;
}
