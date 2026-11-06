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

describe('TRUST_PROXY', () => {
  it('não confia em proxies por padrão', () => {
    expect(loadEnv(required).TRUST_PROXY).toBe(0);
  });

  it('aceita o número de proxies na frente da API', () => {
    expect(loadEnv({ ...required, TRUST_PROXY: '2' }).TRUST_PROXY).toBe(2);
  });

  it('impede a API de subir com valor inválido', () => {
    expect(() => loadEnv({ ...required, TRUST_PROXY: 'true' })).toThrow(InvalidEnvError);
  });
});
