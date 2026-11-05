import { z } from 'zod';
import type { Account } from '../../db/schema/index.ts';
import { APPEARANCE_COLORS } from '../../shared/models/appearance.ts';
import { signedCentsSchema } from '../../shared/validation/money.ts';
import {
  ACCOUNT_ICONS,
  ACCOUNT_INSTITUTION_MAX_LENGTH,
  ACCOUNT_NAME_MAX_LENGTH,
  ACCOUNT_TYPES,
} from './accounts.constants.ts';

export const accountTypeSchema = z.enum(ACCOUNT_TYPES, 'Selecione um tipo de conta válido.').meta({
  description:
    'Tipo da conta: `checking` (corrente), `savings` (poupança), `cash` (dinheiro), `investment` (investimento) ou `other`.',
});

const accountColorSchema = z.enum(APPEARANCE_COLORS, 'Selecione uma cor válida.');
const accountIconSchema = z
  .enum(ACCOUNT_ICONS, 'Selecione um ícone válido.')
  .meta({ description: 'Ícone do Material Symbols.' });

/**
 * Campos editáveis, com as mesmas regras do formulário do front. Sem `default` aqui: no `PATCH`,
 * campo ausente significa "não alterar".
 */
const accountFields = {
  name: z
    .string('Informe o nome da conta.')
    .trim()
    .min(1, 'Informe o nome da conta.')
    .max(
      ACCOUNT_NAME_MAX_LENGTH,
      `O nome deve ter no máximo ${ACCOUNT_NAME_MAX_LENGTH} caracteres.`,
    )
    .meta({ example: 'Conta corrente' }),
  type: accountTypeSchema,
  /** Vazio ou só espaços vira `null` (sem instituição). */
  institution: z
    .string('Informe a instituição como texto.')
    .trim()
    .max(
      ACCOUNT_INSTITUTION_MAX_LENGTH,
      `A instituição deve ter no máximo ${ACCOUNT_INSTITUTION_MAX_LENGTH} caracteres.`,
    )
    .nullable()
    .transform((value) => (value === '' ? null : value))
    .meta({ example: 'Banco Exemplo' }),
  initialBalance: signedCentsSchema.meta({
    description: 'Saldo inicial em centavos; pode ser negativo.',
  }),
  color: accountColorSchema,
  icon: accountIconSchema,
};

// `strictObject`: campos desconhecidos (ex.: `userId`, `id`) são rejeitados com 422.
export const createAccountBodySchema = z.strictObject({
  ...accountFields,
  institution: accountFields.institution.optional().transform((value) => value ?? null),
  initialBalance: accountFields.initialBalance.default(0),
});

export type CreateAccountInput = z.infer<typeof createAccountBodySchema>;

/** Na edição, `isArchived` arquiva ou reativa a conta: contas não são excluídas. */
export const updateAccountBodySchema = z
  .strictObject({
    ...accountFields,
    isArchived: z.boolean('Informe true ou false.').meta({
      description: 'true arquiva a conta (some da lista padrão); false a reativa.',
    }),
  })
  .partial();

export type UpdateAccountInput = z.infer<typeof updateAccountBodySchema>;

/** Conta como a API devolve. O dono sai da sessão e não aparece na resposta. */
export const accountSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    type: accountTypeSchema,
    institution: z.string().nullable(),
    initialBalance: z.int().meta({ description: 'Saldo inicial em centavos; pode ser negativo.' }),
    color: accountColorSchema,
    icon: accountIconSchema,
    isArchived: z.boolean(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'Account' });

export type AccountDto = z.infer<typeof accountSchema>;

export const accountListSchema = z.array(accountSchema);

export const accountParamsSchema = z.object({
  id: z.uuid('Identificador de conta inválido.'),
});

export const listAccountsQuerySchema = z.object({
  includeArchived: z
    .enum(['true', 'false'], 'Use true ou false.')
    .default('false')
    .meta({ description: 'Inclui as contas arquivadas na lista (padrão: só as ativas).' })
    .transform((value) => value === 'true'),
});

export type ListAccountsQuery = z.infer<typeof listAccountsQuerySchema>;

export function toAccountDto(account: Account): AccountDto {
  return {
    id: account.id,
    name: account.name,
    type: account.type,
    institution: account.institution,
    initialBalance: account.initialBalance,
    // As constraints do banco garantem que cor e ícone estão nas listas.
    color: account.color as AccountDto['color'],
    icon: account.icon as AccountDto['icon'],
    isArchived: account.isArchived,
    createdAt: account.createdAt.toISOString(),
  };
}
