/**
 * Avanço das datas do seed da demo, portado do front (`seed-dates.ts`): o seed foi gerado como se
 * hoje fosse `anchorDate`, e as datas andam em meses inteiros até o mês atual.
 */

/** Campos com data (`yyyy-MM-dd`) ou data e hora ISO. */
const DATE_KEYS = new Set(['date', 'deadline', 'createdAt']);
/** Campos com mês (`yyyy-MM`). */
const MONTH_KEYS = new Set(['month', 'invoiceMonth']);

const MONTH_PREFIX = /^(\d{4})-(\d{2})/;

/** Meses entre o mês de `anchorDate` e o de `today` (ambos `yyyy-MM-dd`); nunca negativo. */
export function monthsSinceAnchor(anchorDate: string, today: string): number {
  const anchor = monthIndex(anchorDate);
  const current = monthIndex(today);
  return Math.max(0, current - anchor);
}

/**
 * Avança todas as datas e meses em `months` meses, mantendo o dia. O seed só usa dias de 1 a 28,
 * então nenhuma data muda de dia (e as compras continuam nas mesmas faturas).
 */
export function shiftSeedDates<T>(value: T, months: number): T {
  return months === 0 ? value : (shift(value, months, null) as T);
}

function monthIndex(date: string): number {
  const match = MONTH_PREFIX.exec(date);
  if (!match) {
    throw new RangeError(`Invalid date: ${date}`);
  }
  return Number(match[1]) * 12 + Number(match[2]) - 1;
}

function shift(value: unknown, months: number, key: string | null): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => shift(item, months, null));
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([name, item]) => [name, shift(item, months, name)]),
    );
  }
  if (typeof value === 'string' && key !== null && (DATE_KEYS.has(key) || MONTH_KEYS.has(key))) {
    return shiftMonthPrefix(value, months);
  }
  return value;
}

function shiftMonthPrefix(value: string, months: number): string {
  if (!MONTH_PREFIX.test(value)) {
    return value;
  }
  const total = monthIndex(value) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  return `${year}-${String(month).padStart(2, '0')}${value.slice(7)}`;
}
