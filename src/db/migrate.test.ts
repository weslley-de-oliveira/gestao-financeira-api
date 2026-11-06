import { describe, expect, inject, it } from 'vitest';
import { createDatabase } from './client.ts';
import { runMigrations } from './migrate.ts';

describe('runMigrations', () => {
  it('não reaplica migrações e aguarda a trava quando duas instâncias sobem juntas', async () => {
    const databaseUrl = inject('databaseUrl');
    const { pool } = createDatabase(databaseUrl, 1);
    const count = async () =>
      Number(
        (
          await pool.query<{ total: string }>(
            'select count(*) as total from drizzle.__drizzle_migrations',
          )
        ).rows[0]?.total,
      );
    try {
      const before = await count();

      await Promise.all([runMigrations(databaseUrl), runMigrations(databaseUrl)]);

      expect(before).toBeGreaterThan(0);
      expect(await count()).toBe(before);
    } finally {
      await pool.end();
    }
  });
});
