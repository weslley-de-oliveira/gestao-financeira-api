import { z } from 'zod';
import { userNameSchema } from '../auth/auth.schemas.ts';

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
