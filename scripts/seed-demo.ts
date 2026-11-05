// Cria (ou recria) a pessoa da demo, com seis meses de dados até o mês atual. Uso: npm run db:seed
// Login: demo@exemplo.com / demo1234. Rodar de novo apaga a demo anterior e cria tudo de novo.
import { createDatabase } from '../src/db/client.ts';
import { DEMO_CREDENTIALS, seedDemo } from '../src/db/seed/demo-seed.ts';
import { loadEnv } from '../src/config/env.ts';
import { todayIn } from '../src/shared/utils/today.ts';

const env = loadEnv();
const { db, pool } = createDatabase(env.DATABASE_URL, 1);
try {
  const summary = await seedDemo(db, todayIn(env.TIME_ZONE));
  console.log(
    `Demo criada: ${summary.accounts} contas, ${summary.categories} categorias, ${summary.creditCards} cartões, ${summary.transactions} transações, ${summary.budgets} orçamentos e ${summary.goals} metas.`,
  );
  console.log(`Login: ${DEMO_CREDENTIALS.email} / ${DEMO_CREDENTIALS.password}`);
} finally {
  await pool.end();
}
