import { eq } from 'drizzle-orm';
import { categoryNameKey } from '../../modules/categories/category-name.ts';
import { hashPassword } from '../../modules/auth/password.ts';
import type { IsoDate } from '../../shared/utils/date.ts';
import type { Database } from '../client.ts';
import {
  accounts,
  budgetLimits,
  budgets,
  categories,
  creditCards,
  goalContributions,
  goals,
  transactions,
  users,
  type NewAccount,
  type NewCategory,
  type NewCreditCard,
  type NewTransaction,
} from '../schema/index.ts';
import seed from './demo-seed.json' with { type: 'json' };
import { monthsSinceAnchor, shiftSeedDates } from './seed-dates.ts';

/** Conta fictícia da demo, a mesma da tela de login do front (`demo-credentials.ts`). */
export const DEMO_CREDENTIALS = {
  email: 'demo@exemplo.com',
  password: 'demo1234',
} as const;

type Seed = typeof seed;

export interface DemoSeedSummary {
  userId: string;
  accounts: number;
  categories: number;
  creditCards: number;
  transactions: number;
  budgets: number;
  goals: number;
}

/**
 * Cria (ou recria) a pessoa da demo com o cenário de `demo-seed.json` (o mesmo `db.seed.json` do
 * front: seis meses de dados), com as datas avançadas para o mês de `today`. Idempotente: apaga a
 * demo anterior (e tudo o que é dela, em cascata) antes de inserir. Tudo numa transação.
 */
export async function seedDemo(db: Database, today: IsoDate): Promise<DemoSeedSummary> {
  const data: Seed = shiftSeedDates(seed, monthsSinceAnchor(seed.meta.anchorDate, today));
  const passwordHash = await hashPassword(DEMO_CREDENTIALS.password);
  const [user] = data.users;
  if (!user) throw new Error('O seed não tem a pessoa da demo.');

  await db.transaction(async (tx) => {
    await tx.delete(users).where(eq(users.email, DEMO_CREDENTIALS.email));
    await tx.insert(users).values({
      id: user.id,
      name: user.name,
      email: DEMO_CREDENTIALS.email,
      passwordHash,
      createdAt: new Date(user.createdAt),
    });

    await tx.insert(accounts).values(
      data.accounts.map(
        (account): NewAccount => ({
          ...account,
          type: account.type as NewAccount['type'],
          createdAt: new Date(account.createdAt),
        }),
      ),
    );
    await tx.insert(categories).values(
      data.categories.map(
        (category): NewCategory => ({
          ...category,
          type: category.type as NewCategory['type'],
          nameNormalized: categoryNameKey(category.name),
          createdAt: new Date(category.createdAt),
        }),
      ),
    );
    await tx.insert(creditCards).values(
      data.creditCards.map(
        (card): NewCreditCard => ({
          ...card,
          brand: card.brand as NewCreditCard['brand'],
          createdAt: new Date(card.createdAt),
        }),
      ),
    );
    await tx.insert(transactions).values(
      data.transactions.map(
        (transaction): NewTransaction => ({
          ...transaction,
          type: transaction.type as NewTransaction['type'],
          status: transaction.status as NewTransaction['status'],
          createdAt: new Date(transaction.createdAt),
        }),
      ),
    );

    for (const { limits, ...budget } of data.budgets) {
      await tx.insert(budgets).values({ ...budget, createdAt: new Date(budget.createdAt) });
      await tx
        .insert(budgetLimits)
        .values(limits.map((limit) => ({ ...limit, budgetId: budget.id })));
    }
    for (const { contributions, ...goal } of data.goals) {
      await tx.insert(goals).values({ ...goal, createdAt: new Date(goal.createdAt) });
      if (contributions.length > 0) {
        await tx.insert(goalContributions).values(
          contributions.map((contribution) => ({
            ...contribution,
            type: contribution.type as 'deposit' | 'withdrawal',
            goalId: goal.id,
            createdAt: new Date(contribution.createdAt),
          })),
        );
      }
    }
  });

  return {
    userId: user.id,
    accounts: data.accounts.length,
    categories: data.categories.length,
    creditCards: data.creditCards.length,
    transactions: data.transactions.length,
    budgets: data.budgets.length,
    goals: data.goals.length,
  };
}
