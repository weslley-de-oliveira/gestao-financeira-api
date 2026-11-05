import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    // Um Postgres (Testcontainers) para toda a execução: sobe antes dos testes e para no fim.
    globalSetup: ['./test/global-setup.ts'],
    // Subir o contêiner na primeira vez inclui baixar a imagem.
    hookTimeout: 120_000,
    testTimeout: 10_000,
    restoreMocks: true,
  },
});
