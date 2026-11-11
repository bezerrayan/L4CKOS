# L4CKOS launch core — GO/NO-GO checklist

Snapshot date: 2026-11-10. Scope: local preparation in `launch/codex-core`; no remote changes.

| Gate | State | Evidence / remaining condition |
| --- | --- | --- |
| Production schema compatibility | **NO-GO** | P15–P17 provide a reviewed metadata-only attestation path and partial table/TLS evidence. Current columns, defaults, keys, FKs, checks, triggers and migration history are not attested. P26–P28/checkpoint artifacts were not found in the supplied/reference repository trees. |
| STOCK 0027 isolation | **PASS locally / NO-GO remotely** | Separate SQL path; no Drizzle journal change or `0008–0017` replay; schema/already-complete/partial guards; default `isActive=0`; disposable MySQL 9.7.2 test passed. Production structure and partial-DDL recovery remain unknown. |
| Current backup and isolated restore | **NO-GO** | No current target backup plus successful isolated restore evidence is available in this worktree. |
| Inventory source and writer arbitration | **PARTIAL / NO-GO** | Local legacy and STOCK reservation paths now share the product-row lock. Legacy reserve refuses products with active STOCK variants; STOCK reserve refuses unexpired variantless legacy reservations. Historical inventory reconciliation, production reservations, admin ID-preserving variant workflow, and external writers are unresolved. |
| Atomic reservation and oversell regression | **PARTIAL / NOT VERIFIED** | STOCK adapter uses row locks, conditional updates, unique attempt/reservation constraints and stable lock ordering. Added MySQL regression for legacy reservations, but Vitest/MySQL adapter suite could not run because this worktree has no `node_modules`. |
| Order/payment amount integrity | **PASS in local code / TEST PENDING** | Order/line total above signed MySQL `INT` now fails before order creation, reservation or provider call; regression added. Vitest not run. |
| Webhook owner and idempotency | **NO-GO** | STOCK boundary validates Asaas token signature and transactional event/hash dedupe. It is not mounted. Legacy webhook now refuses STOCK orders with HTTP 503 before claiming the event; `markOrderPaid` also rejects them. One dispatcher/ledger owner and retry/recovery policy still need integration. |
| Backend contract to checkout UI | **DOCUMENTED / NOT LIVE** | V1 contract records `stockCheckout.create`/`resume`, auth, IDs, payload, idempotency, states and errors. Router is mounted in `appRouter`, but runtime composition is absent and public checkout remains closed. |
| Critical local regression suite | **PARTIAL** | Fresh disposable MySQL 9.7.2 migration run passed. Focused Vitest invocation was blocked: `vitest` not found; dependencies were not installed. Staging and Asaas sandbox were not accessed. |
| Deployment, payment or production writes | **PASS: NONE** | No remote read/write or deploy was performed in this cycle. |

## Required before homologation

1. Provide an authorized read-only metadata principal and exact connection context to run the existing P16 attestation once; capture complete sanitized structure/history and compare it with 0027.
2. Prove a current backup restores in an isolated compatible MySQL environment.
3. Reconcile active legacy reservations and physical inventory; freeze/identify every external writer; define the explicit admin workflow to activate canonical variants while preserving IDs.
4. Integrate one Asaas dispatcher and event ledger that routes by `stockAttemptId`; prove duplicate/retry/failure recovery in sandbox.
5. Compose the MySQL store/provider runtime, run typecheck and focused Vitest/MySQL regressions in an approved dependency environment, then complete authorized staging homologation.

**Decision:** `NO-GO` for production migration, deployment, checkout activation, product activation, or real payments. `GO` only to continue local implementation and prepare the authorized read-only attestation/backup gates.
