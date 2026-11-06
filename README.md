# Gestão Financeira — API

API REST que serve o front [Gestão Financeira](https://github.com/weslley-de-oliveira/gestao-financeira): autenticação, contas, categorias, transações, cartões, faturas, orçamentos, metas e dashboard. Projeto de portfólio: use apenas dados fictícios.

O plano completo (etapas, commits e decisões) está em `gestao-financeira-docs/docs/PLANO_API_NODE.md`.

## Stack

| Tecnologia                                              | Uso                                                              |
| ------------------------------------------------------- | ---------------------------------------------------------------- |
| Node.js 26                                              | Runtime; executa o TypeScript direto (remoção de tipos)          |
| TypeScript 6                                            | Strict, só sintaxe apagável                                      |
| [Fastify 5](https://fastify.dev)                        | Servidor HTTP, plugins e hooks                                   |
| [Zod 4](https://zod.dev) + `fastify-type-provider-zod`  | Validação de entrada, filtro de saída e geração do OpenAPI       |
| [Drizzle ORM](https://orm.drizzle.team) + PostgreSQL 17 | Banco, consultas tipadas e migrações SQL                         |
| Argon2id (`@node-rs/argon2`)                            | Hash de senhas                                                   |
| `@fastify/swagger` + Scalar                             | OpenAPI 3.1 e referência interativa em `/docs`                   |
| [Vitest](https://vitest.dev) + Testcontainers           | Testes de integração contra um Postgres real e descartável       |
| Docker, GitHub Container Registry, Render e Neon        | Imagem, publicação e hospedagem (API e banco)                    |
| GitHub Actions, CodeQL e Dependabot                     | CI, análise de segurança do código e atualização de dependências |

## Arquitetura

```text
src/
  server.ts          # entrada: valida o ambiente, aplica migrações (opcional) e abre a porta
  app.ts             # monta a aplicação (plugins e rotas); os testes a usam sem abrir porta
  config/env.ts      # variáveis de ambiente validadas com Zod
  plugins/           # transversais: erros, segurança (helmet, CORS, CSRF), rate limit, banco,
                     # sessão, relógio e documentação
  modules/<recurso>/ # um módulo por recurso:
    *.routes.ts      #   rotas, schemas da requisição/resposta e OpenAPI
    *.schemas.ts     #   schemas Zod e conversão para o formato da API (DTO)
    *.service.ts     #   regras de negócio, sem conhecer HTTP (lança DomainError)
    *.repository.ts  #   acesso ao banco (Drizzle), sempre filtrando pelo dono
  db/                # cliente, schema (uma tabela por arquivo), migrações SQL e seed da demo
  shared/            # utilitários de domínio (dinheiro, datas) e de HTTP (paginação, ETag,
                     # idempotência, Problem Details)
test/                # Postgres de teste, helpers e testes que cruzam módulos (isolamento, ETag)
```

- **Isolamento entre usuários:** toda consulta filtra pelo usuário da sessão; o recurso de outra pessoa responde 404, como um id que não existe (`test/isolation-matrix.test.ts` cobre cada rota com id).
- **Regras iguais às do front:** saldos, faturas, orçamentos e metas seguem as mesmas regras do front, com testes de paridade (`*.parity.test.ts`); somas grandes são feitas em SQL.
- **Erros:** sempre Problem Details (RFC 9457), com `errors[]` por campo nos 422 e o `x-request-id` para encontrar o log.

## Segurança

- Senhas com Argon2id (rehash automático quando os parâmetros mudam); mesma resposta e tempo para e-mail com e sem conta. A troca de senha (`POST /v1/me/password`) confere a senha atual e encerra as sessões dos outros aparelhos.
- Sessão em cookie `__Host-session` (`HttpOnly`, `Secure`, `SameSite=Lax`); o banco guarda só o SHA-256 do token. Expira por inatividade (7 dias) e por idade (30 dias).
- CSRF: além do `SameSite`, `POST`/`PATCH`/`DELETE` só são aceitos com `Origin` do front (`APP_ORIGIN`), das origens de CORS ou da própria API.
- Rate limit global por IP e específico para login, cadastro e exclusão de conta. Atrás de proxies, o IP do cliente vem do `X-Forwarded-For` (`TRUST_PROXY`).
- Cabeçalhos de segurança (helmet), corpo limitado a 100 kB e logs sem cookies, senhas ou tokens.
- **Produção:** CORS desligado (o front usa a mesma origem), `/docs` desligado por padrão, `APP_ORIGIN` obrigatória; imagem sem dependências de desenvolvimento, com usuário não root; CodeQL, Dependabot e `npm audit` na CI.

## Edições concorrentes e repetições

- **ETag e If-Match:** `GET`, `POST` e `PATCH` de contas, categorias, transações, cartões, orçamentos e metas devolvem `ETag` (a versão do registro) e o campo `updatedAt`, do qual a ETag é derivada (`"<milissegundos do updatedAt>"`): o cliente que leu o registro numa listagem também consegue montar o `If-Match`. Um `PATCH` com `If-Match` só grava se o registro ainda estiver nessa versão; senão, responde **412** e nada muda. Sem `If-Match`, vale a última gravação.
- **Idempotency-Key:** o pagamento de fatura aceita `Idempotency-Key`. Repetir o pedido com a mesma chave em até 24 horas devolve a mesma resposta (`Idempotent-Replayed: true`) sem pagar de novo. A chave reaproveitada em outra requisição responde 422; enquanto a primeira ainda roda, 409. Falhas não ficam guardadas.

## Requisitos

- Node.js 26 (definido em `.nvmrc`) e npm 11
- Docker (Postgres local via Docker Compose e Postgres descartável nos testes, via Testcontainers)

## Como executar

```bash
npm install
cp .env.example .env
npm run db:up        # Postgres 17 na porta 5433
npm run db:migrate   # cria as tabelas
npm run db:seed      # conta de demonstração: demo@exemplo.com / demo1234
npm run dev          # http://127.0.0.1:3333
```

O front, rodando com `npm start` no repositório dele, encaminha `/api` para esta porta.

Com Docker, a mesma imagem de produção:

```bash
docker build -t gestao-financeira-api .
docker run -p 3333:3333 -e APP_ORIGIN=http://localhost:4200 -e MIGRATE_ON_START=true \
  -e DATABASE_URL=postgres://gestao:gestao@host.docker.internal:5433/gestao_financeira \
  gestao-financeira-api
```

## Documentação da API

Com a API rodando em desenvolvimento, a referência interativa (OpenAPI 3.1, gerada dos schemas Zod das rotas) fica em <http://127.0.0.1:3333/docs>. A especificação também é versionada em `openapi.json`: rode `npm run openapi` sempre que alterar uma rota (a CI confere). O front gera os tipos dele a partir desse arquivo.

## Variáveis de ambiente

Copie `.env.example` para `.env` e ajuste os valores. Elas são validadas na inicialização (`src/config/env.ts`): se faltar alguma ou houver valor inválido, a API não sobe e informa quais estão erradas. O `.env` não é versionado.

| Variável             | Padrão               | Uso                                                                   |
| -------------------- | -------------------- | --------------------------------------------------------------------- |
| `NODE_ENV`           | `development`        | `production` liga as regras de produção (CORS, `/docs`, `APP_ORIGIN`) |
| `HOST` / `PORT`      | `127.0.0.1` / `3333` | Endereço do servidor (na imagem, `0.0.0.0`)                           |
| `DATABASE_URL`       | —                    | Conexão do Postgres (obrigatória)                                     |
| `DATABASE_POOL_MAX`  | `10`                 | Conexões no pool                                                      |
| `MIGRATE_ON_START`   | `false`              | Aplica as migrações pendentes antes de abrir a porta                  |
| `APP_ORIGIN`         | vazio                | Endereço público do front (obrigatório em produção)                   |
| `CORS_ORIGINS`       | vazio                | Origens com CORS, separadas por vírgula (só fora de produção)         |
| `TRUST_PROXY`        | `0`                  | Proxies na frente da API (produção: 2, Vercel + Render)               |
| `RATE_LIMIT_ENABLED` | `true`               | Rate limit (só os testes desligam)                                    |
| `DOCS_ENABLED`       | fora de produção     | Referência em `/docs`                                                 |
| `TIME_ZONE`          | `America/Sao_Paulo`  | Fuso do "hoje" nas regras de fatura                                   |
| `LOG_LEVEL`          | `info`               | Nível dos logs (JSON fora de desenvolvimento)                         |

## Testes e CI

- `npm test` sobe um Postgres descartável (Testcontainers), aplica as migrações e roda os testes de integração e unitários.
- **CI** (`.github/workflows/ci.yml`, em PRs e na `main`): `npm audit` das dependências de produção, formatação, lint, typecheck, testes, build e a verificação do `openapi.json`.
- **Imagem** (`image.yml`): monta a imagem e confere o `/health` em todo PR; na `main`, publica no GitHub Container Registry (`sha-<commit>` e `latest`) e pede o deploy ao Render.
- **Demonstração** (`demo-reset.yml`): todo dia, de madrugada em Brasília, roda o seed contra o banco de produção e devolve a conta de demonstração aos dados iniciais. Também pode ser rodado à mão.
- **Monitoramento** (`monitor.yml`): a cada hora, confere pelo site da Vercel o `/api/ready` (tolerando a hibernação) e o login da conta de demonstração. Uma falha deixa a execução vermelha, e o GitHub avisa por e-mail. Workflows agendados param depois de 60 dias sem atividade no repositório: o GitHub avisa antes.
- **CodeQL** (`codeql.yml`) em PRs, na `main` e semanalmente; **Dependabot** (`.github/dependabot.yml`) para npm, GitHub Actions e a imagem base.

## Deploy

A API roda no **Render** (serviço web gratuito, a partir da imagem do GHCR) e o banco no **Neon** (Postgres gratuito, AWS us-east-1, na mesma região do Render). O front, na Vercel, encaminha `/api/*` para o Render: o navegador fala só com a origem do front, e o cookie de sessão é dessa origem.

1. **Neon:** crie o projeto (Postgres 17, região AWS us-east-1) e copie a conexão **direta** (sem `-pooler` no host, com `sslmode=require`): as migrações usam uma trava de sessão que o PgBouncer não mantém.
2. **Imagem:** o merge na `main` publica `ghcr.io/weslley-de-oliveira/gestao-financeira-api`. Na primeira vez, torne o pacote público (GitHub → Packages → gestao-financeira-api → Package settings → Change visibility), para o Render baixá-lo sem credenciais.
3. **Render:** New → Blueprint → este repositório. O `render.yaml` cria o serviço; informe o `DATABASE_URL` do Neon quando o painel pedir. As migrações rodam na subida de cada versão (`MIGRATE_ON_START`): o plano gratuito não tem comando de pré-deploy.
4. **Deploy automático:** copie o Deploy Hook do serviço (Settings → Deploy Hook) para o segredo `RENDER_DEPLOY_HOOK_URL` do repositório (Settings → Secrets and variables → Actions). A cada merge na `main`, a nova imagem é publicada e o deploy, pedido.
5. **Conta de demonstração:** rode o seed uma vez contra o Neon, da sua máquina: `DATABASE_URL="<conexão do Neon>" npm run db:seed`. Para a restauração diária, guarde a mesma conexão no segredo `DEMO_DATABASE_URL` do repositório.
6. **Front:** o `vercel.json` do front faz o `rewrite` de `/api/:path*` para a URL do serviço no Render.

**Limites aceitos:** no plano gratuito, o Render hiberna a API sem uso (a primeira requisição depois disso demora alguns segundos) e o Neon suspende o banco ocioso. O rate limit fica em memória: vale para uma instância só. As migrações precisam ser compatíveis com a versão anterior da API, que continua no ar até a nova ficar saudável.

## Decisões

As decisões de arquitetura estão na seção 11 do plano. Além delas:

- **Migrações na subida** (`MIGRATE_ON_START`), com trava no banco contra duas instâncias migrando ao mesmo tempo: o plano gratuito do Render não tem pré-deploy.
- **`TRUST_PROXY` por número de saltos:** o Fastify 5 recusa esse modo, porque quem chama a API direto pode forjar o `X-Forwarded-For`. Aqui isso afeta só o rate limit de quem contorna a Vercel, e os provedores não publicam faixas de IP fixas para confiar por endereço.
- **ETag pela versão do registro:** valores calculados (saldo, uso do limite, progresso) não mudam a ETag; aportes e retiradas mudam a da meta. A versão tem resolução de milissegundos.

## Padrão de commits

Conventional Commits, validados pelo commitlint no hook `commit-msg`; o hook `pre-commit` roda ESLint e Prettier nos arquivos alterados (lint-staged).

## Scripts

| Script                 | Descrição                                                          |
| ---------------------- | ------------------------------------------------------------------ |
| `npm run dev`          | Executa a API com recarga automática (TypeScript nativo do Node)   |
| `npm run build`        | Compila para `dist/` e copia as migrações                          |
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
