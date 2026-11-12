import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestApp } from '../../../test/helpers/app.ts';
import { signUp } from '../../../test/helpers/users.ts';

const validBody = {
  kind: 'error',
  name: 'TypeError',
  message: "Cannot read properties of undefined (reading 'id')",
  stack: 'TypeError: Cannot read properties of undefined\n    at main.js:1:100',
  path: '/transactions?busca=farmacia#topo',
  requestId: '0192f7a1-4c2e-7d3b-9a10-123456789abc',
};

describe('POST /v1/client-errors', () => {
  let app: FastifyInstance;
  /** Cada chamada a `request.log.warn` das requisições do teste. */
  const warn = vi.fn();

  beforeAll(async () => {
    app = await createTestApp({
      setup: (instance) => {
        instance.addHook('onRequest', async (request) => {
          request.log.warn = warn;
        });
      },
    });
  });

  afterEach(() => {
    warn.mockReset();
  });

  afterAll(async () => {
    await app.close();
  });

  const report = (payload: Record<string, unknown>, cookies?: Record<string, string>) =>
    app.inject({
      method: 'POST',
      url: '/v1/client-errors',
      payload,
      headers: { 'user-agent': 'Navegador de Teste/1.0' },
      ...(cookies && { cookies }),
    });

  it('registra o erro no log, sem a query string da página', async () => {
    const response = await report(validBody);

    expect(response.statusCode).toBe(204);
    expect(warn).toHaveBeenCalledWith(
      {
        source: 'front',
        clientError: {
          kind: 'error',
          name: 'TypeError',
          message: validBody.message,
          stack: validBody.stack,
          path: '/transactions',
          requestId: validBody.requestId,
        },
        userAgent: 'Navegador de Teste/1.0',
        userId: null,
      },
      'erro no front',
    );
  });

  it('registra o id do usuário da sessão, sem exigir sessão', async () => {
    const user = await signUp(app);

    const response = await report(
      { kind: 'network', message: 'Falha de rede', path: '/' },
      user.cookies,
    );

    expect(response.statusCode).toBe(204);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: user.userId,
        clientError: expect.objectContaining({
          kind: 'network',
          name: null,
          requestId: null,
        }) as unknown,
      }),
      'erro no front',
    );
  });

  it('ignora um cookie de sessão inválido', async () => {
    const response = await report(validBody, { '__Host-session': 'token-que-nao-existe' });

    expect(response.statusCode).toBe(204);
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ userId: null }), 'erro no front');
  });

  it.each([
    ['sem mensagem', { ...validBody, message: '   ' }, 'body.message'],
    ['mensagem longa demais', { ...validBody, message: 'x'.repeat(501) }, 'body.message'],
    ['stack longa demais', { ...validBody, stack: 'x'.repeat(4_001) }, 'body.stack'],
    [
      'endereço completo em vez do caminho',
      { ...validBody, path: 'https://exemplo.com/' },
      'body.path',
    ],
    ['id de requisição inseguro', { ...validBody, requestId: 'abc\ndef ghi' }, 'body.requestId'],
    ['tipo desconhecido', { ...validBody, kind: 'warning' }, 'body.kind'],
  ])('recusa %s (422)', async (_case, payload, field) => {
    const response = await report(payload);

    expect(response.statusCode).toBe(422);
    expect(response.json<{ errors: { field: string }[] }>().errors).toContainEqual(
      expect.objectContaining({ field }),
    );
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('POST /v1/client-errors com rate limit', () => {
  it('aceita 10 relatos por minuto do mesmo IP e recusa o 11º (429)', async () => {
    const app = await createTestApp({ env: { RATE_LIMIT_ENABLED: 'true' } });
    try {
      const report = () =>
        app.inject({
          method: 'POST',
          url: '/v1/client-errors',
          payload: { kind: 'error', message: 'Erro', path: '/' },
          remoteAddress: '203.0.113.10',
        });

      for (let attempt = 1; attempt <= 10; attempt++) {
        expect((await report()).statusCode).toBe(204);
      }
      expect((await report()).statusCode).toBe(429);
    } finally {
      await app.close();
    }
  });
});
