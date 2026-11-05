import { describe, expect, it } from 'vitest';
import {
  calculateBalance,
  calculateTotalBalance,
  movementEffect,
  type BalanceMovement,
} from './account-balance.ts';

// Porte de `account-balance.spec.ts` do front: os mesmos casos, para a regra dar o mesmo resultado
// nos dois lados.
describe('saldo da conta', () => {
  const checking = { id: 'checking', initialBalance: 100_000 };
  const savings = { id: 'savings', initialBalance: 50_000 };

  it('começa do saldo inicial', () => {
    expect(calculateBalance(checking, [])).toBe(100_000);
    expect(calculateBalance({ id: 'x', initialBalance: -2_500 }, [])).toBe(-2_500);
  });

  it('soma receitas e subtrai despesas só da própria conta', () => {
    const movements: BalanceMovement[] = [
      { type: 'income', amount: 30_000, accountId: 'checking' },
      { type: 'expense', amount: 12_345, accountId: 'checking' },
      { type: 'expense', amount: 99_999, accountId: 'savings' },
    ];

    expect(calculateBalance(checking, movements)).toBe(117_655);
  });

  it('debita a origem e credita o destino de uma transferência', () => {
    const transfer: BalanceMovement = {
      type: 'transfer',
      amount: 20_000,
      accountId: 'checking',
      destinationAccountId: 'savings',
    };

    expect(movementEffect(transfer, 'checking')).toBe(-20_000);
    expect(movementEffect(transfer, 'savings')).toBe(20_000);
    expect(movementEffect(transfer, 'other')).toBe(0);
  });

  it('debita pagamentos de fatura e ignora compras no cartão', () => {
    const movements: BalanceMovement[] = [
      { type: 'expense', amount: 40_000, accountId: null },
      { type: 'invoice-payment', amount: 40_000, accountId: 'checking' },
    ];

    expect(calculateBalance(checking, movements)).toBe(60_000);
    expect(calculateBalance(savings, movements)).toBe(50_000);
  });

  it('ignora movimentações pendentes', () => {
    const movements: BalanceMovement[] = [
      { type: 'income', amount: 30_000, accountId: 'checking', status: 'completed' },
      { type: 'expense', amount: 50_000, accountId: 'checking', status: 'pending' },
      {
        type: 'transfer',
        amount: 10_000,
        accountId: 'checking',
        destinationAccountId: 'savings',
        status: 'pending',
      },
    ];

    expect(calculateBalance(checking, movements)).toBe(130_000);
    expect(calculateBalance(savings, movements)).toBe(50_000);
  });

  it('mantém o patrimônio consolidado depois de transferências', () => {
    const before = calculateTotalBalance([checking, savings], []);
    const after = calculateTotalBalance(
      [checking, savings],
      [
        {
          type: 'transfer',
          amount: 20_000,
          accountId: 'checking',
          destinationAccountId: 'savings',
        },
        { type: 'transfer', amount: 7_550, accountId: 'savings', destinationAccountId: 'checking' },
      ],
    );

    expect(after).toBe(before);
    expect(before).toBe(150_000);
  });

  it('mantém a precisão de centavos onde o ponto flutuante erraria', () => {
    const movements: BalanceMovement[] = Array.from({ length: 10 }, () => ({
      type: 'income' as const,
      amount: 10,
      accountId: 'checking',
    }));

    expect(calculateBalance({ id: 'checking', initialBalance: 20 }, movements)).toBe(120);
  });

  it.each([Number.NaN, Infinity, 10.5, -100])(
    'recusa valor de movimentação inválido (%s)',
    (amount) => {
      expect(() =>
        calculateBalance(checking, [{ type: 'income', amount, accountId: 'checking' }]),
      ).toThrow(RangeError);
    },
  );

  it('recusa saldo inicial inválido', () => {
    expect(() => calculateBalance({ id: 'x', initialBalance: Number.NaN }, [])).toThrow(RangeError);
  });
});
