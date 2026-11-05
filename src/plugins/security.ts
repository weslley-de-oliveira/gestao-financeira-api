import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import type { FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { REQUEST_ID_HEADER } from '../shared/http/headers.ts';

export interface SecurityOptions {
  corsOrigins: readonly string[];
  /** Front em produção (mesma origem via proxy); também pode alterar dados. */
  appOrigin: string | null;
}

/** Métodos que alteram dados: exigem origem confiável. */
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Cabeçalhos de segurança, CORS e proteção contra CSRF. A API só responde JSON, então a
 * Content-Security-Policy bloqueia qualquer conteúdo ativo e o carregamento em frames. O CORS só é
 * registrado quando há origens configuradas (desenvolvimento); em produção o front usa a mesma
 * origem.
 *
 * CSRF: além do cookie `SameSite=Lax`, requisições que alteram dados com cabeçalho `Origin` fora da
 * lista (origens de CORS, `appOrigin` e a própria API) recebem 403. Sem `Origin`, passam: navegadores
 * sempre o enviam nesses métodos, então a requisição não veio de uma página (curl, scripts) e não
 * pode carregar o cookie de outra pessoa.
 */
export const securityPlugin = fp<SecurityOptions>(
  async (app, { corsOrigins, appOrigin }) => {
    await app.register(helmet, {
      contentSecurityPolicy: {
        useDefaults: false,
        directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
      },
      crossOriginResourcePolicy: { policy: 'same-origin' },
      frameguard: { action: 'deny' },
    });

    if (corsOrigins.length > 0) {
      await app.register(cors, {
        origin: [...corsOrigins],
        credentials: true,
        methods: ['GET', 'POST', 'PATCH', 'DELETE'],
        exposedHeaders: [REQUEST_ID_HEADER],
        maxAge: 600,
      });
    }

    const trustedOrigins = new Set(
      [...corsOrigins, ...(appOrigin ? [appOrigin] : [])].map((url) => new URL(url).origin),
    );

    app.addHook('onRequest', async (request) => {
      if (!UNSAFE_METHODS.has(request.method)) {
        return;
      }
      const origin = request.headers.origin;
      if (origin === undefined || trustedOrigins.has(origin) || origin === ownOrigin(request)) {
        return;
      }
      request.log.warn({ origin }, 'origem não permitida para alterar dados');
      throw app.httpErrors.forbidden('Origem da requisição não permitida.');
    });
  },
  { name: 'security', dependencies: ['errors'] },
);

/** Origem da própria API, como o navegador a vê (ex.: a referência em /docs chamando a API). */
function ownOrigin(request: FastifyRequest): string {
  return `${request.protocol}://${request.host}`;
}
