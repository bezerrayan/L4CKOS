#!/usr/bin/env bash
set -euo pipefail
node --import tsx scripts/staging-backup-v2.ts preflight
if ! { exec 4<>/dev/tty; } 2>/dev/null; then
  printf '{"status":"STAGING_BACKUP_V2_FAILED","phase":"key_input","code":"TTY_UNAVAILABLE"}\n' >&2
  exit 2
fi
unset BACKUP_KEY
printf 'Cole a chave hex de 32 bytes da referência Bitwarden l4ckos-staging-aes-v2: ' >&4
if ! IFS= read -r -s BACKUP_KEY <&4; then
  unset BACKUP_KEY
  printf '\n{"status":"STAGING_BACKUP_V2_FAILED","phase":"key_input","code":"INPUT_READ_FAILED"}\n' >&4
  exec 4>&-
  exit 2
fi
printf '\n' >&4
exec 4>&-
if [[ ! "$BACKUP_KEY" =~ ^[a-fA-F0-9]{64}$ ]]; then
  unset BACKUP_KEY
  printf '{"status":"STAGING_BACKUP_V2_FAILED","phase":"key_input","code":"INVALID_KEY_FORMAT"}\n' >&2
  exit 2
fi
exec 3< <(printf '%s' "$BACKUP_KEY")
unset BACKUP_KEY
node --import tsx scripts/staging-backup-v2.ts capture 3<&3
