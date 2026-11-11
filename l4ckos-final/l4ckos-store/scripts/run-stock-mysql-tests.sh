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

STOCK_MYSQL_HOST=127.0.0.1 \
STOCK_MYSQL_PORT="$published_port" \
STOCK_MYSQL_USER=stock_test \
STOCK_MYSQL_PASSWORD="$synthetic_test_password" \
STOCK_MYSQL_DATABASE=l4ckos_stock_test \
STOCK_LOCAL_HARNESS=true \
JWT_SECRET=synthetic-stock-local-session-key-32-bytes-minimum \
  pnpm exec vitest run --fileParallelism=false server/stock/mysqlStockCheckoutStore.mysql.test.ts server/stock/stockCheckout.integration.mysql.test.ts server/stock/stockStorefront.e2e.mysql.test.ts server/exclusive/exclusiveDrops.mysql.test.ts client/src/pages/Pagamento.mysql.e2e.test.tsx "$@"
