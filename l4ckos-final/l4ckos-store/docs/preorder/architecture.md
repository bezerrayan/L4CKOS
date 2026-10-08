# PREORDER/BATCH — architecture audit (baseline 83ee0d8)

| Current component               | PREORDER impact                                     | Minimal change                                                                                   |
| ------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| products / productVariants      | Physical stock must not gate preorder               | STOCK default; normalized batch/product assignment; trusted server mode                          |
| checkout.ts                     | All items currently require stock                   | Validate batch under sorted row locks; reserve only STOCK; full payment unchanged                |
| orders / payment confirmation   | Trusted payment evidence exists                     | Derive demand from confirmed evidence and noncancelled order; no demand table                    |
| orderItems                      | Price/name/options snapshots exist                  | Freeze mode, batch ID/name and shipping estimate                                                 |
| stockReservations               | Used as primary read model                          | Read orderItems first, retain unlinked historical reservation fallback                           |
| cart / shipping                 | Single shipping choice and tracking per order       | Mixed cart ships together when all items available; one freight calculation                      |
| admin                           | Existing adminProcedure, audit and product sections | Batch router/section; audited transactional mutations and explicit transitions                   |
| customer tracking               | Existing order status                               | Derive production state per purchased batch; shipment status takes precedence                    |
| emails                          | Existing order summary                              | Add preorder context to item description; existing dispatch only, local mocks                    |
| Drizzle / bootstrap / runner V2 | v1 checksum is baseline ledger identity             | Preserve v1; 0021 additive migration and v2 expected contract/bootstrap; no new baseline         |
| backup/restore                  | Explicit ordered table inventory                    | Add batch tables before dependent items; accept old backups, require new pair on migrated schema |

## Decisions

Full payment only. Confirmed demand requires paymentStatus=confirmed, paymentConfirmedAt and trusted manual actor or webhook reference, and order status paid/processing/shipped/delivered. pending, cancelled and unconfirmed are excluded. Batch cancellation does not erase paid demand; production is stopped and an explicit paid-order warning/acknowledgement is required. No automatic refund.

Capacity counts all noncancelled checkout orders (including pending provider recovery). This is a logical claim derived from orderItems, not a physical stock reservation. It is serialized by the batch row lock across every product in the drop. Automatic timed release is unsafe: the current adapter cannot invalidate a still-payable charge atomically and accepts delayed payment. Therefore claims do not expire automatically; abandoned orders require explicit administrative cancellation after provider reconciliation. A late payment on a cancelled order remains cancelled and never enters production. This conservative V1 avoids oversell without adding a hold table or changing certified STOCK behavior.

Minimum is informational only. One active assignment per product prevents ambiguous batch selection while each batch supports multiple products. Historical items retain their batch even after reassignment. Cancelled/completed batches cannot reopen. No split shipment. Shipping readiness is checked server-side before shipped/delivered transitions.

## PRE-LAUNCH OPERATIONAL LIMITATION — refund and capacity

An external refund alone does **not** remove confirmed production demand: the current confirmation evidence and noncancelled order state still satisfy the demand predicate. A manually refunded PREORDER order must also have its corresponding state resolved through the authorized operational order workflow (provider reconciliation, administrative cancellation and audit). Coordinate any already-submitted factory demand separately. Batch cancellation alone retains confirmed demand. No automatic refund or refund webhook integration is introduced.

`pending + paid` continue to occupy `maximumQuantity`; pending claims do not expire automatically. Order cancellation frees capacity. For the first drop, use `maximumQuantity=NULL` unless there is an actual hard production limit. Do not use the informational minimum as an order cap.

Production groups, paid order counts, quantities, gross item values and pending counts are derived from **one InnoDB consistent SELECT**. Payment interleaving after that read cannot move an order between its groups and totals. Batch metadata and product assignments are separate reads; they do not determine payment demand. The administrative transition transaction remains READ COMMITTED; no nested transaction or extra write lock is added.
