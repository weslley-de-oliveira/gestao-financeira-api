import type { IsoDate } from './date.ts';

/** Data (`yyyy-MM-dd`) de `now` no fuso `timeZone` (IANA), não no fuso do servidor. */
export function todayIn(timeZone: string, now: Date = new Date()): IsoDate {
  // `en-CA` formata como `yyyy-MM-dd`.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
