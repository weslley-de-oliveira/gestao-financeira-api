import swagger from '@fastify/swagger';
import scalar from '@scalar/fastify-api-reference';
import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { jsonSchemaTransform, jsonSchemaTransformObject } from 'fastify-type-provider-zod';
import packageJson from '../../package.json' with { type: 'json' };

export interface DocsOptions {
  /** Publica a referência interativa em `/docs`. A especificação é gerada de qualquer forma. */
  enabled: boolean;
}

export const DOCS_PREFIX = '/docs';

/**
 * A página da referência carrega scripts e estilos próprios: recebe uma CSP específica, mais
 * permissiva que a do restante da API (que só responde JSON).
 */
const DOCS_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com https://fonts.scalar.com",
  "img-src 'self' data: https:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
].join('; ');

/**
 * Gera a especificação OpenAPI 3.1 a partir dos schemas Zod das rotas (`app.swagger()`) e, se
 * habilitado, publica a referência interativa (Scalar) em `/docs`.
 */
export const docsPlugin = fp<DocsOptions>(
  async (app, { enabled }) => {
    await app.register(swagger, {
      openapi: {
        openapi: '3.1.0',
        info: {
          title: 'Gestão Financeira API',
          description:
            'API REST da Gestão Financeira. Erros seguem o formato Problem Details (RFC 9457); valores monetários em centavos inteiros.',
          version: packageJson.version,
        },
        tags: [
          { name: 'Operação', description: 'Saúde e prontidão da API.' },
          { name: 'Autenticação', description: 'Cadastro, login, sessão e logout.' },
          { name: 'Contas', description: 'Contas bancárias, carteiras e investimentos.' },
          { name: 'Categorias', description: 'Categorias de receitas e despesas.' },
        ],
      },
      transform: jsonSchemaTransform,
      transformObject: jsonSchemaTransformObject,
    });

    if (enabled) {
      await app.register(scalarReference);
    }
  },
  { name: 'docs' },
);

/** Contexto encapsulado: a CSP da documentação vale só para as rotas de `/docs`. */
const scalarReference: FastifyPluginAsync = async (app) => {
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('content-security-policy', DOCS_CSP);
    return payload;
  });
  await app.register(scalar, { routePrefix: DOCS_PREFIX });
};
