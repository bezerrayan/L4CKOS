# RC3 Gate P6: ciclo de vida STOCK

## Escopo e preservação

- Worktree detached no SHA-base `ede02fc8380c8e4cfacf1cba7d0abbb7fc987156`.
- O domínio/adapter P4/P5 foi estendido; nenhum arquivo TLS foi alterado.
- Nenhuma rota foi montada ou editada. `createStockCheckoutRuntime` só compõe o pool já configurado, o adapter, o provider injetado, a fronteira assinada de webhook e o worker em lote.
- Checkout continua dependendo de `isPublicCheckoutEnabled()`; com o gate fechado, o factory falha antes de adquirir conexão ou chamar provider. Nenhuma env foi alterada.
- Nenhum módulo PREORDER/logística foi importado. Nenhuma chamada real ao Asaas, segredo real, Railway ou MySQL remoto foi usado.

## Política de expiração

O relógio autoritativo é `UTC_TIMESTAMP(3)` do MySQL. `stockCheckoutAttempts.reservationExpiresAt` e `stockReservations.expiresAt` são gravados junto com a reserva; o worker consulta o primeiro campo persistido, limita a consulta ao lote requisitado (máximo 500) e usa `FOR UPDATE SKIP LOCKED`. Pode ser chamado por um scheduler externo; não depende de timer em memória.

| Estado persistido ao vencer | Ação |
| --- | --- |
| `status=reserved, providerState=not_started, expiryReviewedAt IS NULL` | Elegível para expiração automática. Sob lock, marca released e libera contadores/reservas na mesma transação. O início do provider também bloqueia a tentativa: quem obtiver o lock primeiro decide; se expiração vencer, nenhuma chamada externa começa. |
| `providerState=creating` | Não liberar. Marca revisão/reconciliação requerida. A chamada pode ter sido enviada antes da queda. |
| `providerState=ambiguous` | Não liberar. Resultado externo desconhecido; manter inventário até consulta/reconciliação. |
| `providerState=created` e tentativa ainda reservada | Não liberar. Pagamento existe/pode confirmar; requer estado final do provider. |
| `status=paid` ou `status=released` | Terminal; não entra no lote. |
| Estado inesperado ou inconsistência de reserva | Erro/rollback; nunca converter em liberação automática. |

O lote marca `expiryReviewedAt` e `reconciliationRequiredAt` para estados incertos, evitando varredura infinita dos mesmos registros. Resolução autenticada por webhook pode confirmar/consumir ou falhar/liberar; o worker não decide por timeout que uma cobrança não existe. Falha parcial do lote reverte todo o lote transacionalmente.

## Fronteira financeira

`StockPaymentProvider` exige declarar se garante idempotência server-side da chave `stock:<orderId>`. A criação começa somente depois de persistir `providerState=creating`. Erro definitivamente sem cobrança marca definitive_failure e libera dentro da mesma transação. Erro incerto marca ambiguous e conserva a reserva. Retry enquanto a reserva ainda não venceu só pode ocorrer com garantia explícita de idempotência; caso contrário exige reconciliação.

Webhooks só entram pela API `processSignedStockWebhook`: o verificador recebe headers e corpo bruto; o decoder só é chamado depois da assinatura válida. A API interna de transição não é exportada. O evento normalizado precisa conter `orderId`, `paymentId`, valor, estado e event ID; pedido/tentativa, pagamento e valor são correlacionados. A transação grava hash do evento, correlação e estado financeiro/estoque juntos. O caller só recebe `processed` após commit; erro/commit incerto não vira confirmação de sucesso.

- Mesmo event ID e hash: replay duplicado.
- Mesmo event ID com outro hash: conflito, sem mudança financeira.
- Pagamento depois de released ou falha depois de paid: conflito, sem regressão; segue para reconciliação.
- Evento pending depois de paid é reconhecido sem downgrade.
- Webhook válido por `orderId` recupera uma cobrança criada antes de a persistência local do payment ID terminar.

A implementação concreta do verificador Asaas/provider não está ligada nesta etapa. A interface não autoriza usar o validador permissivo de desenvolvimento; integração futura deve injetar verificação estrita em produção e validação sandbox em homologação.

## Alterações sintéticas de schema

A fixture P5 ganhou apenas colunas locais para ciclo de vida:

- `stockCheckoutAttempts.providerState`: `not_started | creating | ambiguous | created | definitive_failure`.
- `reservationExpiresAt`, `expiryReviewedAt`, `reconciliationRequiredAt`, `paidAt`, `releasedAt`.
- Índice de lote `(status, reservationExpiresAt, expiryReviewedAt, attemptId)`.

O adapter segue usando tabelas candidatas `stockCheckoutAttempts`, `stockCheckoutItems`, `stockReservations`, `stockWebhookEvents` mais catálogo sintético. Isso não corresponde automaticamente a `orders`, `orderItems`, `asaasWebhookEvents` ou schema implantado. Nenhum DDL definitivo foi criado; dependência remota continua sem attestation.

## Testes e gates

- Testes MySQL 8.4.11 descartável: cobrem tentativa nunca submetida vencida, lote limitado/idempotente, estados creating/ambiguous/created retidos, corrida confirmação vs expiração, interrupção/restart, assinatura inválida antes do decode/DB, recuperação por order ID, eventos fora de ordem, retry com chave idempotente, cancelamento e overselling. Executar com `scripts/run-stock-mysql-tests.sh`.
- Provider é sintético e nunca envia cobranças.
- Typecheck `pnpm check`: PASS.
- Build `pnpm build`: PASS.
- Vitest `pnpm test`: PASS, 79 aprovados e 19 testes MySQL pulados sem o runner.
- MySQL 8.4.11 descartável `scripts/run-stock-mysql-tests.sh`: PASS, 19/19; contêiner removido ao final.

## Limites

- Não existe job de scheduler montado; o método em lote está pronto para ser invocado por worker autorizado.
- Cobranças em `creating/ambiguous/created` exigem integração de consulta/reconciliação ao provider antes de qualquer liberação; essa consulta não é implementada aqui.
- Compatibilidade com o schema de produção e grants do usuário MySQL permanece desconhecida e bloqueia qualquer promoção.
- Runtime factory não está montado em HTTP. Nenhum comportamento atual de checkout foi alterado.

`REMOTE_CHANGES=NONE`
