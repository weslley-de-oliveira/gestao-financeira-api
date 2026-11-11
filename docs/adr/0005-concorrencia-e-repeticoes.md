# 0005. ETag/If-Match, Idempotency-Key e trava da linha do cartão

- **Data:** 06/11/2026 (etapa 8); a trava do cartão entrou em 11/11/2026 (etapa 16)
- **Status:** aceita

## Contexto

Três situações gravam dados errados sem que ninguém perceba:

1. **Edição concorrente:** duas abas editam a mesma conta; a última gravação apaga a primeira sem aviso.
2. **Repetição:** a rede cai depois que o servidor pagou a fatura, e o cliente tenta de novo: pagamento em dobro. O plano gratuito do Render, que hiberna, deixa timeouts comuns.
3. **Corrida no pagamento:** dois pagamentos parciais da mesma fatura ao mesmo tempo, cada um conferindo o saldo antes do outro gravar, passam do saldo.

## Decisão

- **ETag + If-Match** (`src/shared/http/etag.ts`): leituras e gravações devolvem `ETag` derivada do `updatedAt` (milissegundos). Um `PATCH` com `If-Match` grava com `UPDATE … WHERE updated_at = <versão>`; se a linha mudou, responde **412** e nada é gravado. O front envia a versão que o formulário carregou e avisa a pessoa.
- **Idempotency-Key** (`src/shared/http/idempotency.ts`, tabela `idempotency_keys`): nas rotas que criam dinheiro (pagamento de fatura, compra parcelada, estorno, antecipação e cancelamento de parcelas), a primeira resposta fica guardada por 24 horas. A mesma chave devolve a mesma resposta (`Idempotent-Replayed: true`). A chave guarda o hash da rota e do corpo: reaproveitada com outro corpo, responde 422; enquanto a primeira ainda roda, 409. Falhas não ficam guardadas. O front gera a chave e tenta de novo uma vez.
- **Trava da linha do cartão:** pagar e desfazer abrem uma transação com `SELECT … FOR UPDATE` no cartão; o segundo pedido espera o primeiro e já vê o saldo novo.

## Alternativas descartadas

- **Última gravação vence:** simples, mas perde edições em silêncio.
- **Coluna `version` inteira:** equivalente ao `updatedAt`, mas é mais uma coluna em toda tabela; o `updatedAt` já existe e serve ao front.
- **Índice único "um pagamento por fatura":** foi a proteção até a etapa 15, mas impede o pagamento parcial.
- **Isolamento `SERIALIZABLE`:** protegeria o saldo, mas obrigaria a repetir transações em qualquer conflito, em todas as rotas.

## Consequências

- Nenhuma edição se perde sem aviso, e nenhum pagamento é duplicado por repetição.
- A ETag não muda quando muda só um valor calculado (como o saldo de uma conta). Isso levou ao ADR 0008.
- A tabela `idempotency_keys` cresce; as chaves vencidas são ignoradas e podem ser apagadas.
