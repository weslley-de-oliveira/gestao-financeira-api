// Gera openapi.json (versionado) a partir dos schemas das rotas. Uso: npm run openapi
// A CI regenera e falha se o arquivo commitado estiver desatualizado.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
import { buildApp } from '../src/app.ts';
import { loadEnv } from '../src/config/env.ts';

// Nenhuma conexão é aberta: o pool do banco só conecta na primeira consulta.
const env = loadEnv({
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DOCS_ENABLED: 'false',
  DATABASE_URL: 'postgres://openapi:openapi@localhost:5432/openapi',
});
const app = await buildApp(env);
await app.ready();

const json = JSON.stringify(app.swagger());
const output = new URL('../openapi.json', import.meta.url);
const prettierConfig = await resolveConfig(fileURLToPath(output));
writeFileSync(output, await format(json, { ...prettierConfig, parser: 'json' }));
await app.close();
console.log('openapi.json atualizado.');
