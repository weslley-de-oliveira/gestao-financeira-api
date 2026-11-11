# Decisões de arquitetura (ADRs)

Cada registro explica uma decisão que molda a API: o contexto, o que foi decidido, as alternativas descartadas e as consequências, no formato de Michael Nygard.

Os registros foram escritos em novembro de 2026, depois das decisões, a partir do plano e do histórico do projeto. A data de cada um é a da decisão. As decisões do front ficam no [repositório do front](https://github.com/weslley-de-oliveira/gestao-financeira/tree/main/docs/adr).

| Nº                                        | Decisão                                                   | Data       |
| ----------------------------------------- | --------------------------------------------------------- | ---------- |
| [0001](0001-sessao-em-cookie.md)          | Sessão em cookie `__Host-`, com Argon2id, em vez de JWT   | 05/11/2026 |
| [0002](0002-dinheiro-em-centavos.md)      | Dinheiro em centavos inteiros                             | 04/11/2026 |
| [0003](0003-faturas-calculadas.md)        | Faturas calculadas, não gravadas                          | 05/11/2026 |
| [0004](0004-paginacao-por-cursor.md)      | Paginação por cursor, inclusive na ordenação por valor    | 06/11/2026 |
| [0005](0005-concorrencia-e-repeticoes.md) | ETag/If-Match, Idempotency-Key e trava da linha do cartão | 06/11/2026 |
| [0006](0006-isolamento-na-aplicacao.md)   | Isolamento por usuário na aplicação, sem RLS              | 05/11/2026 |
| [0007](0007-migracoes-na-subida.md)       | Migrações na subida, com trava no banco                   | 06/11/2026 |
| [0008](0008-respostas-sem-cache.md)       | `Cache-Control: no-store` em todas as respostas           | 10/11/2026 |
