import { sql } from 'drizzle-orm';
import { boolean, check, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import {
  CATEGORY_ICONS,
  CATEGORY_NAME_MAX_LENGTH,
  CATEGORY_TYPES,
} from '../../modules/categories/categories.constants.ts';
import { APPEARANCE_COLORS } from '../../shared/models/appearance.ts';
import { oneOf, primaryId, timestamps } from './columns.ts';
import { users } from './users.ts';

/**
 * Categorias de receita e despesa. O nome é único por usuário e tipo sem diferenciar acentos,
 * maiúsculas e espaços extras: a API grava essa forma em `name_normalized` (`categoryNameKey`), e a
 * constraint impede duplicatas mesmo em cadastros simultâneos. Arquivadas também contam. O tipo não
 * muda depois de criada, e categorias não são excluídas, só arquivadas.
 */
export const categories = pgTable(
  'categories',
  {
    id: primaryId(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    nameNormalized: text().notNull(),
    type: text({ enum: CATEGORY_TYPES }).notNull(),
    icon: text().notNull(),
    color: text().notNull(),
    /** Criada com o conjunto inicial do cadastro; `false` nas criadas pelo usuário. */
    isDefault: boolean().notNull().default(false),
    isArchived: boolean().notNull().default(false),
    ...timestamps(),
  },
  // As mesmas regras são validadas na API; aqui protegem contra gravações fora dela.
  (table) => [
    // Também atende às consultas por usuário (e por usuário e tipo): começa por `user_id`.
    unique('categories_user_type_name_unique').on(table.userId, table.type, table.nameNormalized),
    // Alvo das chaves estrangeiras compostas (categoria + dono + tipo) de outras tabelas.
    unique('categories_id_user_id_type_unique').on(table.id, table.userId, table.type),
    check(
      'categories_name_length',
      sql`char_length(${table.name}) between 1 and ${sql.raw(String(CATEGORY_NAME_MAX_LENGTH))}`,
    ),
    check('categories_name_normalized_not_empty', sql`${table.nameNormalized} <> ''`),
    check('categories_type_valid', oneOf(table.type, CATEGORY_TYPES)),
    check('categories_color_valid', oneOf(table.color, APPEARANCE_COLORS)),
    check('categories_icon_valid', oneOf(table.icon, CATEGORY_ICONS)),
  ],
);

export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
