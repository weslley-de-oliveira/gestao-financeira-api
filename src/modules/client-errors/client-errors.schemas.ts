import { z } from 'zod';

/** Mesmo formato aceito para o `x-request-id` recebido (`app.ts`). */
const REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;

/** Tamanho máximo do `User-Agent` guardado no log. */
const USER_AGENT_MAX_LENGTH = 300;

/** Só o caminho: a query string pode ter termos de busca, e o fragmento não interessa. */
function withoutQuery(path: string): string {
  return path.split(/[?#]/, 1)[0] ?? path;
}

export const clientErrorBodySchema = z
  .object({
    kind: z.enum(['error', 'network']).meta({
      description:
        '`error`: erro de JavaScript não tratado; `network`: requisição sem resposta da API (rede, proxy, API hibernando).',
    }),
    message: z.string().trim().min(1).max(500),
    name: z
      .string()
      .trim()
      .max(100)
      .optional()
      .meta({ description: 'Tipo do erro (`TypeError`).' }),
    stack: z.string().max(4_000).optional(),
    path: z
      .string()
      .max(300)
      .regex(/^\//, 'Informe o caminho da página, começando por /.')
      .overwrite(withoutQuery)
      .meta({ description: 'Página em que o erro ocorreu; a query string é descartada.' }),
    requestId: z
      .string()
      .regex(REQUEST_ID)
      .optional()
      .meta({ description: 'O `x-request-id` da requisição que falhou, se houver.' }),
  })
  .meta({ id: 'ClientError' });

export type ClientErrorBody = z.infer<typeof clientErrorBodySchema>;

export interface ClientErrorContext {
  userAgent: string | undefined;
  /** Usuário da sessão, se houver; nunca e-mail ou nome. */
  userId: string | null;
}

/** Entrada do log de um erro relatado pelo front. */
export function clientErrorLogEntry(body: ClientErrorBody, context: ClientErrorContext) {
  return {
    source: 'front' as const,
    clientError: {
      kind: body.kind,
      name: body.name ?? null,
      message: body.message,
      stack: body.stack ?? null,
      path: body.path,
      requestId: body.requestId ?? null,
    },
    userAgent: context.userAgent?.slice(0, USER_AGENT_MAX_LENGTH) ?? null,
    userId: context.userId,
  };
}
