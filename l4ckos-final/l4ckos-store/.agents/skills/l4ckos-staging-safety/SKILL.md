---
name: l4ckos-staging-safety
description: Preserva isolamento operacional da L4CKOS. Use ao trabalhar com Railway, Vercel, banco, migrations, env vars, deploy, serviços externos, staging/production, domínios/APIs ou dados remotos.
---

# Isolamento operacional

STAGING é o ambiente remoto padrão permitido, dentro do escopo autorizado da tarefa. Esta skill, um GO anterior ou um exemplo em documentação não autorizam novas ações por si só.

Produção real é proibida salvo autorização **explícita e específica do usuário para a ação concreta e seu alvo**. Menções antigas/genéricas ou contexto implícito não são autorização de produção.

## Identidade esperada

| Recurso | Staging |
| --- | --- |
| Railway project / service | `l4ckos-staging` / `l4ckos-staging` |
| Railway project ID | `2bb90c8e-eb65-43ee-826b-f93750f0499c` |
| Railway environment interno | `production` |
| Vercel project | `l4ckos-staging` |
| Frontend | `https://staging.l4ckos.com.br` |
| Backend | `https://api-staging.l4ckos.com.br` |
| Asaas API / checkout | `https://api-sandbox.asaas.com/v3` / `https://sandbox.asaas.com` |

O environment `production` pertence ao projeto **isolado** `l4ckos-staging`: nunca confundi-lo com o projeto `l4ckos-production`. Durante homologação, endpoints reais do Asaas são proibidos.

## Antes de acessar ou escrever

- Nunca altere, substitua ou desfaça o vínculo Railway do repositório oficial para acessar staging. Use contexto explicitamente isolado: diretório temporário já confirmado ou worktree, com projeto/environment/service explícitos.
- Confirme a identidade antes de consultar recursos remotos; antes de **qualquer escrita**, reconfirme projeto, ID, environment, service, domínio e recurso afetado. Use metadados read-only, como `railway status` no contexto isolado. Para banco, confirme MySQL exclusivo de staging; nome do environment sozinho não basta.
- Se projeto/service/domínio divergir do staging esperado, ou houver possibilidade de tocar produção por ambiguidade: **STOP e reporte antes de acessar/escrever**. Não siga redirects nem teste outro alvo por tentativa.
- Guias legados de setup, `.env` e vínculos locais não comprovam isolamento nem autorizam migrations, seeds ou `db:push` remoto. Confirme o alvo efetivo também em testes aparentemente locais.
- Não imprima API keys, tokens, senhas, `DATABASE_URL`/connection strings, destinatários reais, unsubscribe tokens, cookies ou sessões. Filtre na origem; reporte presença/ausência, IDs não secretos e URLs públicas necessárias, nunca JSON bruto de variáveis.
- Ao preparar release, faça stage explícito por arquivo; nunca `git add .` ou `git add -A`. O `.npmrc` local não entra em commit, artefato ou release.
