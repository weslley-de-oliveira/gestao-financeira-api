import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp } from '../../../test/helpers/app.ts';
import { createAccount, signUp, type TestUser } from '../../../test/helpers/users.ts';
import { idempotencyKeys, transactions } from '../../db/schema/index.ts';
import { IDEMPOTENCY_TTL_MS } from '../../shared/http/idempotency.ts';
import type { CategoryDto } from '../categories/categories.schemas.ts';
import type { CreditCardDto } from '../credit-cards/credit-cards.schemas.ts';
import type { InvoiceDto } from './invoices.schemas.ts';

// Hoje é 15/11/2026: a fatura de 11/2026 do cartão (fechamento 5, vencimento 12) está vencida.
describe('pagamento de fatura com Idempotency-Key', () => {
  let app: FastifyInstance;
  let user: TestUser;
  let card: CreditCardDto;

  beforeAll(async () => {
    app = await createTestApp({ today: '2026-11-15' });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    user = await signUp(app);
    const account = await createAccount(user, { initialBalance: 100_000 });
    card = (
      await user.api('POST', '/v1/credit-cards', {
        name: 'Roxinho',
        brand: 'mastercard',
        lastFourDigits: '4321',
        creditLimit: 500_000,
        closingDay: 5,
        dueDay: 12,
        paymentAccountId: account.id,
        color: '#6a1b9a',
      })
    ).json<CreditCardDto>();
    const food = (await user.api('GET', '/v1/categories?type=expense'))
      .json<CategoryDto[]>()
      .find((category) => category.name === 'Alimentação')!;
    for (const [amount, date] of [
      [20_000, '2026-10-20'],
      [15_050, '2026-11-04'],
    ] as const) {
      await user.api('POST', '/v1/transactions', {
        type: 'expense',
        description: 'Compra',
        amount,
        date,
        creditCardId: card.id,
        categoryId: food.id,
      });
    }
  });

  const pay = (key?: string, month = '2026-11', who = user) =>
    app.inject({
      method: 'POST',
      url: `/v1/credit-cards/${card.id}/invoices/${month}/payment`,
      cookies: who.cookies,
      ...(key && { headers: { 'idempotency-key': key } }),
    });

  const payments = async () =>
    app.db
      .select()
      .from(transactions)
      .where(and(eq(transactions.userId, user.userId), eq(transactions.type, 'invoice-payment')));

  it('repetir com a mesma chave devolve o mesmo pagamento, sem pagar de novo', async () => {
    const first = await pay('chave-pagamento-1');
    const retry = await pay('chave-pagamento-1');

    expect(first.statusCode).toBe(201);
    expect(first.headers['idempotent-replayed']).toBeUndefined();
    expect(retry.statusCode).toBe(201);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(retry.json<InvoiceDto>()).toEqual(first.json<InvoiceDto>());
    expect(await payments()).toHaveLength(1);
  });

  it('sem a chave, a repetição continua sendo recusada (fatura já paga)', async () => {
    expect((await pay()).statusCode).toBe(201);

    expect((await pay()).statusCode).toBe(409);
    expect(await payments()).toHaveLength(1);
  });

  it('a mesma chave numa requisição diferente responde 422', async () => {
    expect((await pay('chave-reaproveitada')).statusCode).toBe(201);

    const response = await pay('chave-reaproveitada', '2026-10');

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      status: 422,
      detail: expect.stringContaining('outra requisição') as unknown,
    });
  });

  it('a mesma chave com outro valor responde 422, sem pagar de novo', async () => {
    const payPart = (amount: number) =>
      app.inject({
        method: 'POST',
        url: `/v1/credit-cards/${card.id}/invoices/2026-11/payment`,
        cookies: user.cookies,
        headers: { 'idempotency-key': 'chave-com-valor' },
        payload: { amount },
      });
    expect((await payPart(10_000)).statusCode).toBe(201);

    expect((await payPart(10_000)).headers['idempotent-replayed']).toBe('true');
    expect((await payPart(5_000)).statusCode).toBe(422);
    expect(await payments()).toHaveLength(1);
  });

  it('uma falha não fica guardada: a mesma chave pode ser usada de novo', async () => {
    // A fatura de 12/2026 ainda está aberta: o pagamento é recusado e a reserva da chave, desfeita.
    expect((await pay('chave-apos-falha', '2026-12')).statusCode).toBe(409);

    const stored = await app.db
      .select()
      .from(idempotencyKeys)
      .where(eq(idempotencyKeys.userId, user.userId));
    expect(stored).toEqual([]);
  });

  it('responde 409 enquanto a primeira requisição com a chave ainda está em andamento', async () => {
    // Reserva sem resposta gravada: a primeira requisição ainda não terminou.
    await app.db.insert(idempotencyKeys).values({
      userId: user.userId,
      key: 'chave-em-andamento',
      requestHash: createHash('sha256')
        .update(`POST /v1/credit-cards/${card.id}/invoices/2026-11/payment null`)
        .digest('hex'),
    });

    const response = await pay('chave-em-andamento');

    expect(response.statusCode).toBe(409);
    expect(await payments()).toHaveLength(0);
  });

  it('a chave é de cada pessoa e vence depois de 24 horas', async () => {
    const other = await signUp(app);
    expect((await pay('chave-de-cada-um')).statusCode).toBe(201);
    // Outra pessoa com a mesma chave: não recebe a resposta guardada (o cartão não é dela).
    expect((await pay('chave-de-cada-um', '2026-11', other)).statusCode).toBe(404);

    await app.db
      .update(idempotencyKeys)
      .set({ createdAt: new Date(Date.now() - IDEMPOTENCY_TTL_MS - 60_000) })
      .where(
        and(eq(idempotencyKeys.userId, user.userId), eq(idempotencyKeys.key, 'chave-de-cada-um')),
      );

    // Vencida: a operação roda de novo (e a fatura já está paga).
    expect((await pay('chave-de-cada-um')).statusCode).toBe(409);
  });
});
