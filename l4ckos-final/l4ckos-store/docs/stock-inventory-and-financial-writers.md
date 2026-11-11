# STOCK inventory and financial writer map

This map is based on the local code at the `launch/codex-core` base. It describes reachable writers; it is not proof that every production operator/job has been found.

| Writer | Current behavior | Guard added / remaining gate |
| --- | --- | --- |
| `orders.create` → `reserveStockForOrder` in `server/db.ts` | Reserves by `products.stock` and active `stockReservations` with `variantId IS NULL`. | Locks product rows in sorted order. Refuses a product once it has any `productVariants.isActive=1` row. |
| Legacy Asaas `/webhook/asaas` → `runAsaasWebhookOnce` → `markOrderPaid` | Confirms legacy orders and decrements `products.stock` for active product-level reservations. | Controller returns 503 before claiming the event if `orders.stockAttemptId` is present; `markOrderPaid` also rejects STOCK orders. A STOCK dispatcher/ledger owner is still required. |
| Admin `orderConfirmPayment` | Calls `markOrderPaid` for manual legacy confirmation. | Existing router guard and the helper guard reject STOCK orders. |
| Admin product create/update → `createProduct`/`updateProduct` and `replaceProductVariants` | Product-level stock is writable; generic variant replacement deletes and recreates rows. | STOCK variants default inactive. Referenced variant deletion is blocked by the migration's FKs, but an explicit admin workflow that preserves IDs and reconciles variant stock remains required before activation. |
| STOCK `reserveVariant` / `consumeReservations` / `releaseReservations` | Reserves and mutates `productVariants.stock` and `reservedStock`; writes variant-linked reservations. | Locks the same parent product row as the legacy reserve writer, rejects unexpired legacy product-level reservations, and serializes variant claims with row locks and guarded updates. IDs are locked in product/variant order. |
| Backup restore | Replaces persisted product, variant, order and reservation rows from a backup payload. | Operationally privileged writer; it must remain unavailable during checkout/financial mutation windows and is outside normal checkout authorization. |

## Sellable-stock rule

For a product with one or more explicitly reviewed active STOCK variants, `productVariants.stock - productVariants.reservedStock` is the STOCK sellable quantity. The legacy `products.stock` path is refused for that product. Before activating variants, an operator must reconcile physical stock and drain/reconcile active legacy reservations; legacy orders remain variantless. Product-level stock is not copied into variants automatically.

For a product without active STOCK variants, the legacy flow continues to use `products.stock` minus active product-level reservations. This split is safe only after the code and schema guards are deployed together. Do not enable checkout on a partial rollout.

## Remaining release blockers

- Production writers outside this repository (manual SQL, jobs, integrations and dashboards) are not inventoried.
- Active legacy reservations and per-variant counts have not been reconciled on the current database.
- Admin variant editing does not yet present the canonical STOCK identity contract or preserve IDs as a reviewed workflow.
- The STOCK webhook boundary is implemented but not mounted; the legacy controller deliberately refuses STOCK orders until one authoritative dispatcher/ledger is integrated.
- Current production schema is not fully attested, so these guarded queries are not approved for deployment yet.
