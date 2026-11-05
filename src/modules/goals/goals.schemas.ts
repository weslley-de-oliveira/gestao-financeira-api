import { z } from 'zod';
import type { Goal } from '../../db/schema/index.ts';
import { APPEARANCE_COLORS } from '../../shared/models/appearance.ts';
import { MAX_MONEY_CENTS } from '../../shared/utils/money.ts';
import { collapseWhitespace } from '../../shared/utils/text.ts';
import { booleanQueryParam } from '../../shared/validation/query.ts';
import {
  GOAL_DESCRIPTION_MAX_LENGTH,
  GOAL_ICONS,
  GOAL_NAME_MAX_LENGTH,
} from './goals.constants.ts';

const colorSchema = z.enum(APPEARANCE_COLORS, 'Selecione uma cor válida.');
const iconSchema = z
  .enum(GOAL_ICONS, 'Selecione um ícone válido.')
  .meta({ description: 'Ícone do Material Symbols.' });

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

export function toGoalDto(goal: Goal): GoalDto {
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
  };
}
