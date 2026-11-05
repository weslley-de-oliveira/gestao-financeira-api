import { createHash, randomBytes } from 'node:crypto';

/** 256 bits de entropia: impossível de adivinhar, mesmo com muitas tentativas. */
const TOKEN_BYTES = 32;

/** Gera o token opaco da sessão (vai só no cookie, em base64url). */
export function generateSessionToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/**
 * SHA-256 do token, em hex: é o que fica no banco. Não precisa de salt nem de hash lento, porque o
 * token já é aleatório e longo (ao contrário de uma senha).
 */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
