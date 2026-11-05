import { z } from 'zod';

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';
export const VALIDATION_PROBLEM_TYPE = '/problems/validation-error';

export const fieldErrorSchema = z.object({
  field: z.string().meta({ description: 'Caminho do campo (ex.: `body.amount`).' }),
  message: z.string(),
});

/** Corpo de erro no formato Problem Details (RFC 9457), usado em todas as respostas de erro. */
export const problemDetailsSchema = z
  .object({
    type: z.string().meta({
      description: 'Tipo do problema; `about:blank` quando o status já basta.',
      example: 'about:blank',
    }),
    title: z.string().meta({ example: 'Recurso não encontrado' }),
    status: z.number().int().meta({ example: 404 }),
    detail: z.string(),
    instance: z.string().meta({ description: 'Caminho da requisição que falhou.' }),
    requestId: z.string().meta({ description: 'Mesmo valor do cabeçalho `x-request-id`.' }),
    errors: z
      .array(fieldErrorSchema)
      .optional()
      .meta({ description: 'Só em erros de validação: um item por campo inválido.' }),
  })
  .meta({ id: 'ProblemDetails' });

export type ProblemDetails = z.infer<typeof problemDetailsSchema>;
export type FieldError = z.infer<typeof fieldErrorSchema>;
