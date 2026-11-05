import { hash, type Algorithm } from '@node-rs/argon2';
import { describe, expect, it } from 'vitest';
import { PASSWORD_HASH_OPTIONS, hashPassword, verifyPassword } from './password.ts';

const PASSWORD = 'senha-de-teste-123';

describe('hashPassword', () => {
  it('gera hash Argon2id com os parâmetros atuais e salt aleatório', async () => {
    const first = await hashPassword(PASSWORD);
    const second = await hashPassword(PASSWORD);

    expect(first).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(first).not.toContain(PASSWORD);
    expect(first).not.toBe(second);
  });
});

describe('verifyPassword', () => {
  it('aceita a senha correta sem pedir rehash', async () => {
    const passwordHash = await hashPassword(PASSWORD);

    await expect(verifyPassword(passwordHash, PASSWORD)).resolves.toEqual({
      valid: true,
      needsRehash: false,
    });
  });

  it('recusa senha errada, inclusive com diferença só de caixa', async () => {
    const passwordHash = await hashPassword(PASSWORD);

    await expect(verifyPassword(passwordHash, 'outra-senha-456')).resolves.toEqual({
      valid: false,
      needsRehash: false,
    });
    await expect(verifyPassword(passwordHash, PASSWORD.toUpperCase())).resolves.toMatchObject({
      valid: false,
    });
  });

  it('pede rehash quando o hash usa parâmetros antigos', async () => {
    const weaker = await hash(PASSWORD, {
      ...PASSWORD_HASH_OPTIONS,
      memoryCost: 8_192,
      timeCost: 1,
    });

    await expect(verifyPassword(weaker, PASSWORD)).resolves.toEqual({
      valid: true,
      needsRehash: true,
    });
  });

  it('pede rehash quando o hash usa outro algoritmo', async () => {
    // Algorithm.Argon2i (const enum sem valor em runtime).
    const argon2i = await hash(PASSWORD, { ...PASSWORD_HASH_OPTIONS, algorithm: 1 as Algorithm });

    await expect(verifyPassword(argon2i, PASSWORD)).resolves.toEqual({
      valid: true,
      needsRehash: true,
    });
  });

  it('não pede rehash quando a senha está errada', async () => {
    const weaker = await hash(PASSWORD, { ...PASSWORD_HASH_OPTIONS, timeCost: 1 });

    await expect(verifyPassword(weaker, 'outra-senha-456')).resolves.toEqual({
      valid: false,
      needsRehash: false,
    });
  });
});
