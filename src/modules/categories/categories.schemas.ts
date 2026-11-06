import { z } from 'zod';
import type { Category } from '../../db/schema/index.ts';
import { APPEARANCE_COLORS } from '../../shared/models/appearance.ts';
import { collapseWhitespace } from '../../shared/utils/text.ts';
import { booleanQueryParam } from '../../shared/validation/query.ts';
import {
  CATEGORY_ICONS,
  CATEGORY_NAME_MAX_LENGTH,
  CATEGORY_TYPES,
} from './categories.constants.ts';

export const categoryTypeSchema = z
  .enum(CATEGORY_TYPES, 'Selecione despesa ou receita.')
  .meta({ description: 'Tipo da categoria: `expense` (despesa) ou `income` (receita).' });

const categoryColorSchema = z.enum(APPEARANCE_COLORS, 'Selecione uma cor válida.');
const categoryIconSchema = z
  .enum(CATEGORY_ICONS, 'Selecione um ícone válido.')
  .meta({ description: 'Ícone do Material Symbols.' });

/** Categoria como a API devolve. O dono e o nome normalizado são internos. */
export const categorySchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    type: categoryTypeSchema,
    icon: categoryIconSchema,
    color: categoryColorSchema,
    isDefault: z.boolean().meta({
      description: 'Criada com o conjunto inicial do cadastro; `false` nas criadas pelo usuário.',
    }),
    isArchived: z.boolean(),
    transactionCount: z.int().meta({
      description: 'Quantidade de transações que usam a categoria, em todos os períodos.',
    }),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime().meta({
      description: 'Versão do registro: a ETag é derivada dela (use a ETag no `If-Match`).',
    }),
  })
  .meta({ id: 'Category' });

export type CategoryDto = z.infer<typeof categorySchema>;

export const categoryListSchema = z.array(categorySchema);

export const categoryParamsSchema = z.object({
  id: z.uuid('Identificador de categoria inválido.'),
});

export const listCategoriesQuerySchema = z.object({
  type: categoryTypeSchema
    .optional()
    .meta({ description: 'Só as categorias deste tipo (padrão: as dos dois tipos).' }),
  includeArchived: booleanQueryParam(
    'Inclui as categorias arquivadas na lista (padrão: só as ativas).',
  ),
});

export type ListCategoriesQuery = z.infer<typeof listCategoriesQuerySchema>;

/** Nome com os espaços extras removidos (como no front) antes de checar os limites. */
const categoryNameSchema = z
  .string('Informe o nome da categoria.')
  .overwrite(collapseWhitespace)
  .min(1, 'Informe o nome da categoria.')
  .max(
    CATEGORY_NAME_MAX_LENGTH,
    `O nome deve ter no máximo ${CATEGORY_NAME_MAX_LENGTH} caracteres.`,
  )
  .meta({ example: 'Alimentação' });

// `strictObject`: campos desconhecidos (ex.: `userId`, `isDefault`) são rejeitados com 422.
export const createCategoryBodySchema = z.strictObject({
  name: categoryNameSchema,
  type: categoryTypeSchema,
  icon: categoryIconSchema,
  color: categoryColorSchema,
});

export type CreateCategoryInput = z.infer<typeof createCategoryBodySchema>;

export const updateCategoryBodySchema = z.strictObject({
  name: categoryNameSchema.optional(),
  icon: categoryIconSchema.optional(),
  color: categoryColorSchema.optional(),
  isArchived: z.boolean('Informe true ou false.').optional().meta({
    description: 'true arquiva a categoria (some da lista padrão); false a reativa.',
  }),
  // O tipo é fixo: as transações da categoria dependem dele. Enviá-lo é erro, com mensagem clara.
  type: z
    .never('O tipo da categoria não pode ser alterado.')
    .optional()
    .meta({ description: 'Não aceito: o tipo é definido na criação e não muda.' }),
});

export type UpdateCategoryInput = z.infer<typeof updateCategoryBodySchema>;

export function toCategoryDto(category: Category & { transactionCount: number }): CategoryDto {
  return {
    id: category.id,
    name: category.name,
    type: category.type,
    // As constraints do banco garantem que ícone e cor estão nas listas.
    icon: category.icon as CategoryDto['icon'],
    color: category.color as CategoryDto['color'],
    isDefault: category.isDefault,
    isArchived: category.isArchived,
    transactionCount: category.transactionCount,
    createdAt: category.createdAt.toISOString(),
    updatedAt: category.updatedAt.toISOString(),
  };
}
