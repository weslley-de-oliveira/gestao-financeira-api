# 0006. Isolamento por usuário na aplicação, sem RLS

- **Data:** 05/11/2026
- **Status:** aceita

## Contexto

Cada pessoa só pode ver e mudar os próprios dados. O erro clássico é uma rota que busca pelo id sem filtrar pelo dono (IDOR). O Postgres oferece Row-Level Security (RLS), que aplica o filtro no banco.

## Decisão

- **Toda consulta filtra pelo usuário da sessão** nos repositórios. O recurso de outra pessoa responde **404**, igual a um id que não existe, para não revelar que ele existe.
- **O banco também ajuda:** as chaves estrangeiras são compostas com o dono (`(account_id, user_id)` → `accounts(id, user_id)`), então uma transação não consegue apontar para a conta de outra pessoa nem por engano no código.
- **Testes que cobrem todas as rotas:** `test/isolation-matrix.test.ts` cria dois usuários e chama cada rota com id do outro. Uma guarda lê o OpenAPI e falha se aparecer uma rota com id fora da matriz, então uma rota nova não escapa do teste.

## Alternativas descartadas

- **RLS desde o início:** exigiria toda consulta dentro de uma transação com o usuário no contexto (`SET LOCAL`), um papel de banco sem `BYPASSRLS` para a aplicação e migrações e testes mais complexos. Fica como camada extra possível, não como a única proteção.

## Consequências

- O filtro é responsabilidade do código, e a garantia vem dos testes e das chaves compostas.
- A guarda do OpenAPI transforma "esqueci de testar a rota nova" numa falha de CI.
- Adotar RLS depois continua possível sem mudar o contrato.
