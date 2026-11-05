import { z } from 'zod';
import type { Category } from '../../db/schema/index.ts';
import { APPEARANCE_COLORS } from '../../shared/models/appearance.ts';
import { booleanQueryParam } from '../../shared/validation/query.ts';
import { CATEGORY_ICONS, CATEGORY_TYPES } from './categories.constants.ts';

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
    createdAt: z.iso.datetime(),
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

export function toCategoryDto(category: Category): CategoryDto {
  return {
    id: category.id,
    name: category.name,
    type: category.type,
    // As constraints do banco garantem que ícone e cor estão nas listas.
    icon: category.icon as CategoryDto['icon'],
    color: category.color as CategoryDto['color'],
    isDefault: category.isDefault,
    isArchived: category.isArchived,
    createdAt: category.createdAt.toISOString(),
  };
}
