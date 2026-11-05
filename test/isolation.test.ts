import { randomUUID, randomUUIDv7 } from 'node:crypto';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '../src/modules/auth/session-cookie.ts';
import { createTestApp } from './helpers/app.ts';

/**
 * Isolamento entre usuários: ninguém lê, altera ou arquiva recurso de outra pessoa. O recurso alheio
 * responde sempre 404, igual a um id que não existe, para não revelar o que existe. Cada recurso
 * novo da API entra na lista `RESOURCES`.
 */
interface Resource {
  name: string;
  path: string;
  /** Corpo válido para cadastrar o recurso. */
  create: Record<string, unknown>;
  /** Uma edição válida qualquer. */
  edit: Record<string, unknown>;
}

const RESOURCES: Resource[] = [
  {
    name: 'contas',
    path: '/v1/accounts',
    create: {
      name: 'Conta da dona',
      type: 'checking',
      institution: 'Banco Exemplo',
      initialBalance: 250_000,
      color: '#1565c0',
      icon: 'account_balance',
    },
    edit: { name: 'Invadida', initialBalance: 0 },
  },
  {
    name: 'categorias',
    path: '/v1/categories',
    create: { name: 'Categoria da dona', type: 'expense', icon: 'pets', color: '#2e7d32' },
    edit: { name: 'Invadida', color: '#c62828' },
  },
];

interface Session {
  cookies: Record<string, string>;
}

describe.each(RESOURCES)('isolamento entre usuários: $name', (resource) => {
  let app: FastifyInstance;
  let owner: Session;
  let intruder: Session;
  /** Recurso da dona, como ela o vê logo depois de cadastrar. */
  let original: { id: string } & Record<string, unknown>;

  async function signUp(): Promise<Session> {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: {
        name: 'Pessoa de Teste',
        email: `pessoa.${randomUUID()}@exemplo.com`,
        password: 'senha1234',
      },
    });
    const token = response.cookies.find(({ name }) => name === SESSION_COOKIE)?.value;
    if (!token) throw new Error('cadastro sem cookie de sessão');
    return { cookies: { [SESSION_COOKIE]: token } };
  }

  const request = (
    session: Session,
    method: 'GET' | 'PATCH',
    url: string,
    payload?: Record<string, unknown>,
  ) => app.inject({ method, url, cookies: session.cookies, ...(payload && { payload }) });

  /** O que um 404 diz, sem os campos que mudam a cada requisição (`requestId`, `instance`). */
  function notFound(response: LightMyRequestResponse) {
    expect(response.statusCode).toBe(404);
    const { type, title, status, detail } = response.json<Record<string, unknown>>();
    return { type, title, status, detail };
  }

  beforeAll(async () => {
    app = await createTestApp();
    owner = await signUp();
    intruder = await signUp();
    const created = await app.inject({
      method: 'POST',
      url: resource.path,
      payload: resource.create,
      cookies: owner.cookies,
    });
    expect(created.statusCode).toBe(201);
    original = created.json();
  });

  afterAll(async () => {
    await app.close();
  });

  it('não aparece na lista da outra pessoa, nem com as arquivadas', async () => {
    for (const query of ['', '?includeArchived=true']) {
      const response = await request(intruder, 'GET', `${resource.path}${query}`);

      expect(response.statusCode).toBe(200);
      const ids = response.json<{ id: string }[]>().map(({ id }) => id);
      expect(ids).not.toContain(original.id);
    }
  });

  it('o detalhe responde 404, igual a um id que não existe', async () => {
    const foreign = await request(intruder, 'GET', `${resource.path}/${original.id}`);
    const missing = await request(intruder, 'GET', `${resource.path}/${randomUUIDv7()}`);

    expect(notFound(foreign)).toEqual(notFound(missing));
  });

  it.each([
    ['editar', () => resource.edit],
    ['arquivar', () => ({ isArchived: true })],
    ['enviar corpo vazio', () => ({})],
  ])('%s responde 404, igual a um id que não existe', async (_action, body) => {
    const foreign = await request(intruder, 'PATCH', `${resource.path}/${original.id}`, body());
    const missing = await request(intruder, 'PATCH', `${resource.path}/${randomUUIDv7()}`, body());

    expect(notFound(foreign)).toEqual(notFound(missing));
  });

  // Roda por último (os testes de um arquivo são sequenciais): confere o efeito de todos os acima.
  it('nenhuma tentativa alterou o recurso, e a dona continua com acesso', async () => {
    const detail = await request(owner, 'GET', `${resource.path}/${original.id}`);
    const list = await request(owner, 'GET', resource.path);

    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toEqual(original);
    expect(list.json<{ id: string }[]>().map(({ id }) => id)).toContain(original.id);
  });
});
