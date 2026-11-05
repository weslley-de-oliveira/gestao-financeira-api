import { defineConfig } from 'drizzle-kit';

// O drizzle-kit não lê o .env sozinho: carrega se existir (na CI, a variável vem do ambiente).
try {
  process.loadEnvFile();
} catch {
  // Sem .env: segue com as variáveis do ambiente.
}

const url = process.env['DATABASE_URL'];
if (!url) {
  throw new Error('Defina DATABASE_URL (veja .env.example).');
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './src/db/migrations',
  casing: 'snake_case',
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
