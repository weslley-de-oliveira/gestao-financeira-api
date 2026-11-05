import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import cookie from '@fastify/cookie';
import Fastify, {
  LogController,
  type FastifyInstance,
  type FastifyRequest,
  type FastifyServerOptions,
} from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { Env } from './config/env.ts';
import { authRoutes } from './modules/auth/auth.routes.ts';
import { healthRoutes } from './modules/health/health.routes.ts';
import { authPlugin } from './plugins/auth.ts';
import { databasePlugin } from './plugins/db.ts';
import { docsPlugin } from './plugins/docs.ts';
import { errorsPlugin } from './plugins/errors.ts';
import { securityPlugin } from './plugins/security.ts';
import { REQUEST_ID_HEADER } from './shared/http/headers.ts';
import './shared/validation/zod.ts';

declare module 'fastify' {
  interface FastifyContextConfig {
    /**
     * `false` omite os logs automáticos de requisição da rota ("incoming request" e "request
     * completed"). Os logs escritos pela própria rota continuam seguindo o `LOG_LEVEL`.
     */
    requestLogging?: boolean;
  }
}

/** Tamanho máximo do corpo: os payloads da API são pequenos (formulários); acima disso, 413. */
const BODY_LIMIT_BYTES = 100 * 1024;

/** Aceita o id vindo do proxy só se for curto e seguro para logs; senão, gera um novo. */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;

/** Dados que nunca podem aparecer nos logs. */
const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.currentPassword',
  '*.token',
];

/**
 * Cria a aplicação Fastify sem abrir porta: `server.ts` a inicia e os testes usam `app.inject()`.
 * Plugins e módulos são registrados aqui conforme a API cresce; a aplicação fica pronta no primeiro
 * `inject()` ou no `listen()`.
 */
export async function buildApp(env: Env): Promise<FastifyInstance> {
  const app = Fastify({
    logger: loggerOptions(env),
    logController: new LogController({ disableRequestLogging: isRequestLoggingDisabled }),
    bodyLimit: BODY_LIMIT_BYTES,
    requestIdHeader: false,
    genReqId: (request: IncomingMessage) => {
      const incoming = request.headers[REQUEST_ID_HEADER];
      return typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming)
        ? incoming
        : randomUUID();
    },
  });

  // Schemas Zod nas rotas: validam a entrada, filtram a saída e geram o OpenAPI.
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.addHook('onRequest', async (request, reply) => {
    reply.header(REQUEST_ID_HEADER, request.id);
  });

  await app.register(errorsPlugin);
  // Lê e grava cookies (sessão em `__Host-session`); sem assinatura: o token já é opaco e aleatório.
  await app.register(cookie);
  await app.register(securityPlugin, { corsOrigins: env.CORS_ORIGINS });
  await app.register(databasePlugin, {
    url: env.DATABASE_URL,
    maxConnections: env.DATABASE_POOL_MAX,
  });
  await app.register(authPlugin);

  // A documentação precisa ser registrada antes das rotas, para enxergá-las.
  await app.register(docsPlugin, { enabled: env.DOCS_ENABLED });
  await app.register(healthRoutes);
  await app.register(authRoutes, { prefix: '/v1/auth' });

  return app;
}

function isRequestLoggingDisabled(request: FastifyRequest): boolean {
  return request.routeOptions.config.requestLogging === false;
}

function loggerOptions(env: Env): FastifyServerOptions['logger'] {
  return {
    level: env.LOG_LEVEL,
    redact: { paths: REDACTED_PATHS, censor: '[oculto]' },
    // Em desenvolvimento, logs legíveis; nos demais ambientes, JSON (para o provedor de logs).
    ...(env.NODE_ENV === 'development' && {
      transport: {
        target: 'pino-pretty',
        options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
      },
    }),
  };
}
