import { randomUUID } from 'node:crypto';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { SESSION_COOKIE } from '../../src/modules/auth/session-cookie.ts';

/** Requisição feita com a sessão de uma pessoa. */
export type Api = (
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  payload?: Record<string, unknown>,
) => Promise<LightMyRequestResponse>;

export interface TestUser {
  userId: string;
  cookies: Record<string, string>;
  api: Api;
}

/** Cadastra uma pessoa nova (com e-mail único) e devolve as requisições com a sessão dela. */
export async function signUp(app: FastifyInstance): Promise<TestUser> {
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
  const cookies = { [SESSION_COOKIE]: token };
  return {
    userId: response.json<{ id: string }>().id,
    cookies,
    api: (method, url, payload) =>
      app.inject({ method, url, cookies, ...(payload && { payload }) }),
  };
}

/** Conta ativa da pessoa, criada pela API. */
export async function createAccount(
  user: TestUser,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string; name: string }> {
  const response = await user.api('POST', '/v1/accounts', {
    name: 'Conta corrente',
    type: 'checking',
    color: '#1565c0',
    icon: 'account_balance',
    ...overrides,
  });
  if (response.statusCode !== 201) throw new Error(`conta não criada: ${response.body}`);
  return response.json();
}
