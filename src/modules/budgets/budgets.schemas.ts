import { z } from 'zod';
import { MAX_MONEY_CENTS } from '../../shared/utils/money.ts';
import { BUDGET_STATES, currentLimit, type BudgetProgress } from './budget-rules.ts';
import type { BudgetWithLimits } from './budgets.repository.ts';
import { ALERT_THRESHOLD_OPTIONS, DEFAULT_ALERT_THRESHOLD } from './budgets.constants.ts';

const limitAmountSchema = z
  .int('Informe o limite em centavos inteiros.')
  .min(1, 'O limite deve ser maior que zero.')
  .max(MAX_MONEY_CENTS, 'O valor deve ser de até R$ 1 bilhão.')
  .meta({ description: 'Limite mensal em centavos.', example: 80_000 });

const alertThresholdSchema = z
  .union(
    ALERT_THRESHOLD_OPTIONS.map((option) => z.literal(option)),
    `Selecione um percentual de alerta entre ${ALERT_THRESHOLD_OPTIONS.join(', ')}.`,
  )
  .meta({
    description: `Percentual do limite a partir do qual o orçamento fica em alerta: ${ALERT_THRESHOLD_OPTIONS.join(', ')}.`,
  });

export const budgetLimitSchema = z.object({
  month: z.string().meta({ description: 'Mês (`yyyy-MM`) a partir do qual o valor vale.' }),
  amount: z.int(),
});

export const budgetProgressSchema = z
  .object({
    month: z.string().meta({ description: 'Mês consultado (`yyyy-MM`).' }),
    limit: z.int().meta({ description: 'Limite em vigor no mês, em centavos.' }),
    spent: z.int().meta({
      description: 'Despesas realizadas da categoria no mês, incluindo compras no cartão.',
    }),
    pending: z
      .int()
      .meta({ description: 'Despesas pendentes da categoria no mês, à parte (previstas).' }),
    available: z.int().meta({ description: 'Limite − gasto; negativo quando excedido.' }),
    percent: z.number().meta({ description: 'Percentual gasto, sem arredondamento nem teto.' }),
    state: z.enum(BUDGET_STATES).meta({
      description:
        '`ok` (dentro do limite), `warning` (a partir do percentual de alerta) ou `exceeded` (acima de 100%).',
    }),
  })
  .meta({ id: 'BudgetProgress' });

/** Orçamento como a API devolve. */
export const budgetSchema = z
  .object({
    id: z.uuid(),
    categoryId: z.uuid().meta({ description: 'Categoria de despesa; não muda.' }),
    alertThreshold: z.int(),
    limitAmount: z.int().meta({ description: 'Limite atual (o da vigência mais recente).' }),
    limits: z.array(budgetLimitSchema).meta({
      description: 'Vigências do limite, em ordem crescente de mês: o histórico dos limites.',
    }),
    progress: budgetProgressSchema.nullable().meta({
      description: 'Consumo do mês consultado; `null` se o orçamento ainda não valia nele.',
    }),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'Budget' });

export type BudgetDto = z.infer<typeof budgetSchema>;

export const budgetListSchema = z.array(budgetSchema);

const monthQueryParam = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Informe o mês no formato aaaa-mm.')
  .optional()
  .meta({ description: 'Mês do consumo (`yyyy-MM`); padrão: o mês atual.', example: '2026-11' });

export const budgetMonthQuerySchema = z.object({ month: monthQueryParam });

export const budgetParamsSchema = z.object({
  id: z.uuid('Identificador de orçamento inválido.'),
});

// `strictObject`: campos desconhecidos (ex.: `userId`, `limits`) são rejeitados com 422.
export const createBudgetBodySchema = z.strictObject({
  categoryId: z.uuid('Selecione a categoria.'),
  limitAmount: limitAmountSchema,
  alertThreshold: alertThresholdSchema.default(DEFAULT_ALERT_THRESHOLD),
});

export type CreateBudgetInput = z.infer<typeof createBudgetBodySchema>;

export const updateBudgetBodySchema = z.strictObject({
  limitAmount: limitAmountSchema.optional().meta({
    description:
      'Novo limite mensal: vale do mês atual em diante; os meses anteriores mantêm o limite que tinham.',
  }),
  alertThreshold: alertThresholdSchema.optional(),
  // A categoria é fixa. Enviá-la é erro, com mensagem clara.
  categoryId: z
    .never('A categoria do orçamento não pode ser alterada.')
    .optional()
    .meta({ description: 'Não aceito: a categoria é definida na criação e não muda.' }),
});

export type UpdateBudgetInput = z.infer<typeof updateBudgetBodySchema>;

export function toBudgetDto(
  budget: BudgetWithLimits & { progress: BudgetProgress | null },
): BudgetDto {
  return {
    id: budget.id,
    categoryId: budget.categoryId,
    alertThreshold: budget.alertThreshold,
    limitAmount: currentLimit(budget.limits),
    limits: budget.limits,
    progress: budget.progress,
    createdAt: budget.createdAt.toISOString(),
  };
}
