import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { createDatabase } from '../client.ts';
import {
  goalContributions,
  goals,
  users,
  type NewGoal,
  type NewGoalContribution,
} from './index.ts';

// Os arquivos de teste rodam em paralelo no mesmo banco: cada teste cria o próprio usuário.
const { db, pool } = createDatabase(inject('databaseUrl'), 2);

afterAll(async () => {
  await pool.end();
});

const violation = (code: string, constraint: string) => ({ cause: { code, constraint } });

async function insertGoal(overrides: Partial<NewGoal> = {}) {
  const [user] = await db
    .insert(users)
    .values({
      email: `${randomUUID()}@exemplo.com`,
      name: 'Pessoa de Teste',
      passwordHash: 'hash-fictício',
    })
    .returning();
  const [goal] = await db
    .insert(goals)
    .values({
      userId: user!.id,
      name: 'Viagem',
      targetAmount: 1_000_000,
      color: '#2e7d32',
      icon: 'flight',
      ...overrides,
    })
    .returning();
  return goal!;
}

describe('tabela goals', () => {
  it('grava sem valor inicial, prazo nem descrição, ativa e não pausada', async () => {
    const goal = await insertGoal({ deadline: '2027-04-30' });

    expect(goal).toMatchObject({
      initialAmount: 0,
      description: null,
      deadline: '2027-04-30',
      isPaused: false,
      isArchived: false,
    });
  });

  it.each([
    ['nome vazio', { name: '' }, 'goals_name_length'],
    ['nome com 61 caracteres', { name: 'a'.repeat(61) }, 'goals_name_length'],
    ['descrição vazia', { description: '' }, 'goals_description_length'],
    ['descrição com 301 caracteres', { description: 'a'.repeat(301) }, 'goals_description_length'],
    ['alvo zero', { targetAmount: 0 }, 'goals_target_amount_range'],
    ['alvo acima de R$ 1 bilhão', { targetAmount: 100_000_000_001 }, 'goals_target_amount_range'],
    ['valor inicial negativo', { initialAmount: -1 }, 'goals_initial_amount_range'],
    ['cor fora da paleta', { color: '#000000' }, 'goals_color_valid'],
    ['ícone fora da lista', { icon: 'rocket' }, 'goals_icon_valid'],
  ])('rejeita %s', async (_case, overrides, constraint) => {
    await expect(insertGoal(overrides)).rejects.toMatchObject(violation('23514', constraint));
  });

  it('apaga as metas e os aportes junto com o usuário', async () => {
    const goal = await insertGoal();
    await db
      .insert(goalContributions)
      .values({ goalId: goal.id, type: 'deposit', amount: 1_000, date: '2026-11-01' });

    await db.delete(users).where(eq(users.id, goal.userId));

    expect(await db.select().from(goals).where(eq(goals.id, goal.id))).toEqual([]);
    expect(
      await db.select().from(goalContributions).where(eq(goalContributions.goalId, goal.id)),
    ).toEqual([]);
  });
});

describe('tabela goal_contributions', () => {
  const contribution = (goalId: string, overrides: Partial<NewGoalContribution> = {}) => ({
    goalId,
    type: 'deposit' as const,
    amount: 10_000,
    date: '2026-11-01',
    ...overrides,
  });

  it('grava aporte e retirada com valor em centavos como número', async () => {
    const goal = await insertGoal();

    const inserted = await db
      .insert(goalContributions)
      .values([
        contribution(goal.id),
        contribution(goal.id, { type: 'withdrawal', amount: 100_000_000_000, note: 'Resgate' }),
      ])
      .returning();

    expect(inserted.map(({ type, amount, note }) => ({ type, amount, note }))).toEqual([
      { type: 'deposit', amount: 10_000, note: null },
      { type: 'withdrawal', amount: 100_000_000_000, note: 'Resgate' },
    ]);
  });

  it.each([
    [
      'tipo desconhecido',
      { type: 'transfer' as NewGoalContribution['type'] },
      'goal_contributions_type_valid',
    ],
    ['valor zero', { amount: 0 }, 'goal_contributions_amount_range'],
    ['observação vazia', { note: '' }, 'goal_contributions_note_length'],
    ['observação com 121 caracteres', { note: 'a'.repeat(121) }, 'goal_contributions_note_length'],
  ])('rejeita %s', async (_case, overrides, constraint) => {
    const goal = await insertGoal();

    await expect(
      db.insert(goalContributions).values(contribution(goal.id, overrides)),
    ).rejects.toMatchObject(violation('23514', constraint));
  });
});
