import { z } from 'zod';
import type { Account } from '../../db/schema/index.ts';
import { APPEARANCE_COLORS } from '../../shared/models/appearance.ts';
import { ACCOUNT_ICONS, ACCOUNT_TYPES } from './accounts.constants.ts';

export const accountTypeSchema = z.enum(ACCOUNT_TYPES).meta({
  description:
    'Tipo da conta: `checking` (corrente), `savings` (poupança), `cash` (dinheiro), `investment` (investimento) ou `other`.',
});

/** Conta como a API devolve. O dono sai da sessão e não aparece na resposta. */
export const accountSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    type: accountTypeSchema,
    institution: z.string().nullable(),
    initialBalance: z.int().meta({ description: 'Saldo inicial em centavos; pode ser negativo.' }),
    color: z.enum(APPEARANCE_COLORS),
    icon: z.enum(ACCOUNT_ICONS).meta({ description: 'Ícone do Material Symbols.' }),
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
