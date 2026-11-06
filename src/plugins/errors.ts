import sensible from '@fastify/sensible';
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import {
  DomainError,
  InvalidInputError,
  type DomainErrorKind,
} from '../shared/errors/domain-error.ts';
import {
  PROBLEM_CONTENT_TYPE,
  VALIDATION_PROBLEM_TYPE,
  type ProblemDetails,
} from '../shared/http/problem.ts';

const TITLES: Readonly<Record<number, string>> = {
  400: 'Requisição inválida',
  401: 'Não autenticado',
  403: 'Acesso negado',
  404: 'Recurso não encontrado',
  405: 'Método não permitido',
  409: 'Conflito',
  412: 'Pré-condição falhou',
  413: 'Corpo da requisição muito grande',
  415: 'Tipo de conteúdo não suportado',
  422: 'Dados inválidos',
  429: 'Muitas requisições',
  500: 'Erro interno',
  503: 'Serviço indisponível',
};

const DOMAIN_ERROR_STATUS: Readonly<Record<DomainErrorKind, number>> = {
  unauthorized: 401,
  'not-found': 404,
  conflict: 409,
  precondition: 412,
  invalid: 422,
};

/**
 * Padroniza todas as respostas de erro em Problem Details: validação → 422 com `errors[]`, erros
 * de regra dos serviços (`DomainError`) → status do seu tipo, erros HTTP conhecidos mantêm o
 * status e a mensagem, e erros inesperados viram 500 sem detalhes internos (o erro completo vai
 * só para o log). Também registra o `@fastify/sensible` (`app.httpErrors`), usado pelas rotas.
 */
export const errorsPlugin = fp(
  async (app) => {
    await app.register(sensible);

    app.setErrorHandler((error: FastifyError, request, reply) => {
      if (error.validation) {
        return sendProblem(request, reply, {
          status: 422,
          type: VALIDATION_PROBLEM_TYPE,
          detail: 'Um ou mais campos são inválidos.',
          errors: error.validation.map((issue) => ({
            field: fieldPath(error.validationContext, issue.instancePath, issue.params),
            message: issue.message ?? 'Valor inválido.',
          })),
        });
      }

      if (error instanceof InvalidInputError) {
        return sendProblem(request, reply, {
          status: 422,
          type: VALIDATION_PROBLEM_TYPE,
          detail: error.message,
          errors: error.fields.map(({ field, message }) => ({ field: `body.${field}`, message })),
        });
      }

      if (error instanceof DomainError) {
        return sendProblem(request, reply, {
          status: DOMAIN_ERROR_STATUS[error.kind],
          detail: error.message,
          ...(error.problemType && { type: error.problemType }),
        });
      }

      const status = error.statusCode ?? 500;
      if (status >= 400 && status < 500) {
        return sendProblem(request, reply, { status, detail: error.message });
      }

      // 5xx lançado de propósito (ex.: 503 com `app.httpErrors.serviceUnavailable`) mantém status e
      // mensagem; só o erro inesperado (500) esconde os detalhes.
      if (status > 500 && status < 600) {
        request.log.error({ err: error }, 'serviço indisponível');
        return sendProblem(request, reply, { status, detail: error.message });
      }

      request.log.error({ err: error }, 'erro inesperado');
      return sendProblem(request, reply, {
        status: 500,
        detail: 'Ocorreu um erro inesperado. Tente novamente em instantes.',
      });
    });

    app.setNotFoundHandler((request, reply) =>
      sendProblem(request, reply, {
        status: 404,
        detail: `Rota ${request.method} ${request.url.split('?')[0]} não existe.`,
      }),
    );
  },
  { name: 'errors' },
);

function sendProblem(
  request: FastifyRequest,
  reply: FastifyReply,
  problem: Pick<ProblemDetails, 'status' | 'detail'> & Partial<ProblemDetails>,
): FastifyReply {
  const body: ProblemDetails = {
    type: problem.type ?? 'about:blank',
    title: problem.title ?? TITLES[problem.status] ?? 'Erro',
    status: problem.status,
    detail: problem.detail,
    instance: request.url.split('?')[0] ?? request.url,
    requestId: request.id,
    ...(problem.errors && { errors: problem.errors }),
  };
  return reply.status(problem.status).type(PROBLEM_CONTENT_TYPE).send(body);
}

/** Monta `body.campo.sub` a partir do caminho JSON Pointer (`/campo/sub`) do validador. */
function fieldPath(
  context: string | undefined,
  instancePath: string,
  params: Record<string, unknown>,
): string {
  const segments = instancePath.split('/').filter(Boolean);
  // Campo obrigatório ausente: o validador aponta o objeto pai e informa o nome em `params`.
  const missing = params['missingProperty'];
  if (typeof missing === 'string') {
    segments.push(missing);
  }
  return [context ?? 'body', ...segments].join('.');
}
