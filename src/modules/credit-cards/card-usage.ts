import type { IsoDate } from '../../shared/utils/date.ts';
import {
  invoiceCycleFor,
  type CardDays,
  type InvoiceCycle,
} from '../../shared/utils/invoice-cycle.ts';
import type { Cents } from '../../shared/utils/money.ts';
import type { TransactionType } from '../transactions/transactions.constants.ts';

/** Fatura aberta hoje e o total das compras já lançadas nela. */
export type NextInvoice = InvoiceCycle & { amount: Cents };

export interface CardUsage {
  /** Compras ainda não pagas. */
  usedLimit: Cents;
  /** Limite − utilizado; negativo quando o limite foi ultrapassado. */
  availableLimit: Cents;
  nextInvoice: NextInvoice;
}

/** Movimentação de cartão: compras (despesas no cartão), estornos e pagamentos de fatura. */
export interface CardMovement {
  type: TransactionType;
  amount: Cents;
  date: IsoDate;
  creditCardId: string | null;
}

/**
 * Limite e próxima fatura de um cartão (porte de `card-usage.ts` do front). A API calcula no banco
 * (`CreditCardsRepository.usageTotals`, com a mesma regra); esta função é a referência legível, e
 * os testes garantem que os dois dão o mesmo resultado. Regra:
 * - utilizado = compras − estornos − faturas pagas (nunca negativo);
 * - disponível = limite − utilizado, negativo se o limite foi ultrapassado;
 * - próxima fatura = a aberta em `today`, com as compras menos os estornos já lançados nela.
 */
export function calculateCardUsage(
  card: CardDays & { id: string; creditLimit: Cents },
  movements: readonly CardMovement[],
  today: IsoDate,
): CardUsage {
  const ofCard = movements.filter((movement) => movement.creditCardId === card.id);
  const purchases = ofCard.filter((movement) => movement.type === 'expense');
  const refunds = ofCard.filter((movement) => movement.type === 'refund');
  const payments = ofCard.filter((movement) => movement.type === 'invoice-payment');
  const usedLimit = Math.max(0, sum(purchases) - sum(refunds) - sum(payments));
  const cycle = invoiceCycleFor(card, today);
  const inCycle = (movement: CardMovement) =>
    movement.date >= cycle.start && movement.date <= cycle.end;
  return {
    usedLimit,
    availableLimit: card.creditLimit - usedLimit,
    nextInvoice: {
      ...cycle,
      amount: sum(purchases.filter(inCycle)) - sum(refunds.filter(inCycle)),
    },
  };
}

function sum(movements: readonly { amount: Cents }[]): Cents {
  return movements.reduce((total, movement) => total + movement.amount, 0);
}
