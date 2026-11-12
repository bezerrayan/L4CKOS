# Aprovação financeira tardia: trilha de reconciliação durável

Branch `fix/late-payment-reconciliation`, base `2b06848` (candidata consolidada). Sem migration, sem alteração de regra financeira.

## Causa raiz

`processStockWebhook` rejeitava corretamente um `paid` que chegava depois de uma falha terminal (retornava `conflict`; estoque, lote e
cota permaneciam liberados). Mas a rejeição só deixava a linha de deduplicação em `stockWebhookEvents` (`eventId`, `payloadHash`,
`receivedAt`, sem pedido/pagamento/valor) e um `securityLog`. Se o cliente tivesse sido cobrado, não havia registro durável e consultável.

## O que foi feito

- **Armazenamento (reuso, sem migration):** `auditLogs` (colunas físicas já existentes `actorType`, `orderId`, `event`, `correlationId`,
  `beforeState`, `afterState`). `action = "stock.reconciliation.required"`, `actorType = "system"`, `entity = "stockCheckoutAttempt"`,
  `entityId = attemptId`, `orderId` = id do pedido, `event` = tipo da divergência.
- **Tipos:** `PAID_AFTER_TERMINAL_FAILURE`, `PAID_AFTER_RELEASE`, `PAID_FOR_UNSTARTED_ATTEMPT`, `PAID_WITH_DIFFERENT_PAYMENT_ID`
  (todos só para eventos assinados com status "pago"; pending/failed contraditórios seguem como `conflict` sem registro).
- **Conteúdo (`metadata`):** `reconciliation: "open"`, kind, attemptId, orderId, paymentId e providerEventId do provedor, valor observado e
  esperado em centavos, paymentId da tentativa, `automaticReprocessing: false`. Sem dados pessoais e sem payload bruto (testado).
- **Atomicidade e falha fechada:** a escrita ocorre na mesma transação do claim do webhook. Se falhar, a transação inteira é desfeita
  (inclusive o claim) e a entrega não é confirmada; o provedor reenvia e o registro é gravado depois (testado renomeando `auditLogs`).
- **Idempotência:** o registro só é feito sob `FOR UPDATE` da tentativa; chave `kind:attemptId:paymentId` em `correlationId`.
  Evento repetido → `duplicate` pelo claim; eventos distintos da mesma cobrança → um único caso (12 entregas concorrentes → 1 linha).
- **Corrida paid × falha terminal:** se o `paid` perde a corrida (`markPaid` → `not-pending`), o estado é relido e a divergência é classificada.
- **Consulta administrativa:** `admin.reconciliationCasesList` (somente leitura, `adminProcedure`); os casos também aparecem em `admin.auditList`.
- **Não faz:** não reabre pedido, não restaura estoque/capacidade/cota (a tentativa continua `released`, `reconciliationRequiredAt` nulo para não
  voltar a reter cota), não confirma pagamento, não inicia cobrança.

## Migration

Nenhuma. Nada muda no schema; a execução no Railway não exige aprovação de migration.

## Limites conhecidos

- O estado é append-only (`open`); não há ação de "resolver". Ao tratar um caso, registrar outra entrada de auditoria (trabalho futuro).
- `paid` com valor divergente numa tentativa ainda **ativa** continua lançando `WEBHOOK_AMOUNT_MISMATCH` (transação desfeita, entrega não
  confirmada); não vira registro nesta rodada para não alterar a regra financeira existente.
- `failed`/reembolso depois de `paid` seguem como conflito/evento não suportado, sem registro (o dinheiro já está confirmado localmente).
- Sem UI dedicada; a consulta é por API administrativa e pela tela de Auditoria existente.
