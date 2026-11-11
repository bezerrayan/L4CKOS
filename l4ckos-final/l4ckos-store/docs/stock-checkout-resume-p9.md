# STOCK authenticated resume — Gate P9

Local only. No application route is mounted, no remote SQL was used and no provider API was called.

## Persistent ownership and HTTP boundary

- `ownerUserId` is set by the server-authenticated checkout caller and persisted on each synthetic `stockCheckoutAttempts` row. The checkout domain requires a positive owner before any enabled checkout IO; replay under a different owner returns the same generic `CHECKOUT_ATTEMPT_NOT_FOUND` as an absent attempt.
- `resumeStockAttemptHttp` reads the authenticated session context, validates `attemptId`, and never reads `body.userId`. Missing session is 401; malformed ID is 400; missing and foreign attempts are indistinguishable 404 responses.
- `findAttemptForOwner` performs one parameterized persistent `SELECT` with both `attemptId = ? AND ownerUserId = ?`. It is read-only and returns a narrow projection. Snapshots, fingerprint, owner ID and unrelated account data are not exposed.
- Resume does not invoke checkout, create a payment, mutate a reservation or write a webhook. Checkout creation still checks `PUBLIC_CHECKOUT_DISABLED` before owner validation, input/database access or provider IO. Authenticated resume remains available while that financial gate is closed.
- This is a local adapter contract, not a mounted HTTP route. Its future route must pass the authenticated server session; it must not derive the principal from request body/query data.

## State map

| Persisted state | V1 response | Can start another attempt? |
|---|---|---:|
| `reserved / not_started`, expiration not due | `reserved` | No |
| `reserved / creating`, before expiration | `creating` | No |
| `reserved / created` | `pending` | No |
| `ambiguous`, reconciliation marker, or `creating` after persisted expiry | `ambiguous` | No |
| `paid` | `paid` | No |
| `released / definitive_failure` | `failed` | Yes |
| `released / not_started` | `expired` | Yes |
| `reserved / not_started`, but expiry is due and release worker has not persisted it | `expired` | No; wait for release processing |

The expiration decision uses persisted database time in the query. The status read does not release stock. A `creating` attempt that passed its persisted reservation deadline becomes `ambiguous`, not a presumed payment failure. Checkout URL is returned only for `pending`; reconciliation responses do not expose it. The current domain has no distinct persisted user-cancellation state, so `cancelled` is reserved in the shared response enum but is not emitted.

Definitive `failed` or released `expired` responses carry `canStartNewAttempt=true`. `client/src/stock/stockCheckoutClient.ts` requires that server flag before replacing the attempt ID. An ambiguous state, timeout, missing response or ordinary pending response preserves the same ID. If the attempt is locally absent, resume fails without generating an ID or making a request. A changed cart uses a separate fingerprint/attempt.

## Frontend handoff

The local client adapter resumes from the cart-restored fingerprint and stored ID. It does not require the current catalog row to remain active just to query an existing attempt; create still validates the real variant ID against the catalog. Timeout leaves the stored attempt unchanged. A legacy cart item without a validated `variantId` is rejected before checkout transport.

`stockAttemptStatusLabel` provides Portuguese labels for reserved, creating, pending, ambiguous, paid, failed, expired and cancelled states. The existing `Pagamento` page remains on its legacy payment contract and is not wired to the STOCK adapter in this gate. A real page integration needs the authenticated local query route and a UI/product decision that does not alter PREORDER handling.

## Synthetic schema change

The disposable P5/P6 fixture now adds `ownerUserId INT UNSIGNED NOT NULL` and an owner lookup index to `stockCheckoutAttempts`. This is fixture-only DDL; no migration was created or executed. The production schema has not been attested, so these names/columns are not assumed remotely available.

## Tests and security checks

Focused Vitest covers owner vs foreign/missing, absent session, invalid ID, generic 404, status mapping, ambiguous status, refresh/retry, resume timeout, terminal retry gate, legacy cart, duplicate payment handling and the closed checkout gate. The disposable MySQL 8.4.11 suite validates the owner-qualified lookup and existing transaction invariants. No real API/credentials are used.
