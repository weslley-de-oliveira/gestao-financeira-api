import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestApp } from '../../../test/helpers/app.ts';

describe('rotas de operação', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('GET /health responde 200 sem depender do banco', async () => {
    app = await createTestApp();

    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('GET /ready responde 200 quando o banco responde', async () => {
    app = await createTestApp();

    const response = await app.inject({ method: 'GET', url: '/ready' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ready' });
  });

  it('GET /ready responde 503 em Problem Details quando o banco não responde', async () => {
    // Porta sem nenhum serviço: a conexão é recusada na hora.
    app = await createTestApp({ DATABASE_URL: 'postgres://gestao:gestao@127.0.0.1:1/inexistente' });

    const response = await app.inject({ method: 'GET', url: '/ready' });

    expect(response.statusCode).toBe(503);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.json()).toMatchObject({
      status: 503,
      detail: 'O banco de dados não está respondendo.',
    });
  });

  it('devolve o x-request-id recebido', async () => {
    app = await createTestApp();

    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': 'teste-request-id-123' },
    });

    expect(response.headers['x-request-id']).toBe('teste-request-id-123');
  });
});
