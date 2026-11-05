import {
  hash,
  parseOptions,
  verify,
  type Algorithm,
  type Options,
  type Version,
} from '@node-rs/argon2';

/** `Algorithm.Argon2id` e `Version.V0x13`: são `const enum` da biblioteca, sem valor em runtime. */
const ARGON2ID = 2 as Algorithm;
const ARGON2_VERSION_0X13 = 1 as Version;

/**
 * Parâmetros do Argon2id: a configuração mínima recomendada pela OWASP (19 MiB de memória,
 * 2 passadas, 1 thread). Ao aumentá-los, os hashes antigos são refeitos no próximo login.
 */
export const PASSWORD_HASH_OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const satisfies Options;

export interface PasswordVerification {
  valid: boolean;
  /** A senha confere, mas o hash usa parâmetros antigos: grave um novo com `hashPassword`. */
  needsRehash: boolean;
}

/** Gera o hash da senha no formato PHC (`$argon2id$v=19$m=...`), com salt aleatório. */
export function hashPassword(password: string): Promise<string> {
  return hash(password, PASSWORD_HASH_OPTIONS);
}

/** Confere a senha com o hash guardado (comparação em tempo constante) e avisa se precisa refazer. */
export async function verifyPassword(
  passwordHash: string,
  password: string,
): Promise<PasswordVerification> {
  const valid = await verify(passwordHash, password);
  return { valid, needsRehash: valid && usesOutdatedParameters(passwordHash) };
}

function usesOutdatedParameters(passwordHash: string): boolean {
  const current = parseOptions(passwordHash);
  return (
    current.algorithm !== PASSWORD_HASH_OPTIONS.algorithm ||
    current.version !== ARGON2_VERSION_0X13 ||
    current.memoryCost !== PASSWORD_HASH_OPTIONS.memoryCost ||
    current.timeCost !== PASSWORD_HASH_OPTIONS.timeCost ||
    current.parallelism !== PASSWORD_HASH_OPTIONS.parallelism ||
    current.outputLen !== PASSWORD_HASH_OPTIONS.outputLen
  );
}
