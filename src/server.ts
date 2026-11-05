import { buildApp } from './app.ts';
import { loadEnv } from './config/env.ts';

// Ponto de entrada: valida o ambiente, cria a aplicação e abre a porta.
const env = loadEnv();
const app = await buildApp(env);

await app.listen({ host: env.HOST, port: env.PORT });
