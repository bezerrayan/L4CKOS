# L4CKOS — Preparação operacional da release

09/10/2026. **GO para criar o commit local posteriormente e iniciar a preparação operacional local do staging. NO-GO para publicação/migration remota/abertura oficial.** Nenhum commit, push ou alteração do índice foi executado; nenhum serviço remoto, produção, operação financeira ou pedido existente foi acessado/alterado.

Branch `feat/preorder-batch`; HEAD `f519c11e94e57f76522db11f04254c5c17874598`; parent `8ed0a472f7f8fbf693bb5528700ec2245ed479c0`. Worktree Git raiz em `/home/yan/Documentos/l4ckos/worktrees/l4ckos-preorder`; aplicação em `l4ckos-final/l4ckos-store`. Paths abaixo relativos à aplicação.

## Políticas e limites

As políticas financeiras V1 foram aprovadas pelos dois fundadores conforme comunicação do usuário: reembolsos manuais supervisionados, conciliação obrigatória com Asaas, parciais manuais, lotes abaixo do mínimo tratados individualmente, responsabilidade inicial dos dois fundadores, auditoria de aprovações/ações e respeito a prazos legais/direitos do consumidor/política aplicável. Formalizadas no [runbook](refund-reconciliation-runbook.md) e na [RC](staging-release-candidate.md), com atualização do checklist e dos relatórios históricos 02/04 e 04/04.

Audit/ledger/cancelamento e proteções transacionais existem. Refund automático, módulo completo de reembolso/dupla aprovação/saldo conciliado e notificações de cancelamento/refund não foram implementados. Controle manual e evidências do Asaas são necessários para encerramento financeiro.

## Revisão acumulada 01–04

- Fabricação/frete: dates civis e snapshots, validação de cronograma, legado sem datas fictícias, cotação sem opção/prazo inventado e comunicação consistente no frontend/backend/e-mail.
- Financeiro: cancelamento separado de devolução, reserva ativa liberada uma vez, observações de exceção, claim durável de cobrança e bloqueio de replay/pagamento inconsistente.
- Auth/segurança: reset atômico, ownership antes de snapshot de frete, adminProcedure, logs com token redigido e testes de regressão.
- Isolamento: build/runtime exigem `VITE_DEPLOY_TARGET=staging` e `VITE_API_URL=https://api-staging.l4ckos.com.br`; backend exige URLs/credenciais staging/Sandbox explicitamente configuradas. Defaults externos reais ainda exigem preflight, não foram alterados nem consultados remotamente.
- Migration 0022: aditiva, sem backfill de históricos; legacy flag0/new default1; hash `f6f3ec21394b03da2920d88b163d3aa512a6fe74da4aea4a689dda4f828b26c1`; manifests/contrato/bootstrap v3 conferidos pelos leitores locais. Backend novo exige schema v3; sequência **0022 → backend → frontend**, com pausa de escrita e health/API entre deploys. Frontend/backend devem vir do mesmo commit.
- Identidade não documental: **588 arquivos**, hash `c579dbafada47c1e7d3198d58264eb1923800d2747a49f74bd6d7cfae3a435b3`, igual ao gate anterior. Nada funcional alterado nesta formalização. Diff revisado e escopo coerente; nenhuma alteração acidental identificada.
- Busca sanitizada nos arquivos candidatos não encontrou assinaturas de chaves privadas/AWS/providers/Asaas; URLs autenticadas encontradas são exemplos e fixtures, não credenciais reais novas. Scanner completo/CVEs/configuração remota não executados.

## Relação exata para futuro commit

**57 caminhos: 36 rastreados modificados e 21 novos.** Incluir todos explicitamente após autorização; não executar `git add .`/`git add -A`. O HEAD isolado não contém o delta. Código já commitado também compõe a release; esta lista é somente a diferença contra HEAD.

### Modificados

```text
client/src/components/CartDrawer.tsx
client/src/components/PreorderInfo.tsx
client/src/components/admin/batches/AdminBatches.tsx
client/src/components/admin/orders/AdminOrdersUI.tsx
client/src/const.ts
client/src/pages/AcompanharPedido.tsx
client/src/pages/Admin.tsx
client/src/pages/FAQs.tsx
client/src/pages/MeusPedidos.tsx
client/src/pages/Pagamento.tsx
client/src/pages/PedidoDetalhe.tsx
client/src/pages/ProductDetail.tsx
database/bootstrap/bootstrap.ts
database/migrations/runner.ts
database/schema/artifacts.ts
drizzle/schema.ts
scripts/database-schema.ts
server/_core/security.ts
server/controllers/paymentController.ts
server/database/checkout.mysql.test.ts
server/database/checkout.ts
server/database/preorder.mysql.test.ts
server/database/preorderUi.test.ts
server/database/productionBatches.ts
server/db.ts
server/emails/transactional/OrderCreated.jsx
server/emails/transactional/PaymentApproved.jsx
server/routers.ts
server/routers/admin.ts
server/routers/orders.ts
server/security-hardening.test.ts
server/services/email/emailService.js
server/services/emailService.d.ts
server/services/shippingService.ts
shared/preorder.ts
vite.config.ts
```

### Novos (incluindo este relatório)

```text
database/bootstrap/manifest-v3.json
database/bootstrap/v3/orderItems.sql
database/bootstrap/v3/productionBatches.sql
database/migrations/0022_preorder_manufacturing_schedule.sql
database/migrations/manifest-v3.json
database/schema/contract-v3.json
docs/preorder/cancellation-refunds-review.md
docs/preorder/final-functional-audit.md
docs/preorder/operational-release-preparation.md
docs/preorder/refund-reconciliation-runbook.md
docs/preorder/shipping-deadlines-review.md
docs/preorder/staging-homologation-checklist.md
docs/preorder/staging-release-candidate.md
server/_core/security.logging.test.ts
server/apiConfig.test.ts
server/auth.release.test.ts
server/database/manufacturingSchedule.test.ts
server/database/orderShippingSnapshot.ts
server/database/shippingDeadlines.test.ts
shared/apiConfig.ts
shared/paymentExceptions.ts
```

## Exclusões e mensagem proposta

Nenhum dos 57 caminhos deve ser excluído: formam código, schema, testes e documentação do mesmo escopo. Excluir do futuro contexto de release `.npmrc` local, `.env*` locais, credenciais/configuração privada, `node_modules`, `dist`, relatórios temporários, backups/dumps, sockets e artefatos de teste. `node_modules` e `dist` existem localmente e estão ignorados; `.npmrc` e `.env` na raiz da aplicação estão ausentes. Exemplos de configuração versionados não se confundem com env privado. Package/lockfile não alterados. Não incluir referências Git sintéticas de testes em /tmp como origem publicável.

Mensagem de commit proposta:

```text
feat(preorder): finalize V1 release candidate and approved financial runbook

Add manufacturing schedules and purchase snapshots with migration 0022.
Harden payment reconciliation, cancellation, password reset and API isolation.
Document founder-approved manual refunds, audit duties and staging release gates.
```

## Verificação e pendências

Node 22.23.2 / pnpm 10.4.1. **94 testes locais aprovados em 8 arquivos, zero falhas/ignorados** na repetição final; primeira tentativa teve três restrições listen EPERM de loopback. Contrato/bootstrap/lineage v3 e checksums locais válidos; inventário, links e diff --check validados. Sem instalação de dependências. Build/check/MySQL/suíte completa não repetidos por se tratar de formalização documental; evidências anteriores e comandos/resultados desta tarefa estão separados na seção 12 da RC.

Antes de publicar: autorização específica, commit/fonte limpa, preflight/configuração staging efetiva, backup persistente com restore em clone e evidências de preservação, executor 0022 governado, responsáveis nominais/canal e janela. Depois: deployments ativos no SHA, startup/health/API/bundle, homologação das modalidades anunciadas/auth/frete/e-mail/recovery. Backup/restore, ordem e critérios GO/NO-GO nas seções 7, 9, 10 e 12 da RC. A política foi aprovada; a homologação operacional e os gates externos continuam pendentes. Nenhum GO desta preparação autoriza publicação ou produção.
