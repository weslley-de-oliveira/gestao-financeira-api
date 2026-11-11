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
    // Só em `npm run test:coverage` (CI). Os limites ficam 5 pontos abaixo do medido na etapa 17:
    // avisam quando a cobertura cai, sem travar um PR por detalhe.
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      reporter: ['text-summary', 'json-summary', 'html'],
      thresholds: { statements: 91, branches: 83, functions: 91, lines: 91 },
    },
  },
});
