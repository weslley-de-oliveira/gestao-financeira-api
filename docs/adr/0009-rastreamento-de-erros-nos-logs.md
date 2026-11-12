# 0009. Rastreamento de erros nos logs da API, sem serviço externo

- **Data:** 11/11/2026 (etapa 18)
- **Status:** aceita

## Contexto

Quando alguém vê "Não foi possível salvar a conta" no front, é preciso achar o que aconteceu. A API já dava um id a cada requisição (o `x-request-id`, nos logs JSON e no `requestId` dos Problem Details), mas o front não o mostrava. E três tipos de falha não chegavam a lugar nenhum:

- erros de JavaScript no navegador;
- requisições que nunca chegaram à API (rede, proxy da Vercel, API hibernando);
- respostas 5xx do proxy, que a API nunca viu.

## Decisão

- **O front gera o id** de cada requisição à API (UUID em `x-request-id`), que a API aceita e usa nos logs. O front conhece o id mesmo quando a resposta não chega.
- **O código vai para a tela:** as mensagens de falha inesperada mostram os 8 primeiros caracteres do id. Buscar esse código no painel de logs do Render encontra a requisição.
- **`POST /v1/client-errors`:** o front relata erros de JavaScript e falhas de rede. A API grava um log `warn` com `source: "front"`, o `User-Agent` e o id do usuário da sessão, se houver. A rota é pública (erros no login também importam), com corpo pequeno e validado, sem a query string da página, e limitada a 10 relatos por minuto por IP. O front para em 5 relatos por página.

## Alternativas descartadas

- **Sentry (ou serviço parecido):** agrupa erros, mostra tendências e alerta, mas exige conta e chave, abre a CSP para outro domínio e manda dados de uso a terceiros. Fica como evolução natural se o app tiver usuários reais; o `x-request-id` continua útil com ele.
- **OpenTelemetry:** rastreamento distribuído completo, mas exige um coletor e um backend de traces, que os planos gratuitos usados aqui não oferecem.
- **Só os logs da API:** não veriam os erros de JavaScript nem as falhas antes da API.

## Consequências

- Um código na tela leva ao log da requisição, e os erros do front ficam no mesmo lugar, filtráveis por `source: "front"`.
- Não há agrupamento, alertas nem histórico longo: o plano gratuito do Render guarda os logs por pouco tempo. Serve para investigar um problema recente.
- A rota pública pode receber lixo; o limite por IP, a validação e o log em JSON (o pino escapa o conteúdo) contêm o estrago.
