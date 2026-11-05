/**
 * Datas sem horário (`yyyy-MM-dd`) e meses (`yyyy-MM`) circulam como texto, como no front. As
 * contas de calendário usam `Date` em UTC só como apoio: o resultado não depende do fuso do
 * servidor.
 */
export type IsoDate = string;
export type IsoMonth = string;

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Meia-noite UTC da data; `null` se o texto não for uma data `yyyy-MM-dd` existente. */
export function parseIsoDate(value: string): Date | null {
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) {
    return null;
  }
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return toIsoDate(date) === value ? date : null;
}

export function toIsoDate(date: Date): IsoDate {
  return date.toISOString().slice(0, 10);
}

export function isIsoMonth(value: unknown): value is IsoMonth {
  return typeof value === 'string' && ISO_MONTH_PATTERN.test(value);
}

/** Ano e mês (0–11) de um `yyyy-MM`; `null` se inválido. */
export function parseIsoMonth(value: string): { year: number; month: number } | null {
  const match = ISO_MONTH_PATTERN.exec(value);
  return match ? { year: Number(match[1]), month: Number(match[2]) - 1 } : null;
}

export function toIsoMonth(date: Date): IsoMonth {
  return toIsoDate(date).slice(0, 7);
}

export function addDays(date: Date, amount: number): Date {
  return new Date(date.getTime() + amount * DAY_MS);
}

/**
 * Dia `day` do mês, limitado ao último dia do mês (31 em fevereiro vira 28 ou 29); `month` fora de
 * 0–11 avança ou recua o ano.
 */
export function dayOfMonth(year: number, month: number, day: number): Date {
  const first = new Date(Date.UTC(year, month, 1));
  const lastDay = new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(day, lastDay)));
}

/** "2026-11" → { start: "2026-11-01", end: "2026-11-30" }. */
export function monthRange(month: IsoMonth): { start: IsoDate; end: IsoDate } {
  const parsed = parseIsoMonth(month);
  if (!parsed) {
    throw new RangeError(`Invalid month: ${month}`);
  }
  return {
    start: toIsoDate(dayOfMonth(parsed.year, parsed.month, 1)),
    end: toIsoDate(dayOfMonth(parsed.year, parsed.month, 31)),
  };
}

/** "2026-11-04" → "04/11/2026". */
export function formatIsoDate(date: IsoDate): string {
  const [year, month, day] = date.split('-');
  return `${day}/${month}/${year}`;
}

/** "2026-12" → "12/2026". */
export function monthLabel(month: IsoMonth): string {
  const [year, number] = month.split('-');
  return `${number}/${year}`;
}
