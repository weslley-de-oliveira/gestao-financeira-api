# 0003. Faturas calculadas, não gravadas

- **Data:** 05/11/2026 (etapa 4); a cadeia de saldos entrou em 11/11/2026 (etapa 16)
- **Status:** aceita

## Contexto

Uma fatura de cartão é consequência de outras coisas: as compras do ciclo, os estornos, os pagamentos e, desde o pagamento parcial, o saldo da fatura anterior. Se a fatura fosse uma linha no banco, toda compra, estorno, antecipação de parcela ou pagamento teria de atualizá-la, e qualquer caminho esquecido deixaria o total errado para sempre.

## Decisão

- **Não existe tabela de faturas.** A fatura é calculada a cada leitura a partir das transações do cartão (`src/modules/invoices/invoice-rules.ts`), com funções puras:
  - o ciclo vem do dia de fechamento e do dia de vencimento do cartão (`invoice-cycle.ts`); a compra no dia do fechamento já vai para a fatura seguinte;
  - total = compras − estornos do ciclo; saldo anterior = saldo da fatura anterior, que só passa para esta no fechamento dela;
  - total a pagar = saldo anterior + total; saldo = total a pagar − pagamentos;
  - o status (`open`, `closed`, `overdue`, `paid`, `carried-over`) vem da data de hoje e do saldo.
- O pagamento é uma transação `invoice-payment` com o mês da fatura; desfazer é apagá-la.
- **Travas em cadeia:** como o saldo de uma fatura entra na seguinte, compras e estornos são recusados quando a fatura deles ou alguma posterior já tem pagamento (409 `/problems/paid-invoice`). Desfazer só apaga o pagamento mais recente, e só se nenhuma fatura posterior tiver pagamento.
- As mesmas regras existem no front (modo demo) e são conferidas por testes de paridade (`invoices.parity.test.ts`).

## Alternativas descartadas

- **Tabela de faturas atualizada a cada evento:** leitura mais barata, mas duas fontes de verdade (transações e fatura) que precisam ficar iguais em todos os caminhos de escrita.
- **Fechamento gravado por um job:** exigiria um agendador no plano gratuito do Render, que hiberna, e um reprocessamento para cada correção retroativa.

## Consequências

- Uma regra nova (estornos, parcelas, pagamento parcial) mexe só nas funções de cálculo e nas travas, não em dados gravados; corrigir uma regra corrige todas as faturas, inclusive as antigas.
- Cada leitura de fatura lê as transações do cartão. Nesta escala é barato; o uso do limite, que soma todo o histórico, é calculado em SQL.
- O status muda com a passagem do tempo sem ninguém gravar nada. Por isso a API tem um relógio injetável (`app.today()`, no fuso `TIME_ZONE`) e os testes fixam a data.
