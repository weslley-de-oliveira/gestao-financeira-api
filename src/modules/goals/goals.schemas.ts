import { z } from 'zod';
import type { Goal, GoalContribution } from '../../db/schema/index.ts';
import { APPEARANCE_COLORS } from '../../shared/models/appearance.ts';
import { MAX_MONEY_CENTS } from '../../shared/utils/money.ts';
import { collapseWhitespace } from '../../shared/utils/text.ts';
import { positiveCentsSchema } from '../../shared/validation/money.ts';
import { booleanQueryParam } from '../../shared/validation/query.ts';
import { GOAL_STATUSES, type GoalProgress } from './goal-rules.ts';
import {
  CONTRIBUTION_NOTE_MAX_LENGTH,
  CONTRIBUTION_TYPES,
  GOAL_DESCRIPTION_MAX_LENGTH,
  GOAL_ICONS,
  GOAL_NAME_MAX_LENGTH,
} from './goals.constants.ts';

const colorSchema = z.enum(APPEARANCE_COLORS, 'Selecione uma cor válida.');
const iconSchema = z
  .enum(GOAL_ICONS, 'Selecione um ícone válido.')
  .meta({ description: 'Ícone do Material Symbols.' });

export const contributionSchema = z
  .object({
    id: z.uuid(),
    type: z
      .enum(CONTRIBUTION_TYPES)
      .meta({ description: '`deposit` (aporte) ou `withdrawal` (retirada).' }),
    accountId: z.uuid().nullable().meta({
      description:
        'Conta de onde o aporte saiu ou para onde a retirada voltou; `null` quando só registra na meta.',
    }),
    amount: z
      .int()
      .meta({ description: 'Centavos, sempre positivo: o tipo define se soma ou subtrai.' }),
    date: z.iso.date(),
    note: z.string().nullable(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'GoalContribution' });

/** Meta como a API devolve. */
export const goalSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    description: z.string().nullable(),
    targetAmount: z.int().meta({ description: 'Valor-alvo em centavos.' }),
    initialAmount: z
      .int()
      .meta({ description: 'Valor já guardado quando a meta foi criada, em centavos.' }),
    deadline: z.iso.date().nullable().meta({ description: 'Data-limite, se houver.' }),
    color: colorSchema,
    icon: iconSchema,
    isPaused: z.boolean().meta({ description: 'Pausada: não fica atrasada enquanto pausada.' }),
    isArchived: z.boolean(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime().meta({
      description: 'Versão do registro: a ETag é derivada dela (use a ETag no `If-Match`).',
    }),
    contributions: z
      .array(contributionSchema)
      .meta({ description: 'Aportes e retiradas, dos mais recentes para os mais antigos.' }),
    currentAmount: z.int().meta({ description: 'Acumulado: inicial + aportes − retiradas.' }),
    remainingAmount: z.int().meta({ description: 'Quanto falta para o alvo; zero se atingido.' }),
    excessAmount: z.int().meta({ description: 'Quanto passou do alvo; zero se não atingido.' }),
    percent: z.number().meta({ description: 'Percentual atingido, sem teto em 100.' }),
    status: z.enum(GOAL_STATUSES).meta({
      description:
        'Pela regra concluída > pausada > atrasada > em andamento: `completed`, `paused`, `overdue` ou `in-progress`.',
    }),
    monthsLeft: z.int().nullable().meta({
      description: 'Meses até o prazo, contando o atual; `null` sem prazo, concluída ou vencida.',
    }),
    monthlyPace: z.int().nullable().meta({
      description:
        'Aporte mensal para atingir o alvo no prazo, arredondado para cima; mesmo critério de `monthsLeft`.',
    }),
  })
  .meta({ id: 'Goal' });

export type GoalDto = z.infer<typeof goalSchema>;

export const goalListSchema = z.array(goalSchema);

export const goalParamsSchema = z.object({
  id: z.uuid('Identificador de meta inválido.'),
});

export const listGoalsQuerySchema = z.object({
  includeArchived: booleanQueryParam('Inclui as metas arquivadas na lista (padrão: só as ativas).'),
});

export type ListGoalsQuery = z.infer<typeof listGoalsQuerySchema>;

/** Campos editáveis, com as mesmas regras e mensagens do formulário do front. */
const goalFields = {
  name: z
    .string('Informe o nome da meta.')
    .overwrite(collapseWhitespace)
    .min(1, 'Informe o nome da meta.')
    .max(GOAL_NAME_MAX_LENGTH, `O nome deve ter no máximo ${GOAL_NAME_MAX_LENGTH} caracteres.`)
    .meta({ example: 'Viagem ao Japão' }),
  /** Vazia ou só espaços vira `null`. */
  description: z
    .string('Informe a descrição como texto.')
    .trim()
    .max(
      GOAL_DESCRIPTION_MAX_LENGTH,
      `A descrição deve ter no máximo ${GOAL_DESCRIPTION_MAX_LENGTH} caracteres.`,
    )
    .nullable()
    .transform((value) => (value === '' ? null : value)),
  targetAmount: z
    .int('Informe o valor-alvo em centavos inteiros.')
    .min(1, 'O valor deve ser maior que zero.')
    .max(MAX_MONEY_CENTS, 'O valor deve ser de até R$ 1 bilhão.')
    .meta({ description: 'Valor-alvo em centavos.', example: 1_000_000 }),
  initialAmount: z
    .int('Informe o valor inicial em centavos inteiros.')
    .min(0, 'Informe um valor válido.')
    .max(MAX_MONEY_CENTS, 'O valor deve ser de até R$ 1 bilhão.')
    .meta({ description: 'Valor já guardado, em centavos (pode ser zero).' }),
  deadline: z.iso
    .date('Informe uma data válida no formato aaaa-mm-dd.')
    .nullable()
    .meta({ description: 'Data-limite: hoje ou uma data futura.' }),
  color: colorSchema,
  icon: iconSchema,
};

// `strictObject`: campos desconhecidos (ex.: `userId`, `isArchived`) são rejeitados com 422.
export const createGoalBodySchema = z.strictObject({
  ...goalFields,
  description: goalFields.description.optional().transform((value) => value ?? null),
  initialAmount: goalFields.initialAmount.default(0),
  deadline: goalFields.deadline.optional().transform((value) => value ?? null),
});

export type CreateGoalInput = z.infer<typeof createGoalBodySchema>;

/** Edição parcial; `isPaused` pausa ou retoma e `isArchived` arquiva ou reativa (sem exclusão). */
export const updateGoalBodySchema = z
  .strictObject({
    ...goalFields,
    isPaused: z.boolean('Informe true ou false.').meta({
      description: 'true pausa a meta (não fica atrasada enquanto pausada); false a retoma.',
    }),
    isArchived: z.boolean('Informe true ou false.').meta({
      description: 'true arquiva a meta (some da lista padrão); false a reativa.',
    }),
  })
  .partial();

export type UpdateGoalInput = z.infer<typeof updateGoalBodySchema>;

export const contributionParamsSchema = goalParamsSchema.extend({
  contributionId: z.uuid('Identificador de movimentação inválido.'),
});

// `strictObject`: campos desconhecidos (ex.: `goalId`) são rejeitados com 422.
export const createContributionBodySchema = z.strictObject({
  type: z.enum(CONTRIBUTION_TYPES, 'Selecione aporte ou retirada.'),
  amount: positiveCentsSchema,
  accountId: z
    .uuid('Selecione uma conta válida.')
    .nullable()
    .optional()
    .transform((value) => value ?? null)
    .meta({
      description:
        'Conta ativa de onde o aporte sai ou para onde a retirada volta. O saldo dela muda, como numa transferência; sem conta, só registra na meta.',
    }),
  date: z.iso
    .date('Informe uma data válida no formato aaaa-mm-dd.')
    .meta({ description: 'Data da movimentação: hoje ou antes.' }),
  /** Vazia ou só espaços vira `null`. */
  note: z
    .string('Informe a observação como texto.')
    .trim()
    .max(
      CONTRIBUTION_NOTE_MAX_LENGTH,
      `A observação deve ter no máximo ${CONTRIBUTION_NOTE_MAX_LENGTH} caracteres.`,
    )
    .nullable()
    .optional()
    .transform((value) => (value === '' ? null : (value ?? null))),
});

export type CreateContributionInput = z.infer<typeof createContributionBodySchema>;

export function toGoalDto(
  goal: Goal & { contributions: GoalContribution[] } & GoalProgress,
): GoalDto {
  return {
    id: goal.id,
    name: goal.name,
    description: goal.description,
    targetAmount: goal.targetAmount,
    initialAmount: goal.initialAmount,
    deadline: goal.deadline,
    // As constraints do banco garantem que cor e ícone estão nas listas.
    color: goal.color as GoalDto['color'],
    icon: goal.icon as GoalDto['icon'],
    isPaused: goal.isPaused,
    isArchived: goal.isArchived,
    createdAt: goal.createdAt.toISOString(),
    updatedAt: goal.updatedAt.toISOString(),
    contributions: goal.contributions.map((contribution) => ({
      id: contribution.id,
      type: contribution.type,
      accountId: contribution.accountId,
      amount: contribution.amount,
      date: contribution.date,
      note: contribution.note,
      createdAt: contribution.createdAt.toISOString(),
    })),
    currentAmount: goal.currentAmount,
    remainingAmount: goal.remainingAmount,
    excessAmount: goal.excessAmount,
    percent: goal.percent,
    status: goal.status,
    monthsLeft: goal.monthsLeft,
    monthlyPace: goal.monthlyPace,
  };
}
