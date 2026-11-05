import { z } from 'zod';
import { MAX_MONEY_CENTS } from '../../shared/utils/money.ts';
import { currentLimit } from './budget-rules.ts';
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
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'Budget' });

export type BudgetDto = z.infer<typeof budgetSchema>;

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

export function toBudgetDto(budget: BudgetWithLimits): BudgetDto {
  return {
    id: budget.id,
    categoryId: budget.categoryId,
    alertThreshold: budget.alertThreshold,
    limitAmount: currentLimit(budget.limits),
    limits: budget.limits,
    createdAt: budget.createdAt.toISOString(),
  };
}
