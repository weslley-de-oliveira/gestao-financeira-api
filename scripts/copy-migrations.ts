// Copia as migrações SQL para dist/, onde a API compilada as procura (src/db/migrate.ts).
// Roda no fim do npm run build.
import { cpSync, rmSync } from 'node:fs';

const target = new URL('../dist/db/migrations', import.meta.url);
rmSync(target, { recursive: true, force: true });
cpSync(new URL('../src/db/migrations', import.meta.url), target, { recursive: true });
