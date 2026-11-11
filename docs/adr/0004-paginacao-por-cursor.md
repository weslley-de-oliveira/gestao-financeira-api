# 0004. Paginação por cursor, inclusive na ordenação por valor

- **Data:** 06/11/2026 (etapa 10, transações no servidor)
- **Status:** aceita

## Contexto

A lista de transações cresce sem limite e pode ser ordenada por data ou por valor, nos dois sentidos, com filtros e busca. Com `offset`, uma transação lançada enquanto a pessoa navega desloca as páginas: um item aparece duas vezes ou some. E `OFFSET n` fica mais lento quanto mais longe a página.

## Decisão

- **Cursor opaco** (`src/shared/http/pagination.ts`): o `nextCursor` guarda a ordenação, o valor da chave de ordenação do último item (data ou valor) e o id dele, que desempata (UUID v7, que segue a ordem de criação). A página seguinte é uma consulta "depois desta chave", apoiada em índices compostos (migração 0010).
- O mesmo desempate do front: entre itens iguais, a registrada por último vem primeiro.
- Um cursor de outra ordenação responde 422, em vez de devolver uma página sem sentido.
- **Totais à parte:** `GET /v1/transactions/summary`, com os mesmos filtros, devolve a quantidade e as somas. O front mostra "11–20 de 75" sem baixar tudo.

## Alternativas descartadas

- **`page`/`offset`:** permite saltar para qualquer página, mas as páginas mudam quando entra uma transação, e o custo cresce com o deslocamento.
- **Cursor só na ordenação por data:** mais simples, mas a ordenação por valor voltaria ao problema do `offset`.

## Consequências

- Navegar é estável: uma transação nova não move a página seguinte.
- O cliente vai para a próxima página ou volta (o front guarda a pilha de cursores), mas não salta direto para a página 7.
- Cada nova ordenação precisa de índice e de codificação do cursor; os testes cobrem empates e páginas com itens de mesmo valor.
