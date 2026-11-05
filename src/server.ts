import { loadEnv } from './config/env.ts';

// Ponto de entrada da API. O servidor HTTP é criado no próximo passo da fundação.
const env = loadEnv();

console.log(`Gestão Financeira API — ${env.NODE_ENV}, porta ${env.PORT}`);
