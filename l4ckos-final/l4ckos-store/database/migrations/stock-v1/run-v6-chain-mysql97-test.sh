#!/usr/bin/env bash
# Structural proof for the V6-aware STOCK migration (stock-v1/v6/0027_stock_v1_on_v6_lineage.sql) and its
# compatibility with the Exclusive Drops 0028 candidate, on a throw-away MySQL 9.7.2 container (no network).
#
# Baseline = AUDITED physical schema (server/database/fixtures/audited-schema.json) + V6 chain 0020..0025.
# Covers: apply, re-apply (no-op), synthetic legacy data preservation, preservation of every pre-existing
# column/index/FK/CHECK, new-structure types, partial/diverging states (all fail-closed), the frozen legacy 0027
# staying blocked on V6, and 0028 on top (twice). Never touches a remote database; removes its container.
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../../.." && pwd)"
migration="$repo_root/database/migrations/stock-v1/v6/0027_stock_v1_on_v6_lineage.sql"
legacy="$repo_root/database/migrations/stock-v1/0027_stock_v1_incremental.sql"
drops="$repo_root/database/migrations/exclusive-drops-v1/0028_exclusive_drops_candidate.sql"
work="$(mktemp -d)"
name="stock-v1-v6-chain-$$"
trap 'docker rm -f "$name" >/dev/null 2>&1 || true; rm -rf "$work"' EXIT

docker run --pull=never --detach --name "$name" --network none \
  --env MYSQL_ALLOW_EMPTY_PASSWORD=yes --env MYSQL_DATABASE=railway mysql:9.7.2 \
  --character-set-server=utf8mb4 --collation-server=utf8mb4_unicode_ci >/dev/null
for _ in $(seq 1 120); do
  docker exec "$name" mysqladmin ping --silent >/dev/null 2>&1 \
    && docker exec "$name" mysql -uroot -e "USE railway" >/dev/null 2>&1 && break
  sleep 1
done
sql() { docker exec -i "$name" mysql -uroot railway "$@"; }
val() { sql --batch --skip-column-names -e "$1"; }
fail() { echo "FAIL: $*" >&2; exit 1; }
assert() { local a; a="$(val "$1")"; [[ "$a" == "$2" ]] || fail "expected <$2>, got <$a> for: $1"; }

# ---- baseline ---------------------------------------------------------------------------------------------
python3 - "$repo_root" <<'PY' > "$work/audited.sql"
import json, sys
tables = json.load(open(sys.argv[1] + "/server/database/fixtures/audited-schema.json"))
print("SET FOREIGN_KEY_CHECKS=0;")
for ddl in tables.values():
    print(ddl.rstrip(";") + ";")
print("SET FOREIGN_KEY_CHECKS=1;")
PY
sql < "$work/audited.sql"
for f in 0020_reconcile_asaas_webhook_events 0021_preorder_production_batches 0022_preorder_manufacturing_schedule \
         0023_asaas_webhook_inbox 0024_home_highlight_settings 0025_product_variant_identity; do
  sql < "$repo_root/database/migrations/$f.sql"
done
docker exec "$name" mysqldump -uroot --no-data --skip-comments --set-gtid-purged=OFF railway > "$work/baseline.sql"
[[ -s "$work/baseline.sql" ]] || fail "empty baseline dump"

reset_baseline() {
  sql -e "DROP DATABASE railway; CREATE DATABASE railway CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
  sql < "$work/baseline.sql"
}

seed_legacy() {
  sql -e "
    INSERT INTO users (id, openId, name) VALUES (910001,'chain-user','Synthetic'),(910002,'chain-admin','Admin');
    INSERT INTO products (id,name,category,price,stock) VALUES (910001,'Synthetic tee','fixture',1200,9),(910002,'Legacy hoodie','fixture',5000,3);
    INSERT INTO productVariants (id,productId,name,sku,price,stock,size,color,optionKey,isActive)
      VALUES (910001,910001,'M / Preto','SYN-M-BLK',1200,5,'M','Preto','preto|m',1),
             (910002,910001,'G / Preto','SYN-G-BLK',NULL,4,'G','Preto','preto|g',0),
             (910003,910002,'Legacy','',NULL,3,NULL,NULL,NULL,0);
    INSERT INTO orders (id,userId,status,totalPrice) VALUES (910001,910001,'pending',2400),(910002,910001,'paid',5000);
    INSERT INTO orderItems (id,orderId,productId,quantity,unitPrice,totalPrice,variantId,sku,size,color)
      VALUES (910001,910001,910001,2,1200,2400,910001,'SYN-M-BLK','M','Preto'),
             (910002,910002,910002,1,5000,NULL,NULL,NULL,NULL,NULL),
             (910003,910002,910002,1,0,0,777777,'ORPHAN','P','Azul');
    INSERT INTO stockReservations (id,orderId,userId,productId,quantity,status,expiresAt,variantId,orderItemId)
      VALUES (910001,910001,910001,910001,2,'active','2030-01-01 00:00:00',910001,910001);"
}

data_hash() {
  val "SET SESSION group_concat_max_len = 1048576; SELECT SHA2(CONCAT_WS('#',
     (SELECT GROUP_CONCAT(CONCAT_WS('|',id,name,category,price,stock) ORDER BY id) FROM products),
     (SELECT GROUP_CONCAT(CONCAT_WS('|',id,productId,name,IFNULL(sku,'~'),IFNULL(price,'~'),stock,IFNULL(size,'~'),IFNULL(color,'~'),IFNULL(optionKey,'~'),isActive) ORDER BY id) FROM productVariants),
     (SELECT GROUP_CONCAT(CONCAT_WS('|',id,userId,status,paymentStatus,totalPrice,fulfillmentStatus) ORDER BY id) FROM orders),
     (SELECT GROUP_CONCAT(CONCAT_WS('|',id,orderId,productId,quantity,unitPrice,IFNULL(totalPrice,'~'),IFNULL(variantId,'~'),IFNULL(sku,'~'),IFNULL(size,'~'),IFNULL(color,'~'),salesModeAtPurchase) ORDER BY id) FROM orderItems),
     (SELECT GROUP_CONCAT(CONCAT_WS('|',id,orderId,userId,productId,quantity,status,IFNULL(variantId,'~'),IFNULL(orderItemId,'~')) ORDER BY id) FROM stockReservations)),256)"
}

# Every pre-existing column / index / FK / CHECK of the tables, as comparable lines.
structure() {
  val "SELECT CONCAT('col|',table_name,'|',column_name,'|',column_type,'|',is_nullable,'|',IFNULL(column_default,'~'),'|',IFNULL(collation_name,'~'),'|',extra)
         FROM information_schema.columns WHERE table_schema='railway' AND table_name IN ('products','productVariants','orders','orderItems','stockReservations','users')
       UNION ALL SELECT CONCAT('idx|',table_name,'|',index_name,'|',non_unique,'|',GROUP_CONCAT(column_name ORDER BY seq_in_index))
         FROM information_schema.statistics WHERE table_schema='railway' AND table_name IN ('products','productVariants','orders','orderItems','stockReservations','users') GROUP BY table_name,index_name,non_unique
       UNION ALL SELECT CONCAT('con|',table_name,'|',constraint_name,'|',constraint_type)
         FROM information_schema.table_constraints WHERE table_schema='railway' AND table_name IN ('products','productVariants','orders','orderItems','stockReservations','users')
       UNION ALL SELECT CONCAT('fk|',constraint_name,'|',table_name,'|',referenced_table_name,'|',update_rule,'|',delete_rule)
         FROM information_schema.referential_constraints WHERE constraint_schema='railway'" | LC_ALL=C sort
}

expect_block() { # <label> <expected message fragment> <file>
  local out rc
  set +e; out="$(sql < "$3" 2>&1)"; rc=$?; set -e
  [[ $rc -ne 0 ]] || fail "$1: migration unexpectedly applied"
  grep -q "$2" <<<"$out" || fail "$1: unexpected failure text: $out"
}
stock_objects() {
  val "SELECT (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='railway' AND
          ((table_name='productVariants' AND column_name='reservedStock') OR (table_name='orders' AND column_name IN ('stockAttemptId','stockPaymentId','shippingOptionId'))
        OR (table_name='orderItems' AND column_name IN ('skuSnapshot','sizeSnapshot','colorSnapshot'))
        OR (table_name='stockReservations' AND column_name IN ('attemptId','skuSnapshot','sizeSnapshot','colorSnapshot','unitPriceCents'))))
        + (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='railway' AND table_name IN ('stockCheckoutAttempts','stockCheckoutItems','stockWebhookEvents'))"
}

# ---- 0. the physical contract and the frozen legacy file ---------------------------------------------------
assert "SELECT GROUP_CONCAT(column_name ORDER BY column_name) FROM information_schema.columns WHERE table_schema='railway' AND table_name='orderItems' AND column_name IN ('price','unitPrice','totalPrice')" "totalPrice,unitPrice"
seed_legacy
expect_block "legacy 0027 on V6" "STOCK V1 0027 blocked" "$legacy"
[[ "$(stock_objects)" == "0" ]] || fail "legacy 0027 left STOCK objects on V6"

# ---- 1. apply + re-apply -------------------------------------------------------------------------------------
before_data="$(data_hash)"
structure > "$work/before.txt"
sql < "$migration"
[[ "$(data_hash)" == "$before_data" ]] || fail "legacy data changed by the migration"
structure > "$work/after1.txt"
sql < "$migration"                                  # re-apply: must be a verified no-op
structure > "$work/after2.txt"
cmp -s "$work/after1.txt" "$work/after2.txt" || fail "re-apply changed the schema"
[[ "$(data_hash)" == "$before_data" ]] || fail "legacy data changed on re-apply"
# Every pre-existing column/index/FK/CHECK is still there, byte for byte (new lines only added).
if [[ -n "$(LC_ALL=C comm -23 "$work/before.txt" "$work/after1.txt")" ]]; then
  LC_ALL=C comm -23 "$work/before.txt" "$work/after1.txt" >&2; fail "pre-existing structure was altered or removed"
fi
assert "SELECT COUNT(*) FROM orderItems WHERE variantId=777777" "1"        # orphan legacy reference untouched

# ---- 2. types / keys / constraints of the new structure ---------------------------------------------------
assert "SELECT CONCAT(column_type,':',is_nullable,':',column_default) FROM information_schema.columns WHERE table_schema='railway' AND table_name='productVariants' AND column_name='reservedStock'" "int:NO:0"
assert "SELECT column_type FROM information_schema.columns WHERE table_schema='railway' AND table_name='productVariants' AND column_name='isActive'" "tinyint"
assert "SELECT GROUP_CONCAT(column_name ORDER BY column_name) FROM information_schema.columns WHERE table_schema='railway' AND table_name='orders' AND column_name IN ('stockAttemptId','stockPaymentId','shippingOptionId') AND column_type='varchar(120)' AND is_nullable='YES'" "shippingOptionId,stockAttemptId,stockPaymentId"
assert "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='railway' AND table_name='stockReservations' AND column_name='unitPriceCents' AND column_type='int' AND is_nullable='YES'" "1"
assert "SELECT COUNT(DISTINCT index_name) FROM information_schema.statistics WHERE table_schema='railway' AND non_unique=0 AND index_name IN ('productVariants_sku_unique','orders_stockAttempt_unique','orders_stockPayment_unique','stockReservations_attempt_variant_unique','stockCheckoutAttempts_order_unique','stockCheckoutAttempts_payment_unique')" "6"
assert "SELECT COUNT(*) FROM information_schema.referential_constraints WHERE constraint_schema='railway' AND constraint_name IN ('stockCheckoutAttempts_order_fk','stockCheckoutItems_attempt_fk','stockCheckoutItems_variant_fk','stockCheckoutItems_product_fk','stockReservations_attempt_fk')" "5"
assert "SELECT COUNT(*) FROM information_schema.table_constraints WHERE constraint_schema='railway' AND constraint_type='CHECK' AND constraint_name IN ('productVariants_stock_bounds_check','productVariants_active_identity_check','stockCheckoutItems_quantity_check')" "3"
assert "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='railway' AND table_name IN ('stockCheckoutAttempts','stockCheckoutItems','stockWebhookEvents') AND engine='InnoDB' AND table_collation='utf8mb4_unicode_ci'" "3"

# Constraints really enforce: reserved <= stock, active identity, sku uniqueness.
for stmt in "UPDATE productVariants SET reservedStock = 99 WHERE id = 910001" \
            "UPDATE productVariants SET isActive = 1 WHERE id = 910003" \
            "INSERT INTO productVariants (productId,name,sku,stock) VALUES (910001,'dup','SYN-M-BLK',1)"; do
  if sql -e "$stmt" >/dev/null 2>&1; then fail "constraint did not reject: $stmt"; fi
done

# The exact write shape of server/stock/mysqlStockCheckoutStore.ts (attempt header + item + order item + reservation).
sql -e "INSERT INTO orders (id,userId,status,totalPrice,stockAttemptId,shippingOptionId) VALUES (910003,910001,'pending',2400,'attempt-v6-0001','local-plano-piloto');
        INSERT INTO stockCheckoutAttempts (attemptId,ownerUserId,fingerprint,orderId,status,providerState,amountCents,reservationExpiresAt)
          VALUES ('attempt-v6-0001',910001,REPEAT('a',64),910003,'reserved','not_started',2400,DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 600 SECOND));
        INSERT INTO orderItems (orderId,productId,quantity,unitPrice,totalPrice,variantId,skuSnapshot,sizeSnapshot,colorSnapshot) VALUES (910003,910001,2,1200,2400,910001,'SYN-M-BLK','M','Preto');
        INSERT INTO stockCheckoutItems (attemptId,lineNumber,variantId,productId,sku,size,color,unitPriceCents,quantity,totalCents) VALUES ('attempt-v6-0001',0,910001,910001,'SYN-M-BLK','M','Preto',1200,2,2400);
        UPDATE productVariants SET reservedStock = reservedStock + 2 WHERE id = 910001;
        INSERT INTO stockReservations (orderId,userId,productId,quantity,status,expiresAt,attemptId,variantId,skuSnapshot,sizeSnapshot,colorSnapshot,unitPriceCents)
          VALUES (910003,910001,910001,2,'active',DATE_ADD(UTC_TIMESTAMP(), INTERVAL 600 SECOND),'attempt-v6-0001',910001,'SYN-M-BLK','M','Preto',1200)"
if sql -e "INSERT INTO orderItems (orderId,productId,quantity,price) VALUES (910003,910001,1,1)" >/dev/null 2>&1; then fail "legacy orderItems.price accepted"; fi

# ---- 3. Exclusive Drops 0028 on top (collation-compatible FK to the STOCK attempts), twice ---------------
sql < "$drops"; sql < "$drops"
assert "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='railway' AND table_name IN ('exclusiveDrops','exclusiveDropProducts','exclusiveAccessRequests','exclusiveGrants','exclusiveGrantUsage','exclusiveRedeemAttempts','exclusiveEvents','exclusiveNotificationOutbox')" "8"
# 0028 derives usage by JOINing exclusiveGrantUsage.attemptId to stockCheckoutAttempts.attemptId: same collation, JOIN works.
assert "SELECT COUNT(DISTINCT collation_name) FROM information_schema.columns WHERE table_schema='railway' AND column_name='attemptId' AND table_name IN ('stockCheckoutAttempts','exclusiveGrantUsage','stockReservations')" "1"
assert "SELECT COUNT(*) FROM exclusiveGrantUsage u JOIN stockCheckoutAttempts a ON a.attemptId = u.attemptId" "0"

# ---- 4. diverging / partial states: every one fail-closed -----------------------------------------------------
reset_baseline; expect_block "0028 without STOCK" "apply and attest STOCK 0027 first" "$drops"

reset_baseline; seed_legacy
sql -e "UPDATE productVariants SET sku='SYN-M-BLK' WHERE id=910002"
expect_block "duplicate sku" "Duplicate entry" "$migration"
[[ "$(stock_objects)" == "0" ]] || fail "duplicate sku left STOCK objects"

reset_baseline; seed_legacy
sql -e "UPDATE productVariants SET isActive=1 WHERE id=910003"
expect_block "active w/o identity" "productVariants_active_identity_check" "$migration"
[[ "$(stock_objects)" == "0" ]] || fail "invalid active variant left STOCK objects"

reset_baseline; sql -e "ALTER TABLE orders ADD COLUMN stockAttemptId VARCHAR(120) NULL"
expect_block "partial columns" "partial prior STOCK DDL" "$migration"
reset_baseline; sql -e "CREATE TABLE stockWebhookEvents (eventId VARCHAR(191) NOT NULL, PRIMARY KEY (eventId)) ENGINE=InnoDB"
expect_block "partial table" "partial prior STOCK DDL" "$migration"

reset_baseline; sql < "$migration"; sql -e "ALTER TABLE stockCheckoutItems DROP FOREIGN KEY stockCheckoutItems_variant_fk"
expect_block "missing FK on replay" "lacks required FKs" "$migration"
reset_baseline; sql < "$migration"; sql -e "ALTER TABLE productVariants MODIFY COLUMN reservedStock BIGINT NOT NULL DEFAULT 0"
expect_block "retyped column on replay" "column drift" "$migration"

reset_baseline; sql -e "ALTER TABLE productVariants MODIFY COLUMN isActive INT NOT NULL DEFAULT 0"
expect_block "isActive retyped" "column contract drift" "$migration"
reset_baseline; sql -e "ALTER TABLE productVariants DROP INDEX productVariants_product_option_unique"
expect_block "optionKey unique missing" "optionKey) unique key missing" "$migration"
reset_baseline; sql -e "ALTER TABLE orderItems ADD COLUMN price INT NULL"
expect_block "legacy price column" "legacy orderItems.price present" "$migration"
reset_baseline; sql -e "DROP TABLE asaasWebhookInbox"
expect_block "not V6 lineage" "V6 lineage table missing" "$migration"
reset_baseline; sql -e "ALTER TABLE orderItems CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci"
expect_block "collation drift" "collation differs" "$migration"

echo "PASS: V6-aware STOCK 0027 on audited+0020..0025 (MySQL 9.7.2): apply/re-apply, data+structure preservation, constraints, Drops 0028 x2, 13 fail-closed scenarios; legacy 0027 stays blocked on V6"
