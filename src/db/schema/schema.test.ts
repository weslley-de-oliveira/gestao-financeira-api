import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { createDatabase } from '../client.ts';
import { sessions, users, type NewUser } from './index.ts';

// Os arquivos de teste rodam em paralelo no mesmo banco: cada teste usa e-mails próprios em vez
// de limpar as tabelas.
const { db, pool } = createDatabase(inject('databaseUrl'), 2);

afterAll(async () => {
  await pool.end();
});

function newUser(overrides: Partial<NewUser> = {}): NewUser {
  return {
    email: `${randomUUID()}@exemplo.com`,
    name: 'Pessoa de Teste',
    passwordHash: 'hash-fictício',
    ...overrides,
  };
}

function tokenHash(): string {
  return createHash('sha256').update(randomBytes(32)).digest('hex');
}

async function insertUser(overrides: Partial<NewUser> = {}) {
  const [user] = await db.insert(users).values(newUser(overrides)).returning();
  if (!user) throw new Error('usuário não inserido');
  return user;
}

describe('tabela users', () => {
  it('gera id UUID v7 e datas de criação e atualização', async () => {
    const user = await insertUser();

    expect(user.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(user.createdAt).toBeInstanceOf(Date);
    expect(user.updatedAt).toBeInstanceOf(Date);
  });

  it('rejeita e-mail repetido sem diferenciar maiúsculas', async () => {
    const email = `${randomUUID()}@exemplo.com`;
    await insertUser({ email });

    await expect(insertUser({ email: email.toUpperCase() })).rejects.toMatchObject({
      cause: { code: '23505', constraint: 'users_email_unique' },
    });
  });

  it('encontra o usuário pelo e-mail em qualquer caixa', async () => {
    const user = await insertUser({ email: `Pessoa.${randomUUID()}@Exemplo.com` });

    const [found] = await db.select().from(users).where(eq(users.email, user.email.toLowerCase()));

    expect(found?.id).toBe(user.id);
  });

  it('rejeita nome vazio ou com mais de 80 caracteres', async () => {
    const violation = { cause: { code: '23514', constraint: 'users_name_length' } };

    await expect(insertUser({ name: '' })).rejects.toMatchObject(violation);
    await expect(insertUser({ name: 'a'.repeat(81) })).rejects.toMatchObject(violation);
  });
});

describe('tabela sessions', () => {
  it('rejeita token_hash que não é SHA-256 em hex', async () => {
    const user = await insertUser();

    await expect(
      db.insert(sessions).values({
        userId: user.id,
        tokenHash: 'z'.repeat(64),
        expiresAt: new Date(Date.now() + 60_000),
      }),
    ).rejects.toMatchObject({ cause: { code: '23514', constraint: 'sessions_token_hash_hex' } });
  });

  it('rejeita token_hash repetido', async () => {
    const user = await insertUser();
    const session = { userId: user.id, tokenHash: tokenHash(), expiresAt: new Date() };
    await db.insert(sessions).values(session);

    await expect(db.insert(sessions).values(session)).rejects.toMatchObject({
      cause: { code: '23505', constraint: 'sessions_token_hash_unique' },
    });
  });

  it('apaga as sessões junto com o usuário', async () => {
    const user = await insertUser();
    await db.insert(sessions).values({
      userId: user.id,
      tokenHash: tokenHash(),
      expiresAt: new Date(Date.now() + 60_000),
      ip: '203.0.113.10',
      userAgent: 'Vitest',
    });

    await db.delete(users).where(eq(users.id, user.id));

    const remaining = await db.select().from(sessions).where(eq(sessions.userId, user.id));
    expect(remaining).toEqual([]);
  });
});
