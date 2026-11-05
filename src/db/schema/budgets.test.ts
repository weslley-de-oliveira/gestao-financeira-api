import { randomUUID, randomUUIDv7 } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { categoryNameKey } from '../../modules/categories/category-name.ts';
import { createDatabase } from '../client.ts';
import {
  budgetLimits,
  budgets,
  categories,
  users,
  type Category,
  type NewBudget,
} from './index.ts';

// Os arquivos de teste rodam em paralelo no mesmo banco: cada teste cria o próprio usuário.
const { db, pool } = createDatabase(inject('databaseUrl'), 2);

afterAll(async () => {
  await pool.end();
});

/** Usuário com uma categoria de despesa. */
async function createCategory(name = 'Mercado'): Promise<Category> {
  const [user] = await db
    .insert(users)
    .values({
      email: `${randomUUID()}@exemplo.com`,
      name: 'Pessoa de Teste',
      passwordHash: 'hash-fictício',
    })
    .returning();
  const [category] = await db
    .insert(categories)
    .values({
      userId: user!.id,
      name,
      nameNormalized: categoryNameKey(name),
      type: 'expense',
      icon: 'shopping_cart',
      color: '#2e7d32',
    })
    .returning();
  return category!;
}

const violation = (code: string, constraint: string) => ({ cause: { code, constraint } });

async function insertBudget(overrides: Partial<NewBudget> = {}) {
  const category = await createCategory();
  const [budget] = await db
    .insert(budgets)
    .values({ userId: category.userId, categoryId: category.id, ...overrides })
    .returning();
  return budget!;
}

describe('tabela budgets', () => {
  it('grava com alerta de 80% por padrão', async () => {
    expect((await insertBudget()).alertThreshold).toBe(80);
  });

  it('rejeita um segundo orçamento para a mesma categoria', async () => {
    const budget = await insertBudget();

    await expect(
      db.insert(budgets).values({ userId: budget.userId, categoryId: budget.categoryId }),
    ).rejects.toMatchObject(violation('23505', 'budgets_user_category_unique'));
  });

  it.each([[0], [49], [83], [101]])('rejeita alerta de %i%%', async (alertThreshold) => {
    await expect(insertBudget({ alertThreshold })).rejects.toMatchObject(
      violation('23514', 'budgets_alert_threshold_valid'),
    );
  });

  it('rejeita categoria de outro usuário ou inexistente', async () => {
    const owner = await createCategory();
    const other = await createCategory('Lazer');

    for (const categoryId of [other.id, randomUUIDv7()]) {
      await expect(
        db.insert(budgets).values({ userId: owner.userId, categoryId }),
      ).rejects.toMatchObject(violation('23503', 'budgets_category_fk'));
    }
  });

  it('apaga os orçamentos e as vigências junto com o usuário', async () => {
    const budget = await insertBudget();
    await db.insert(budgetLimits).values({ budgetId: budget.id, month: '2026-11', amount: 1_000 });

    await db.delete(users).where(eq(users.id, budget.userId));

    expect(await db.select().from(budgets).where(eq(budgets.id, budget.id))).toEqual([]);
    expect(
      await db.select().from(budgetLimits).where(eq(budgetLimits.budgetId, budget.id)),
    ).toEqual([]);
  });
});

describe('tabela budget_limits', () => {
  it('guarda o valor em centavos como número e apaga junto com o orçamento', async () => {
    const budget = await insertBudget();
    const [limit] = await db
      .insert(budgetLimits)
      .values({ budgetId: budget.id, month: '2026-11', amount: 100_000_000_000 })
      .returning();
    expect(limit).toMatchObject({ month: '2026-11', amount: 100_000_000_000 });

    await db.delete(budgets).where(eq(budgets.id, budget.id));

    expect(
      await db.select().from(budgetLimits).where(eq(budgetLimits.budgetId, budget.id)),
    ).toEqual([]);
  });

  it('rejeita duas vigências no mesmo mês', async () => {
    const budget = await insertBudget();
    await db.insert(budgetLimits).values({ budgetId: budget.id, month: '2026-11', amount: 1_000 });

    await expect(
      db.insert(budgetLimits).values({ budgetId: budget.id, month: '2026-11', amount: 2_000 }),
    ).rejects.toMatchObject(violation('23505', 'budget_limits_budget_month_unique'));
  });

  it.each([
    ['mês fora do formato', { month: '2026-13' }, 'budget_limits_month_format'],
    ['valor zero', { amount: 0 }, 'budget_limits_amount_range'],
    ['valor acima de R$ 1 bilhão', { amount: 100_000_000_001 }, 'budget_limits_amount_range'],
  ])('rejeita %s', async (_case, overrides, constraint) => {
    const budget = await insertBudget();

    await expect(
      db
        .insert(budgetLimits)
        .values({ budgetId: budget.id, month: '2026-11', amount: 1_000, ...overrides }),
    ).rejects.toMatchObject(violation('23514', constraint));
  });
});
