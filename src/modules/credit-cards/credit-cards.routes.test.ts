import { randomUUIDv7 } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../../../test/helpers/app.ts';
import { createAccount, signUp, type TestUser } from '../../../test/helpers/users.ts';
import { creditCards } from '../../db/schema/index.ts';
import type { CreditCardDto } from './credit-cards.schemas.ts';

describe('rotas /v1/credit-cards', () => {
  let app: FastifyInstance;
  let user: TestUser;
  let account: { id: string; name: string };

  beforeAll(async () => {
    app = await createTestApp();
    user = await signUp(app);
    account = await createAccount(user);
  });

  afterAll(async () => {
    await app.close();
  });

  const validCard = (overrides: Record<string, unknown> = {}) => ({
    name: 'Roxinho',
    brand: 'mastercard',
    lastFourDigits: '4321',
    creditLimit: 500_000,
    closingDay: 5,
    dueDay: 12,
    paymentAccountId: account.id,
    color: '#6a1b9a',
    ...overrides,
  });

  async function createCard(
    owner: TestUser = user,
    overrides: Record<string, unknown> = {},
  ): Promise<CreditCardDto> {
    const response = await owner.api('POST', '/v1/credit-cards', validCard(overrides));
    expect(response.statusCode).toBe(201);
    return response.json<CreditCardDto>();
  }

  const names = (response: LightMyRequestResponse) =>
    response.json<CreditCardDto[]>().map((card) => card.name);

  function expectInvalid(response: LightMyRequestResponse, field: string, message: string) {
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ errors: [{ field, message }] });
  }

  async function stored(id: string) {
    const [card] = await app.db.select().from(creditCards).where(eq(creditCards.id, id));
    return card;
  }

  describe('POST /v1/credit-cards', () => {
    it('cadastra o cartão do usuário da sessão, ativo', async () => {
      const response = await user.api(
        'POST',
        '/v1/credit-cards',
        validCard({ name: '  Roxinho   novo ' }),
      );

      expect(response.statusCode).toBe(201);
      const body = response.json<CreditCardDto>();
      expect(body).toEqual({
        ...validCard({ name: 'Roxinho novo' }),
        id: expect.any(String) as unknown,
        isArchived: false,
        createdAt: expect.any(String) as unknown,
        updatedAt: expect.any(String) as unknown,
        // Sem compras: nada usado e a próxima fatura vazia.
        usedLimit: 0,
        availableLimit: 500_000,
        nextInvoice: expect.objectContaining({ amount: 0 }) as unknown,
      });
      expect((await stored(body.id))?.userId).toBe(user.userId);
    });

    it.each([
      ['apelido vazio', { name: '  ' }, 'body.name', 'Informe o apelido do cartão.'],
      [
        'apelido com mais de 40 caracteres',
        { name: 'a'.repeat(41) },
        'body.name',
        'O apelido deve ter no máximo 40 caracteres.',
      ],
      ['bandeira desconhecida', { brand: 'diners' }, 'body.brand', 'Selecione a bandeira.'],
      [
        'número completo do cartão',
        { lastFourDigits: '4111111111111111' },
        'body.lastFourDigits',
        'Informe exatamente quatro números.',
      ],
      [
        'dígitos com letra',
        { lastFourDigits: '12a4' },
        'body.lastFourDigits',
        'Informe exatamente quatro números.',
      ],
      ['limite zero', { creditLimit: 0 }, 'body.creditLimit', 'O limite deve ser maior que zero.'],
      [
        'limite fracionado',
        { creditLimit: 10.5 },
        'body.creditLimit',
        'Informe o limite em centavos inteiros.',
      ],
      ['fechamento no dia 0', { closingDay: 0 }, 'body.closingDay', 'Informe um dia entre 1 e 31.'],
      ['vencimento no dia 32', { dueDay: 32 }, 'body.dueDay', 'Informe um dia entre 1 e 31.'],
      [
        'fechamento e vencimento no mesmo dia',
        { closingDay: 10, dueDay: 10 },
        'body.dueDay',
        'O vencimento deve ser diferente do fechamento.',
      ],
      [
        'sem conta de pagamento',
        { paymentAccountId: undefined },
        'body.paymentAccountId',
        'Selecione a conta de pagamento.',
      ],
      ['cor fora da paleta', { color: '#000000' }, 'body.color', 'Selecione uma cor válida.'],
    ])('responde 422 para %s', async (_case, overrides, field, message) => {
      expectInvalid(
        await user.api('POST', '/v1/credit-cards', validCard(overrides)),
        field,
        message,
      );
    });

    it('aceita os dias 29 a 31 (em meses curtos, vale o último dia)', async () => {
      const card = await createCard(user, { closingDay: 31, dueDay: 29 });

      expect(card).toMatchObject({ closingDay: 31, dueDay: 29 });
    });

    it.each([['userId'], ['id'], ['isArchived'], ['cardNumber']])(
      'responde 422 se o corpo trouxer %s',
      async (field) => {
        const value = field === 'isArchived' ? true : randomUUIDv7();
        const response = await user.api('POST', '/v1/credit-cards', validCard({ [field]: value }));

        expect(response.statusCode).toBe(422);
      },
    );

    it('trata conta de pagamento de outro usuário como inexistente', async () => {
      const other = await signUp(app);
      const otherAccount = await createAccount(other);

      expectInvalid(
        await user.api(
          'POST',
          '/v1/credit-cards',
          validCard({ paymentAccountId: otherAccount.id }),
        ),
        'body.paymentAccountId',
        'Conta não encontrada.',
      );
    });

    it('responde 409 para conta de pagamento arquivada', async () => {
      const archived = await createAccount(user, { name: 'Antiga' });
      await user.api('PATCH', `/v1/accounts/${archived.id}`, { isArchived: true });

      const response = await user.api(
        'POST',
        '/v1/credit-cards',
        validCard({ paymentAccountId: archived.id }),
      );

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        detail:
          'A conta "Antiga" está arquivada. Reative-a ou escolha outra para pagar as faturas.',
      });
    });

    it('responde 401 sem sessão', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/credit-cards',
        payload: validCard(),
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('GET /v1/credit-cards', () => {
    it('lista os ativos do usuário em ordem alfabética; com includeArchived, todos', async () => {
      const owner = await signUp(app);
      const ownAccount = await createAccount(owner);
      const own = { paymentAccountId: ownAccount.id };
      await createCard(owner, { ...own, name: 'nubank' });
      await createCard(owner, { ...own, name: 'Álvaro' });
      const archived = await createCard(owner, { ...own, name: 'Antigo' });
      await owner.api('PATCH', `/v1/credit-cards/${archived.id}`, { isArchived: true });

      expect(names(await owner.api('GET', '/v1/credit-cards'))).toEqual(['Álvaro', 'nubank']);
      expect(names(await owner.api('GET', '/v1/credit-cards?includeArchived=true'))).toEqual([
        'Álvaro',
        'Antigo',
        'nubank',
      ]);
    });

    it('detalha o cartão; de outro usuário ou inexistente responde 404 igual', async () => {
      const card = await createCard();
      const other = await signUp(app);

      expect((await user.api('GET', `/v1/credit-cards/${card.id}`)).json()).toEqual({
        ...card,
        updatedAt: expect.any(String) as unknown,
      });
      for (const id of [card.id, randomUUIDv7()]) {
        const response = await other.api('GET', `/v1/credit-cards/${id}`);

        expect(response.statusCode).toBe(404);
        expect(response.json()).toMatchObject({ detail: 'Cartão não encontrado.' });
      }
    });

    it('responde 422 para id que não é UUID', async () => {
      expectInvalid(
        await user.api('GET', '/v1/credit-cards/abc'),
        'params.id',
        'Identificador de cartão inválido.',
      );
    });
  });

  describe('PATCH /v1/credit-cards/:id', () => {
    it('altera só os campos enviados', async () => {
      const card = await createCard();

      const response = await user.api('PATCH', `/v1/credit-cards/${card.id}`, {
        name: 'Roxinho Black',
        creditLimit: 1_000_000,
        dueDay: 20,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<CreditCardDto>();
      expect(body).toMatchObject({
        id: card.id,
        brand: card.brand,
        lastFourDigits: card.lastFourDigits,
        closingDay: card.closingDay,
        paymentAccountId: card.paymentAccountId,
        name: 'Roxinho Black',
        creditLimit: 1_000_000,
        dueDay: 20,
        availableLimit: 1_000_000,
      });
      // A próxima fatura passa a vencer no novo dia.
      expect(body.nextInvoice.dueDate.slice(8)).toBe('20');
    });

    it('não deixa o vencimento cair no dia do fechamento, mesmo trocando só um', async () => {
      const card = await createCard();

      expectInvalid(
        await user.api('PATCH', `/v1/credit-cards/${card.id}`, { closingDay: 12 }),
        'body.dueDay',
        'O vencimento deve ser diferente do fechamento.',
      );
      expect((await stored(card.id))?.closingDay).toBe(5);
    });

    it('arquiva e reativa, sem rota de exclusão', async () => {
      const card = await createCard();

      const archived = await user.api('PATCH', `/v1/credit-cards/${card.id}`, {
        isArchived: true,
      });
      expect(archived.json()).toEqual({
        ...card,
        isArchived: true,
        updatedAt: expect.any(String) as unknown,
      });
      const active = (await user.api('GET', '/v1/credit-cards')).json<CreditCardDto[]>();
      expect(active.map(({ id }) => id)).not.toContain(card.id);
      const reactivated = await user.api('PATCH', `/v1/credit-cards/${card.id}`, {
        isArchived: false,
      });
      expect(reactivated.json()).toEqual({ ...card, updatedAt: expect.any(String) as unknown });

      const deleted = await user.api('DELETE', `/v1/credit-cards/${card.id}`);
      expect(deleted.statusCode).toBe(404);
      expect(await stored(card.id)).toBeDefined();
    });

    it('mantém a conta de pagamento que já tinha, mesmo arquivada; não troca por outra arquivada', async () => {
      const paying = await createAccount(user, { name: 'Pagadora' });
      const card = await createCard(user, { paymentAccountId: paying.id });
      const other = await createAccount(user, { name: 'Outra antiga' });
      await user.api('PATCH', `/v1/accounts/${paying.id}`, { isArchived: true });
      await user.api('PATCH', `/v1/accounts/${other.id}`, { isArchived: true });

      expect(
        (await user.api('PATCH', `/v1/credit-cards/${card.id}`, { name: 'Ainda paga' })).statusCode,
      ).toBe(200);
      const response = await user.api('PATCH', `/v1/credit-cards/${card.id}`, {
        paymentAccountId: other.id,
      });
      expect(response.statusCode).toBe(409);
    });

    it('responde 404 para cartão de outro usuário, sem alterá-lo', async () => {
      const card = await createCard();
      const other = await signUp(app);

      const response = await other.api('PATCH', `/v1/credit-cards/${card.id}`, {
        name: 'Invadido',
      });

      expect(response.statusCode).toBe(404);
      expect((await stored(card.id))?.name).toBe('Roxinho');
    });

    it.each([['userId'], ['lastFourDigits']])('responde 422 para %s inválido', async (field) => {
      const card = await createCard();
      const value = field === 'userId' ? randomUUIDv7() : '1234567890123456';

      expect(
        (await user.api('PATCH', `/v1/credit-cards/${card.id}`, { [field]: value })).statusCode,
      ).toBe(422);
    });
  });
});
