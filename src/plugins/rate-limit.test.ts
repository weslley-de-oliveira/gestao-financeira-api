import { randomUUID } from 'node:crypto';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestApp } from '../../test/helpers/app.ts';

const uniqueEmail = () => `pessoa.${randomUUID()}@exemplo.com`;

describe('plugin rate-limit', () => {
  let app: FastifyInstance;

  // Uma app por teste: os contadores ficam em memória e recomeçam do zero.
  afterEach(async () => {
    await app.close();
  });

  const createApp = async () => {
    app = await createTestApp({ env: { RATE_LIMIT_ENABLED: 'true' } });
  };

  const login = (email: string, remoteAddress = '127.0.0.1') =>
    app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email, password: 'senha-errada-1' },
      remoteAddress,
    });

  function expectTooManyRequests(response: LightMyRequestResponse) {
    expect(response.statusCode).toBe(429);
    expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.json()).toMatchObject({
      status: 429,
      title: 'Muitas requisições',
      detail: expect.stringMatching(
        /^Muitas tentativas\. Tente novamente em \d+ segundos?\.$/,
      ) as unknown,
    });
  }

  it('bloqueia a 6ª tentativa de login por minuto do mesmo IP e e-mail', async () => {
    await createApp();
    const email = uniqueEmail();

    for (let attempt = 1; attempt <= 5; attempt++) {
      expect((await login(email)).statusCode).toBe(401);
    }

    expectTooManyRequests(await login(email));
  });

  it('conta o e-mail sem diferenciar maiúsculas', async () => {
    await createApp();
    const email = uniqueEmail();

    for (let attempt = 1; attempt <= 5; attempt++) {
      await login(attempt % 2 === 0 ? email.toUpperCase() : email);
    }

    expectTooManyRequests(await login(` ${email.toUpperCase()} `));
  });

  it('não bloqueia outro e-mail nem outro IP', async () => {
    await createApp();
    const email = uniqueEmail();
    for (let attempt = 1; attempt <= 6; attempt++) {
      await login(email);
    }

    expect((await login(uniqueEmail())).statusCode).toBe(401);
    expect((await login(email, '203.0.113.7')).statusCode).toBe(401);
  });

  it('bloqueia o 6º cadastro por minuto do mesmo IP', async () => {
    await createApp();
    const register = () =>
      app.inject({
        method: 'POST',
        url: '/v1/auth/register',
        payload: { name: 'Pessoa de Teste', email: uniqueEmail(), password: 'senha1234' },
      });

    for (let attempt = 1; attempt <= 5; attempt++) {
      expect((await register()).statusCode).toBe(201);
    }

    expectTooManyRequests(await register());
  });

  it('aplica o limite geral de 300 requisições por minuto por IP', async () => {
    await createApp();

    for (let request = 1; request <= 300; request++) {
      await app.inject({ method: 'GET', url: '/v1/auth/me' });
    }

    expectTooManyRequests(await app.inject({ method: 'GET', url: '/v1/auth/me' }));
  });

  it('não limita /health e /ready', async () => {
    await createApp();

    for (let request = 1; request <= 305; request++) {
      await app.inject({ method: 'GET', url: '/health' });
    }

    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
  });
});
