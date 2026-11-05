import type { TransactionStatus, TransactionType } from '../transactions/transactions.constants.ts';
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
    case 'income':
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
