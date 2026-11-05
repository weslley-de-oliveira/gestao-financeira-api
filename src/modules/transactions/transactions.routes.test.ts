import { randomUUID, randomUUIDv7 } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../../../test/helpers/app.ts';
import { transactions } from '../../db/schema/index.ts';
import type { AccountDto } from '../accounts/accounts.schemas.ts';
import { SESSION_COOKIE } from '../auth/session-cookie.ts';
import type { CategoryDto } from '../categories/categories.schemas.ts';
import type { TransactionDto } from './transactions.schemas.ts';

/** Usuário pronto para lançar: uma conta e as categorias padrão "Alimentação" e "Salário". */
interface Ledger {
  userId: string;
  cookies: Record<string, string>;
  account: AccountDto;
  food: CategoryDto;
  salary: CategoryDto;
}

describe('rotas /v1/transactions', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  async function createLedger(): Promise<Ledger> {
    const registered = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: {
        name: 'Pessoa de Teste',
        email: `pessoa.${randomUUID()}@exemplo.com`,
        password: 'senha1234',
      },
    });
    const token = registered.cookies.find(({ name }) => name === SESSION_COOKIE)?.value;
    if (!token) throw new Error('cadastro sem cookie de sessão');
    const cookies = { [SESSION_COOKIE]: token };

    const account = await app.inject({
      method: 'POST',
      url: '/v1/accounts',
      cookies,
      payload: { name: 'Conta corrente', type: 'checking', color: '#1565c0', icon: 'home' },
    });
    const list = await app.inject({ method: 'GET', url: '/v1/categories', cookies });
    const byName = (name: string) => {
      const found = list.json<CategoryDto[]>().find((category) => category.name === name);
      if (!found) throw new Error(`categoria padrão ${name} não encontrada`);
      return found;
    };

    return {
      userId: registered.json<{ id: string }>().id,
      cookies,
      account: account.json<AccountDto>(),
      food: byName('Alimentação'),
      salary: byName('Salário'),
    };
  }

  const post = (ledger: Pick<Ledger, 'cookies'> | null, payload: Record<string, unknown>) =>
    app.inject({
      method: 'POST',
      url: '/v1/transactions',
      payload,
      ...(ledger && { cookies: ledger.cookies }),
    });

  /** Despesa válida no ledger, com qualquer campo trocado. */
  const expense = (ledger: Ledger, overrides: Record<string, unknown> = {}) => ({
    type: 'expense',
    description: 'Mercado do mês',
    amount: 45_390,
    date: '2026-11-05',
    accountId: ledger.account.id,
    categoryId: ledger.food.id,
    ...overrides,
  });

  async function stored(id: string) {
    const [transaction] = await app.db.select().from(transactions).where(eq(transactions.id, id));
    return transaction;
  }

  describe('POST /v1/transactions', () => {
    let ledger: Ledger;

    beforeAll(async () => {
      ledger = await createLedger();
    });

    it('cadastra a despesa do usuário da sessão, realizada por padrão', async () => {
      const response = await post(ledger, expense(ledger));

      expect(response.statusCode).toBe(201);
      const body = response.json<TransactionDto>();
      expect(body).toEqual({
        id: expect.any(String) as unknown,
        type: 'expense',
        description: 'Mercado do mês',
        amount: 45_390,
        date: '2026-11-05',
        accountId: ledger.account.id,
        creditCardId: null,
        invoiceMonth: null,
        destinationAccountId: null,
        categoryId: ledger.food.id,
        status: 'completed',
        notes: null,
        createdAt: expect.any(String) as unknown,
      });
      expect((await stored(body.id))?.userId).toBe(ledger.userId);
    });

    it('cadastra receita pendente, com descrição e observações aparadas', async () => {
      const response = await post(ledger, {
        ...expense(ledger),
        type: 'income',
        categoryId: ledger.salary.id,
        description: '  Salário   de  novembro ',
        status: 'pending',
        notes: '  Cai no quinto dia útil.  ',
      });

      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({
        type: 'income',
        description: 'Salário de novembro',
        status: 'pending',
        notes: 'Cai no quinto dia útil.',
      });
    });

    it('grava observações vazias como null', async () => {
      const response = await post(ledger, expense(ledger, { notes: '   ' }));

      expect(response.json<TransactionDto>().notes).toBeNull();
    });

    it.each([
      ['descrição vazia', { description: '  ' }, 'body.description', 'Informe a descrição.'],
      [
        'descrição com mais de 80 caracteres',
        { description: 'a'.repeat(81) },
        'body.description',
        'A descrição deve ter no máximo 80 caracteres.',
      ],
      ['valor zero', { amount: 0 }, 'body.amount', 'O valor deve ser maior que zero.'],
      ['valor negativo', { amount: -100 }, 'body.amount', 'O valor deve ser maior que zero.'],
      [
        'valor fracionado',
        { amount: 10.5 },
        'body.amount',
        'Informe o valor em centavos inteiros.',
      ],
      [
        'valor acima de R$ 1 bilhão',
        { amount: 100_000_000_001 },
        'body.amount',
        'O valor deve ser de até R$ 1 bilhão.',
      ],
      [
        'data inexistente',
        { date: '2026-02-30' },
        'body.date',
        'Informe uma data válida no formato aaaa-mm-dd.',
      ],
      [
        'data em outro formato',
        { date: '05/11/2026' },
        'body.date',
        'Informe uma data válida no formato aaaa-mm-dd.',
      ],
      [
        'tipo desconhecido',
        { type: 'refund' },
        'body.type',
        'Selecione despesa, receita ou transferência.',
      ],
      [
        'pagamento de fatura (só pelas rotas de faturas)',
        { type: 'invoice-payment' },
        'body.type',
        'Selecione despesa, receita ou transferência.',
      ],
      ['sem conta', { accountId: undefined }, 'body.accountId', 'Selecione a conta.'],
      ['sem categoria', { categoryId: null }, 'body.categoryId', 'Selecione a categoria.'],
      [
        'status desconhecido',
        { status: 'done' },
        'body.status',
        'Selecione realizada ou pendente.',
      ],
      [
        'observações com mais de 500 caracteres',
        { notes: 'a'.repeat(501) },
        'body.notes',
        'As observações devem ter no máximo 500 caracteres.',
      ],
    ])('responde 422 para %s', async (_case, overrides, field, message) => {
      const response = await post(ledger, expense(ledger, overrides));

      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({ errors: [{ field, message }] });
    });

    it('aceita 29 de fevereiro só em ano bissexto', async () => {
      expect((await post(ledger, expense(ledger, { date: '2028-02-29' }))).statusCode).toBe(201);
      expect((await post(ledger, expense(ledger, { date: '2026-02-29' }))).statusCode).toBe(422);
    });

    it('responde 422 no campo quando a categoria é do outro tipo', async () => {
      const response = await post(ledger, expense(ledger, { categoryId: ledger.salary.id }));

      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({
        type: '/problems/validation-error',
        errors: [{ field: 'body.categoryId', message: 'Selecione uma categoria de despesa.' }],
      });
    });

    it('responde 422 nos dois campos para conta e categoria inexistentes', async () => {
      const response = await post(
        ledger,
        expense(ledger, { accountId: randomUUIDv7(), categoryId: randomUUIDv7() }),
      );

      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({
        errors: [
          { field: 'body.accountId', message: 'Conta não encontrada.' },
          { field: 'body.categoryId', message: 'Categoria não encontrada.' },
        ],
      });
    });

    it('trata conta e categoria de outro usuário como inexistentes', async () => {
      const other = await createLedger();

      const response = await post(
        ledger,
        expense(ledger, { accountId: other.account.id, categoryId: other.food.id }),
      );

      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({
        errors: [
          { field: 'body.accountId', message: 'Conta não encontrada.' },
          { field: 'body.categoryId', message: 'Categoria não encontrada.' },
        ],
      });
    });

    it.each([
      ['userId', () => randomUUIDv7()],
      ['id', () => randomUUIDv7()],
      ['creditCardId', () => randomUUIDv7()],
      ['destinationAccountId', () => randomUUIDv7()],
    ])('responde 422 se o corpo trouxer %s', async (field, value) => {
      const response = await post(ledger, expense(ledger, { [field]: value() }));

      expect(response.statusCode).toBe(422);
    });

    it('responde 401 sem sessão', async () => {
      expect((await post(null, expense(ledger))).statusCode).toBe(401);
    });
  });

  describe('POST /v1/transactions (transferência)', () => {
    let ledger: Ledger;
    let savings: AccountDto;

    beforeAll(async () => {
      ledger = await createLedger();
      const response = await app.inject({
        method: 'POST',
        url: '/v1/accounts',
        cookies: ledger.cookies,
        payload: { name: 'Poupança', type: 'savings', color: '#2e7d32', icon: 'savings' },
      });
      savings = response.json<AccountDto>();
    });

    /** Transferência válida da conta corrente para a poupança, com qualquer campo trocado. */
    const transfer = (overrides: Record<string, unknown> = {}) => ({
      type: 'transfer',
      description: 'Reserva do mês',
      amount: 100_000,
      date: '2026-11-05',
      accountId: ledger.account.id,
      destinationAccountId: savings.id,
      ...overrides,
    });

    it('cadastra a transferência entre duas contas do usuário, sem categoria', async () => {
      const response = await post(ledger, transfer({ status: 'pending' }));

      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({
        type: 'transfer',
        amount: 100_000,
        accountId: ledger.account.id,
        destinationAccountId: savings.id,
        categoryId: null,
        creditCardId: null,
        status: 'pending',
      });
    });

    it('responde 422 para a mesma conta na origem e no destino', async () => {
      const response = await post(ledger, transfer({ destinationAccountId: ledger.account.id }));

      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({
        errors: [
          {
            field: 'body.destinationAccountId',
            message: 'Escolha uma conta diferente da conta de origem.',
          },
        ],
      });
    });

    it.each([
      ['sem conta de origem', 'accountId', 'Selecione a conta de origem.'],
      ['sem conta de destino', 'destinationAccountId', 'Selecione a conta de destino.'],
    ])('responde 422 %s', async (_case, field, message) => {
      const response = await post(ledger, transfer({ [field]: undefined }));

      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({ errors: [{ field: `body.${field}`, message }] });
    });

    it('responde 422 se a transferência trouxer categoria', async () => {
      const response = await post(ledger, transfer({ categoryId: ledger.food.id }));

      expect(response.statusCode).toBe(422);
    });

    it('responde 422 nos dois campos para contas inexistentes ou de outro usuário', async () => {
      const other = await createLedger();

      const response = await post(
        ledger,
        transfer({ accountId: randomUUIDv7(), destinationAccountId: other.account.id }),
      );

      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({
        errors: [
          { field: 'body.accountId', message: 'Conta de origem não encontrada.' },
          { field: 'body.destinationAccountId', message: 'Conta de destino não encontrada.' },
        ],
      });
    });

    it('não transfere para a conta de outro usuário', async () => {
      const other = await createLedger();

      const response = await post(ledger, transfer({ destinationAccountId: other.account.id }));

      expect(response.statusCode).toBe(422);
      const othersTransactions = await app.db
        .select()
        .from(transactions)
        .where(eq(transactions.destinationAccountId, other.account.id));
      expect(othersTransactions).toEqual([]);
    });
  });

  describe('GET, PATCH e DELETE /v1/transactions/:id', () => {
    let ledger: Ledger;
    let savings: AccountDto;

    beforeAll(async () => {
      ledger = await createLedger();
      const response = await app.inject({
        method: 'POST',
        url: '/v1/accounts',
        cookies: ledger.cookies,
        payload: { name: 'Poupança', type: 'savings', color: '#2e7d32', icon: 'savings' },
      });
      savings = response.json<AccountDto>();
    });

    const call = (
      method: 'GET' | 'PATCH' | 'DELETE',
      id: string,
      payload?: Record<string, unknown>,
      session: Pick<Ledger, 'cookies'> | null = ledger,
    ) =>
      app.inject({
        method,
        url: `/v1/transactions/${id}`,
        ...(payload && { payload }),
        ...(session && { cookies: session.cookies }),
      });

    async function createdExpense(overrides: Record<string, unknown> = {}) {
      const response = await post(ledger, expense(ledger, { notes: 'Feira', ...overrides }));
      return response.json<TransactionDto>();
    }

    /** Pagamento de fatura gravado direto no banco: as rotas de faturas chegam na Etapa 4. */
    async function insertInvoicePayment() {
      const [payment] = await app.db
        .insert(transactions)
        .values({
          userId: ledger.userId,
          type: 'invoice-payment',
          description: 'Fatura de outubro',
          amount: 80_000,
          date: '2026-11-05',
          accountId: ledger.account.id,
          creditCardId: randomUUIDv7(),
          invoiceMonth: '2026-10',
        })
        .returning();
      if (!payment) throw new Error('pagamento não inserido');
      return payment;
    }

    function expectInvalid(
      response: Awaited<ReturnType<typeof call>>,
      field: string,
      message: string,
    ) {
      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({
        type: '/problems/validation-error',
        errors: [{ field, message }],
      });
    }

    describe('GET', () => {
      it('detalha a transação', async () => {
        const created = await createdExpense();

        const response = await call('GET', created.id);

        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual(created);
      });

      it('detalha também pagamento de fatura', async () => {
        const payment = await insertInvoicePayment();

        const response = await call('GET', payment.id);

        expect(response.json()).toMatchObject({ type: 'invoice-payment', invoiceMonth: '2026-10' });
      });

      it('responde 404 igual para transação de outro usuário e inexistente', async () => {
        const created = await createdExpense();
        const other = await createLedger();

        for (const id of [created.id, randomUUIDv7()]) {
          const response = await call('GET', id, undefined, other);

          expect(response.statusCode).toBe(404);
          expect(response.json()).toMatchObject({ detail: 'Transação não encontrada.' });
        }
      });

      it('responde 422 para id que não é UUID e 401 sem sessão', async () => {
        expect((await call('GET', 'abc')).statusCode).toBe(422);
        expect((await call('GET', randomUUIDv7(), undefined, null)).statusCode).toBe(401);
      });
    });

    describe('PATCH', () => {
      it('altera só os campos enviados', async () => {
        const created = await createdExpense();

        const response = await call('PATCH', created.id, {
          description: ' Feira  da semana ',
          amount: 12_000,
          status: 'pending',
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({
          ...created,
          description: 'Feira da semana',
          amount: 12_000,
          status: 'pending',
        });
      });

      it('remove as observações com null', async () => {
        const created = await createdExpense();

        const response = await call('PATCH', created.id, { notes: null });

        expect(response.json<TransactionDto>().notes).toBeNull();
      });

      it('com corpo vazio, devolve a transação sem alterar', async () => {
        const created = await createdExpense();

        const response = await call('PATCH', created.id, {});

        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual(created);
      });

      it('troca despesa por receita junto com a categoria', async () => {
        const created = await createdExpense();

        const response = await call('PATCH', created.id, {
          type: 'income',
          categoryId: ledger.salary.id,
        });

        expect(response.json()).toMatchObject({ type: 'income', categoryId: ledger.salary.id });
      });

      it('não troca o tipo mantendo a categoria do tipo antigo', async () => {
        const created = await createdExpense();

        const response = await call('PATCH', created.id, { type: 'income' });

        expectInvalid(response, 'body.categoryId', 'Selecione uma categoria de receita.');
      });

      it('vira transferência descartando a categoria', async () => {
        const created = await createdExpense();

        const response = await call('PATCH', created.id, {
          type: 'transfer',
          destinationAccountId: savings.id,
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({
          type: 'transfer',
          accountId: ledger.account.id,
          destinationAccountId: savings.id,
          categoryId: null,
        });
      });

      it('transferência volta a ser despesa descartando o destino', async () => {
        const created = await createdExpense();
        await call('PATCH', created.id, { type: 'transfer', destinationAccountId: savings.id });

        const response = await call('PATCH', created.id, {
          type: 'expense',
          categoryId: ledger.food.id,
        });

        expect(response.json()).toMatchObject({
          type: 'expense',
          categoryId: ledger.food.id,
          destinationAccountId: null,
        });
      });

      it('exige o destino ao virar transferência', async () => {
        const created = await createdExpense();

        const response = await call('PATCH', created.id, { type: 'transfer' });

        expectInvalid(response, 'body.destinationAccountId', 'Selecione a conta de destino.');
      });

      it('não deixa a transferência com origem igual ao destino', async () => {
        const created = await createdExpense();
        await call('PATCH', created.id, { type: 'transfer', destinationAccountId: savings.id });

        const response = await call('PATCH', created.id, { accountId: savings.id });

        expectInvalid(
          response,
          'body.destinationAccountId',
          'Escolha uma conta diferente da conta de origem.',
        );
      });

      it.each([
        ['descrição vazia', { description: ' ' }, 'body.description', 'Informe a descrição.'],
        ['valor zero', { amount: 0 }, 'body.amount', 'O valor deve ser maior que zero.'],
        [
          'data inexistente',
          { date: '2026-04-31' },
          'body.date',
          'Informe uma data válida no formato aaaa-mm-dd.',
        ],
        [
          'tipo pagamento de fatura',
          { type: 'invoice-payment' },
          'body.type',
          'Selecione despesa, receita ou transferência.',
        ],
      ])('responde 422 para %s', async (_case, body, field, message) => {
        const created = await createdExpense();

        expectInvalid(await call('PATCH', created.id, body), field, message);
      });

      it('responde 422 para conta ou categoria de outro usuário, sem alterar nada', async () => {
        const created = await createdExpense();
        const other = await createLedger();

        const response = await call('PATCH', created.id, {
          accountId: other.account.id,
          categoryId: other.food.id,
        });

        expect(response.statusCode).toBe(422);
        expect((await call('GET', created.id)).json()).toEqual(created);
      });

      it.each([['userId'], ['creditCardId'], ['invoiceMonth']])(
        'responde 422 se o corpo trouxer %s',
        async (field) => {
          const created = await createdExpense();

          const value = field === 'invoiceMonth' ? '2026-10' : randomUUIDv7();
          expect((await call('PATCH', created.id, { [field]: value })).statusCode).toBe(422);
        },
      );

      it('responde 409 para pagamento de fatura, sem alterá-lo', async () => {
        const payment = await insertInvoicePayment();

        const response = await call('PATCH', payment.id, { amount: 1 });

        expect(response.statusCode).toBe(409);
        expect(response.json()).toMatchObject({
          detail:
            'Pagamentos de fatura não são alterados por aqui: desfaça o pagamento pela fatura.',
        });
        expect((await stored(payment.id))?.amount).toBe(80_000);
      });

      it('responde 404 para transação de outro usuário, sem alterá-la', async () => {
        const created = await createdExpense();
        const other = await createLedger();

        const response = await call('PATCH', created.id, { amount: 1 }, other);

        expect(response.statusCode).toBe(404);
        expect((await stored(created.id))?.amount).toBe(created.amount);
      });
    });

    describe('DELETE', () => {
      it('exclui a transação e responde 204', async () => {
        const created = await createdExpense();

        const response = await call('DELETE', created.id);

        expect(response.statusCode).toBe(204);
        expect(response.body).toBe('');
        expect(await stored(created.id)).toBeUndefined();
        expect((await call('GET', created.id)).statusCode).toBe(404);
      });

      it('responde 404 ao excluir de novo', async () => {
        const created = await createdExpense();
        await call('DELETE', created.id);

        expect((await call('DELETE', created.id)).statusCode).toBe(404);
      });

      it('responde 409 para pagamento de fatura, sem excluí-lo', async () => {
        const payment = await insertInvoicePayment();

        expect((await call('DELETE', payment.id)).statusCode).toBe(409);
        expect(await stored(payment.id)).toBeDefined();
      });

      it('responde 404 para transação de outro usuário, sem excluí-la', async () => {
        const created = await createdExpense();
        const other = await createLedger();

        expect((await call('DELETE', created.id, undefined, other)).statusCode).toBe(404);
        expect(await stored(created.id)).toBeDefined();
      });

      it('responde 401 sem sessão', async () => {
        expect((await call('DELETE', randomUUIDv7(), undefined, null)).statusCode).toBe(401);
      });
    });
  });
});
