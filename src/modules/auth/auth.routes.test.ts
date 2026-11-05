import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../../../test/helpers/app.ts';
import { hash } from '@node-rs/argon2';
import { sessions, users } from '../../db/schema/index.ts';
import type { UserDto } from './auth.schemas.ts';
import { PASSWORD_HASH_OPTIONS } from './password.ts';
import { SESSION_COOKIE } from './session-cookie.ts';
import { SESSION_IDLE_TIMEOUT_MS, hashSessionToken } from './session-token.ts';

const uniqueEmail = () => `pessoa.${randomUUID()}@exemplo.com`;

function sessionCookie(response: LightMyRequestResponse) {
  const cookie = response.cookies.find(({ name }) => name === SESSION_COOKIE);
  if (!cookie) throw new Error(`a resposta não trouxe o cookie ${SESSION_COOKIE}`);
  return cookie;
}

describe('POST /v1/auth/register', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  const register = (payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/v1/auth/register', payload });

  it('cadastra o usuário e devolve 201 sem o hash da senha', async () => {
    const email = uniqueEmail();

    const response = await register({
      name: '  Pessoa de Teste  ',
      email: `  ${email.toUpperCase()} `,
      password: 'senha1234',
    });

    expect(response.statusCode).toBe(201);
    const body = response.json<UserDto>();
    expect(Object.keys(body).sort()).toEqual(['createdAt', 'email', 'id', 'name']);
    expect(body).toMatchObject({ name: 'Pessoa de Teste', email });
    expect(Number.isNaN(Date.parse(body.createdAt))).toBe(false);
    expect(response.body).not.toContain('senha1234');
    expect(response.body).not.toMatch(/password/i);

    const [stored] = await app.db.select().from(users).where(eq(users.email, email));
    expect(stored?.passwordHash).toMatch(/^\$argon2id\$/);
  });

  it('já abre a sessão: cookie seguro com o token e só o hash dele no banco', async () => {
    const response = await register({
      name: 'Pessoa de Teste',
      email: uniqueEmail(),
      password: 'senha1234',
    });

    const cookie = sessionCookie(response);
    expect(cookie).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      path: '/',
    });
    expect(cookie.domain).toBeUndefined();
    expect(cookie.value).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 bytes em base64url

    const userId = response.json<UserDto>().id;
    const [session] = await app.db.select().from(sessions).where(eq(sessions.userId, userId));
    expect(session?.tokenHash).toBe(hashSessionToken(cookie.value));
    expect(session?.tokenHash).not.toContain(cookie.value);
  });

  it('responde 409 para e-mail já cadastrado, sem diferenciar maiúsculas', async () => {
    const email = uniqueEmail();
    await register({ name: 'Primeira', email, password: 'senha1234' });

    const response = await register({
      name: 'Segunda',
      email: email.toUpperCase(),
      password: 'outra5678',
    });

    expect(response.statusCode).toBe(409);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.json()).toMatchObject({
      status: 409,
      title: 'Conflito',
      detail: 'Este e-mail já está cadastrado.',
    });
  });

  it.each([
    ['nome vazio', { name: '   ' }, 'body.name', 'Informe o nome.'],
    [
      'nome com mais de 80 caracteres',
      { name: 'a'.repeat(81) },
      'body.name',
      'O nome deve ter no máximo 80 caracteres.',
    ],
    ['e-mail inválido', { email: 'nao-e-email' }, 'body.email', 'Informe um e-mail válido.'],
    [
      'senha curta',
      { password: 'abc123' },
      'body.password',
      'A senha deve ter pelo menos 8 caracteres.',
    ],
    [
      'senha sem número',
      { password: 'somenteletras' },
      'body.password',
      'A senha deve conter pelo menos uma letra e um número.',
    ],
    [
      'senha sem letra',
      { password: '12345678' },
      'body.password',
      'A senha deve conter pelo menos uma letra e um número.',
    ],
  ])('responde 422 para %s', async (_case, override, field, message) => {
    const response = await register({
      name: 'Pessoa de Teste',
      email: uniqueEmail(),
      password: 'senha1234',
      ...override,
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      status: 422,
      errors: expect.arrayContaining([{ field, message }]) as unknown,
    });
  });

  it('responde 422 para campos desconhecidos (ex.: tentar definir o id)', async () => {
    const response = await register({
      id: randomUUID(),
      name: 'Pessoa de Teste',
      email: uniqueEmail(),
      password: 'senha1234',
    });

    expect(response.statusCode).toBe(422);
  });

  it('responde 422 listando todos os campos obrigatórios ausentes', async () => {
    const response = await register({});

    expect(response.statusCode).toBe(422);
    const fields = response.json<{ errors: { field: string }[] }>().errors.map((e) => e.field);
    expect(fields).toEqual(expect.arrayContaining(['body.name', 'body.email', 'body.password']));
  });
});

describe('POST /v1/auth/login', () => {
  let app: FastifyInstance;
  const password = 'senha1234';

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  const login = (payload: Record<string, unknown>, headers: Record<string, string> = {}) =>
    app.inject({ method: 'POST', url: '/v1/auth/login', payload, headers });

  async function registeredEmail(): Promise<string> {
    const email = uniqueEmail();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { name: 'Pessoa de Teste', email, password },
    });
    expect(response.statusCode).toBe(201);
    return email;
  }

  it('entra com e-mail em qualquer caixa e devolve o usuário com o cookie da sessão', async () => {
    const email = await registeredEmail();

    const response = await login({ email: ` ${email.toUpperCase()} `, password });

    expect(response.statusCode).toBe(200);
    expect(response.json<UserDto>()).toMatchObject({ email, name: 'Pessoa de Teste' });
    expect(response.body).not.toMatch(/password/i);
    const cookie = sessionCookie(response);
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax', path: '/' });
  });

  it('grava a sessão com validade de 7 dias, IP e user-agent', async () => {
    const email = await registeredEmail();
    const before = Date.now();

    const response = await login({ email, password }, { 'user-agent': 'Vitest/5 (teste)' });

    const cookie = sessionCookie(response);
    const [session] = await app.db
      .select()
      .from(sessions)
      .where(eq(sessions.tokenHash, hashSessionToken(cookie.value)));
    expect(session).toMatchObject({ userAgent: 'Vitest/5 (teste)', ip: '127.0.0.1' });
    const ttl = (session?.expiresAt.getTime() ?? 0) - before;
    expect(ttl).toBeGreaterThanOrEqual(SESSION_IDLE_TIMEOUT_MS - 5_000);
    expect(ttl).toBeLessThanOrEqual(SESSION_IDLE_TIMEOUT_MS + 5_000);
    expect(cookie.expires?.getTime()).toBe(Math.floor(session!.expiresAt.getTime() / 1000) * 1000);
  });

  it('abre uma sessão nova, com outro token, a cada login', async () => {
    const email = await registeredEmail();

    const first = sessionCookie(await login({ email, password }));
    const second = sessionCookie(await login({ email, password }));

    expect(first.value).not.toBe(second.value);
  });

  it('responde 401 com a mesma mensagem para senha errada e e-mail inexistente', async () => {
    const email = await registeredEmail();

    const wrongPassword = await login({ email, password: 'outra5678' });
    const unknownEmail = await login({ email: uniqueEmail(), password });

    for (const response of [wrongPassword, unknownEmail]) {
      expect(response.statusCode).toBe(401);
      expect(response.cookies).toEqual([]);
      expect(response.json()).toMatchObject({
        status: 401,
        title: 'Não autenticado',
        detail: 'E-mail ou senha inválidos.',
      });
    }
  });

  it('refaz o hash da senha quando ele usa parâmetros antigos', async () => {
    const email = uniqueEmail();
    const weakHash = await hash(password, { ...PASSWORD_HASH_OPTIONS, timeCost: 1 });
    await app.db.insert(users).values({ name: 'Pessoa Antiga', email, passwordHash: weakHash });

    const response = await login({ email, password });

    expect(response.statusCode).toBe(200);
    const [stored] = await app.db.select().from(users).where(eq(users.email, email));
    expect(stored?.passwordHash).not.toBe(weakHash);
    expect(stored?.passwordHash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  });

  it('responde 422 sem e-mail ou senha', async () => {
    const response = await login({ email: '' });

    expect(response.statusCode).toBe(422);
    const fields = response.json<{ errors: { field: string }[] }>().errors.map((e) => e.field);
    expect(fields).toEqual(expect.arrayContaining(['body.email', 'body.password']));
  });
});
