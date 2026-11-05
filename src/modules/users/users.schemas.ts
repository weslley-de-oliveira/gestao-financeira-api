import { z } from 'zod';
import { PASSWORD_MAX_LENGTH, userNameSchema } from '../auth/auth.schemas.ts';

// `strictObject`: campos desconhecidos (ex.: `id`) são rejeitados com 422.
export const updateProfileBodySchema = z.strictObject({
  name: userNameSchema,
  // E-mail e senha não mudam por aqui. Enviá-los é erro, com mensagem clara.
  email: z
    .never('O e-mail não pode ser alterado por aqui.')
    .optional()
    .meta({ description: 'Não aceito: o e-mail não muda por esta rota.' }),
  password: z
    .never('A senha não pode ser alterada por aqui.')
    .optional()
    .meta({ description: 'Não aceito: a senha não muda por esta rota.' }),
});

export type UpdateProfileInput = z.infer<typeof updateProfileBodySchema>;

export const deleteAccountBodySchema = z.strictObject({
  password: z
    .string('Informe a senha atual para confirmar.')
    .min(1, 'Informe a senha atual para confirmar.')
    .max(PASSWORD_MAX_LENGTH, `A senha deve ter no máximo ${PASSWORD_MAX_LENGTH} caracteres.`)
    .meta({ description: 'Senha atual, para confirmar a exclusão.' }),
});

export type DeleteAccountInput = z.infer<typeof deleteAccountBodySchema>;
