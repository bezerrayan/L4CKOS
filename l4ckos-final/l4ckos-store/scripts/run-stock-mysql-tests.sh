#!/usr/bin/env bash
set -euo pipefail

package_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$package_dir"

if [[ "$(node --version)" != "v22.23.2" ]]; then
  echo "Expected Node v22.23.2; found $(node --version)." >&2
  exit 2
fi
if [[ "$(pnpm --version)" != "10.4.1" ]]; then
  echo "Expected pnpm 10.4.1; found $(pnpm --version)." >&2
  exit 2
fi
if ! docker image inspect mysql:9.7.2 >/dev/null 2>&1; then
  echo "Required local image mysql:9.7.2 is unavailable; this runner does not pull images." >&2
  exit 2
fi

container_name="l4ckos-stock-mysql-test-$$"
synthetic_root_password="stock-local-root-pw-not-production"
synthetic_test_password="stock-local-test-pw-only"
cleanup() {
  docker rm --force "$container_name" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

docker run --pull=never --detach --rm \
  --name "$container_name" \
  --publish 127.0.0.1::3306 \
  --env MYSQL_ROOT_PASSWORD="$synthetic_root_password" \
  --env MYSQL_DATABASE=l4ckos_stock_test \
  --env MYSQL_USER=stock_test \
  --env MYSQL_PASSWORD="$synthetic_test_password" \
  mysql:9.7.2 >/dev/null

ready=0
for _ in $(seq 1 60); do
  if docker exec --env MYSQL_PWD="$synthetic_test_password" "$container_name" \
    mysqladmin ping --silent --host=127.0.0.1 --user=stock_test >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
if [[ "$ready" != 1 ]]; then
  echo "Disposable MySQL 9.7.2 did not become ready; container will be removed." >&2
  exit 2
fi

published_port="$(docker port "$container_name" 3306/tcp | sed -n 's/.*:\([0-9][0-9]*\)$/\1/p' | head -1)"
if [[ -z "$published_port" ]]; then
  echo "Could not identify the loopback-only published MySQL port." >&2
  exit 2
fi

# STOCK_SCHEMA=v6 (default): provision the AUDITED V6 physical schema + 0020..0025 + the V6-aware STOCK candidate + Drops 0028
# in the disposable container, so the integrated app runs on the same structure the V6 line owns.
# STOCK_SCHEMA=legacy keeps the original minimal fixture (server/stock/fixtures/mysql8-stock-schema.sql).
if [[ "${STOCK_SCHEMA:-v6}" == "v6" ]]; then
  work_dir="$(mktemp -d)"
  trap 'rm -rf "$work_dir"; cleanup' EXIT INT TERM
  python3 - "$package_dir" > "$work_dir/audited.sql" <<'PY'
import json, sys
tables = json.load(open(sys.argv[1] + "/server/database/fixtures/audited-schema.json"))
print("SET FOREIGN_KEY_CHECKS=0;")
for ddl in tables.values():
    print(ddl.rstrip(";") + ";")
print("SET FOREIGN_KEY_CHECKS=1;")
PY
  root_sql() { docker exec --interactive --env MYSQL_PWD="$synthetic_root_password" "$container_name" mysql --user=root "$@"; }
  root_sql -e "CREATE DATABASE railway CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; ALTER DATABASE l4ckos_stock_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
  root_sql railway < "$work_dir/audited.sql"
  for file in 0020_reconcile_asaas_webhook_events 0021_preorder_production_batches 0022_preorder_manufacturing_schedule \
              0023_asaas_webhook_inbox 0024_home_highlight_settings 0025_product_variant_identity; do
    root_sql railway < "database/migrations/$file.sql"
  done
  root_sql railway < database/migrations/stock-v1/v6/0027_stock_v1_on_v6_lineage.sql
  root_sql railway < database/migrations/exclusive-drops-v1/0028_exclusive_drops_candidate.sql
  docker exec --env MYSQL_PWD="$synthetic_root_password" "$container_name" \
    mysqldump --user=root --no-data --skip-comments --set-gtid-purged=OFF railway > "$work_dir/v6-stock.sql"
  root_sql l4ckos_stock_test < "$work_dir/v6-stock.sql"
  root_sql -e "DROP DATABASE railway"
fi

set +e # keep the exit status of phase 1 (set -e would skip phase 2 and the status report)
STOCK_MYSQL_HOST=127.0.0.1 \
STOCK_MYSQL_PORT="$published_port" \
STOCK_MYSQL_USER=stock_test \
STOCK_MYSQL_PASSWORD="$synthetic_test_password" \
STOCK_MYSQL_DATABASE=l4ckos_stock_test \
STOCK_LOCAL_HARNESS=true \
JWT_SECRET=synthetic-stock-local-session-key-32-bytes-minimum \
  pnpm exec vitest run --fileParallelism=false server/stock/mysqlStockCheckoutStore.mysql.test.ts server/stock/stockCheckout.integration.mysql.test.ts server/stock/stockStorefront.e2e.mysql.test.ts server/exclusive/exclusiveDrops.mysql.test.ts server/exclusive/exclusiveDropsQuota.mysql.test.ts server/database/productVariantPrice.mysql.test.ts client/src/pages/Pagamento.mysql.e2e.test.tsx "$@"
status=$?
# Phase 2 - least privilege: restrict the application account `stock_test` to database/staging/stock-runtime-grants.template.sql and rerun the
# quota / late-approval / reconciliation suite through it. The harness keeps a separate privileged `stock_setup` account for seeding and inspection.
# Any statement outside the documented grants fails the suite, so the template is proven rather than guessed.
if [[ "$status" -eq 0 && "${STOCK_SKIP_LEAST_PRIVILEGE:-false}" != "true" ]]; then
  synthetic_setup_password="stock-local-setup-pw-only"
  root_sql_priv() { docker exec --interactive --env MYSQL_PWD="$synthetic_root_password" "$container_name" mysql --user=root "$@"; }
  set -e
  root_sql_priv -e "CREATE USER 'stock_setup'@'%' IDENTIFIED BY '$synthetic_setup_password'; GRANT ALL PRIVILEGES ON l4ckos_stock_test.* TO 'stock_setup'@'%'; REVOKE ALL PRIVILEGES, GRANT OPTION FROM 'stock_test'@'%'"
  # The phase-1 teardown leaves the base fixture (Drops tables dropped); recreate them exactly as the suites do (CREATE TABLE statements of 0028).
  python3 - <<'PY' | root_sql_priv l4ckos_stock_test
import re
sql = open("database/migrations/exclusive-drops-v1/0028_exclusive_drops_candidate.sql", encoding="utf-8").read()
for statement in (part.strip() for part in sql.split(";")):
    if re.search(r"CREATE TABLE", statement):
        print(statement + ";")
PY
  sed -e "s/@DB@/l4ckos_stock_test/g" -e "s/@USER@/stock_test/g" database/staging/stock-runtime-grants.template.sql | root_sql_priv
  root_sql_priv -e "UPDATE performance_schema.setup_consumers SET ENABLED = 'YES' WHERE NAME IN ('events_statements_history_long'); UPDATE performance_schema.setup_instruments SET ENABLED = 'YES', TIMED = 'YES' WHERE NAME LIKE 'statement/sql/%'"
  set +e
  STOCK_MYSQL_HOST=127.0.0.1 \
  STOCK_MYSQL_PORT="$published_port" \
  STOCK_MYSQL_USER=stock_test \
  STOCK_MYSQL_PASSWORD="$synthetic_test_password" \
  STOCK_MYSQL_DATABASE=l4ckos_stock_test \
  STOCK_SETUP_MYSQL_USER=stock_setup \
  STOCK_SETUP_MYSQL_PASSWORD="$synthetic_setup_password" \
  STOCK_LOCAL_HARNESS=true \
  JWT_SECRET=synthetic-stock-local-session-key-32-bytes-minimum \
    pnpm exec vitest run --fileParallelism=false server/exclusive/exclusiveDropsQuota.mysql.test.ts
  status=$?
  if [[ "$status" -ne 0 ]]; then
    echo "--- statements rejected by MySQL during the least-privilege phase (privilege gaps appear here) ---" >&2
    root_sql_priv -N -B -e "SELECT DISTINCT LEFT(MESSAGE_TEXT, 160) FROM performance_schema.events_statements_history_long WHERE MYSQL_ERRNO IN (1142, 1143, 1044, 1045, 1370) ORDER BY 1" >&2 || true
  fi
fi
exit "$status"
