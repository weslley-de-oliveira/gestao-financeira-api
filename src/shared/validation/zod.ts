import { z } from 'zod';

// Mensagens de validação do Zod em português, para todas as rotas. Importado uma vez por `app.ts`.
z.config(z.locales.pt());
