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
import { accountsRoutes } from './modules/accounts/accounts.routes.ts';
import { authRoutes } from './modules/auth/auth.routes.ts';
import { budgetsRoutes } from './modules/budgets/budgets.routes.ts';
import { categoriesRoutes } from './modules/categories/categories.routes.ts';
import { creditCardsRoutes } from './modules/credit-cards/credit-cards.routes.ts';
import { dashboardRoutes } from './modules/dashboard/dashboard.routes.ts';
import { goalsRoutes } from './modules/goals/goals.routes.ts';
import { invoicesRoutes } from './modules/invoices/invoices.routes.ts';
import { transactionsRoutes } from './modules/transactions/transactions.routes.ts';
import { healthRoutes } from './modules/health/health.routes.ts';
import { usersRoutes } from './modules/users/users.routes.ts';
import { authPlugin } from './plugins/auth.ts';
import { clockPlugin } from './plugins/clock.ts';
import { databasePlugin } from './plugins/db.ts';
import { docsPlugin } from './plugins/docs.ts';
import { errorsPlugin } from './plugins/errors.ts';
import { rateLimitPlugin } from './plugins/rate-limit.ts';
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

export interface BuildAppOptions {
  /** Momento atual da aplicação; os testes fixam o "hoje" das regras de fatura. */
  now?: () => Date;
}

/**
 * Cria a aplicação Fastify sem abrir porta: `server.ts` a inicia e os testes usam `app.inject()`.
 * Plugins e módulos são registrados aqui conforme a API cresce; a aplicação fica pronta no primeiro
 * `inject()` ou no `listen()`.
 */
export async function buildApp(env: Env, { now }: BuildAppOptions = {}): Promise<FastifyInstance> {
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
  await app.register(securityPlugin, {
    corsOrigins: env.CORS_ORIGINS,
    appOrigin: env.APP_ORIGIN,
  });
  await app.register(rateLimitPlugin, { enabled: env.RATE_LIMIT_ENABLED });
  await app.register(databasePlugin, {
    url: env.DATABASE_URL,
    maxConnections: env.DATABASE_POOL_MAX,
  });
  await app.register(authPlugin);
  await app.register(clockPlugin, { timeZone: env.TIME_ZONE, ...(now && { now }) });

  // A documentação precisa ser registrada antes das rotas, para enxergá-las.
  await app.register(docsPlugin, { enabled: env.DOCS_ENABLED });
  await app.register(healthRoutes);
  await app.register(authRoutes, { prefix: '/v1/auth' });
  await app.register(accountsRoutes, { prefix: '/v1/accounts' });
  await app.register(categoriesRoutes, { prefix: '/v1/categories' });
  await app.register(transactionsRoutes, { prefix: '/v1/transactions' });
  await app.register(creditCardsRoutes, { prefix: '/v1/credit-cards' });
  await app.register(invoicesRoutes, { prefix: '/v1/credit-cards' });
  await app.register(budgetsRoutes, { prefix: '/v1/budgets' });
  await app.register(goalsRoutes, { prefix: '/v1/goals' });
  await app.register(dashboardRoutes, { prefix: '/v1/dashboard' });
  await app.register(usersRoutes, { prefix: '/v1/me' });

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
