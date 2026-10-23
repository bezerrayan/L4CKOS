# Governed remote executor for staging v6

This operator is pinned to RC `88daab3046f5351b6724ad51f69041b4fd896509`, Railway project `2bb90c8e-eb65-43ee-826b-f93750f0499c`, environment `15545eee-bc02-4b70-afc4-19a5db9e6f46`, API service `9f1c7705-f2f9-48cf-b957-8f63a6bba4db`, MySQL service `bcda5d78-4a0d-4682-8659-8316847addb7`, and schema `l4ckos_staging`. The internal Railway environment label `production` is accepted only with the pinned staging project ID. The operator has no production target, arbitrary URL option, force option, or database URL argument.

`database/stagingV6/executor.ts` verifies the official release manifest and migration checksums, expected ledger prefix, schema fingerprint, SQL connection identity, MySQL 8.4 strict mode, and the fixed staging runtime. `diagnose` executes only metadata and aggregate `SELECT`s. `applyV6` mints an opaque, connection-bound, single-use capability and calls the official `migrateAuthorizedStagingV6` entry point; it does not contain replacement DDL. The runner records both entries in the existing execution and migration ledgers. It accepts only the exact sequential 0024/0025 lineage, rejects an unknown or incomplete ledger state, and refuses replay after completion. A completed 0024 with no active recovery record is reported as a recognized partial state, but apply remains blocked; recovery is a separate operation and is not implemented here.

Before any remote apply, the separate current-backup process must produce a private JSON proof with the `BackupGate` fields in `database/stagingV6/policy.ts`. The proof must identify the exact Railway project/environment/MySQL/schema, an off-Railway artifact, isolated MySQL 8.4 restore, 31 tables, verified checksums, zero FK violations, ledger tail 0023, and the required pre-migration fingerprint. The executor checks those fields, freshness, and a confirmation digest bound to the target, current API deployment, proof, RC, and migration checksums. The proof file must have mode `0600` or stricter. Do not hand-author or reuse a historical proof.

## Remote commands (not run as part of local validation)

Run from this clean RC worktree after the current backup gate is independently complete:

```sh
pnpm db:staging:v6 package
pnpm db:staging:v6 diagnose
pnpm db:staging:v6 authorize /secure/path/staging-backup-proof.json
pnpm db:staging:v6 apply /secure/path/staging-backup-proof.json DIGEST_OUTPUT
```

Replace `DIGEST_OUTPUT` with the digest printed by `authorize`. `diagnose` reports each read-only check and the current fingerprint. `authorize` reads Railway metadata and the backup proof locally, then prints the confirmation digest without opening a SQL connection. `apply` rechecks the SQL identity, ledger, fingerprint, manifest, and backup proof remotely immediately before applying. The commands require Railway CLI authentication. They must not be run until the backup artifact and isolated restore have passed.

## Local validation

The MySQL integration test uses a uniquely named `l4ckos_test_v6_*` database and drops it after the test. It does not access Railway or provider services.

```sh
pnpm exec vitest run server/database/stagingV6Executor.test.ts
env L4CKOS_MYSQL_TEST=1 L4CKOS_LOCAL_SCHEMA=1 L4CKOS_LOCAL_MYSQL_SOCKET=/tmp/l4ckos-v6-socket-user/mysqld.sock NODE_ENV=test pnpm exec vitest run server/database/stagingV6Executor.mysql.test.ts
pnpm exec tsc --noEmit --project tsconfig.server.json
```
