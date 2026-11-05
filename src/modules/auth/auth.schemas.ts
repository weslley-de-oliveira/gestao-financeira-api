import { z } from 'zod';
import type { User } from '../../db/schema/index.ts';

export const USER_NAME_MAX_LENGTH = 80;
export const EMAIL_MAX_LENGTH = 254;
export const PASSWORD_MIN_LENGTH = 8;
/** Limite superior para não gastar CPU com senhas gigantes no Argon2. */
export const PASSWORD_MAX_LENGTH = 128;

/** Ao menos uma letra e um número (mesma regra do cadastro do front). */
const PASSWORD_PATTERN = /^(?=.*\p{L})(?=.*\d).+$/u;

/** E-mail sem espaços nas pontas e em minúsculas, como o front normaliza. */
const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(EMAIL_MAX_LENGTH, `O e-mail deve ter no máximo ${EMAIL_MAX_LENGTH} caracteres.`)
  .pipe(z.email('Informe um e-mail válido.'))
  .meta({ format: 'email', example: 'pessoa@exemplo.com' });

const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `A senha deve ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`)
  .max(PASSWORD_MAX_LENGTH, `A senha deve ter no máximo ${PASSWORD_MAX_LENGTH} caracteres.`)
  .regex(PASSWORD_PATTERN, 'A senha deve conter pelo menos uma letra e um número.')
  .meta({ example: 'senha1234' });

// `strictObject`: campos desconhecidos (ex.: `id`, `passwordHash`) são rejeitados com 422.
export const registerBodySchema = z.strictObject({
  name: z
    .string()
    .trim()
    .min(1, 'Informe o nome.')
    .max(USER_NAME_MAX_LENGTH, `O nome deve ter no máximo ${USER_NAME_MAX_LENGTH} caracteres.`)
    .meta({ example: 'Pessoa de Exemplo' }),
  email: emailSchema,
  password: passwordSchema,
});

export type RegisterInput = z.infer<typeof registerBodySchema>;

// No login, a senha não é validada contra as regras de cadastro: só presença e tamanho máximo.
export const loginBodySchema = z.strictObject({
  email: emailSchema,
  password: z
    .string()
    .min(1, 'Informe a senha.')
    .max(PASSWORD_MAX_LENGTH, `A senha deve ter no máximo ${PASSWORD_MAX_LENGTH} caracteres.`)
    .meta({ example: 'senha1234' }),
});

export type LoginInput = z.infer<typeof loginBodySchema>;

/** Usuário como a API devolve: nunca inclui o hash da senha. */
export const userSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    email: z.string(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'User' });

export type UserDto = z.infer<typeof userSchema>;

export function toUserDto(user: User): UserDto {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    createdAt: user.createdAt.toISOString(),
  };
}
