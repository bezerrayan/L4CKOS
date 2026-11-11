# Checkout Claude ↔ backend STOCK — contrato final da branch Codex

Data: 2026-11-11. Revisado contra os commits Claude `a1f7cd9` e `7aa441d`.

## API e seleção

- `trpc.products.getById.useQuery(productId)` retorna `variants[]`; cada linha tem `id` (variantId), `productId`, `sku`, `size`, `color`, `active: boolean`, `isActive: 0|1`, `stock` e `price`. `active` é o campo para filtrar variantes vendáveis na UI. IDs são inteiros positivos.
- `trpc.stockCheckout.create.mutate({ attemptId, items, delivery })` exige sessão autenticada. `items` contém `{ productId, variantId, quantity }`, quantidade 1–99 e até 30 linhas. Nunca inferir variante para carrinho legado. O servidor relê preço, SKU, dimensão e estoque do catálogo; o cliente não é autoridade desses valores.
- `attemptId` é idempotency key cliente, 16–120 caracteres alfanuméricos, `_` ou `-`. Reutilizar somente para o mesmo conteúdo de itens e entrega. O servidor ainda usa `stock:<orderId>` na chamada provider.
- Resposta create: `{ attemptId, orderId, status: "pending"|"paid"|"reconciliation_required", paymentId?, checkoutUrl?, amountCents, replayed }`.
- `trpc.stockCheckout.resume.query({ attemptId })` consulta tentativa persistida, autenticada e limitada ao dono. `trpc.stockCheckout.resumeLatest.query()` recupera a tentativa mais recente do dono se o browser perdeu `localStorage`; retorna o mesmo shape de resume ou `null`.
- Resume: `{ attemptId, orderId, status, paymentId?, checkoutUrl?, amountCents, reservationExpiresAt, canStartNewAttempt }`. `status`: `reserved | creating | pending | ambiguous | paid | failed | expired | cancelled`.

## Entrega

O endpoint `POST /api/shipping/quote` só retorna opção local quando Melhor Envio retorna uma cotação válida ou CEP está entre `70000000` e `73999999` inclusive, a faixa territorial aprovada em P12. A opção local é `local-plano-piloto`; valores de shipping quote estão em reais. Fora da faixa, ausência/falha/resultado vazio do Melhor Envio resulta em `options: []`. O cliente deve bloquear checkout sem uma opção recebida do servidor.

`create.delivery` é obrigatório: `{ optionId: "local-plano-piloto", address: { recipient, zipCode, street, number, complement?, neighborhood, city, state } }`. O servidor valida novamente CEP e snapshot.

## Erros estáveis

Leia `error.data.appError.code` (a mensagem pode mudar):

- `STOCK_UNAVAILABLE`: variante inativa ou unidades insuficientes; atualizar carrinho/catálogo.
- `CHECKOUT_ATTEMPT_EXPIRED`: reserva não submetida ao provider expirou; não retentar o mesmo attemptId.
- `PAYMENT_UNDER_ANALYSIS`: resultado/correlação de pagamento incerto; não criar nova cobrança e consultar resume.
- `CHECKOUT_ATTEMPT_NOT_REUSABLE`: tentativa alterada, liberada ou paga.
- Códigos tRPC incluem `UNAUTHORIZED`, `NOT_FOUND`, `BAD_REQUEST`, `SERVICE_UNAVAILABLE` e `CONFLICT`.

## Persistência e pagamento

- Para linhas STOCK, `orderItems.variantId`, `skuSnapshot`, `sizeSnapshot` e `colorSnapshot` recebem o snapshot persistido; não inferir essas dimensões em pedidos antigos.
- Estados financeiros válidos: evento normalizado `pending | paid | failed`; pedido começa `pending/unconfirmed`, passa a `paid/confirmed` somente após webhook autêntico e correlação/valor conferidos. Evento tardio não pode regredir estado pago.
- `/webhook/asaas` é atualmente a única rota montada. Mantém ownership legado e responde 503 a ordem com `stockAttemptId` antes de tocar ledger ou pedido legado. A fronteira e ledger STOCK estão implementadas isoladamente e cobertas por testes; composição no handler de produção ainda é bloqueador. Portanto checkout público continua fechado.
- Testes MySQL usam exclusivamente `l4ckos_stock_test` em loopback; não são chamadas de pagamento real.

## Arquivos para compilar a integração

- Contrato wire: `shared/stockCheckoutV1.ts`
- Catálogo tRPC: `server/routers/products.ts`, `server/db.ts`
- Checkout tRPC e erros: `server/routers/stockCheckout.ts`, `server/_core/appErrors.ts`
- Domínio/persistência: `server/stock/stockCheckout.ts`, `server/stock/mysqlStockCheckoutStore.ts`
- Recuperação browser + estado seguro: `client/src/stock/stockCheckoutClient.ts`, `client/src/stock/stockAttemptView.ts`, `client/src/utils/cartPersistence.ts`
- Faixa e cotação de CEP: `shared/localDeliveryTerritory.ts`, `server/services/shippingService.ts`
- Referência do lado Claude: `docs/launch-checkout-frontend-contract.md` no worktree Claude.

O contrato é aditivo em `resumeLatest` e nos códigos `data.appError.code`. Não habilitar fluxo de pagamento até composição do runtime, owner único de webhook STOCK e preflight operacional do banco.
