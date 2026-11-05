import fp from 'fastify-plugin';
import { createDatabase, type Database } from '../db/client.ts';

declare module 'fastify' {
  interface FastifyInstance {
    /** Cliente Drizzle compartilhado; os repositórios dos módulos o recebem por parâmetro. */
    db: Database;
  }
}

export interface DatabaseOptions {
  url: string;
  maxConnections: number;
}

/** Disponibiliza o banco como `app.db` e fecha o pool quando a aplicação encerra. */
export const databasePlugin = fp<DatabaseOptions>(
  (app, { url, maxConnections }, done) => {
    const { db, pool } = createDatabase(url, maxConnections);
    pool.on('error', (error) => app.log.error({ err: error }, 'erro numa conexão ociosa do banco'));

    app.decorate('db', db);
    app.addHook('onClose', async () => {
      await pool.end();
    });
    done();
  },
  { name: 'database' },
);
