# Gestão Financeira — API

API REST que serve o front [Gestão Financeira](https://github.com/weslley-de-oliveira/gestao-financeira): autenticação, contas, categorias, transações, cartões, faturas, orçamentos e metas.

> **Status:** em desenvolvimento (etapa 0 — fundação). O plano completo está em `gestao-financeira-docs/docs/PLANO_API_NODE.md`.

## Padrão de commits

Conventional Commits, validados pelo commitlint no hook `commit-msg`; o hook `pre-commit` roda ESLint e Prettier nos arquivos alterados (lint-staged).

## Integração contínua

O workflow `.github/workflows/ci.yml` roda em todo pull request e em pushes na `main`: formatação, lint, typecheck, testes (Postgres via Testcontainers no Docker do runner), build e a verificação de que o `openapi.json` está atualizado.

## Requisitos

- Node.js 26 (definido em `.nvmrc`)
- npm 11
- Docker (Postgres local via Docker Compose e Postgres descartável nos testes, via Testcontainers)

## Como executar

```bash
npm install
cp .env.example .env
npm run db:up      # Postgres 17 na porta 5433
npm run dev
```

## Documentação da API

Com a API rodando, a referência interativa (OpenAPI 3.1, gerada dos schemas Zod das rotas) fica em <http://127.0.0.1:3333/docs>. A especificação também é versionada em `openapi.json`: rode `npm run openapi` sempre que alterar uma rota. Erros seguem o formato Problem Details (RFC 9457).

## Variáveis de ambiente

Copie `.env.example` para `.env` e ajuste os valores. Elas são validadas na inicialização (`src/config/env.ts`): se faltar alguma ou houver valor inválido, a API não sobe e informa quais estão erradas. O `.env` não é versionado.

## Scripts

| Script                 | Descrição                                                          |
| ---------------------- | ------------------------------------------------------------------ |
| `npm run dev`          | Executa a API com recarga automática (TypeScript nativo do Node)   |
| `npm run build`        | Compila para `dist/`                                               |
| `npm start`            | Executa a versão compilada                                         |
| `npm run typecheck`    | Verifica os tipos sem gerar arquivos                               |
| `npm test`             | Roda os testes (Vitest) contra um Postgres no Testcontainers       |
| `npm run test:watch`   | Roda os testes em modo observação                                  |
| `npm run openapi`      | Regenera o `openapi.json` a partir das rotas                       |
| `npm run db:up`        | Sobe o Postgres local (Docker Compose) e espera ficar pronto       |
| `npm run db:down`      | Para o Postgres local (os dados ficam no volume)                   |
| `npm run db:generate`  | Gera uma migração SQL a partir das mudanças no schema              |
| `npm run db:migrate`   | Aplica as migrações pendentes                                      |
| `npm run db:studio`    | Abre o Drizzle Studio para inspecionar o banco                     |
| `npm run db:seed`      | Cria a demo (`demo@exemplo.com` / `demo1234`) com 6 meses de dados |
| `npm run lint`         | Executa o ESLint (com regras que usam os tipos)                    |
| `npm run format`       | Formata o código com Prettier                                      |
| `npm run format:check` | Verifica a formatação sem alterar arquivos                         |
