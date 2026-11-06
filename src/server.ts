import { buildApp } from './app.ts';
import { loadEnv } from './config/env.ts';
import { runMigrations } from './db/migrate.ts';
import { registerGracefulShutdown } from './shared/process/graceful-shutdown.ts';

// Ponto de entrada: valida o ambiente, cria a aplicação e abre a porta.
const env = loadEnv();
if (env.MIGRATE_ON_START) {
  await runMigrations(env.DATABASE_URL);
}
const app = await buildApp(env);

registerGracefulShutdown(app);
await app.listen({ host: env.HOST, port: env.PORT });
