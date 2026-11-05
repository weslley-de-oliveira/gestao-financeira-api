import { z } from 'zod';

/**
 * Variáveis de ambiente da API. A validação acontece na inicialização: se faltar algo ou houver
 * valor inválido, a API não sobe (falha cedo, com mensagem clara, em vez de quebrar em uso).
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3333),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  // Origens com CORS liberado, separadas por vírgula (ex.: o front no ng serve). Vazio = sem CORS:
  // em produção o front chama a API pela mesma origem (proxy da Vercel).
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.url({ protocol: /^https?$/ }))),
});

export type Env = z.infer<typeof envSchema>;

export class InvalidEnvError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Variáveis de ambiente inválidas:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`);
    this.name = 'InvalidEnvError';
    this.issues = issues;
  }
}

/** Lê e valida as variáveis (por padrão, `process.env`). Os testes passam um objeto próprio. */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new InvalidEnvError(
      result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    );
  }
  return result.data;
}
