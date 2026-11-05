import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../../test/helpers/app.ts';
import { sessions, users } from '../db/schema/index.ts';
import { SESSION_COOKIE } from '../modules/auth/session-cookie.ts';
import { hashSessionToken } from '../modules/auth/session-token.ts';
import { currentAuth } from './auth.ts';

describe('plugin auth', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp({
      setup: (instance) => {
        // Escopo privado, como os módulos farão: o hook vale só para as rotas registradas aqui.
        instance.register((scope, _options, done) => {
          scope.addHook('onRequest', scope.authenticate);
          scope.get('/teste/privada', async (request) => {
            const { user, sessionId } = currentAuth(request);
            return { email: user.email, sessionId };
          });
          done();
        });
        instance.get('/teste/publica', async (request) => ({ autenticado: request.auth !== null }));
        instance.get('/teste/sem-hook', async (request) => currentAuth(request).user.email);
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  /** Cadastra um usuário e devolve o token do cookie da sessão aberta. */
  async function signUp(): Promise<{ email: string; token: string }> {
    const email = `pessoa.${randomUUID()}@exemplo.com`;
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { name: 'Pessoa de Teste', email, password: 'senha1234' },
    });
    const token = response.cookies.find(({ name }) => name === SESSION_COOKIE)?.value;
    if (!token) throw new Error('cadastro sem cookie de sessão');
    return { email, token };
  }

  const getPrivate = (token?: string) =>
    app.inject({
      method: 'GET',
      url: '/teste/privada',
      ...(token && { cookies: { [SESSION_COOKIE]: token } }),
    });

  function expectUnauthorized(response: Awaited<ReturnType<typeof getPrivate>>) {
    expect(response.statusCode).toBe(401);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.json()).toMatchObject({
      status: 401,
      detail: 'Sessão ausente, expirada ou encerrada. Entre novamente.',
    });
  }

  /** O cookie velho é apagado: mesmo nome, valor vazio e data no passado. */
  function expectCookieCleared(response: Awaited<ReturnType<typeof getPrivate>>) {
    const cleared = response.cookies.find(({ name }) => name === SESSION_COOKIE);
    expect(cleared?.value).toBe('');
    expect(cleared?.expires?.getTime()).toBeLessThan(Date.now());
  }

  it('libera a rota privada com sessão válida e expõe o usuário e a sessão', async () => {
    const { email, token } = await signUp();

    const response = await getPrivate(token);

    expect(response.statusCode).toBe(200);
    const [session] = await app.db
      .select()
      .from(sessions)
      .where(eq(sessions.tokenHash, hashSessionToken(token)));
    expect(response.json()).toEqual({ email, sessionId: session?.id });
  });

  it('responde 401 sem cookie, sem mexer em cookies', async () => {
    const response = await getPrivate();

    expectUnauthorized(response);
    expect(response.cookies).toEqual([]);
  });

  it('responde 401 e apaga o cookie quando o token não existe', async () => {
    const response = await getPrivate('token-que-nunca-existiu');

    expectUnauthorized(response);
    expectCookieCleared(response);
  });

  it('responde 401 e apaga o cookie quando a sessão expirou', async () => {
    const { token } = await signUp();
    await app.db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(sessions.tokenHash, hashSessionToken(token)));

    const response = await getPrivate(token);

    expectUnauthorized(response);
    expectCookieCleared(response);
  });

  it('responde 401 quando a sessão foi encerrada (apagada do banco)', async () => {
    const { token } = await signUp();
    await app.db.delete(sessions).where(eq(sessions.tokenHash, hashSessionToken(token)));

    expectUnauthorized(await getPrivate(token));
  });

  it('responde 401 quando o usuário foi excluído', async () => {
    const { email, token } = await signUp();
    await app.db.delete(users).where(eq(users.email, email));

    expectUnauthorized(await getPrivate(token));
  });

  it('não valida a sessão em rotas públicas', async () => {
    const { token } = await signUp();

    const response = await app.inject({
      method: 'GET',
      url: '/teste/publica',
      cookies: { [SESSION_COOKIE]: token },
    });

    expect(response.json()).toEqual({ autenticado: false });
  });

  it('falha com 500 se uma rota lê a sessão sem registrar app.authenticate', async () => {
    const response = await app.inject({ method: 'GET', url: '/teste/sem-hook' });

    expect(response.statusCode).toBe(500);
  });
});
