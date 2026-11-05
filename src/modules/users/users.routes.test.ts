import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp } from '../../../test/helpers/app.ts';
import { signUp, type TestUser } from '../../../test/helpers/users.ts';
import type { UserDto } from '../auth/auth.schemas.ts';

describe('PATCH /v1/me', () => {
  let app: FastifyInstance;
  let user: TestUser;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    user = await signUp(app);
  });

  const me = async () => (await user.api('GET', '/v1/auth/me')).json<UserDto>();

  function expectInvalid(response: LightMyRequestResponse, field: string, message: string) {
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ errors: [{ field, message }] });
  }

  it('altera o nome, sem espaços nas pontas', async () => {
    const before = await me();

    const response = await user.api('PATCH', '/v1/me', { name: '  Pessoa Renomeada ' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ...before, name: 'Pessoa Renomeada' });
    expect((await me()).name).toBe('Pessoa Renomeada');
  });

  it.each([
    ['nome vazio', { name: '  ' }, 'body.name', 'Informe o nome.'],
    ['sem nome', {}, 'body.name', 'Informe o nome.'],
    [
      'nome com 81 caracteres',
      { name: 'a'.repeat(81) },
      'body.name',
      'O nome deve ter no máximo 80 caracteres.',
    ],
    [
      'e-mail',
      { name: 'Pessoa', email: 'outro@exemplo.com' },
      'body.email',
      'O e-mail não pode ser alterado por aqui.',
    ],
    [
      'senha',
      { name: 'Pessoa', password: 'nova12345' },
      'body.password',
      'A senha não pode ser alterada por aqui.',
    ],
  ])('responde 422 para %s, sem alterar nada', async (_case, body, field, message) => {
    const before = await me();

    expectInvalid(await user.api('PATCH', '/v1/me', body), field, message);
    expect(await me()).toEqual(before);
  });

  it('altera só o perfil da sessão', async () => {
    const other = await signUp(app);
    const otherBefore = (await other.api('GET', '/v1/auth/me')).json<UserDto>();

    await user.api('PATCH', '/v1/me', { name: 'Só eu' });

    expect((await other.api('GET', '/v1/auth/me')).json()).toEqual(otherBefore);
  });

  it('responde 401 sem sessão', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/v1/me',
      payload: { name: 'Ninguém' },
    });

    expect(response.statusCode).toBe(401);
  });
});
