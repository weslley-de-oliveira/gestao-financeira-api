# 0008. `Cache-Control: no-store` em todas as respostas

- **Data:** 10/11/2026 (correção encontrada no teste em produção da etapa 15)
- **Status:** aceita

## Contexto

O teste em produção das metas ligadas às contas mostrou o saldo antigo de uma conta depois de um aporte. A causa:

1. A ETag é a versão do registro (ADR 0005). O saldo é calculado, então um aporte muda o saldo da conta sem mudar a ETag dela.
2. O proxy da Vercel acrescenta `Cache-Control: public, max-age=0, must-revalidate` a respostas sem esse cabeçalho.
3. O navegador guardava a resposta e, na leitura seguinte, perguntava `If-None-Match`. A API comparava a ETag, respondia **304**, e o navegador mostrava o saldo guardado.

Os testes não pegavam o problema: ele só aparecia com o proxy e o cache do navegador juntos.

## Decisão

- Toda resposta sai com `Cache-Control: no-store` (`src/plugins/security.ts`), salvo se a rota definir outro. São dados pessoais e mudam a toda hora; não há o que guardar.
- A ETag continua existindo para o `If-Match` (controle de concorrência), não para cache.

## Alternativas descartadas

- **ETag que inclui os valores calculados:** exigiria calcular saldo, uso do limite e progresso para gerar a ETag, e o `If-Match` passaria a falhar quando outra pessoa (ou outro registro) mudasse um valor derivado.
- **Desligar o cache só no proxy da Vercel:** corrigiria o sintoma neste deploy, mas qualquer outro proxy ou cliente repetiria o problema.

## Consequências

- O navegador sempre busca a versão atual; o custo é não economizar banda com 304, irrelevante para respostas de poucos kB.
- Também evita que dados financeiros fiquem gravados no disco do navegador ou de proxies intermediários.
- Lição registrada: testar em produção, com o caminho real (Vercel → Render), pega classes de erro que os testes de integração não alcançam.
