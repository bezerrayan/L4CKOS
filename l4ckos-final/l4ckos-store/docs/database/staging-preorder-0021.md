# Fixed authorized staging executor — 0021

Implementation and tests are local only. This document grants no remote permission.
Future target is exclusively the existing `l4ckos-staging` project
`2bb90c8e-eb65-43ee-826b-f93750f0499c`, application service and exclusive private MySQL
bound by independent Railway identity/network metadata. The Railway environment is
named `production` **inside that staging project**; it is not the L4CKOS production
project. Identity constants are shared in value with the 0020 executor, never supplied
through CLI/env/plan target selectors.

| Identity | Reviewed value |
| --- | --- |
| Name | `0021_preorder_production_batches` |
| SQL SHA256 | `46e7b40f6320659791ba90d3ebaf4c4cc031e84de36f5bdf8789ab1993d0233d` |
| PRE | `f2baf7519cb425c955bfd0f697da10afa670ee57763e3f641b61a09ba75b7f8d` |
| POST | `6654c63ea42bbcb84af99e7640f24d3963581128a6a5387898b12b34cbbca93a` |

## PREPARE (requires separate future authorization)

`pnpm db:staging:preorder:prepare --commit <approved-40-character-SHA>`

Source must be committed and clean. No dotenv or arbitrary SQL/database/project flags
are accepted. The transport bundles source and artifacts from that exact Git SHA.
Sequence: source → fixed identity → HTTP health → two PRE fingerprints → validated
ledger/executions → business backup → preserved copy → separate governance checkpoint
→ local MySQL restore proof → repeated identity/schema/ledger/source checks → sealed plan.

Prior ledger must contain exactly one real 0020 RECONCILIATION and one canonical-v1
BASELINE, zero legacy entries, and no 0021. Existing lineage checks enforce checksums,
manifest versions, fingerprints, ordered chain and no incomplete executions. PREPARE
neither initializes nor mutates remote governance.

Business backup includes all 26 PRE business tables, including `asaasWebhookEvents`.
It deliberately excludes `_l4ckos_schema_migrations` and `_l4ckos_schema_executions`.
Therefore `governance.json` separately records **every prior ledger and execution row**,
with overall, ledger and execution checksums. It is captured and preserved before restore.
It is evidence, not an automatic governance restore or permission to overwrite history.

Artifacts live in `<repository>/.local/staging-0021/<planId>/`, not volatile `/tmp`:
`backup.json`, `governance.json`, `restore-proof.json`, `plan.json`, `seal.json`, and
`result.json` after APPLY. Directories are private 0700 and files 0600; anchored file
access rejects symlinks/hardlinks and unsafe ownership/modes. `.local` is excluded from
Git and Docker context. Preserve the entire directory and root `.plan-key` through
operational recovery. A failed restore leaves backup, governance and prepare-failure
records; it cannot produce a usable plan.

The 15-minute plan binds target/deployment/connection identity, application SHA,
expected/observed PRE, POST, 0021 checksum, backup row counts/checksums/artifact checksum,
restore proof checksum, governance ledger/execution checksums, health and expiry.
HMAC is checked by the local controller before the trusted fixed transport. It does
not depend on an unkeyed checksum alone. The remote capability is opaque,
connection-bound, runtime-bound and specific to 0021.

## APPLY (requires separate future explicit authorization)

`pnpm db:staging:preorder:apply --plan <returned-absolute-plan-path> --confirm <planId>`

Review the concrete plan, target and SHA before authorizing that command. The controller
validates HMAC, expiry, private artifacts, target, source and health. Under the same
bounded `GET_LOCK` used by the existing schema runner, the fixed remote body validates
live PRE, lineage, exact governance snapshot and fresh business backup checksums.

Only the four reviewed statements of 0021 are permitted. No 0020 DDL, baseline,
legacy ledger record, business DML, db:push or manual bypass can be selected. Statement
progress is persisted through the existing execution mechanism. POST must match before
exactly one MIGRATION ledger row and completed execution are committed atomically:
`manifestVersion=2`, `runnerVersion=2.0.0`, `applicationCommit=<approved SHA>`.
Prior ledger and executions remain intact. A valid replay verifies POST, the entire
history, unchanged prior governance, approved SHA and exactly one completed four-statement
0021 execution, then returns `UP_TO_DATE`. The 0020 policy/transport/body remain unchanged;
only a separate capability entry point shares the existing schema lock implementation.

## Failure and recovery

MySQL DDL is forward-only and may commit implicitly. Failure after any statement,
after DDL before ledger commit, lost connection, invalid POST or ambiguous transport
result requires `RECOVERY_REQUIRED`. No blind retry, rollback DROP/ALTER, baseline rewrite,
history repair or automatic stale-lock deletion is offered. A failed/STARTED execution
also blocks a new plan's runner. Preserve backup, governance snapshot, proof, sealed
plan, local result and remote execution checkpoint; transport retains sanitized checkpoint
metadata when available. Interrupted APPLY leaves an exclusive plan lock as evidence.

Recovery requires inspection of actual schema, execution and ledger against those
artifacts and a separately reviewed recovery procedure. Business restore alone cannot
restore governance. Successful DDL/ledger followed by lost response is still operationally
ambiguous and is recorded as recovery-required by that plan; do not bypass it.

## Local evidence

`staging0021Executor.test.ts`: identity, plan/HMAC/expiry, private artifacts, path/symlink,
forged capability and forbidden CLI flags. `staging0021Executor.mysql.test.ts`: actual
8.4.11 PRE ledger, real 26-table backup/restore, separate checkpoint, APPLY/replay,
immutable prior governance, data/drift/checksum/SHA/target/health guards, shared lock,
concurrent callers, failures after 0/1/2/3/4 statements, failed restore evidence and
independent Docker restore. `staging0021Transport.test.ts`: mocked fixed Railway metadata
and an exact-Git bundle test pending execution after the worktree is committed and clean. No remote credentials or real email are used.
