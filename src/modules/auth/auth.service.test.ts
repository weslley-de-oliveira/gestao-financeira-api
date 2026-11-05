import { randomUUIDv7 } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { User } from '../../db/schema/index.ts';
import type { AuthRepository } from './auth.repository.ts';
import { createAuthService, InvalidCredentialsError, type ClientInfo } from './auth.service.ts';
import { hashPassword, verifyPassword } from './password.ts';

// Espiona as funções reais: o hash continua sendo calculado, mas dá para contar as chamadas.
vi.mock('./password.ts', { spy: true });

const client: ClientInfo = { ip: '127.0.0.1', userAgent: null, currentToken: null };
const password = 'senha1234';

/** Repositório em memória com um único usuário: o teste mede só o serviço, sem o banco. */
async function createService() {
  const user: User = {
    id: randomUUIDv7(),
    name: 'Pessoa de Teste',
    email: 'pessoa@exemplo.com',
    passwordHash: await hashPassword(password),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const repository: AuthRepository = {
    insertUser: () => Promise.resolve(null),
    findUserByEmail: (email) => Promise.resolve(email === user.email ? user : null),
    updatePasswordHash: () => Promise.resolve(),
    insertSession: () => Promise.resolve(),
    findActiveSession: () => Promise.resolve(null),
    touchSession: () => Promise.resolve(),
    deleteSession: () => Promise.resolve(),
  };
  return { service: createAuthService(repository), user };
}

async function elapsedMs(task: () => Promise<unknown>): Promise<number> {
  const start = performance.now();
  await task().catch(() => undefined);
  return performance.now() - start;
}

function median(values: number[]): number {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

describe('login: enumeração de e-mail', () => {
  it('e-mail inexistente também confere a senha com um hash Argon2id', async () => {
    const { service } = await createService();
    vi.mocked(verifyPassword).mockClear();

    await expect(
      service.login({ email: 'ninguem@exemplo.com', password }, client),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);

    expect(verifyPassword).toHaveBeenCalledTimes(1);
    expect(vi.mocked(verifyPassword).mock.calls[0]?.[0]).toMatch(
      /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/,
    );
  });

  it('e-mail inexistente e senha errada falham com o mesmo erro', async () => {
    const { service, user } = await createService();

    const unknownEmail = service.login({ email: 'ninguem@exemplo.com', password }, client);
    const wrongPassword = service.login({ email: user.email, password: 'outra5678' }, client);

    const errors = await Promise.allSettled([unknownEmail, wrongPassword]);
    const [first, second] = errors.map((result) =>
      result.status === 'rejected' ? (result.reason as Error) : null,
    );
    expect(first).toBeInstanceOf(InvalidCredentialsError);
    expect(second).toBeInstanceOf(InvalidCredentialsError);
    expect(first?.message).toBe(second?.message);
  });

  it('e-mail inexistente leva o mesmo tempo que senha errada', async () => {
    const { service, user } = await createService();
    const unknownEmail = () => service.login({ email: 'ninguem@exemplo.com', password }, client);
    const wrongPassword = () => service.login({ email: user.email, password: 'outra5678' }, client);
    await elapsedMs(unknownEmail); // aquece o hash fictício, gerado no primeiro uso

    const unknownTimes: number[] = [];
    const wrongTimes: number[] = [];
    for (let round = 0; round < 7; round++) {
      unknownTimes.push(await elapsedMs(unknownEmail));
      wrongTimes.push(await elapsedMs(wrongPassword));
    }

    // Sem o hash fictício, o e-mail inexistente responderia em ~0 ms contra dezenas de ms do Argon2.
    // A margem larga evita falsos alarmes em máquinas lentas ou ocupadas (CI).
    const ratio = median(unknownTimes) / median(wrongTimes);
    expect(ratio).toBeGreaterThan(0.5);
    expect(ratio).toBeLessThan(2);
  });
});
