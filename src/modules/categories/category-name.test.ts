import { describe, expect, it } from 'vitest';
import { categoryNameKey } from './category-name.ts';

describe('categoryNameKey', () => {
  it.each([
    ['Alimentação', 'alimentacao'],
    ['  alimentacao  ', 'alimentacao'],
    ['ALIMENTAÇÃO', 'alimentacao'],
    ['Saúde   e  bem-estar', 'saude e bem-estar'],
    ['Educação\tinfantil', 'educacao infantil'],
  ])('"%s" vira "%s"', (name, key) => {
    expect(categoryNameKey(name)).toBe(key);
  });

  it('dá a mesma chave para nomes que só diferem em acento, caixa e espaços', () => {
    expect(categoryNameKey(' Lazer e  Diversão')).toBe(categoryNameKey('lazer e diversao'));
  });
});
