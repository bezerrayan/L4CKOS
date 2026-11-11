# STOCK checkout backend contract V1

Status: shared contract for the checkout UI work. The disposable loopback test server composes the runtime and webhook owner through an explicit fixture-only injection; production deliberately has no STOCK runtime. This contract does not enable public checkout or authorize a deploy.

## Calls

The application uses tRPC (`trpc.stockCheckout.*`) with the existing authenticated session. The test server composes `ctx.stockCheckoutRuntime` only when the explicit disposable loopback guard matches. Production intentionally has no runtime and returns `SERVICE_UNAVAILABLE`; create is also blocked by the public-checkout gate until schema and release gates are approved.

| Procedure | Input | Result |
| --- | --- | --- |
| `stockCheckout.create` mutation | `{ attemptId, items, delivery }` | `{ attemptId, orderId, status, paymentId?, checkoutUrl?, amountCents, replayed }` |
| `stockCheckout.resume` query | `{ attemptId }` | `{ attemptId, status, orderId, paymentId?, checkoutUrl?, amountCents, reservationExpiresAt, canStartNewAttempt }` |
| `stockCheckout.resumeLatest` query | no input (or `{}`) | Latest persisted attempt owned by the authenticated user, in the same resume shape, or `null` |

Both procedures require an authenticated user. Ownership comes from the server session; a client `userId` is rejected by strict input parsing and is never trusted. `resume` is a read-only owner-scoped lookup. A foreign attempt is returned as not found.

## Selection and idempotency

Each item is `{ productId: number, variantId: number, quantity: number }`; both IDs are positive integers and quantity is 1–99. `variantId` is the canonical selected inventory row and `productId` must match its actual parent. Up to 30 lines are accepted. The server loads the current variant, checks active state and uniqueness, and derives SKU, size, color, price and availability. UI-provided price, SKU, size or color is not accepted as authority. Do not infer a `variantId` for a legacy cart/order.

`attemptId` is the client-generated idempotency key, 16–120 characters matching `[A-Za-z0-9_-]`. Reuse it only for the exact same items and delivery payload. The server fingerprints normalized items plus delivery: an identical replay returns the same order/payment; a different payload, owner, paid attempt or released attempt cannot reuse it. The provider key is `stock:<numeric orderId>` and is stable across retries. If a provider result is ambiguous and the provider does not guarantee idempotency, the attempt is held for reconciliation; the UI must resume the same attempt and must not create another payment.

The accepted order total must also fit the legacy signed MySQL `INT` (`≤ 2,147,483,647` centavos). Larger line or order totals fail before order creation, reservation, or provider I/O.

`delivery` is required at the router boundary and is currently the single option `local-plano-piloto`, with a validated address snapshot. The domain permits omission for tests/internal use. Local eligibility is exactly CEP `70000000`–`73999999` inclusive, from the approved P12 territory. The same predicate is used by quote and checkout. Outside that range, only a valid Melhor Envio quote is eligible; provider absence, failure, or empty quotes return no options and never invent local delivery.

## States

- Attempt: `reserved`, `paid`, `released`.
- Provider: `not_started`, `creating`, `ambiguous`, `created`, `definitive_failure`.
- Administrative order `status`: `pending`, `processing`, `paid`, `shipped`, `delivered`, `cancelled`; `paymentStatus`: `unconfirmed` or `confirmed`.
- Normalized Asaas event state: `pending`, `paid`, `failed`; the client cannot set any payment state.
- Create response: `pending`, `paid`, `reconciliation_required` (current create adapter returns `pending` when it has a payment URL).
- Resume response: `reserved`, `creating`, `pending`, `ambiguous`, `paid`, `failed`, `expired`, `cancelled`.
- Administrative order projection begins `pending` / `unconfirmed`; the verified first payment confirmation moves it to `paid` / `confirmed`. A failed/cancelled payment releases the reservation once and cancels the still-pending projection.

No client action may mark an order paid, consume stock, or release a reservation. A timeout/unknown provider outcome keeps stock reserved pending reconciliation. Expiry releases only an attempt that never started provider creation; an in-flight/ambiguous provider attempt is marked for reconciliation and is not released automatically.

## Errors for the UI

| tRPC code | Meaning | UI behavior |
| --- | --- | --- |
| `UNAUTHORIZED` | No authenticated session | Ask the user to sign in; preserve cart locally. |
| `FORBIDDEN` | Public checkout gate is closed | Keep the cart; do not retry automatically until the server gate is deliberately enabled. |
| `SERVICE_UNAVAILABLE` | Runtime is not composed/available | Keep the attempt ID and allow retry/resume later. |
| `CONFLICT` + `data.appError.code=STOCK_UNAVAILABLE` | Variant is inactive or stock is insufficient | Refresh catalog/cart and ask customer to adjust selection. |
| `CONFLICT` + `data.appError.code=CHECKOUT_ATTEMPT_EXPIRED` | A not-yet-submitted reservation expired before provider creation | Start a new attempt only after the server reports terminal/retryable state. |
| `CONFLICT` + `data.appError.code=PAYMENT_UNDER_ANALYSIS` | Provider outcome or payment correlation needs reconciliation | Do not create another payment; resume the same attempt. |
| `CONFLICT` + `data.appError.code=CHECKOUT_ATTEMPT_NOT_REUSABLE` | Attempt is changed, already paid, or released | Query the attempt; create a new attempt only when server says `canStartNewAttempt`. |
| `NOT_FOUND` | Attempt is absent or belongs to another user | Treat as unavailable; do not reveal ownership. |
| `BAD_REQUEST` | Invalid selection/address/attempt or other validation failure | Ask the user to review the selection/address. |

The stable application code is `error.data.appError.code`; do not interpret message text. Zod validation errors may be returned by tRPC before the procedure executes.

## Payment/webhook boundary

Asaas authenticity uses the existing `asaas-access-token` verifier and configured `ASAAS_WEBHOOK_TOKEN`; missing token fails closed. The candidate STOCK boundary validates signature before decoding or database I/O, accepts recognized payment event/status pairs, BRL amount, external order reference and payment ID, then claims `(eventId, payloadHash)` transactionally. Same event/hash is duplicate; same ID with changed payload is conflict. A paid event must match payment ID and exact cents before one atomic attempt/order transition and reservation consumption.

The mounted `/webhook/asaas` and `/api/webhooks/asaas` URLs share one handler. It resolves the order once; legacy orders go to `asaasWebhookEvents`/`markOrderPaid`, while `stockAttemptId` orders go only to the STOCK runtime and `stockWebhookEvents` ledger. The STOCK branch validates the existing `asaas-access-token` mechanism, transactionally claims event ID/hash, and returns before the legacy ledger or financial writes. If the STOCK runtime is absent, it returns HTTP 503 without acknowledging or mutating the event. Runtime injection requires `STOCK_LOCAL_HARNESS=true`, `NODE_ENV!=production`, loopback host, database `l4ckos_stock_test`, user `stock_test`, and the runtime's effective MySQL pool identity to match that disposable target. Production has no STOCK runtime composition until schema/backup/homologation gates are approved, so it remains fail-closed. No parallel legacy/STOCK processors are allowed.

## Test interface

UI tests should use the typed `AppRouter` tRPC caller with an authenticated synthetic user and a composed fake `StockCheckoutRuntime`; the checkout service also accepts a fake `StockPaymentProvider` and a disposable transactional store. Required cases: invalid/foreign variant, no stock, same-key replay, changed-payload replay, ambiguous provider result/resume, duplicate webhook, conflicting event hash, payment amount mismatch, cancellation/expiry, and unauthenticated access. No real Asaas payment is needed. MySQL integration tests require an isolated disposable schema and synthetic rows.

Contract source: `shared/stockCheckoutV1.ts`, `server/routers/stockCheckout.ts` and `server/stock/stockCheckout.ts`. Any incompatible edit requires updating this document and coordinating it with the UI owner before implementation.
