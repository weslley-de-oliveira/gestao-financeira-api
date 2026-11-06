import { randomUUID } from 'node:crypto';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../../../test/helpers/app.ts';
import { SESSION_COOKIE } from '../auth/session-cookie.ts';

describe('POST /v1/me/password', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  const sessionOf = (response: LightMyRequestResponse) => {
    const token = response.cookies.find(({ name }) => name === SESSION_COOKIE)?.value;
    if (!token) throw new Error('resposta sem cookie de sessão');
    return { [SESSION_COOKIE]: token };
  };

  /** Pessoa nova com duas sessões, como em dois aparelhos. */
  async function personWithTwoSessions() {
    const email = `pessoa.${randomUUID()}@exemplo.com`;
    const credentials = { email, password: 'senha1234' };
    const register = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { name: 'Pessoa de Teste', ...credentials },
    });
    const login = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: credentials });
    return { email, phone: sessionOf(register), laptop: sessionOf(login) };
  }

  const change = (cookies: Record<string, string>, payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/v1/me/password', cookies, payload });

  const me = (cookies: Record<string, string>) =>
    app.inject({ method: 'GET', url: '/v1/auth/me', cookies });

  const login = (email: string, password: string) =>
    app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, password } });

  it('troca a senha, mantém esta sessão e encerra as dos outros aparelhos', async () => {
    const { email, phone, laptop } = await personWithTwoSessions();

    const response = await change(laptop, {
      currentPassword: 'senha1234',
      newPassword: 'novaSenha99',
    });

    expect(response.statusCode).toBe(204);
    expect((await me(laptop)).statusCode).toBe(200);
    expect((await me(phone)).statusCode).toBe(401);
    expect((await login(email, 'senha1234')).statusCode).toBe(401);
    expect((await login(email, 'novaSenha99')).statusCode).toBe(200);
  });

  it('não troca com a senha atual errada (422 em currentPassword)', async () => {
    const { email, phone } = await personWithTwoSessions();

    const response = await change(phone, {
      currentPassword: 'senha-errada1',
      newPassword: 'novaSenha99',
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      errors: [{ field: 'body.currentPassword', message: 'Senha incorreta.' }],
    });
    expect((await login(email, 'senha1234')).statusCode).toBe(200);
  });

  it.each([
    ['curta', 'abc123', 'A senha deve ter pelo menos 8 caracteres.'],
    ['sem número', 'semnumeros', 'A senha deve conter pelo menos uma letra e um número.'],
  ])('aplica as regras do cadastro à senha nova (%s)', async (_case, newPassword, message) => {
    const { phone } = await personWithTwoSessions();

    const response = await change(phone, { currentPassword: 'senha1234', newPassword });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ errors: [{ field: 'body.newPassword', message }] });
  });

  it('recusa a senha nova igual à atual', async () => {
    const { phone } = await personWithTwoSessions();

    const response = await change(phone, {
      currentPassword: 'senha1234',
      newPassword: 'senha1234',
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      errors: [{ field: 'body.newPassword', message: 'A senha nova deve ser diferente da atual.' }],
    });
  });

  it('exige sessão', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/me/password',
      payload: { currentPassword: 'senha1234', newPassword: 'novaSenha99' },
    });

    expect(response.statusCode).toBe(401);
  });
});
