import { describe, expect, it } from 'vitest';
import type { Transaction } from '../../db/schema/index.ts';
import {
  buildInvoice,
  canPayInvoice,
  invoiceStatus,
  isInvoicePaidFor,
  listInvoices,
  nextMonth,
} from './invoice-rules.ts';

// Porte de `invoice-rules.spec.ts` do front: os mesmos casos, para as faturas darem o mesmo
// resultado nos dois lados.
const card = { id: 'card', closingDay: 5, dueDay: 12 };

let sequence = 0;

/** Transação completa (como vem do banco); o id cresce na ordem de criação, como o UUID v7. */
function transaction(overrides: Partial<Transaction>): Transaction {
  sequence += 1;
  return {
    id: `id-${String(sequence).padStart(3, '0')}`,
    userId: 'user',
    type: 'expense',
    description: 'Compra',
    amount: 1_000,
    date: '2026-11-10',
    accountId: null,
    creditCardId: 'card',
    invoiceMonth: null,
    destinationAccountId: null,
    categoryId: 'food',
    status: 'completed',
    notes: null,
    installmentGroupId: null,
    installmentNumber: null,
    installmentCount: null,
    refundedTransactionId: null,
    createdAt: new Date('2026-11-01T10:00:00.000Z'),
    updatedAt: new Date('2026-11-01T10:00:00.000Z'),
    ...overrides,
  };
}

const transactions = [
  transaction({ description: 'Sapato', amount: 20_000, date: '2026-10-20' }),
  transaction({ description: 'Farmácia', amount: 15_050, date: '2026-11-04' }),
  transaction({ description: 'Notebook', amount: 9_990, date: '2026-11-05' }),
  transaction({ description: 'Outro cartão', creditCardId: 'other', date: '2026-11-01' }),
  transaction({ description: 'Na conta', creditCardId: null, accountId: 'checking' }),
];

const payment = transaction({
  description: 'Fatura',
  type: 'invoice-payment',
  amount: 35_050,
  date: '2026-11-10',
  accountId: 'checking',
  invoiceMonth: '2026-11',
  categoryId: null,
});

describe('regras de fatura', () => {
  it('agrupa as compras do ciclo e soma o total', () => {
    const invoice = buildInvoice(card, transactions, '2026-11', '2026-11-15');

    expect(invoice).toMatchObject({
      referenceMonth: '2026-11',
      start: '2026-10-05',
      end: '2026-11-04',
      closingDate: '2026-11-05',
      dueDate: '2026-11-12',
      total: 35_050,
      previousBalance: 0,
      amountDue: 35_050,
      paidAmount: 0,
      balance: 35_050,
      payments: [],
      payment: null,
      status: 'overdue',
    });
    expect(invoice.purchases.map((p) => p.description)).toEqual(['Farmácia', 'Sapato']);
  });

  it('tira o status das datas e do saldo', () => {
    const cycle = { closingDate: '2026-11-05', dueDate: '2026-11-12' };
    const status = (balance: number, today: string) =>
      invoiceStatus(cycle, balance, '2026-12-05', today);

    expect(status(100, '2026-11-04')).toBe('open');
    expect(status(0, '2026-11-04')).toBe('open');
    expect(status(100, '2026-11-05')).toBe('closed');
    expect(status(100, '2026-11-12')).toBe('closed');
    expect(status(100, '2026-11-13')).toBe('overdue');
    expect(status(100, '2026-12-04')).toBe('overdue');
    // No fechamento da seguinte, o saldo passa para ela.
    expect(status(100, '2026-12-05')).toBe('carried-over');
    expect(status(0, '2026-11-05')).toBe('paid');
    expect(status(-500, '2026-11-13')).toBe('paid');
    expect(status(0, '2026-12-05')).toBe('paid');
  });

  it('lista a aberta e todas com compras ou pagamento, da mais recente para a mais antiga', () => {
    const invoices = listInvoices(card, [...transactions, payment], '2026-11-15');

    expect(invoices.map((i) => [i.referenceMonth, i.status, i.total])).toEqual([
      ['2026-12', 'open', 9_990],
      ['2026-11', 'paid', 35_050],
    ]);
    expect(listInvoices(card, [], '2026-11-15').map((i) => i.referenceMonth)).toEqual(['2026-12']);
  });

  it('só paga fatura fechada ou vencida, com saldo', () => {
    expect(canPayInvoice({ status: 'closed', balance: 100 })).toBe(true);
    expect(canPayInvoice({ status: 'overdue', balance: 100 })).toBe(true);
    expect(canPayInvoice({ status: 'open', balance: 100 })).toBe(false);
    expect(canPayInvoice({ status: 'carried-over', balance: 100 })).toBe(false);
    expect(canPayInvoice({ status: 'paid', balance: 0 })).toBe(false);
    expect(canPayInvoice({ status: 'closed', balance: 0 })).toBe(false);
  });

  it('avança o mês, virando o ano', () => {
    expect(nextMonth('2026-11')).toBe('2026-12');
    expect(nextMonth('2026-12')).toBe('2027-01');
  });

  it('sabe se a fatura de uma data de compra está paga', () => {
    const all = [...transactions, payment];

    expect(isInvoicePaidFor(card, all, '2026-10-20')).toBe(true);
    expect(isInvoicePaidFor(card, all, '2026-11-05')).toBe(false);
    expect(isInvoicePaidFor({ ...card, id: 'other' }, all, '2026-10-20')).toBe(false);
  });
});

describe('saldo entre faturas', () => {
  // 2026-11: compras de 05/10 a 04/11, fecha 05/11, vence 12/11 (35.050).
  // 2026-12: compras de 05/11 a 04/12, fecha 05/12, vence 12/12 (9.990).
  const partial = (amount: number, date: string, invoiceMonth = '2026-11') =>
    transaction({
      description: 'Fatura',
      type: 'invoice-payment',
      amount,
      date,
      accountId: 'checking',
      invoiceMonth,
      categoryId: null,
    });

  it('paga em partes: soma os pagamentos e mostra o que falta', () => {
    const first = partial(20_000, '2026-11-10');
    const second = partial(5_000, '2026-11-11');
    const invoice = buildInvoice(card, [...transactions, first, second], '2026-11', '2026-11-12');

    expect(invoice).toMatchObject({
      amountDue: 35_050,
      paidAmount: 25_000,
      balance: 10_050,
      status: 'closed',
      payment: second,
    });
    expect(invoice.payments).toEqual([second, first]);
    expect(canPayInvoice(invoice)).toBe(true);
  });

  it('a fatura paga por inteiro, em partes, fica paga', () => {
    const all = [...transactions, partial(20_000, '2026-11-10'), partial(15_050, '2026-11-11')];

    expect(buildInvoice(card, all, '2026-11', '2026-11-15')).toMatchObject({
      balance: 0,
      status: 'paid',
    });
  });

  it('o saldo só passa para a seguinte quando ela fecha', () => {
    const all = [...transactions, partial(20_000, '2026-11-10')];

    const beforeClosing = listInvoices(card, all, '2026-12-04');
    expect(beforeClosing.map((i) => [i.referenceMonth, i.status, i.previousBalance])).toEqual([
      ['2026-12', 'open', 0],
      ['2026-11', 'overdue', 0],
    ]);

    const [, december, november] = listInvoices(card, all, '2026-12-05');
    expect(november).toMatchObject({ status: 'carried-over', balance: 15_050 });
    expect(december).toMatchObject({
      status: 'closed',
      total: 9_990,
      previousBalance: 15_050,
      amountDue: 25_040,
      balance: 25_040,
    });
  });

  it('o pagamento atrasado, antes do fechamento da seguinte, não deixa saldo', () => {
    const all = [...transactions, partial(20_000, '2026-11-10'), partial(15_050, '2026-12-01')];

    const [, december, november] = listInvoices(card, all, '2026-12-05');
    expect(november).toMatchObject({ status: 'paid', balance: 0 });
    expect(december).toMatchObject({ previousBalance: 0, amountDue: 9_990 });
  });

  it('o crédito da fatura com mais estornos que compras passa para a seguinte', () => {
    const refund = transaction({
      description: 'Estorno',
      type: 'refund',
      amount: 50_000,
      date: '2026-11-20',
      refundedTransactionId: 'id-001',
    });
    const all = [...transactions, partial(35_050, '2026-11-10'), refund];

    const [, january, december] = listInvoices(card, all, '2027-01-05');
    expect(december).toMatchObject({ total: -40_010, balance: -40_010, status: 'paid' });
    // Sem compras, a fatura de 01/2027 aparece pelo saldo anterior.
    expect(january).toMatchObject({
      referenceMonth: '2027-01',
      previousBalance: -40_010,
      amountDue: -40_010,
      status: 'paid',
    });
  });

  it('o saldo atravessa um mês sem compras', () => {
    const invoices = listInvoices(card, transactions, '2027-01-05');

    expect(invoices.map((i) => [i.referenceMonth, i.status, i.previousBalance, i.balance])).toEqual(
      [
        ['2027-02', 'open', 0, 0],
        ['2027-01', 'closed', 45_040, 45_040],
        ['2026-12', 'carried-over', 35_050, 45_040],
        ['2026-11', 'carried-over', 0, 35_050],
      ],
    );
  });

  it('um mês fora da cadeia é uma fatura vazia', () => {
    expect(buildInvoice(card, transactions, '2026-01', '2026-11-15')).toMatchObject({
      total: 0,
      previousBalance: 0,
      balance: 0,
      status: 'paid',
    });
  });
});
