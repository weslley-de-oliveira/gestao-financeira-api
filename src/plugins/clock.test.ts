import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { clockPlugin } from './clock.ts';

async function todayAt(instant: string, timeZone: string): Promise<string> {
  const app = Fastify();
  await app.register(clockPlugin, { timeZone, now: () => new Date(instant) });
  await app.ready();
  const today = app.today();
  await app.close();
  return today;
}

describe('plugin clock', () => {
  it('dá a data de hoje no fuso configurado, não no do servidor', async () => {
    // 23h30 de 05/11 em Brasília já é 06/11 em UTC.
    expect(await todayAt('2026-11-06T02:30:00Z', 'America/Sao_Paulo')).toBe('2026-11-05');
    expect(await todayAt('2026-11-06T02:30:00Z', 'UTC')).toBe('2026-11-06');
  });

  it('usa o relógio real quando não recebe outro', async () => {
    const app = Fastify();
    await app.register(clockPlugin, { timeZone: 'UTC' });
    await app.ready();

    expect(app.today()).toBe(new Date().toISOString().slice(0, 10));
    await app.close();
  });
});
