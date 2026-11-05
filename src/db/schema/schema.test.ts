import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { createDatabase } from '../client.ts';
import { categoryNameKey } from '../../modules/categories/category-name.ts';
import {
  accounts,
  categories,
  sessions,
  users,
  type NewAccount,
  type NewCategory,
  type NewUser,
} from './index.ts';

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

describe('tabela accounts', () => {
  async function newAccount(overrides: Partial<NewAccount> = {}): Promise<NewAccount> {
    const user = await insertUser();
    return {
      userId: user.id,
      name: 'Conta corrente',
      type: 'checking',
      color: '#1565c0',
      icon: 'account_balance',
      ...overrides,
    };
  }

  const violation = (constraint: string) => ({ cause: { code: '23514', constraint } });

  it('grava com saldo inicial zero, ativa e sem instituição por padrão', async () => {
    const [account] = await db
      .insert(accounts)
      .values(await newAccount())
      .returning();

    expect(account).toMatchObject({ initialBalance: 0, isArchived: false, institution: null });
  });

  it('guarda o saldo inicial em centavos como número, inclusive negativo e no limite', async () => {
    const values = [
      await newAccount({ initialBalance: 100_000_000_000 }),
      await newAccount({ initialBalance: -150_075 }),
    ];

    const inserted = await db.insert(accounts).values(values).returning();

    expect(inserted.map((account) => account.initialBalance)).toEqual([100_000_000_000, -150_075]);
  });

  it('rejeita saldo inicial acima de R$ 1 bilhão em qualquer sentido', async () => {
    for (const initialBalance of [100_000_000_001, -100_000_000_001]) {
      await expect(
        db.insert(accounts).values(await newAccount({ initialBalance })),
      ).rejects.toMatchObject(violation('accounts_initial_balance_range'));
    }
  });

  it.each([
    ['nome vazio', { name: '' }, 'accounts_name_length'],
    ['nome com mais de 60 caracteres', { name: 'a'.repeat(61) }, 'accounts_name_length'],
    ['instituição vazia', { institution: '' }, 'accounts_institution_length'],
    [
      'instituição com mais de 60 caracteres',
      { institution: 'a'.repeat(61) },
      'accounts_institution_length',
    ],
    ['tipo desconhecido', { type: 'credit' as NewAccount['type'] }, 'accounts_type_valid'],
    ['cor fora da paleta', { color: '#000000' }, 'accounts_color_valid'],
    ['ícone fora da lista', { icon: 'rocket' }, 'accounts_icon_valid'],
  ])('rejeita %s', async (_case, overrides, constraint) => {
    await expect(db.insert(accounts).values(await newAccount(overrides))).rejects.toMatchObject(
      violation(constraint),
    );
  });

  it('apaga as contas junto com o usuário', async () => {
    const account = await newAccount();
    await db.insert(accounts).values(account);

    await db.delete(users).where(eq(users.id, account.userId));

    const remaining = await db.select().from(accounts).where(eq(accounts.userId, account.userId));
    expect(remaining).toEqual([]);
  });
});

describe('tabela categories', () => {
  /** Categoria com o nome já normalizado, como a API vai gravar. */
  function category(userId: string, overrides: Partial<NewCategory> = {}): NewCategory {
    const name = overrides.name ?? 'Alimentação';
    return {
      userId,
      name,
      nameNormalized: categoryNameKey(name),
      type: 'expense',
      icon: 'restaurant',
      color: '#c62828',
      ...overrides,
    };
  }

  const uniqueViolation = {
    cause: { code: '23505', constraint: 'categories_user_type_name_unique' },
  };
  const violation = (constraint: string) => ({ cause: { code: '23514', constraint } });

  it('grava como categoria do usuário, ativa e não padrão', async () => {
    const user = await insertUser();

    const [created] = await db.insert(categories).values(category(user.id)).returning();

    expect(created).toMatchObject({
      nameNormalized: 'alimentacao',
      isDefault: false,
      isArchived: false,
    });
  });

  it('rejeita nome repetido no mesmo tipo, sem diferenciar acentos, maiúsculas e espaços', async () => {
    const user = await insertUser();
    await db.insert(categories).values(category(user.id, { name: 'Alimentação' }));

    await expect(
      db.insert(categories).values(category(user.id, { name: '  ALIMENTACAO ' })),
    ).rejects.toMatchObject(uniqueViolation);
  });

  it('conta as arquivadas na unicidade', async () => {
    const user = await insertUser();
    await db.insert(categories).values(category(user.id, { isArchived: true }));

    await expect(db.insert(categories).values(category(user.id))).rejects.toMatchObject(
      uniqueViolation,
    );
  });

  it('aceita o mesmo nome em outro tipo ou para outro usuário', async () => {
    const user = await insertUser();
    const other = await insertUser();
    await db.insert(categories).values(category(user.id, { name: 'Outros' }));

    await db
      .insert(categories)
      .values([
        category(user.id, { name: 'Outros', type: 'income', icon: 'more_horiz' }),
        category(other.id, { name: 'Outros' }),
      ]);

    const rows = await db.select().from(categories).where(eq(categories.nameNormalized, 'outros'));
    expect(rows.filter((row) => [user.id, other.id].includes(row.userId))).toHaveLength(3);
  });

  it.each([
    ['nome vazio', { name: '', nameNormalized: 'x' }, 'categories_name_length'],
    [
      'nome com mais de 40 caracteres',
      { name: 'a'.repeat(41), nameNormalized: 'a'.repeat(41) },
      'categories_name_length',
    ],
    ['nome normalizado vazio', { nameNormalized: '' }, 'categories_name_normalized_not_empty'],
    ['tipo desconhecido', { type: 'transfer' as NewCategory['type'] }, 'categories_type_valid'],
    ['cor fora da paleta', { color: '#000000' }, 'categories_color_valid'],
    [
      'ícone de conta, fora da lista de categorias',
      { icon: 'account_balance' },
      'categories_icon_valid',
    ],
  ])('rejeita %s', async (_case, overrides, constraint) => {
    const user = await insertUser();

    await expect(db.insert(categories).values(category(user.id, overrides))).rejects.toMatchObject(
      violation(constraint),
    );
  });

  it('apaga as categorias junto com o usuário', async () => {
    const user = await insertUser();
    await db.insert(categories).values(category(user.id));

    await db.delete(users).where(eq(users.id, user.id));

    const remaining = await db.select().from(categories).where(eq(categories.userId, user.id));
    expect(remaining).toEqual([]);
  });
});
