import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../../test/helpers/app.ts';

interface Spec {
  paths: Record<
    string,
    Record<string, { requestBody?: { required: boolean; content: Record<string, unknown> } }>
  >;
}

describe('especificação OpenAPI', () => {
  let app: FastifyInstance;
  let spec: Spec;

  beforeAll(async () => {
    app = await createTestApp();
    spec = app.swagger() as unknown as Spec;
  });

  afterAll(async () => {
    await app.close();
  });

  it('corpo opcional (nullish) sai como requestBody não obrigatório, sem o ramo null', () => {
    const { requestBody } = spec.paths['/v1/credit-cards/{id}/invoices/{month}/payment']!['post']!;

    expect(requestBody).toEqual({
      required: false,
      content: {
        'application/json': { schema: { $ref: '#/components/schemas/PayInvoiceInput' } },
      },
    });
  });

  it('os demais corpos continuam obrigatórios', () => {
    expect(spec.paths['/v1/accounts']!['post']!.requestBody?.required).toBe(true);
  });
});
