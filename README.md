# Gestão Financeira — API

API REST que serve o front [Gestão Financeira](https://github.com/weslley-de-oliveira/gestao-financeira): autenticação, contas, categorias, transações, cartões, faturas, orçamentos, metas e dashboard. Projeto de portfólio: use apenas dados fictícios.

As decisões de arquitetura, com o contexto e as alternativas descartadas, estão em [`docs/adr/`](docs/adr/README.md).

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
- **Erros:** sempre Problem Details (RFC 9457), com `errors[]` por campo nos 422 e o `x-request-id` para encontrar o log. Os conflitos que o cliente trata de forma diferente têm `type` próprio: `/problems/paid-invoice` (compra de fatura já paga, ou anterior a uma paga), `/problems/later-invoice-payment` (desfazer pagamento com uma fatura posterior paga), `/problems/archived-reference` (conta, cartão ou categoria arquivada), `/problems/installment` (parcela alterada sozinha) e `/problems/has-refunds` (despesa com estornos).

## Listagem de transações

- **Filtros:** período (`from`/`to`), tipo, status, conta (origem ou destino), cartão, categoria e busca `q` na descrição e nas observações, sem diferenciar acentos.
- **Ordenação:** `sort` por data ou valor, nos dois sentidos, com o mesmo desempate do front (a registrada por último primeiro).
- **Paginação por cursor:** o `nextCursor` guarda a ordenação e a posição do último item, então uma transação nova não desloca a página seguinte. Um cursor de outra ordenação responde 422.
- **Resumo:** `GET /v1/transactions/summary`, com os mesmos filtros, devolve a quantidade, as receitas e despesas realizadas, o resultado e os pendentes, para o front mostrar totais e o número de páginas sem baixar tudo.
- **Uso por categoria:** as categorias trazem `transactionCount`, calculado numa agregação só.

## Compras parceladas

- **Cada parcela é uma compra comum no cartão**, com `installmentGroupId`, `installmentNumber` e `installmentCount`. Assim, fatura, uso do limite, orçamento, totais e dashboard não mudam de regra. O banco garante a forma: os três campos juntos, só em compra no cartão, de 2 a 24 parcelas e um número de cada por compra.
- **Valores e datas** (`modules/installments/installment-plan.ts`): o total é dividido em centavos, com a sobra na 1ª parcela. A 1ª parcela tem a data da compra; as seguintes ficam no mesmo dia, ajustado ao ciclo de cada fatura seguinte, para não errar a fatura perto do fechamento nem nos dias 29 a 31. Um teste de propriedade confere isso para todos os dias de fechamento ao longo de um ano.
- **Consequências:** orçamento e totais contam cada parcela no mês dela, como no extrato do cartão. O limite reserva o total na hora, porque soma todas as compras ainda não pagas.
- **Rotas próprias:**
  - `POST /v1/installment-purchases`, com `Idempotency-Key`: repetir o pedido não duplica as parcelas.
  - `GET`, `PATCH` e `DELETE /v1/installment-purchases/{id}`. O `PATCH` muda só descrição, categoria e observações, em todas as parcelas, inclusive as de faturas pagas, porque esses campos não mudam valores. O `DELETE` recusa (409) se alguma parcela estiver numa fatura paga ou anterior a uma paga.
  - Alterar ou excluir uma parcela sozinha em `/v1/transactions/{id}` responde 409 (`/problems/installment`). Para mudar valor, número de parcelas, cartão ou data, exclua a compra e registre de novo.
- **Antecipar e cancelar** (`modules/installments/installment-actions.ts`), a partir da fatura atual, a que contém hoje:
  - `POST /v1/installment-purchases/{id}/anticipation` (`{ count }`) leva as últimas parcelas para a fatura atual: a data delas passa a ser hoje, sem mudar número nem valor. Só entram as de faturas seguintes e sem estornos. O desconto do banco é registrado como estorno da parcela antecipada.
  - `POST /v1/installment-purchases/{id}/cancellation` estorna o que falta de cada parcela da fatura atual e das futuras ("Cancelamento: …"), na data da parcela ou hoje, se ela já passou. As parcelas de faturas fechadas já foram cobradas e não mudam. Para desfazer, exclua os estornos.
  - As duas aceitam `Idempotency-Key`. A compra informa `anticipatableCount` e `cancellable` (`count` e `amount`), para o cliente mostrar as ações só quando servem.

## Estornos

- **Tipo `refund`**, ligado à despesa estornada (`refundedTransactionId`, chave estrangeira composta com o dono). Leva a conta ou o cartão da despesa e não guarda categoria: usa a da despesa, buscada na consulta.
- **Regras:**
  - Só despesas realizadas recebem estorno, inclusive uma parcela.
  - Pode haver vários estornos, até o valor da despesa, e a data não pode ser anterior à dela.
  - `POST /v1/transactions/{id}/refunds` (com `Idempotency-Key`) cria o estorno, e `GET` lista os estornos da despesa.
  - O estorno é uma transação: edita-se (descrição, valor, data) e exclui-se por `/v1/transactions/{id}`.
- **Efeitos, no mês da data do estorno:**
  - A conta recebe o valor.
  - No cartão, o estorno abate a fatura em que cai e libera o limite. A fatura pode ficar com crédito, que passa para a seguinte no fechamento dela.
  - O orçamento desconta o gasto da categoria, sem ficar negativo.
  - Totais e dashboard tratam o estorno como despesa negativa.
- **Travas:**
  - Estorno em fatura paga, ou anterior a uma paga, responde 409 (`/problems/paid-invoice`).
  - A despesa com estornos só muda descrição, categoria e observações.
  - Ela não é excluída, nem a compra parcelada com parcela estornada, até os estornos saírem (409, `/problems/has-refunds`).

## Pagamento de faturas

- **A fatura é calculada** das transações do cartão (`modules/invoices/invoice-rules.ts`). Cada pagamento é uma transação `invoice-payment` com o mês da fatura, pela conta de pagamento do cartão e com a data de hoje.
- **Pagamento parcial:** `POST /v1/credit-cards/{id}/invoices/{month}/payment` aceita `{ amount }`, de R$ 0,01 até o saldo (acima, 422). Sem corpo, paga o saldo inteiro. Uma fatura aceita vários pagamentos; o que não quita o saldo leva " (parcial)" na descrição. O limite libera só o que foi pago.
- **Valores da fatura:**
  - `total`: compras − estornos do ciclo.
  - `previousBalance`: o saldo da fatura anterior (positivo é o que faltou pagar; negativo, crédito).
  - `amountDue` = saldo anterior + total; `paidAmount` = soma dos pagamentos; `balance` = total a pagar − pago.
  - `payments`, do mais recente para o mais antigo. `payment` é o mais recente.
- **O saldo passa para a seguinte no fechamento dela**, como o rotativo dos bancos. Até lá, a fatura anterior ainda pode ser paga, mesmo vencida. Depois, ela fica `carried-over` e não aceita mais pagamento. Assim cada real devido aparece numa fatura só.
- **Status**, pela data e pelo saldo: `open` (antes do fechamento), `closed` (fechada, com saldo, até o vencimento), `overdue` (vencida, com saldo), `paid` (fechada com saldo ≤ 0, inclusive sem pagamento, quando os estornos zeram a fatura) e `carried-over` (saldo transferido).
- **Sem juros automáticos:** juros, IOF e multa do rotativo variam por banco. Lance-os como uma compra no cartão.
- **Travas em cadeia:** como o saldo de uma fatura entra na seguinte, compras, estornos e parcelas são recusados (409 `/problems/paid-invoice`) quando a fatura deles **ou uma posterior** tem pagamento. `DELETE …/payment` desfaz só o pagamento mais recente da fatura e responde 409 `/problems/later-invoice-payment` se uma fatura posterior tiver pagamento.
- **Concorrência:** pagar e desfazer travam a linha do cartão (`select … for update`): dois pagamentos ao mesmo tempo não passam do saldo.

## Metas ligadas às contas

- **Conta opcional na movimentação:** `POST /v1/goals/{id}/contributions` aceita `accountId`. O aporte sai da conta e a retirada volta para ela. Sem conta, a movimentação só fica na meta.
- **Como uma transferência entre a conta e a meta** (`goalMovement` em `modules/accounts/account-balance.ts`):
  - Muda o saldo da conta, o saldo total e a evolução do saldo no dashboard.
  - Não é receita nem despesa e não aparece na listagem de transações: fica no histórico da meta.
- **Validação:** a conta precisa ser da pessoa (senão 422) e estar ativa (arquivada, 409 `/problems/archived-reference`). O saldo pode ficar negativo.
- **Desfazer:** excluir a movimentação devolve o valor à conta. Arquivar a conta depois não desfaz nada.
- **`goalsTotal` na conta:** quanto dela está guardado em metas (aportes que saíram − retiradas que voltaram). Explica por que o saldo caiu sem nenhuma transação.
- **No banco:** `goal_contributions.account_id` tem chave estrangeira simples (`ON DELETE SET NULL`), porque a tabela não tem `user_id`. A posse da conta é conferida pela API.

## Segurança

- Senhas com Argon2id (rehash automático quando os parâmetros mudam); mesma resposta e tempo para e-mail com e sem conta. A troca de senha (`POST /v1/me/password`) confere a senha atual e encerra as sessões dos outros aparelhos.
- Sessão em cookie `__Host-session` (`HttpOnly`, `Secure`, `SameSite=Lax`); o banco guarda só o SHA-256 do token. Expira por inatividade (7 dias) e por idade (30 dias).
- CSRF: além do `SameSite`, `POST`/`PATCH`/`DELETE` só são aceitos com `Origin` do front (`APP_ORIGIN`), das origens de CORS ou da própria API.
- Rate limit global por IP e específico para login, cadastro e exclusão de conta. Atrás de proxies, o IP do cliente vem do `X-Forwarded-For` (`TRUST_PROXY`).
- Cabeçalhos de segurança (helmet), corpo limitado a 100 kB e logs sem cookies, senhas ou tokens.
- **Produção:** CORS desligado (o front usa a mesma origem), `/docs` desligado por padrão, `APP_ORIGIN` obrigatória; imagem sem dependências de desenvolvimento, com usuário não root; CodeQL, Dependabot e `npm audit` na CI.

## Edições concorrentes e repetições

- **ETag e If-Match:** `GET`, `POST` e `PATCH` de contas, categorias, transações, cartões, orçamentos e metas devolvem `ETag` (a versão do registro) e o campo `updatedAt`, do qual a ETag é derivada (`"<milissegundos do updatedAt>"`): o cliente que leu o registro numa listagem também consegue montar o `If-Match`. Um `PATCH` com `If-Match` só grava se o registro ainda estiver nessa versão; senão, responde **412** e nada muda. Sem `If-Match`, vale a última gravação.
- **Idempotency-Key:** o pagamento de fatura aceita `Idempotency-Key`. Repetir o pedido com a mesma chave em até 24 horas devolve a mesma resposta (`Idempotent-Replayed: true`) sem pagar de novo. A chave reaproveitada em outra requisição (outra rota ou outro corpo, como outro valor) responde 422; enquanto a primeira ainda roda, 409. Falhas não ficam guardadas.

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
- `npm run test:coverage` faz o mesmo e mede a cobertura (V8), com o relatório em `coverage/index.html`. A execução falha se a cobertura cair abaixo dos limites do `vitest.config.ts` (5 pontos abaixo do medido na etapa 17).
- **CI** (`.github/workflows/ci.yml`, em PRs e na `main`): `npm audit` das dependências de produção, formatação, lint, typecheck, testes com cobertura (o resumo aparece na página da execução), build e a verificação do `openapi.json`.
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

Os registros de decisão ([`docs/adr/`](docs/adr/README.md)) explicam as escolhas que moldam a API:

1. [Sessão em cookie `__Host-`, com Argon2id, em vez de JWT](docs/adr/0001-sessao-em-cookie.md)
2. [Dinheiro em centavos inteiros](docs/adr/0002-dinheiro-em-centavos.md)
3. [Faturas calculadas, não gravadas](docs/adr/0003-faturas-calculadas.md)
4. [Paginação por cursor, inclusive na ordenação por valor](docs/adr/0004-paginacao-por-cursor.md)
5. [ETag/If-Match, Idempotency-Key e trava da linha do cartão](docs/adr/0005-concorrencia-e-repeticoes.md)
6. [Isolamento por usuário na aplicação, sem RLS](docs/adr/0006-isolamento-na-aplicacao.md)
7. [Migrações na subida, com trava no banco](docs/adr/0007-migracoes-na-subida.md)
8. [`Cache-Control: no-store` em todas as respostas](docs/adr/0008-respostas-sem-cache.md)

Além delas, **`TRUST_PROXY` por número de saltos:** o Fastify 5 recusa esse modo, porque quem chama a API direto pode forjar o `X-Forwarded-For`. Aqui isso afeta só o rate limit de quem contorna a Vercel, e os provedores não publicam faixas de IP fixas para confiar por endereço.

## Padrão de commits

Conventional Commits, validados pelo commitlint no hook `commit-msg`; o hook `pre-commit` roda ESLint e Prettier nos arquivos alterados (lint-staged).

## Scripts

| Script                  | Descrição                                                          |
| ----------------------- | ------------------------------------------------------------------ |
| `npm run dev`           | Executa a API com recarga automática (TypeScript nativo do Node)   |
| `npm run build`         | Compila para `dist/` e copia as migrações                          |
| `npm start`             | Executa a versão compilada                                         |
| `npm run typecheck`     | Verifica os tipos sem gerar arquivos                               |
| `npm test`              | Roda os testes (Vitest) contra um Postgres no Testcontainers       |
| `npm run test:watch`    | Roda os testes em modo observação                                  |
| `npm run test:coverage` | Roda os testes e mede a cobertura (relatório em `coverage/`)       |
| `npm run openapi`       | Regenera o `openapi.json` a partir das rotas                       |
| `npm run db:up`         | Sobe o Postgres local (Docker Compose) e espera ficar pronto       |
| `npm run db:down`       | Para o Postgres local (os dados ficam no volume)                   |
| `npm run db:generate`   | Gera uma migração SQL a partir das mudanças no schema              |
| `npm run db:migrate`    | Aplica as migrações pendentes                                      |
| `npm run db:studio`     | Abre o Drizzle Studio para inspecionar o banco                     |
| `npm run db:seed`       | Cria a demo (`demo@exemplo.com` / `demo1234`) com 6 meses de dados |
| `npm run lint`          | Executa o ESLint (com regras que usam os tipos)                    |
| `npm run format`        | Formata o código com Prettier                                      |
| `npm run format:check`  | Verifica a formatação sem alterar arquivos                         |
