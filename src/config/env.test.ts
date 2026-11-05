import { describe, expect, it } from 'vitest';
import { InvalidEnvError, loadEnv } from './env.ts';

const required = { DATABASE_URL: 'postgres://gestao:gestao@localhost:5433/gestao_financeira' };

describe('TIME_ZONE', () => {
  it('usa o fuso de Brasília por padrão', () => {
    expect(loadEnv(required).TIME_ZONE).toBe('America/Sao_Paulo');
  });

  it('aceita outro fuso IANA', () => {
    expect(loadEnv({ ...required, TIME_ZONE: 'UTC' }).TIME_ZONE).toBe('UTC');
  });

  it('impede a API de subir com fuso inválido', () => {
    expect(() => loadEnv({ ...required, TIME_ZONE: 'Brasil/Sao_Paulo' })).toThrow(InvalidEnvError);
  });
});
