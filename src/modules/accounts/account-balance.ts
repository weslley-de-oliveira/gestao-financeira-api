import type { ContributionType } from '../goals/goals.constants.ts';
import type { TransactionStatus, TransactionType } from '../transactions/transactions.constants.ts';
import type { IsoDate } from '../../shared/utils/date.ts';
import { assertValidCents, type Cents } from '../../shared/utils/money.ts';

/**
 * Regra do saldo, portada do front (`account-balance.ts`). A API calcula o saldo no banco
 * (`AccountsRepository.balances`, uma soma agregada com a mesma regra); esta função é a referência
 * legível da regra, e os testes garantem que os dois dão o mesmo resultado.
 */

/**
 * Movimentação que altera o saldo de uma conta. As transações seguem este formato:
 * `amount` é sempre positivo e o tipo define se ele entra ou sai da conta.
 */
export interface BalanceMovement {
  type: TransactionType;
  amount: Cents;
  /** `null` nas compras no cartão, que não movimentam conta. */
  accountId: string | null;
  /** Conta que recebe o valor; apenas em transferências. */
  destinationAccountId?: string | null;
  /** Movimentações pendentes não alteram o saldo. Ausente equivale a realizada. */
  status?: TransactionStatus;
}

/** Efeito de uma movimentação no saldo de uma conta: positivo credita, negativo debita. */
export function movementEffect(movement: BalanceMovement, accountId: string): Cents {
  assertValidCents(movement.amount, 'amount');
  if (movement.amount < 0) {
    throw new RangeError('amount must not be negative');
  }
  if (movement.status === 'pending') {
    return 0;
  }

  switch (movement.type) {
    // O estorno de uma despesa em conta devolve o valor a ela (o do cartão abate a fatura).
    case 'income':
    case 'refund':
      return movement.accountId === accountId ? movement.amount : 0;
    // O pagamento de fatura sai da conta como uma despesa, mas não é contado como despesa nos
    // totais: as compras do cartão já foram.
    case 'expense':
    case 'invoice-payment':
      return movement.accountId === accountId ? -movement.amount : 0;
    case 'transfer': {
      // Debita a origem e credita o destino: o patrimônio consolidado não muda.
      const debit = movement.accountId === accountId ? -movement.amount : 0;
      const credit = movement.destinationAccountId === accountId ? movement.amount : 0;
      return debit + credit;
    }
  }
}

/** Regra única do saldo atual: saldo inicial + efeito de todas as movimentações da conta. */
export function calculateBalance(
  account: { id: string; initialBalance: Cents },
  movements: readonly BalanceMovement[],
): Cents {
  assertValidCents(account.initialBalance, 'initialBalance');
  return movements.reduce(
    (balance, movement) => balance + movementEffect(movement, account.id),
    account.initialBalance,
  );
}

/** Patrimônio consolidado: soma dos saldos atuais das contas informadas. */
export function calculateTotalBalance(
  accounts: readonly { id: string; initialBalance: Cents }[],
  movements: readonly BalanceMovement[],
): Cents {
  return accounts.reduce((total, account) => total + calculateBalance(account, movements), 0);
}

/** Movimentação de uma meta, como a API e o front a guardam. */
export interface GoalContributionMovement {
  type: ContributionType;
  amount: Cents;
  /** Conta de onde o aporte saiu ou para onde a retirada voltou; `null` só registra na meta. */
  accountId: string | null;
  date: IsoDate;
}

/**
 * A movimentação de uma meta com conta, no formato das que alteram o saldo: uma transferência
 * entre a conta e a meta, da qual só o lado da conta existe. O aporte só debita a conta e a
 * retirada só credita, sem contar como receita ou despesa. Sem conta, não há efeito (`null`).
 */
export function goalMovement(
  contribution: GoalContributionMovement,
): (BalanceMovement & { date: IsoDate }) | null {
  if (contribution.accountId === null) {
    return null;
  }
  const deposit = contribution.type === 'deposit';
  return {
    type: 'transfer',
    amount: contribution.amount,
    accountId: deposit ? contribution.accountId : null,
    destinationAccountId: deposit ? null : contribution.accountId,
    status: 'completed',
    date: contribution.date,
  };
}

/** Movimentações de metas que alteram o saldo das contas (as que têm conta). */
export function goalMovements(
  contributions: readonly GoalContributionMovement[],
): (BalanceMovement & { date: IsoDate })[] {
  return contributions
    .map(goalMovement)
    .filter((movement): movement is BalanceMovement & { date: IsoDate } => movement !== null);
}

/** Quanto da conta está guardado em metas: aportes que saíram dela − retiradas que voltaram. */
export function goalsTotal(
  accountId: string,
  contributions: readonly GoalContributionMovement[],
): Cents {
  return goalMovements(contributions).reduce(
    (total, movement) => total - movementEffect(movement, accountId),
    0,
  );
}
