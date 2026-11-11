import swagger, { type SwaggerTransformObject } from '@fastify/swagger';
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

interface JsonSchema {
  type?: unknown;
  anyOf?: JsonSchema[];
}

interface Operation {
  requestBody?: { required?: boolean; content?: Record<string, { schema?: JsonSchema }> };
}

/**
 * O @fastify/swagger marca todo corpo como obrigatório. Um corpo `.nullish()` (ex.: o pagamento de
 * fatura, que sem corpo paga o saldo inteiro) passa a ser opcional e perde o ramo `null`, que no
 * Fastify só representa a requisição sem corpo.
 */
const transformObject: SwaggerTransformObject = (input) => {
  const document = jsonSchemaTransformObject(input);
  const paths = (document as { paths?: Record<string, Record<string, Operation>> }).paths ?? {};
  for (const { requestBody } of Object.values(paths).flatMap((path) => Object.values(path))) {
    for (const media of Object.values(requestBody?.content ?? {})) {
      const [schema, ...rest] = (media.schema?.anyOf ?? []).filter(({ type }) => type !== 'null');
      if (requestBody && schema && rest.length === 0 && media.schema?.anyOf?.length === 2) {
        media.schema = schema;
        requestBody.required = false;
      }
    }
  }
  return document;
};

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
          { name: 'Transações', description: 'Receitas, despesas e transferências.' },
          { name: 'Cartões', description: 'Cartões de crédito, limite e próxima fatura.' },
          { name: 'Faturas', description: 'Faturas calculadas dos cartões e o pagamento.' },
          { name: 'Orçamentos', description: 'Limites mensais de gastos por categoria.' },
          { name: 'Metas', description: 'Metas de economia, aportes e retiradas.' },
          { name: 'Dashboard', description: 'Resumo do período numa chamada só.' },
          { name: 'Perfil', description: 'Dados da pessoa e exclusão da conta.' },
        ],
      },
      transform: jsonSchemaTransform,
      transformObject,
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
