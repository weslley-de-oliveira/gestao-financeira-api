# 0007. Migrações na subida, com trava no banco

- **Data:** 06/11/2026 (etapa 8, deploy)
- **Status:** aceita

## Contexto

Cada merge na `main` publica uma imagem nova, e o Render a coloca no ar. As migrações do banco precisam rodar antes de a versão nova atender. O plano gratuito do Render não tem comando de pré-deploy, e durante o deploy a versão antiga continua no ar até a nova ficar saudável.

## Decisão

- Com `MIGRATE_ON_START=true`, a API aplica as migrações pendentes antes de abrir a porta (`src/db/migrate.ts`).
- Uma trava do Postgres (`pg_advisory_lock`) garante que só uma instância migra por vez; a outra espera e encontra tudo aplicado.
- A conexão do Neon para a API é a **direta**, não a do pooler: a trava é de sessão, e o PgBouncer em modo de transação não a mantém.
- As migrações são SQL gerado pelo Drizzle e revisado à mão quando a ordem importa (restrições `UNIQUE` antes das chaves estrangeiras que dependem delas).

## Alternativas descartadas

- **Rodar as migrações à mão antes do merge:** fácil de esquecer, e o deploy sobe com o banco desatualizado.
- **Job de migração no GitHub Actions:** exigiria a conexão do banco de produção como segredo do CI e coordenação com o deploy do Render.
- **Plano pago do Render, com pré-deploy:** resolveria sem código, mas o projeto roda no plano gratuito.

## Consequências

- O deploy é só o merge: imagem, migrações e troca de versão acontecem sozinhos.
- **Toda migração precisa ser compatível com a versão anterior**, que continua atendendo enquanto a nova sobe (adicionar antes, remover depois).
- Uma migração que falha impede a versão nova de subir, e a antiga segue no ar: falha segura.
