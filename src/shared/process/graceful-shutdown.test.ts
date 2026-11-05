import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { createTestApp } from '../../../test/helpers/app.ts';
import { registerGracefulShutdown, type GracefulShutdown } from './graceful-shutdown.ts';

/** Eventos em que o close-with-grace instala listeners no processo. */
const PROCESS_EVENTS = [
  'SIGHUP',
  'SIGINT',
  'SIGQUIT',
  'SIGTERM',
  'SIGUSR2',
  'uncaughtException',
  'unhandledRejection',
  'beforeExit',
] as const;

describe('registerGracefulShutdown', () => {
  let app: FastifyInstance | undefined;
  let shutdown: GracefulShutdown | undefined;
  let listenersBefore: Map<string, unknown[]>;
  let exit: MockInstance<typeof process.exit>;

  beforeEach(() => {
    // O close-with-grace termina com process.exit: aqui só registramos o código de saída.
    exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    listenersBefore = new Map(PROCESS_EVENTS.map((event) => [event, process.listeners(event)]));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    shutdown?.uninstall();
    // Depois de encerrar, a biblioteca deixa listeners para um segundo sinal; remove os que criou.
    for (const event of PROCESS_EVENTS) {
      const before = listenersBefore.get(event) ?? [];
      for (const listener of process.listeners(event)) {
        if (!before.includes(listener)) {
          process.removeListener(event, listener as (...args: unknown[]) => void);
        }
      }
    }
    await app?.close();
    app = undefined;
    shutdown = undefined;
  });

  it('fecha o servidor e o pool do banco e sai com código 0', async () => {
    app = await createTestApp();
    await app.listen({ host: '127.0.0.1', port: 0 });
    await app.inject({ method: 'GET', url: '/ready' });
    shutdown = registerGracefulShutdown(app);

    shutdown.close();

    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
    expect(app.server.listening).toBe(false);
    // Pool encerrado: novas consultas falham.
    await expect(app.db.execute(sql`select 1`)).rejects.toThrow();
  });

  it('sai com código 1 quando o encerramento passa do prazo', async () => {
    app = await createTestApp();
    // Simula um encerramento lento (ex.: requisição em andamento que não termina).
    vi.spyOn(app, 'close').mockReturnValue(
      new Promise((resolve) => setTimeout(resolve, 500)) as never,
    );
    shutdown = registerGracefulShutdown(app, 50);

    shutdown.close();

    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
  });
});
