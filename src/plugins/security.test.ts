import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../../test/helpers/app.ts';
import { createAccount, signUp } from '../../test/helpers/users.ts';
import { users } from '../db/schema/index.ts';

describe('verificação de Origin (CSRF)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp({
      env: {
        CORS_ORIGINS: 'http://localhost:4200',
        // Barra final de propósito: a comparação usa só a origem.
        APP_ORIGIN: 'https://app.exemplo.com/',
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  /** Login com senha errada: 401 quando a origem passa, 403 quando é barrada. */
  const loginFrom = (headers: Record<string, string>) =>
    app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'ninguem@exemplo.com', password: 'senha-errada-1' },
      headers,
    });

  it.each([
    ['origem de CORS (front em desenvolvimento)', { origin: 'http://localhost:4200' }],
    ['APP_ORIGIN (front em produção)', { origin: 'https://app.exemplo.com' }],
    [
      'a própria API (referência em /docs)',
      { origin: 'http://api.exemplo.com', host: 'api.exemplo.com' },
    ],
    ['sem Origin (cliente fora do navegador)', {}],
  ])('aceita %s', async (_case, headers) => {
    expect((await loginFrom(headers)).statusCode).toBe(401);
  });

  it.each([
    ['outro site', 'https://site-malicioso.exemplo'],
    ['porta diferente do front', 'http://localhost:4300'],
    ['http no lugar de https', 'http://app.exemplo.com'],
    ['Origin nula (iframe isolado, redirecionamento)', 'null'],
  ])('responde 403 para %s', async (_case, origin) => {
    const response = await loginFrom({ origin });

    expect(response.statusCode).toBe(403);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.json()).toMatchObject({
      status: 403,
      title: 'Acesso negado',
      detail: 'Origem da requisição não permitida.',
    });
  });

  it('barra a requisição antes de alterar qualquer dado', async () => {
    const email = `pessoa.${randomUUID()}@exemplo.com`;

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { name: 'Pessoa de Teste', email, password: 'senha1234' },
      headers: { origin: 'https://site-malicioso.exemplo' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.cookies).toEqual([]);
    expect(await app.db.select().from(users).where(eq(users.email, email))).toEqual([]);
  });

  it('não verifica métodos que só leem', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin: 'https://site-malicioso.exemplo' },
    });

    expect(response.statusCode).toBe(200);
  });
});

// O saldo e outros valores calculados mudam sem mudar a ETag (a versão do registro): uma resposta
// guardada e revalidada mostraria o valor antigo.
describe('cache das respostas', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('nenhuma resposta pode ser guardada, nem com ETag nem com erro', async () => {
    const user = await signUp(app);
    const account = await createAccount(user);

    const responses = [
      await user.api('GET', `/v1/accounts/${account.id}`),
      await user.api('GET', '/v1/accounts'),
      await user.api('GET', `/v1/accounts/${randomUUID()}`),
      await app.inject({ method: 'GET', url: '/v1/accounts' }),
    ];

    expect(responses.map((response) => response.statusCode)).toEqual([200, 200, 404, 401]);
    expect(responses[0]?.headers.etag).toBeDefined();
    for (const response of responses) {
      expect(response.headers['cache-control']).toBe('no-store');
    }
  });
});
