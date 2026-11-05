/** Normaliza texto para busca e comparação: sem acentos e em minúsculas. */
export function normalizeForSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

/** Remove espaços nas pontas e reduz espaços repetidos a um só. */
export function collapseWhitespace(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}
