# Gestão Financeira — API

API REST que serve o front [Gestão Financeira](https://github.com/weslley-de-oliveira/gestao-financeira): autenticação, contas, categorias, transações, cartões, faturas, orçamentos e metas.

> **Status:** em desenvolvimento (etapa 0 — fundação). O plano completo está em `gestao-financeira-docs/docs/PLANO_API_NODE.md`.

## Padrão de commits

Conventional Commits, validados pelo commitlint no hook `commit-msg`; o hook `pre-commit` roda ESLint e Prettier nos arquivos alterados (lint-staged).

## Requisitos

- Node.js 26 (definido em `.nvmrc`)
- npm 11

## Como executar

```bash
npm install
npm run dev
```

## Scripts

| Script                 | Descrição                                                        |
| ---------------------- | ---------------------------------------------------------------- |
| `npm run dev`          | Executa a API com recarga automática (TypeScript nativo do Node) |
| `npm run build`        | Compila para `dist/`                                             |
| `npm start`            | Executa a versão compilada                                       |
| `npm run typecheck`    | Verifica os tipos sem gerar arquivos                             |
| `npm run lint`         | Executa o ESLint (com regras que usam os tipos)                  |
| `npm run format`       | Formata o código com Prettier                                    |
| `npm run format:check` | Verifica a formatação sem alterar arquivos                       |
