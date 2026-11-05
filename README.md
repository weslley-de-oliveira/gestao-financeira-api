# Gestão Financeira — API

API REST que serve o front [Gestão Financeira](https://github.com/weslley-de-oliveira/gestao-financeira): autenticação, contas, categorias, transações, cartões, faturas, orçamentos e metas.

> **Status:** em desenvolvimento (etapa 0 — fundação). O plano completo está em `gestao-financeira-docs/docs/PLANO_API_NODE.md`.

## Requisitos

- Node.js 26 (definido em `.nvmrc`)
- npm 11

## Como executar

```bash
npm install
npm run dev
```

## Scripts

| Script              | Descrição                                                    |
| ------------------- | ------------------------------------------------------------ |
| `npm run dev`       | Executa a API com recarga automática (TypeScript nativo do Node) |
| `npm run build`     | Compila para `dist/`                                         |
| `npm start`         | Executa a versão compilada                                   |
| `npm run typecheck` | Verifica os tipos sem gerar arquivos                         |
