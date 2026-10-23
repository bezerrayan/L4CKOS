# Encrypted MySQL staging checkpoint v2

This procedure is independent of the lost 15 October implementation. It does not read or alter the historical `l4ckos-staging-2026-10-15T00-23-01-611Z.enc` artifact or the v1 Bitwarden item.

## Format and key handling

The `.enc` file is a binary envelope:

| Offset | Content |
| --- | --- |
| 0–7 | ASCII `L4CKOSBK` magic |
| 8 | Format version `2` |
| 9 | Algorithm id `1` = AES-256-GCM |
| 10–21 | Fresh random 96-bit nonce |
| 22–25 | Unsigned big-endian context byte length |
| 26 onward | UTF-8 JSON context, then ciphertext, then 128-bit GCM tag |

The fixed header and exact context bytes are authenticated as GCM AAD. `node:crypto` delegates AES-GCM to Node's OpenSSL-backed implementation. A new 32-byte random key is held in Bitwarden and entered as 64 hexadecimal characters; there is no KDF. The nonce is generated with `randomBytes(12)` for every capture. The tag is appended to the file. The manifest records the nonce, tag, context hash and SHA-256 of the complete envelope; these values are not secret and never permit key recovery. It never stores the key or a key-derived verifier.

The decryptor makes a complete first pass and accepts the artifact only after GCM authentication succeeds. Only then does it stream a second pass directly to the disposable restore server. It never creates a plaintext dump. Authentication, ciphertext digest and restore checks all must pass before a manifest proof is created.

## Snapshot and coverage

The remote shell program is fixed to the staging project, environment, MySQL service and `l4ckos_staging` schema. It checks the Railway runtime identity and schema, requires MySQL 8.4, acquires `FLUSH TABLES WITH READ LOCK`, inventories exact row counts while writes are blocked, and streams `mysqldump` output while the read lock remains held. It rejects any non-InnoDB base table. `mysqldump` includes the schema and data, views, triggers, routines, events, binary-safe values and the governance ledger. The dump's streaming SHA-256 is checked again against the authenticated decrypted plaintext; restore also compares per-table counts, schema fingerprint, ledger and objects. The lock is released by a shell trap. Any pipeline or remote process failure removes partial output and prevents a success manifest.

The capture requires `MYSQL_ROOT_PASSWORD`, local `railway`, Docker, the pinned staging identity, and privileges for the global read lock and full dump. It does not expose a public database endpoint. The isolated MySQL restore uses the source-compatible pinned image `mysql:8.4.11`, `--network none`, a temporary tmpfs data directory, and a private Unix socket. It verifies the canonical structural fingerprint, all table row counts, views, triggers, routines, events, exact object definers and their accounts, completed execution states, ledger tail, and foreign-key references. If an object definer cannot be restored with an available account, the checkpoint fails closed. The container and tmpfs are destroyed after validation.

## Owner setup and execution

1. In Bitwarden, create a separate password item named `L4CKOS — Backup Staging — AES-256 v2`; set its reference/name to `l4ckos-staging-aes-v2`. Generate a fresh random 32-byte key using Bitwarden's generator and store it in a hidden custom field as 64 hex characters. Keep the old v1 item unchanged. Never paste either key into chat, a shell command, an environment variable, a file, or a terminal with echo enabled.
2. In a private Ubuntu terminal, enter the isolated RC worktree and verify the expected revision:

   ```sh
   cd /tmp/l4ckos-v6-remote-executor/l4ckos-final/l4ckos-store
   git rev-parse HEAD
   ```

   Expected output: `88daab3046f5351b6724ad51f69041b4fd896509`.
3. Run the one capture command. It prompts on `/dev/tty` with echo disabled and reads the key only into inherited file descriptor 3 for the local Node process. The key is not in shell history, argv, exported environment, or logs.

   ```sh
   bash scripts/run-staging-backup-v2.sh
   ```

4. On success, the encrypted artifact and mode-0600 manifest are stored under `~/.local/share/l4ckos-backups/staging-v2/`. The script prints only artifact ID/path, SHA-256, restored schema fingerprint/version/table count and a validation ID. It does not print row counts, dump bytes or secrets.
5. In the private Google Drive UI, upload both the `.enc` and matching `.enc.manifest.json` into `L4CKOS/Backups/Staging`. Keep the 15 October file untouched. Confirm both uploaded objects are visible and retain their Drive IDs. Drive does not receive a key.
6. Only after upload and independent review of the manifest, the existing executor can consume the root-level proof with:

   ```sh
   pnpm db:staging:v6 authorize "$HOME/.local/share/l4ckos-backups/staging-v2/<artifact-id>.enc.manifest.json"
   ```

   That command is read-only and returns a confirmation digest. It does not apply a migration. Migration execution remains a separate operation requiring all prior gates.

## Local focused validation

```sh
pnpm exec vitest run server/database/stagingBackupV2.test.ts
node --import tsx scripts/test-staging-backup-v2-mysql.ts
```

The first command covers valid key, wrong key, ciphertext modification, truncation and a failed source stream. The second creates synthetic MySQL 8.4 source and restore instances and checks structure, data counts, trigger/routine/event/view coverage and foreign-key integrity. Neither test connects to Railway.
