# Candidata consolidada seguinte (local, sem deploy)

Branch `release/consolidated-20261111` · base `2b06848` (versão implantada no Gate 5, intocada) · sem alteração de schema, Railway, Vercel ou GitHub.

## Integração

| Origem | Commit original | Aqui |
| --- | --- | --- |
| Reconciliação financeira tardia (`fix/late-payment-reconciliation`) | `e64db95` | `ff99529` |
| Preços minimalistas (`ui/storefront-minimal-prices`) | `fc63a50` | `bf4f659` |
| Prova de grants mínimos (novo) | | `5c8a971` |

Sem conflitos (as duas branches não tocam os mesmos arquivos). Preservados: loja V6, checkout STOCK V1, Drops, pré-venda por lote, login e painel admin,
Logística V1, TLS/segurança de homologação, preço herdado e liberação de cota após falha terminal.

## Reconciliação financeira (confirmada em MySQL 9.7.2)

Registro em `auditLogs` (`stock.reconciliation.required`) com pedido, tentativa, paymentId, evento e valores; idempotente (12 entregas concorrentes → 1 linha);
leitura só por `admin.reconciliationCasesList`; cota e capacidade preservadas; nenhum pedido confirmado nem pagamento iniciado; falha de auditoria desfaz a
transação e o provedor reenvia, e a reentrega grava uma única vez. Detalhes: `docs/late-payment-reconciliation-2026-11-11.md`.

## Preços minimalistas (confirmados no navegador, 1440/375/320)

Home, catálogo, PDP (preço e relacionados) mostram `89,00` / `1.289,90`; carrinho, gaveta, checkout, frete e admin mantêm `R$`; o `R$` segue no DOM como texto só
para leitores de tela; valores e cálculos inalterados (78/78 verificações).

## Privilégios MySQL (provados, não supostos)

Fase 2 de `scripts/run-stock-mysql-tests.sh`: a conta da aplicação (`stock_test`) é restrita a `database/staging/stock-runtime-grants.template.sql` e a suíte de
cotas/aprovação tardia/reconciliação (22 testes) roda inteira por ela; uma conta separada `stock_setup` só prepara e inspeciona. Qualquer instrução fora da lista falha
e o runner imprime a instrução rejeitada. O gabarito é **template**: nunca executado remotamente e sem DDL, TRIGGER, GRANT OPTION, privilégios globais ou DELETE em tabelas financeiras.

| Tabela | Privilégios | Motivo |
| --- | --- | --- |
| `users` | SELECT, INSERT, UPDATE | **toda** requisição autenticada faz `INSERT … ON DUPLICATE KEY UPDATE` de `lastSignedIn` |
| `products`, `productionBatches`, `productionBatchProducts` | SELECT, UPDATE | checkout trava linhas com `SELECT … FOR UPDATE` (MySQL exige UPDATE/DELETE além de SELECT) |
| `userAddresses` | SELECT | endereço do pedido |
| `productVariants` | SELECT, INSERT, UPDATE | reserva/consumo de estoque (`reservedStock`, `stock`) |
| `orders`, `orderItems` | SELECT, INSERT, UPDATE | pedido, snapshots, confirmação/cancelamento |
| `stockReservations`, `stockCheckoutAttempts`, `stockCheckoutItems` | SELECT, INSERT, UPDATE | ciclo da tentativa |
| `stockWebhookEvents` | SELECT, INSERT | claim/deduplicação (nunca UPDATE) |
| `auditLogs` | SELECT, INSERT | **reconciliação:** INSERT do caso + SELECT da checagem de idempotência e da consulta admin (nunca UPDATE/DELETE) |
| `exclusiveDrops`, `exclusiveDropProducts`, `exclusiveGrantUsage` | SELECT, INSERT, UPDATE, DELETE | Drops e cota (reposição de itens/uso) |
| `exclusiveAccessRequests`, `exclusiveGrants`, `exclusiveRedeemAttempts`, `exclusiveNotificationOutbox` | SELECT, INSERT, UPDATE | solicitações, códigos, outbox |
| `exclusiveEvents` | SELECT, INSERT | histórico |

**A reconciliação exige apenas `INSERT` e `SELECT` em `auditLogs`** (nada além do já usado por auditoria); o `FOR UPDATE` da tentativa usa o UPDATE já necessário em `stockCheckoutAttempts`.

Não provados (revisão de código; ver comentário no template): `asaasWebhookInbox` SELECT/INSERT/UPDATE e `asaasWebhookEvents` SELECT para o ingresso de webhooks; fluxos
de catálogo/conta/cupom/avaliação/backup do app exigem inventário próprio antes de qualquer conta não somente-leitura.

**Consequência para o ambiente isolado atual (conta somente-leitura):** catálogo público funciona, mas qualquer requisição autenticada (login, sessão, admin, carrinho)
falha com `AuthenticationBackendUnavailable` (503) por causa do upsert de `lastSignedIn`; e checkout/webhook não funcionam. Para a homologação de pagamentos será
preciso uma conta com os grants acima (aprovação e execução separadas; nada foi ampliado remotamente).

## Variáveis e itens para homologar pagamentos (futuro, sandbox Asaas)

- Gates: `PUBLIC_SITE_MODE=store`, `PUBLIC_CHECKOUT_ENABLED=true`, `STOCK_RUNTIME_ENABLED=true`, `STOCK_CHECKOUT_ENABLED=true`.
- Identidade do banco: `STOCK_DATABASE_ENV=staging`, `STOCK_EXPECTED_DATABASE=<schema>` (MySQL 9.7.2), mais `STAGING_DB_TLS_HOST/CA_PEM/CA_SHA256` já validados.
- Provedor (somente sandbox): `STOCK_ASAAS_MODE=sandbox`, `ASAAS_API_URL=https://api-sandbox.asaas.com/v3`, `ASAAS_API_KEY` (chave sandbox).
- Webhook: `ASAAS_WEBHOOK_TOKEN`, `ASAAS_WEBHOOK_INBOUND_ENABLED=true`, `ASAAS_WEBHOOK_RECOVERY_WORKER_ENABLED` e `PAYMENT_NOTIFICATION_RECOVERY_WORKER_ENABLED` conforme o plano.
- Frete (opcional): `STOCK_SHIPPING_SIGNING_SECRET` (≥ 32 bytes), `MELHOR_ENVIO_TOKEN`, `MELHOR_ENVIO_FROM_POSTAL_CODE`.
- Acesso/identidade: `STAGING_API_ACCESS_TOKEN`, `ADMIN_EMAILS`, `LOCAL_AUTH_ALLOWED_EMAILS` (`@example.invalid` na homologação) e, para e-mail, `RESEND_API_KEY` apenas quando aprovado.
- O guarda `assertStagingApiAccessConfiguration` exige hoje todas as flags de pagamento **fechadas**; abri-las é uma mudança deliberada de política, a aprovar à parte.
- Provedor sandbox lê `users.cpf` do comprador (SELECT já coberto).

## Qualidade

- MySQL 9.7.2: fase 1 = 7 arquivos / 106 testes; fase 2 (conta restrita) = 1 arquivo / 22 testes. Typecheck e builds (cliente/servidor) OK.
- Frontend: 26 arquivos / 255 testes. Segurança + TLS: 11 arquivos / 123 testes.
- Navegador real (backend local + MySQL descartável): preço herdado (18/18), cota no carrinho (39/39), preços (78/78), 14 rotas admin + deep link/reload (43/43), loja, drops,
  pré-venda em drop, Logística (1 pago / 1 pendente / 1 cancelado, capacidade 10), 401/403/503 (25/25).
- Suíte completa: **12 arquivos / 28 testes falhando, idênticos ao baseline herdado** (ops/tooling), 1338 passam:

- `server/database/financialWindowPackaging.test.ts`
- `server/database/manufacturingSchedule.test.ts`
- `server/database/order13AdministrativeObserver.mysql.test.ts`
- `server/database/order13Authorization.test.ts`
- `server/database/order13CustodyIntegrity.test.ts`
- `server/database/order13ObserverTransport.test.ts`
- `server/database/physicalBackupIdentity.mysql.test.ts`
- `server/database/preorderEmail.test.ts`
- `server/database/staging0022Packaging.test.ts`
- `server/database/tcpBackupPolicy.test.ts`
- `server/database/tunnelDiagnostics.test.ts`
- `server/routes/managerSyncRoutes.test.ts`
