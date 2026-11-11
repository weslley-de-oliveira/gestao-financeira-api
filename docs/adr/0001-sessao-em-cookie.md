# 0001. Sessão em cookie `__Host-`, com Argon2id, em vez de JWT

- **Data:** 05/11/2026
- **Status:** aceita

## Contexto

A API serve um único front, publicado na Vercel, que encaminha `/api/*` para a API: para o navegador, front e API têm a mesma origem. O projeto lida com dados financeiros (fictícios, mas o desenho deve servir para dados reais). Logout, troca de senha e exclusão de conta precisam encerrar o acesso na hora.

## Decisão

- **Sessão opaca no servidor:** o login gera um token aleatório; o banco guarda só o SHA-256 dele (`sessions.token_hash`), e o navegador recebe o token num cookie `__Host-session` (`HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`).
- **Expiração dupla:** 7 dias sem uso ou 30 dias de idade (`session-rules.ts`). O último uso é atualizado no máximo a cada 5 minutos, para não gravar no banco a cada requisição.
- **Senhas com Argon2id** (`@node-rs/argon2`), com rehash no login quando os parâmetros mudam. E-mail sem conta faz uma verificação contra um hash fictício, para responder no mesmo tempo.
- **CSRF:** além do `SameSite`, `POST`/`PATCH`/`DELETE` só passam com o `Origin` do front.

## Alternativas descartadas

- **JWT no `localStorage`:** qualquer XSS lê o token, e revogar exige uma lista de bloqueio, o que traz de volta o estado no servidor.
- **JWT em cookie:** resolve o XSS, mas mantém o problema da revogação; o ganho (não consultar o banco) não importa numa API com um único banco.
- **bcrypt:** limita a senha a 72 bytes e não usa memória para dificultar ataques com GPU; Argon2id é a recomendação atual da OWASP.

## Consequências

- Logout, troca de senha (encerra as outras sessões) e exclusão de conta valem na hora.
- Cada requisição autenticada consulta a sessão no banco. É uma busca por chave única, barata nesta escala.
- O prefixo `__Host-` exige HTTPS e a mesma origem, o que a Vercel garante. Por isso o front fala com `/api` da própria origem, sem CORS (ver ADR 0003 do front).
- Um vazamento do banco não entrega sessões válidas, só hashes de tokens.
