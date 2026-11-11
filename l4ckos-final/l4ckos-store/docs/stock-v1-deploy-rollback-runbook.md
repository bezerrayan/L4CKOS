# STOCK V1 migration and rollback runbook

Status: preparation only. Production is prohibited without explicit authorization for the exact Railway project/service/schema and exact operation. No deployment, DDL, grant, or checkout enablement is authorized by this runbook.

## Release preconditions

1. Confirm source SHA, clean worktree, reviewed migration SHA, and intended isolated environment. Do not use the Drizzle runner, `db:push`, journal repair, or files `0008–0017` to apply STOCK.
2. Obtain an authorized read-only MySQL principal over the approved TLS route. Use the P15–P17 metadata-attestation runner and reviewed allowlist. Capture schema version, table/column definitions, defaults, indexes, unique keys, FKs, checks, triggers, and migration-history metadata. Sanitize output; do not include connection strings or commercial rows.
3. Compare the attestation with P13, P14 and every precondition in `0027_stock_v1_incremental.sql`. Any mismatch, partial STOCK object, unexpected FK, or uncertain migration history is a stop condition. Do not infer missing structure from a permission-limited query.
4. Measure existing duplicate SKU/options, orphan references, active product-level reservations, variant inventory and writers using separately authorized, privacy-safe aggregates. Do not infer variants for historic orders/reservations. Reconcile the dual stock source and select a single writer/inventory authority before product activation.
5. Obtain a current backup of the exact target and verify its identity, timestamp, scope and checksum. Restore it into an isolated MySQL 9.7.2 environment and record successful structural/data validation. A backup file or prior restore is not proof of a current restorable backup.
6. Resolve a single Asaas webhook owner and event ledger for STOCK orders, validate sandbox behavior, and confirm the exact code/deployment SHA. Keep public checkout disabled until every gate is accepted.

## Apply procedure (future authorized window only)

1. Capture and retain the sanitized pre-change attestation and backup/restore evidence. Record the SHA-256 of the exact approved SQL file.
2. Confirm project, project ID, environment, service, host, schema `railway`, and TLS identity from read-only control-plane metadata and the actual SQL session immediately before the write. Abort on ambiguity or any target mismatch.
3. Execute only `database/migrations/stock-v1/0027_stock_v1_incremental.sql` as an isolated change with an operator able to stop at first error. It is intentionally outside the Drizzle journal because `0008–0017` have an unresolved chain mismatch and backfill risks. Do not include any adjacent migration, seed, or backfill.
4. The SQL preconditions are fail-closed. MySQL DDL may commit implicitly; if an instruction fails, stop and preserve the exact error and resulting metadata. Do not rerun, auto-repair, or drop the helper procedure/tables until a reviewed state comparison exists.
5. After success, capture a second sanitized attestation. Compare all expected columns, types, nullability, defaults, indexes, FKs/checks and table engines. Verify legacy rows/values using approved aggregates and verify no historical order/reservation was assigned a variant.
6. Keep checkout closed. Runtime deployment, webhook routing, stock writer arbitration and functional smoke are separate gates with separate authorization.

## Rollback and recovery

- Before DDL: cancel the window; no database rollback is needed.
- After complete additive DDL but before checkout enablement: roll back application code if necessary, leave additive schema and any evidence intact. Do not drop tables/columns or fabricate a Drizzle history row.
- After partial DDL or data mutation: stop all related writes, preserve the target and logs, capture a sanitized state diff, and use the validated isolated restore only under a separately approved recovery decision. Do not attempt an automatic reverse migration; MySQL DDL is not transactionally reversible and STOCK records may have been created.
- After checkout has been enabled: disable new checkout through the approved fail-closed gate, reconcile provider payments and reservations first, then choose a forward repair. Never restore production blindly over orders/payments created after the backup.

## Current decision

`NO-GO` for production DDL, deploy, checkout enablement, payment, or product activation. Current evidence lacks a complete authorized read-only schema attestation, a current backup proven restorable in isolation, a single financial webhook owner, and a unified inventory writer policy. Local MySQL 9.7.2 disposable validation is useful but does not remove these blockers.
