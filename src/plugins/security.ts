import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import fp from 'fastify-plugin';
import { REQUEST_ID_HEADER } from '../shared/http/headers.ts';

export interface SecurityOptions {
  corsOrigins: readonly string[];
}

/**
 * Cabeçalhos de segurança e CORS. A API só responde JSON, então a Content-Security-Policy bloqueia
 * qualquer conteúdo ativo e o carregamento em frames. O CORS só é registrado quando há origens
 * configuradas (desenvolvimento); em produção o front usa a mesma origem.
 */
export const securityPlugin = fp<SecurityOptions>(
  async (app, { corsOrigins }) => {
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
  },
  { name: 'security' },
);
