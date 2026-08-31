# Preflight — implantação do staging remoto — 2026-08-31

## Decisão atual

**NO-GO para deploy remoto.** Nenhum recurso foi criado, configurado ou alterado. Nenhuma ação ocorreu em produção.

O bloqueio não é de teste local: é de identidade do release e de recursos remotos isolados. O candidato homologado localmente ainda não corresponde a um commit remoto imutável que possa ser implantado com segurança.

## 1. Candidato e árvore de trabalho

| Item | Evidência |
|---|---|
| Checkout local | branch `master`, HEAD `b0cc43aa464936b75ffe8bed11b901dfbca94ec6` |
| Working tree | sujo: alterações rastreadas de P0/P1/staging e arquivos novos correspondentes; arquivos `.kra` permanecem fora do candidato |
| Migrations locais | `0000` a `0015`, incluindo `0013_p0_order_payment_integrity.sql`, `0014_p1_operational_reliability.sql`, `0015_schema_drift_alignment.sql` |
| Preview remoto existente | branch `hardening/l4ckos-rc`, SHA `842490abb2c27b15339b0f2a8506a7195f54369d` |
| Relação | o branch remoto parte de `b0cc43a`, mas não contém os arquivos de P0/P1/staging locais |

O preview remoto contém uma migration distinta, `drizzle/0013_asaas_webhook_events.sql`. Ela conflita pelo número com a migration local `0013_p0_order_payment_integrity.sql`. Portanto, esse preview não é o candidato P0/P1/staging homologado e não pode ser promovido nem usado como staging.

Antes de deploy é necessário integrar/revisar as duas linhas de trabalho, resolver a numeração das migrations, executar a cadeia limpa novamente e criar um único commit/tag candidato. Não há SHA único a registrar enquanto as alterações do staging permanecem não commitadas.

## 2. Inventário remoto de leitura

| Recurso | Existe? | Isolado? | Ação necessária |
|---|---:|---:|---|
| Vercel | Sim: projeto `l4ckos`, organização `bezerrayans-projects`, plano Hobby | Não para staging: domínio/projeto atual é de produção | criar projeto/deployment staging após existir commit candidato |
| Frontend staging | Não | — | criar deployment separado e configurar API staging no build |
| Backend Railway staging | Não confirmado; sem conexão Railway nesta sessão | — | fornecer/acoplar conta e criar serviço identificado como staging |
| `staging.l4ckos.com.br` | Não | — | criar registro Cloudflare independente após frontend existir |
| `api-staging.l4ckos.com.br` | Não | — | criar registro Cloudflare independente após backend existir |
| MySQL staging | Não confirmado | — | criar instância/database/usuário/backup exclusivos |
| Asaas sandbox | Não confirmado | — | fornecer conta/key sandbox e token de webhook exclusivos |
| Resend staging | Não confirmado | — | configurar chave/remetente/allowlist exclusivos |
| Storage staging | Não confirmado | — | configurar endpoint/conta/namespace exclusivo |
| Scheduler staging | Não confirmado | — | configurar scheduler externo e `CRON_SECRET` exclusivo |

Probes públicos de 2026-08-31: os dois nomes staging não resolvem DNS; `https://l4ckos.com.br` respondeu 200 via Cloudflare/Vercel. Não foram feitas chamadas autenticadas, mutations ou probes de negócio em produção.

## 3. Bloqueadores

| Prioridade | Bloqueador | Efeito |
|---|---|---|
| P0 | Não existe commit único contendo P0/P1/staging homologado | impossível cumprir mesmo SHA frontend/backend |
| P0 | Conflito de numeração da migration `0013` entre preview e candidato local | risco de schema incompatível; deploy proibido |
| P0 | Não há MySQL, backend, DNS ou domínio staging identificados | não há alvo seguro para provisionar/deployar |
| P1 | Sem acesso/configuração confirmada para Railway, Cloudflare, Asaas, Resend, storage e scheduler | homologação integrada não executável |

## 4. Próxima sequência segura

1. Definir a linha-base desejada: integrar o branch remoto `hardening/l4ckos-rc` com as mudanças locais P0/P1/staging, ou descartar formalmente uma das linhas.
2. Resolver a colisão de migration preservando histórico e executar fresh install/drift/P0/P1 de novo.
3. Commitar e publicar um branch de release candidato; registrar SHA e tag.
4. Criar recursos com nomes explícitos `*-staging` nas contas corretas, sem reutilizar recursos de produção.
5. Preencher secrets a partir de `staging.env.example`, com `CHECKOUT_ENABLED=false`.
6. Provisionar banco, seed sintético, backend, frontend e DNS; então executar os gates remotos do runbook.

Até os itens 1 a 4 serem concluídos, `CHECKOUT_ENABLED` não deve ser habilitado e não há autorização técnica para teste de pagamento sandbox remoto.
