# 0002. Dinheiro em centavos inteiros

- **Data:** 04/11/2026 (no front; a API seguiu a mesma regra)
- **Status:** aceita

## Contexto

Saldos, faturas e orçamentos somam muitos valores. Em ponto flutuante, `0.1 + 0.2` não é `0.3`, e um centavo de diferença numa fatura é um defeito visível. O front e a API precisam chegar exatamente aos mesmos valores.

## Decisão

- Todo valor monetário é um **inteiro em centavos**: no banco (`bigint`), no contrato da API (`amount: 12345` é R$ 123,45) e nas regras de domínio (`src/shared/utils/money.ts`).
- A validação limita o valor a um teto que cabe com folga em `Number.MAX_SAFE_INTEGER` mesmo depois de somas (`isWithinMoneyLimit`).
- Divisões, como as parcelas de uma compra, distribuem os centavos que sobram (a sobra vai para a 1ª parcela), para que a soma das partes seja sempre o total.
- Só a interface formata em reais.

## Alternativas descartadas

- **`number` com casas decimais:** erros de arredondamento acumulam nas somas.
- **`numeric` no Postgres com string no contrato:** exato, mas obriga o front a uma biblioteca decimal só para somar e comparar.

## Consequências

- Somas e comparações são exatas, em SQL e em TypeScript, e os testes de paridade entre front e API comparam números inteiros.
- Quem lê o contrato precisa saber que `amount` está em centavos. O OpenAPI descreve isso em cada campo.
- Não há suporte a moedas com outro número de casas decimais (fora do escopo: só BRL).
