import {
  addDays,
  dayOfMonth,
  parseIsoDate,
  parseIsoMonth,
  toIsoDate,
  toIsoMonth,
  type IsoDate,
  type IsoMonth,
} from './date.ts';

/** Dias de fechamento e vencimento de um cartão. */
export interface CardDays {
  closingDay: number;
  dueDay: number;
}

/** Fatura de um cartão: compras de `start` a `end` (inclusive), fechada em `closingDate`. */
export interface InvoiceCycle {
  /** Mês do vencimento, `yyyy-MM`: a "fatura de dezembro" vence em dezembro. */
  referenceMonth: IsoMonth;
  /** Primeiro dia de compras da fatura (o fechamento da anterior). */
  start: IsoDate;
  /** Último dia de compras da fatura (a véspera do fechamento). */
  end: IsoDate;
  closingDate: IsoDate;
  dueDate: IsoDate;
}

/**
 * Fatura em que cai uma compra feita em `date` (porte de `invoice-cycle.ts` do front). Regras:
 * - a fatura fecha no dia de fechamento; compras feitas nesse dia já vão para a fatura seguinte
 *   (o "melhor dia de compra");
 * - o vencimento é no mesmo mês do fechamento quando o dia de vencimento é maior que o de
 *   fechamento, senão no mês seguinte;
 * - dias que não existem no mês (29 a 31) viram o último dia do mês.
 */
export function invoiceCycleFor(card: CardDays, date: IsoDate): InvoiceCycle {
  const day = parseIsoDate(date);
  if (!day) {
    throw new RangeError(`Invalid date: ${date}`);
  }
  let closing = dayOfMonth(day.getUTCFullYear(), day.getUTCMonth(), card.closingDay);
  if (day >= closing) {
    closing = dayOfMonth(day.getUTCFullYear(), day.getUTCMonth() + 1, card.closingDay);
  }
  const previousClosing = dayOfMonth(
    closing.getUTCFullYear(),
    closing.getUTCMonth() - 1,
    card.closingDay,
  );
  const dueMonth = closing.getUTCMonth() + (card.dueDay > card.closingDay ? 0 : 1);
  const due = dayOfMonth(closing.getUTCFullYear(), dueMonth, card.dueDay);

  return {
    referenceMonth: toIsoMonth(due),
    start: toIsoDate(previousClosing),
    end: toIsoDate(addDays(closing, -1)),
    closingDate: toIsoDate(closing),
    dueDate: toIsoDate(due),
  };
}

/** Fatura de um mês de referência (`yyyy-MM`, o mês do vencimento). */
export function invoiceCycleForMonth(card: CardDays, referenceMonth: IsoMonth): InvoiceCycle {
  const month = parseIsoMonth(referenceMonth);
  if (!month) {
    throw new RangeError(`Invalid reference month: ${referenceMonth}`);
  }
  const closingMonth = month.month - (card.dueDay > card.closingDay ? 0 : 1);
  const closing = dayOfMonth(month.year, closingMonth, card.closingDay);
  // A véspera do fechamento é o último dia de compras dessa fatura.
  return invoiceCycleFor(card, toIsoDate(addDays(closing, -1)));
}
