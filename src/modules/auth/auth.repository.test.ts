import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { createDatabase } from '../../db/client.ts';
import { categories, users, type NewUser } from '../../db/schema/index.ts';
import { DEFAULT_CATEGORIES, type DefaultCategory } from '../categories/default-categories.ts';
import { createAuthRepository } from './auth.repository.ts';

const { db, pool } = createDatabase(inject('databaseUrl'), 2);

afterAll(async () => {
  await pool.end();
});

const newUser = (): NewUser => ({
  email: `pessoa.${randomUUID()}@exemplo.com`,
  name: 'Pessoa de Teste',
  passwordHash: 'hash-fictício',
});

describe('insertUser', () => {
  it('grava o usuário e o conjunto padrão de categorias, com o nome normalizado', async () => {
    const user = await createAuthRepository(db).insertUser(newUser());

    const stored = await db.select().from(categories).where(eq(categories.userId, user!.id));
    expect(stored).toHaveLength(DEFAULT_CATEGORIES.length);
    expect(stored.find((category) => category.name === 'Contas e serviços')).toMatchObject({
      nameNormalized: 'contas e servicos',
      isDefault: true,
      isArchived: false,
    });
  });

  it('desfaz o cadastro se as categorias não puderem ser gravadas', async () => {
    const invalid = [
      ...DEFAULT_CATEGORIES,
      { name: 'Inválida', type: 'expense', icon: 'rocket', color: '#1565c0' },
    ] as DefaultCategory[];
    const user = newUser();

    await expect(createAuthRepository(db, invalid).insertUser(user)).rejects.toMatchObject({
      cause: { code: '23514', constraint: 'categories_icon_valid' },
    });

    expect(await db.select().from(users).where(eq(users.email, user.email))).toEqual([]);
  });

  it('devolve null para e-mail já cadastrado, sem gravar outro conjunto', async () => {
    const repository = createAuthRepository(db);
    const user = newUser();
    const first = await repository.insertUser(user);

    expect(await repository.insertUser({ ...user, email: user.email.toUpperCase() })).toBeNull();

    const stored = await db.select().from(categories).where(eq(categories.userId, first!.id));
    expect(stored).toHaveLength(DEFAULT_CATEGORIES.length);
  });
});
