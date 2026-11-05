import { describe, expect, it } from 'vitest';
import { calculateCardUsage, type CardMovement } from './card-usage.ts';

// Porte de `card-usage.spec.ts` do front. O `usagePercent` (barra de progresso) é regra de tela e
// continua só no front.
describe('uso do cartão', () => {
  const card = { id: 'card', creditLimit: 100_000, closingDay: 5, dueDay: 12 };

  const purchases: CardMovement[] = [
    { type: 'expense', creditCardId: 'card', amount: 20_000, date: '2026-10-20' },
    { type: 'expense', creditCardId: 'card', amount: 15_050, date: '2026-11-04' },
    { type: 'expense', creditCardId: 'card', amount: 9_990, date: '2026-11-05' },
    { type: 'expense', creditCardId: 'other', amount: 50_000, date: '2026-11-01' },
    { type: 'expense', creditCardId: null, amount: 70_000, date: '2026-11-01' },
  ];

  it('compromete o limite com todas as compras do cartão', () => {
    const usage = calculateCardUsage(card, purchases, '2026-11-15');

    expect(usage.usedLimit).toBe(45_040);
    expect(usage.availableLimit).toBe(54_960);
  });

  it('libera o limite com as faturas pagas do cartão', () => {
    const payments: CardMovement[] = [
      { type: 'invoice-payment', creditCardId: 'card', amount: 35_050, date: '2026-11-10' },
      { type: 'invoice-payment', creditCardId: 'other', amount: 9_000, date: '2026-11-10' },
    ];

    const usage = calculateCardUsage(card, [...purchases, ...payments], '2026-11-15');

    expect(usage.usedLimit).toBe(9_990);
    expect(usage.availableLimit).toBe(90_010);
  });

  it('soma só as compras da fatura aberta', () => {
    // Em 04/11 a fatura aberta é a que fecha em 05/11 (compras de 05/10 a 04/11).
    expect(calculateCardUsage(card, purchases, '2026-11-04').nextInvoice).toMatchObject({
      closingDate: '2026-11-05',
      dueDate: '2026-11-12',
      amount: 35_050,
    });
    // A partir de 05/11, a aberta é a que fecha em 05/12.
    expect(calculateCardUsage(card, purchases, '2026-11-15').nextInvoice).toMatchObject({
      closingDate: '2026-12-05',
      amount: 9_990,
    });
  });

  it('fica negativo quando o limite é ultrapassado', () => {
    const usage = calculateCardUsage({ ...card, creditLimit: 40_000 }, purchases, '2026-11-15');

    expect(usage.availableLimit).toBe(-5_040);
  });

  it('nunca tem utilizado negativo', () => {
    const usage = calculateCardUsage(
      card,
      [{ type: 'invoice-payment', creditCardId: 'card', amount: 1_000, date: '2026-11-10' }],
      '2026-11-15',
    );

    expect(usage.usedLimit).toBe(0);
    expect(usage.availableLimit).toBe(100_000);
  });
});
