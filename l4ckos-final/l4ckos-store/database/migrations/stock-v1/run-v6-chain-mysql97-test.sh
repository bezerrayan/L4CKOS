#!/usr/bin/env bash
# Structural compatibility guard for the integrated V6 + STOCK V1 + Exclusive Drops line.
#
# Builds the AUDITED physical schema (server/database/fixtures/audited-schema.json: orderItems.unitPrice,
# utf8mb4_unicode_ci) in a throw-away MySQL 9.7.2 container (no network), replays the V6 chain 0020..0025 and
# proves: (a) the unitPrice/totalPrice write contract, (b) migrations 0027/0028 stay isolated and fail closed
# without side effects on this schema. Never touches a remote database. Cleans up its container.
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../../.." && pwd)"
name="stock-v1-v6-chain-$$"
trap 'docker rm -f "$name" >/dev/null 2>&1 || true' EXIT

docker run --pull=never --detach --name "$name" --network none \
  --env MYSQL_ALLOW_EMPTY_PASSWORD=yes --env MYSQL_DATABASE=railway mysql:9.7.2 \
  --character-set-server=utf8mb4 --collation-server=utf8mb4_unicode_ci >/dev/null
for _ in $(seq 1 120); do
  docker exec "$name" mysqladmin ping --silent >/dev/null 2>&1 \
    && docker exec "$name" mysql -uroot -e "USE railway" >/dev/null 2>&1 && break
  sleep 1
done
sql() { docker exec -i "$name" mysql -uroot railway "$@"; }
docker exec "$name" mysql -uroot -e "ALTER DATABASE railway CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"

python3 - "$repo_root" <<'PY' | sql
import json, sys
tables = json.load(open(sys.argv[1] + "/server/database/fixtures/audited-schema.json"))
print("SET FOREIGN_KEY_CHECKS=0;")
for ddl in tables.values():
    print(ddl.rstrip(";") + ";")
print("SET FOREIGN_KEY_CHECKS=1;")
PY

assert() {
  local query="$1" expected="$2" actual
  actual="$(sql --batch --skip-column-names -e "$query")"
  if [[ "$actual" != "$expected" ]]; then
    printf 'assertion failed: expected <%s>, got <%s> for %s\n' "$expected" "$actual" "$query" >&2
    exit 1
  fi
}

# Physical contract the STOCK line must honour.
assert "SELECT GROUP_CONCAT(column_name ORDER BY column_name) FROM information_schema.columns WHERE table_schema='railway' AND table_name='orderItems' AND column_name IN ('price','unitPrice','totalPrice')" "totalPrice,unitPrice"

for file in 0020_reconcile_asaas_webhook_events 0021_preorder_production_batches 0022_preorder_manufacturing_schedule \
            0023_asaas_webhook_inbox 0024_home_highlight_settings 0025_product_variant_identity; do
  sql < "$repo_root/database/migrations/$file.sql"
done

# Legacy rows that must survive any rejected candidate untouched.
sql -e "INSERT INTO users (id, openId, name) VALUES (910001,'chain-user','Synthetic');
        INSERT INTO products (id,name,category,price,stock) VALUES (910001,'Synthetic','fixture',1200,5);
        INSERT INTO orders (id,userId,status,totalPrice) VALUES (910001,910001,'pending',1200);
        INSERT INTO orderItems (id,orderId,productId,quantity,unitPrice,totalPrice) VALUES (910001,910001,910001,1,1200,1200)"
before="$(sql --batch --skip-column-names -e "SELECT SHA2(CONCAT_WS('|',id,orderId,productId,quantity,unitPrice,totalPrice),256) FROM orderItems WHERE id=910001")"

# orderItems.unitPrice/totalPrice is the physical write contract; the legacy `price` column does not exist.
sql -e "INSERT INTO orderItems (orderId, productId, quantity, unitPrice, totalPrice) VALUES (910001, 910001, 2, 1200, 2400)"
if sql -e "INSERT INTO orderItems (orderId, productId, quantity, price) VALUES (910001, 910001, 1, 1200)" >/dev/null 2>&1; then
  echo "unexpected: orderItems.price accepted on the audited schema" >&2
  exit 1
fi

# KNOWN BLOCKER (documented, guarded): 0027 was authored against the pre-V6 legacy base (0 or exactly 20 STOCK
# objects). The V6 line already owns orderItems.variantId, productVariants.size/color/isActive/optionKey,
# stockReservations.variantId and different index/FK names, so 0027 MUST stop (fail-closed) with zero side effects
# until a V6-aware reconciliation migration replaces it. If 0027 ever applies here, this guard fails on purpose so
# the new migration gets a full structural review (and this script gets updated).
set +e
out="$(sql < "$repo_root/database/migrations/stock-v1/0027_stock_v1_incremental.sql" 2>&1)"; rc=$?
set -e
if [[ $rc -eq 0 ]]; then echo "0027 unexpectedly applied on the V6 schema: review required" >&2; exit 1; fi
grep -q "STOCK V1 0027 blocked" <<<"$out" || { echo "unexpected 0027 failure: $out" >&2; exit 1; }
assert "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='railway' AND (table_name LIKE 'stockCheckout%' OR table_name='stockWebhookEvents')" "0"
assert "SELECT SHA2(CONCAT_WS('|',id,orderId,productId,quantity,unitPrice,totalPrice),256) FROM orderItems WHERE id=910001" "$before"
set +e
out28="$(sql < "$repo_root/database/migrations/exclusive-drops-v1/0028_exclusive_drops_candidate.sql" 2>&1)"; rc28=$?
set -e
if [[ $rc28 -eq 0 ]]; then echo "0028 unexpectedly applied without 0027" >&2; exit 1; fi
grep -q "apply and attest STOCK 0027 first" <<<"$out28" || { echo "unexpected 0028 failure: $out28" >&2; exit 1; }
assert "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='railway' AND table_name LIKE 'exclusive%'" "0"

echo "PASS (guard): V6 chain 0020..0025 + audited schema keep unitPrice/totalPrice; 0027/0028 stay fail-closed with zero side effects (V6-aware STOCK migration still required)"
