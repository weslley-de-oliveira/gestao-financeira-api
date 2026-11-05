import { describe, expect, it } from 'vitest';
import { collapseWhitespace, normalizeForSearch } from './text.ts';

describe('normalizeForSearch', () => {
  it.each([
    ['Alimentação', 'alimentacao'],
    ['SAÚDE', 'saude'],
    ['Pão de Açúcar', 'pao de acucar'],
    ['Crédito à vista', 'credito a vista'],
    ['Übersee Café', 'ubersee cafe'],
    ['sem acento', 'sem acento'],
    ['', ''],
  ])('normaliza "%s" como "%s"', (text, normalized) => {
    expect(normalizeForSearch(text)).toBe(normalized);
  });

  it('trata igual acentos compostos e combinados', () => {
    expect(normalizeForSearch('Educação')).toBe(normalizeForSearch('Educação'));
  });

  it('mantém espaços e pontuação', () => {
    expect(normalizeForSearch('  Casa & Lar  ')).toBe('  casa & lar  ');
  });
});

describe('collapseWhitespace', () => {
  it.each([
    ['  Mercado  ', 'Mercado'],
    ['Conta   corrente', 'Conta corrente'],
    ['\tCartão\n de  crédito ', 'Cartão de crédito'],
    ['   ', ''],
  ])('reduz "%s" a "%s"', (text, collapsed) => {
    expect(collapseWhitespace(text)).toBe(collapsed);
  });
});
