import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../../../test/helpers/app.ts';
import { users } from '../../db/schema/index.ts';
import type { UserDto } from './auth.schemas.ts';

const uniqueEmail = () => `pessoa.${randomUUID()}@exemplo.com`;

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
