import { collapseWhitespace, normalizeForSearch } from '../../shared/utils/text.ts';

/**
 * Chave de unicidade do nome (`name_normalized`): sem acentos, em minúsculas e com espaços extras
 * removidos, como o `nameKey` do front. "Alimentação" e "  alimentacao " são a mesma categoria.
 */
export function categoryNameKey(name: string): string {
  return normalizeForSearch(collapseWhitespace(name));
}
