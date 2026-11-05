const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** Inatividade máxima: sem uso por 7 dias, a sessão expira. */
export const SESSION_IDLE_TIMEOUT_MS = 7 * DAY_MS;

/** Limite absoluto: mesmo em uso contínuo, a sessão acaba 30 dias depois do login. */
export const SESSION_MAX_LIFETIME_MS = 30 * DAY_MS;

/**
 * Intervalo mínimo entre renovações: evita uma escrita no banco (e um novo `Set-Cookie`) a cada
 * requisição; a expiração deslizante perde no máximo esses minutos.
 */
export const SESSION_TOUCH_INTERVAL_MS = 5 * MINUTE_MS;

/** Nova expiração ao usar a sessão em `now`: 7 dias à frente, sem passar dos 30 dias do login. */
export function slidingExpiry(createdAt: Date, now: Date): Date {
  return new Date(
    Math.min(
      now.getTime() + SESSION_IDLE_TIMEOUT_MS,
      createdAt.getTime() + SESSION_MAX_LIFETIME_MS,
    ),
  );
}

/** A sessão já passou do limite absoluto em `now`, mesmo que `expires_at` diga o contrário. */
export function exceedsMaxLifetime(createdAt: Date, now: Date): boolean {
  return now.getTime() >= createdAt.getTime() + SESSION_MAX_LIFETIME_MS;
}

/** Hora de renovar: o último uso registrado foi há mais que o intervalo mínimo. */
export function shouldTouch(lastSeenAt: Date, now: Date): boolean {
  return now.getTime() - lastSeenAt.getTime() >= SESSION_TOUCH_INTERVAL_MS;
}
