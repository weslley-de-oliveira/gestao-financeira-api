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
      ['tipo desconhecido', { type: 'refund' }, 'body.type', 'Selecione despesa ou receita.'],
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

    it('responde 422 para transferência e pagamento de fatura (ainda não aceitos aqui)', async () => {
      for (const type of ['transfer', 'invoice-payment']) {
        expect((await post(ledger, expense(ledger, { type }))).statusCode).toBe(422);
      }
    });

    it('responde 401 sem sessão', async () => {
      expect((await post(null, expense(ledger))).statusCode).toBe(401);
    });
  });
});
