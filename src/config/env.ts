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
  // Referência interativa da API em /docs. Desligue em produção se não quiser expô-la.
  DOCS_ENABLED: z.stringbool().default(true),
  // Quantos proxies confiáveis ficam na frente da API (ex.: 2 = Vercel + Render). O IP do cliente
  // (rate limit, sessões) vem do X-Forwarded-For só por esses saltos; 0 = conexão direta.
  TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(0),
  // Limite de requisições por IP (e de tentativas de login). Só os testes o desligam.
  RATE_LIMIT_ENABLED: z.stringbool().default(true),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  // Aplica as migrações pendentes antes de abrir a porta (em produção, a cada deploy).
  MIGRATE_ON_START: z.stringbool().default(false),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
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
  // Endereço público do front em produção (ex.: https://app.vercel.app). Requisições que alteram
  // dados só são aceitas dessa origem, das de CORS_ORIGINS ou da própria API. Vazio = nenhuma extra.
  APP_ORIGIN: z
    .string()
    .trim()
    .default('')
    .pipe(z.union([z.literal(''), z.url({ protocol: /^https?$/ })]))
    .transform((value) => value || null),
  // Fuso do "hoje" das regras de calendário (fatura aberta, fatura vencida, data do pagamento).
  // O servidor pode rodar em UTC: às 22h de Brasília, em UTC já seria o dia seguinte.
  TIME_ZONE: z
    .string()
    .default('America/Sao_Paulo')
    .refine(isTimeZone, 'Fuso horário IANA inválido (ex.: America/Sao_Paulo).'),
});

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('pt-BR', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

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
