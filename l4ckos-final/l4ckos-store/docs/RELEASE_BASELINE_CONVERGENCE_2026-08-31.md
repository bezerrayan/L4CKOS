# Convergência da linha-base do release — 2026-08-31

## 1. Estado inicial Git

| Item | Estado inicial |
|---|---|
| Base local | `master` em `b0cc43aa464936b75ffe8bed11b901dfbca94ec6` |
| Working tree | alterações P0/P1/schema/staging não commitadas |
| Referência de segurança | `backup/pre-release-state-20260831` aponta para `b0cc43a` |
| Arquivos pessoais preservados | `client/src/images/**/*.kra` e autosave não foram adicionados nem modificados |
| Linha remota | `origin/hardening/l4ckos-rc` em `842490abb2c27b15339b0f2a8506a7195f54369d` |

O branch remoto parte de `b0cc43a`; ele não foi mesclado cegamente.

## 2. Diferença local × remoto

| Área | Local | Remoto | Classificação |
|---|---|---|---|
| Migrations | `0013_p0`, `0014_p1`, `0015_schema_drift_alignment` | `0013_asaas_webhook_events` | **REMOTE SUPERSEDED** para fresh install; upgrade forward-only provado |
| Pedido/pagamento | agregado transacional, reservas atômicas, payments, paymentEvents, outbox e reconciliação | checkout legado e deduplicação isolada de webhook | **KEEP LOCAL** |
| Webhook Asaas | `paymentEvents.providerEventId` único, referência financeira, conflitos, auditoria e outbox | `asaasWebhookEvents.eventId` único e payload hash | **REMOTE SUPERSEDED** funcionalmente |
| CORS/cookie/env | APP_ENV, origens exatas, cookies por ambiente e startup fail-closed | allowlist de produção/desenvolvimento | **KEEP LOCAL** |
| Rate-limit/trust proxy | limites por classe e configuração de staging | factory e trust proxy privado | **INVESTIGATE**: depende da topologia Railway/Cloudflare, não integrar sem teste remoto |
| CSRF | bloqueio de origem para mutações cookie-auth | token HMAC double-submit e cliente dedicado | **INVESTIGATE**: exige integração coordenada cliente/servidor; não foi cherry-picked isoladamente |
| Auth/admin | role + allowlist de e-mail, OAuth/owner e manutenção | helpers genéricos de role/owner | **KEEP LOCAL** |
| UI/coming soon e conteúdo | candidato P0/P1/staging | diversas alterações de UI do branch remoto | **REMOTE SUPERSEDED** para este RC funcional |
| Métodos HTTP/API | rotas atuais e tRPC | helpers 404/405 do remoto | **INVESTIGATE**, não ligado a P0/P1/staging |

Nenhuma alteração remota foi integrada automaticamente. Isso é deliberado: o branch remoto representa uma linha de código anterior e seus arquivos sobrepostos exigiriam merge manual amplo, com risco de reintroduzir checkout/modelo de webhook anteriores ao P0.

## 3. Migration remota `0013_asaas_webhook_events`

Ela cria `asaasWebhookEvents` com `eventId` único, tipo de evento, IDs de payment/checkout/order, `payloadHash`, status de processamento e timestamps.

O P0 canônico cria `payments` e `paymentEvents`. `paymentEvents` tem `providerEventId` único, ligação a `paymentId`/`orderId`, `providerPaymentId`, `externalReference`, payload, estados `pending|processing|processed|ignored|failed|conflict`, auditoria e processamento transacional. O controller converte eventos Asaas em `providerEventId` determinístico e o banco impede duplicação concorrente.

**Decisão funcional: A — já incorporada pelo P0.** Os campos legados `checkoutId` e `payloadHash` não são preservados como tabela separada porque a estratégia canônica correlaciona pelo pagamento/referência financeira e guarda o payload do evento. Não há migração `0016` necessária para fresh install.

## 4. Status de aplicação

| Ambiente | `0013_asaas_webhook_events` aplicada? |
|---|---|
| Fresh install canônico local | **NÃO** |
| Banco local de upgrade simulado | **SIM**, deliberadamente para o ensaio |
| Staging remoto | **NÃO CONFIRMADO**; não existe ambiente acessível |
| Produção | **NÃO CONFIRMADO**; nenhuma conexão foi realizada |

Como produção/staging não puderam ser confirmados com segurança read-only, a migration legada não foi renomeada, editada ou apagada no branch legado.

## 5. Decisão sobre a migration

- Branch `release/l4ckos-rc`: **superseded**; contém somente `0013_p0_order_payment_integrity.sql`.
- Branch `hardening/l4ckos-rc`: permanece **LEGACY**, sem reescrita.
- Bancos que já tiverem a tabela legada podem aplicar o tail canônico forward-only; a tabela antiga permanece extra e não bloqueia schema/readiness.

## 6–7. Mudanças remotas

**Integradas:** nenhuma por cherry-pick. A implementação equivalente de idempotência de webhook, autenticação administrativa, CORS, cookies, rate limit operacional, logs e deploy já existe ou é mais abrangente no candidato local.

**Não integradas:** migration/tabela legada e fluxos de checkout/webhook anteriores foram superseded; UI não relacionada ficou fora do RC; CSRF double-submit, trust proxy restrito e helpers de API foram marcados para revisão independente, pois dependem de integração de cliente e da topologia remota.

## 8. Linha canônica de migrations

`0000` → `0001` → `0002` → `0003` → `0004` → `0005` → `0006` → `0007` → `0008` → `0009` → `0010` → `0011` → `0012` → `0013_p0_order_payment_integrity` → `0014_p1_operational_reliability` → `0015_schema_drift_alignment`.

Não há duas migrations `0013` no candidato final.

## 9–10. Branch e commits finais

Branch: `release/l4ckos-rc`.

| Commit | Assunto |
|---|---|
| `9f88a3c` | `feat(core): consolidate P0 and P1 transactional integrity` |
| `006da82` | `fix(schema): align migration 0015 and verify drift` |
| `9b12e6a` | `feat(staging): enforce isolated runtime safety gates` |
| `d29bccd` | `docs(release): record RC baseline convergence` |

## 11. Fresh install

Base local descartável `l4ckos_staging_release_rc_fresh_20260831`:

- 16 migrations / 62 statements;
- zero warnings;
- drift limpo;
- seed sintético aplicado;
- `asaasWebhookEvents` ausente, como esperado na linha canônica.

## 12. Upgrade path

Base local descartável `l4ckos_staging_legacy_webhook_upgrade_20260831`:

1. `0000` a `0012`;
2. legacy `0013_asaas_webhook_events`;
3. canônico `0013_p0`, `0014_p1`, `0015`.

Resultado: **GO**, zero blocker de drift. A tabela `asaasWebhookEvents` permanece como tabela extra histórica; `payments`, `paymentEvents` e `notificationOutbox` canônicos estão presentes. Esse é um caminho forward-only; ele não remove dados históricos.

## 13. Regressão

| Gate | Resultado |
|---|---|
| P0 MySQL | 31/31 PASS |
| P1 MySQL | 33/33 PASS |
| Estado/segurança/isolamento/logout | 23/23 PASS |
| Typecheck cliente/servidor | PASS |
| Build cliente/servidor | PASS |
| Fresh install | PASS |
| Upgrade legado → canônico | PASS com tabela histórica extra |
| Drift | 0 blockers |
| Smoke HTTP no SHA do RC | 14/14 PASS, checkout fechado e nenhum provedor externo chamado |
| Backup/restore RC | PASS em segunda base descartável; 2 usuários, 4 produtos e 4 variantes restaurados; drift 0 blockers |

## 14. Arquivos não relacionados

Os arquivos `.kra` e autosave do usuário permanecem não rastreados, não foram alterados e não fazem parte do RC.

## 15. Próximo passo

1. Publicar a branch/tag RC sem force-push.
2. Antes de qualquer upgrade de banco persistente, confirmar se a migration legada foi aplicada em cada destino via inventário read-only.
3. Provisionar recursos staging separados e seguir o runbook com checkout fechado.

## Veredito

**EXISTE AGORA UM ÚNICO RELEASE CANDIDATE VERSIONADO E SEGURO PARA DEPLOY EM STAGING? — SIM, COM RESSALVAS.**

O RC tem linha canônica única e testes locais verdes. A ressalva é o status não confirmado da migration legada em bancos persistentes e as melhorias remotas marcadas para revisão independente; não bloqueiam fresh staging, mas bloqueiam qualquer upgrade de banco existente até inventário read-only.
