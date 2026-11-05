import { randomUUIDv7 } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { decodeCursor, encodeCursor, pageQueryFields, toPage } from './pagination.ts';

describe('cursor de página', () => {
  const position = { date: '2026-11-05', id: randomUUIDv7() };

  it('volta à mesma posição depois de codificado', () => {
    expect(decodeCursor(encodeCursor(position))).toEqual(position);
  });

  it('é opaco e seguro para URL', () => {
    expect(encodeCursor(position)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it.each([
    ['texto qualquer', 'abc'],
    ['base64 de algo que não é JSON', Buffer.from('oi').toString('base64url')],
    ['JSON sem os campos', Buffer.from('{"x":1}').toString('base64url')],
    [
      'data inválida',
      Buffer.from(JSON.stringify({ d: '2026-13-01', i: position.id })).toString('base64url'),
    ],
    [
      'id que não é UUID',
      Buffer.from(JSON.stringify({ d: '2026-11-05', i: '1' })).toString('base64url'),
    ],
    [
      'campos a mais',
      Buffer.from(JSON.stringify({ d: '2026-11-05', i: position.id, x: 1 })).toString('base64url'),
    ],
  ])('recusa %s', (_case, cursor) => {
    expect(decodeCursor(cursor)).toBeNull();
  });
});

describe('parâmetros de página', () => {
  const query = z.object(pageQueryFields);

  it('usa 50 itens e nenhum cursor por padrão', () => {
    expect(query.parse({})).toEqual({ cursor: undefined, limit: 50 });
  });

  it('converte limit da query string e decodifica o cursor', () => {
    const position = { date: '2026-11-05', id: randomUUIDv7() };

    expect(query.parse({ limit: '10', cursor: encodeCursor(position) })).toEqual({
      limit: 10,
      cursor: position,
    });
  });

  it.each([
    [{ limit: '0' }, 'O tamanho da página deve ser pelo menos 1.'],
    [{ limit: '101' }, 'O tamanho da página deve ser no máximo 100.'],
    [{ limit: '2.5' }, 'Informe o tamanho da página como número inteiro.'],
    [{ cursor: 'abc' }, 'Cursor inválido: use o `nextCursor` recebido.'],
  ])('recusa %o', (input, message) => {
    expect(query.safeParse(input).error?.issues[0]?.message).toBe(message);
  });
});

describe('toPage', () => {
  const rows = ['2026-11-05', '2026-11-04', '2026-11-03'].map((date) => ({
    date,
    id: randomUUIDv7(),
  }));

  it('com uma linha a mais, devolve o limite e o cursor do último item', () => {
    const page = toPage(rows, 2);

    expect(page.items).toEqual(rows.slice(0, 2));
    expect(decodeCursor(page.nextCursor ?? '')).toEqual(rows[1]);
  });

  it('sem linha a mais, é a última página', () => {
    expect(toPage(rows, 3)).toEqual({ items: rows, nextCursor: null });
    expect(toPage([], 3)).toEqual({ items: [], nextCursor: null });
  });
});
