import { z } from 'zod';

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;

/**
 * Posição na lista ordenada: a ordenação usada, o valor da chave de ordenação e o id do último
 * item. A próxima página começa logo depois dela. Diferente de `offset`, não pula nem repete itens
 * quando entram registros novos entre uma página e outra.
 */
export interface PageCursor {
  sort: string;
  value: string | number;
  id: string;
}

const cursorPayloadSchema = z.strictObject({
  s: z.string().min(1).max(40),
  v: z.union([z.string().max(40), z.number().int()]),
  i: z.uuid(),
});

/** Cursor opaco para o cliente: base64url do JSON `{ s, v, i }`. */
export function encodeCursor({ sort, value, id }: PageCursor): string {
  return Buffer.from(JSON.stringify({ s: sort, v: value, i: id })).toString('base64url');
}

/** Devolve `null` se o texto não for um cursor gerado por `encodeCursor`. */
export function decodeCursor(cursor: string): PageCursor | null {
  try {
    const json: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    const parsed = cursorPayloadSchema.safeParse(json);
    return parsed.success ? { sort: parsed.data.s, value: parsed.data.v, id: parsed.data.i } : null;
  } catch {
    return null;
  }
}

/** Parâmetros de página da query string: `cursor` (da resposta anterior) e `limit`. */
export const pageQueryFields = {
  cursor: z
    .string()
    .optional()
    .transform((value, context) => {
      if (value === undefined) return undefined;
      const cursor = decodeCursor(value);
      if (!cursor) {
        context.addIssue({
          code: 'custom',
          message: 'Cursor inválido: use o `nextCursor` recebido.',
        });
        return z.NEVER;
      }
      return cursor;
    })
    .meta({ description: 'O `nextCursor` da página anterior; ausente na primeira página.' }),
  limit: z.coerce
    .number('Informe o tamanho da página como número.')
    .int('Informe o tamanho da página como número inteiro.')
    .min(1, 'O tamanho da página deve ser pelo menos 1.')
    .max(MAX_PAGE_SIZE, `O tamanho da página deve ser no máximo ${MAX_PAGE_SIZE}.`)
    .default(DEFAULT_PAGE_SIZE)
    .meta({ description: `Itens por página (1 a ${MAX_PAGE_SIZE}; padrão ${DEFAULT_PAGE_SIZE}).` }),
};

/** Resposta paginada: os itens e o cursor da próxima página (`null` quando acabou). */
export function pageSchema<T extends z.ZodType>(item: T, id: string) {
  return z
    .object({
      items: z.array(item),
      nextCursor: z
        .string()
        .nullable()
        .meta({ description: 'Envie como `cursor` para buscar a próxima página; `null` no fim.' }),
    })
    .meta({ id });
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/**
 * Monta a página a partir de uma consulta que buscou `limit + 1` linhas: a linha a mais só indica
 * que há próxima página e não é devolvida. `positionOf` diz a posição do último item na ordenação.
 */
export function toPage<T>(rows: T[], limit: number, positionOf: (row: T) => PageCursor): Page<T> {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor: rows.length > limit && last !== undefined ? encodeCursor(positionOf(last)) : null,
  };
}
