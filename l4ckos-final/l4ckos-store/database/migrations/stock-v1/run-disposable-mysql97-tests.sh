#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../../.." && pwd)"
migration="$repo_root/database/migrations/stock-v1/0027_stock_v1_incremental.sql"
baseline="$repo_root/database/migrations/stock-v1/fixtures/legacy-baseline.sql"
positive_name="stock-v1-97-pass-$$"
partial_name="stock-v1-97-partial-$$"
cleanup() {
  docker rm -f "$positive_name" "$partial_name" >/dev/null 2>&1 || true
}
trap cleanup EXIT

wait_mysql() {
  local name="$1"
  for _ in $(seq 1 120); do
    if docker exec "$name" mysqladmin ping --silent >/dev/null 2>&1 \
      && docker exec "$name" mysql -uroot -e "USE railway" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  echo "MySQL container did not become ready: $name" >&2
  return 1
}

start_mysql() {
  local name="$1"
  docker run --pull=never --detach --name "$name" --network none \
    --env MYSQL_ALLOW_EMPTY_PASSWORD=yes --env MYSQL_DATABASE=railway mysql:9.7.2 >/dev/null
  wait_mysql "$name"
}

assert_sql() {
  local name="$1" sql="$2" expected="$3" actual
  actual="$(docker exec "$name" mysql --batch --skip-column-names -uroot railway -e "$sql")"
  if [[ "$actual" != "$expected" ]]; then
    printf 'assertion failed: expected <%s>, got <%s> for %s\n' "$expected" "$actual" "$sql" >&2
    return 1
  fi
}

start_mysql "$positive_name"
docker exec -i "$positive_name" mysql -uroot railway < "$baseline"
docker exec "$positive_name" mysql -uroot railway -e \
  "INSERT INTO productVariants (id,productId,name,sku,price,stock) VALUES (710002,710001,'second synthetic variant','SYN-710002',1500,2)"
docker exec -i "$positive_name" mysql -uroot railway < "$migration"
docker exec -i "$positive_name" mysql -uroot railway < "$migration"

assert_sql "$positive_name" "SELECT CONCAT(status,':',paymentStatus,':',totalPrice) FROM orders WHERE id=710001" "pending:unconfirmed:1200"
assert_sql "$positive_name" "SELECT CONCAT(quantity,':',price) FROM orderItems WHERE id=710001" "1:1200"
assert_sql "$positive_name" "SELECT CONCAT(quantity,':',status) FROM stockReservations WHERE id=710001" "1:active"
assert_sql "$positive_name" "SELECT CONCAT(isActive,':',reservedStock) FROM productVariants WHERE id=710001" "0:0"
assert_sql "$positive_name" "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='railway' AND table_name IN ('stockCheckoutAttempts','stockCheckoutItems','stockWebhookEvents')" "3"
assert_sql "$positive_name" "SELECT COUNT(*) FROM information_schema.referential_constraints WHERE constraint_schema='railway' AND constraint_name IN ('stockCheckoutAttempts_order_fk','stockCheckoutItems_attempt_fk','stockCheckoutItems_variant_fk','stockCheckoutItems_product_fk','stockReservations_attempt_fk','stockReservations_variant_fk','stockReservations_order_fk','stockReservations_product_fk','productVariants_product_fk','orderItems_order_fk','orderItems_product_fk','orderItems_variant_fk')" "12"

docker exec "$positive_name" mysql -uroot railway -e \
  "INSERT INTO stockCheckoutAttempts (attemptId,ownerUserId,fingerprint,orderId,status,amountCents,reservationExpiresAt) VALUES ('SYN-ATTEMPT',710001,REPEAT('a',64),710001,'reserved',1200,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 15 MINUTE))"
if docker exec "$positive_name" mysql -uroot railway -e \
  "INSERT INTO stockCheckoutItems (attemptId,lineNumber,variantId,productId,sku,size,color,unitPriceCents,quantity,totalCents) VALUES ('SYN-ATTEMPT',0,710001,710001,'SYN-710001','M','blue',1200,0,0)" >/dev/null 2>&1; then
  echo "quantity CHECK did not reject zero" >&2
  exit 1
fi
if docker exec "$positive_name" mysql -uroot railway -e \
  "INSERT INTO stockCheckoutItems (attemptId,lineNumber,variantId,productId,sku,size,color,unitPriceCents,quantity,totalCents) VALUES ('SYN-ATTEMPT',1,999999,710001,'SYN-999999','M','blue',1200,1,1200)" >/dev/null 2>&1; then
  echo "variant FK did not reject missing parent" >&2
  exit 1
fi
if docker exec "$positive_name" mysql -uroot railway -e \
  "INSERT INTO productVariants (productId,name,sku,price,stock) VALUES (710001,'duplicate synthetic sku','SYN-710001',1200,1)" >/dev/null 2>&1; then
  echo "SKU UNIQUE did not reject duplicate" >&2
  exit 1
fi

start_mysql "$partial_name"
docker exec -i "$partial_name" mysql -uroot railway < "$baseline"
docker exec "$partial_name" mysql -uroot railway -e \
  "INSERT INTO productVariants (id,productId,name,sku,price,stock) VALUES (710002,710001,'duplicate synthetic variant','SYN-710001',1200,2)"
if docker exec -i "$partial_name" mysql -uroot railway < "$migration" >/dev/null 2>&1; then
  echo "duplicate-SKU precondition unexpectedly passed" >&2
  exit 1
fi
assert_sql "$partial_name" "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='railway' AND table_name='productVariants' AND column_name IN ('size','color','reservedStock','isActive')" "4"
assert_sql "$partial_name" "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='railway' AND table_name IN ('stockCheckoutAttempts','stockCheckoutItems','stockWebhookEvents')" "0"
echo "PASS: MySQL 9.7.2 migration, reapplied no-op, legacy row preservation, FK/CHECK/UNIQUE, and duplicate-SKU partial-failure evidence"
