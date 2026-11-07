import type { IsoDate } from '../../shared/utils/date.ts';
import { invoiceCycleFor, type CardDays } from '../../shared/utils/invoice-cycle.ts';
import type { Cents } from '../../shared/utils/money.ts';

/** Uma parcela com o que já foi estornado dela. */
export interface InstallmentState {
  id: string;
  installmentNumber: number;
  amount: Cents;
  date: IsoDate;
  /** Soma dos estornos da parcela. */
  refunded: Cents;
}

/** O estorno que cancela o que falta de uma parcela. */
export interface PlannedCancellation {
  installmentId: string;
  amount: Cents;
  date: IsoDate;
}

/**
 * Parcelas que podem ir para a fatura atual (a que contém `today`): as de faturas seguintes e sem
 * estornos, da última para a primeira, porque os bancos antecipam a partir do fim.
 */
export function anticipatableInstallments<T extends InstallmentState>(
  card: CardDays,
  installments: readonly T[],
  today: IsoDate,
): T[] {
  const current = invoiceCycleFor(card, today);
  return installments
    .filter((installment) => installment.date > current.end && installment.refunded === 0)
    .toSorted((a, b) => b.installmentNumber - a.installmentNumber);
}

/**
 * Estornos que cancelam o que ainda não foi cobrado: o que falta estornar de cada parcela da fatura
 * atual e das futuras, da primeira à última. Cada estorno fica na data da parcela, ou hoje se ela
 * já passou, para cair na mesma fatura dela. Parcelas de faturas fechadas já foram cobradas.
 */
export function plannedCancellations(
  card: CardDays,
  installments: readonly InstallmentState[],
  today: IsoDate,
): PlannedCancellation[] {
  const current = invoiceCycleFor(card, today);
  return installments
    .filter(
      (installment) =>
        installment.date >= current.start && installment.amount > installment.refunded,
    )
    .toSorted((a, b) => a.installmentNumber - b.installmentNumber)
    .map((installment) => ({
      installmentId: installment.id,
      amount: installment.amount - installment.refunded,
      date: installment.date < today ? today : installment.date,
    }));
}
