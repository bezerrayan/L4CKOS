#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_dir"

[[ "$(node --version)" == "v22.23.2" ]] || { echo "Expected Node v22.23.2." >&2; exit 2; }
[[ "$(pnpm --version)" == "10.4.1" ]] || { echo "Expected pnpm 10.4.1." >&2; exit 2; }
docker image inspect mysql:8.4.11 >/dev/null 2>&1 || { echo "Required mysql:8.4.11 image is unavailable; refusing to pull." >&2; exit 2; }
command -v openssl >/dev/null 2>&1 || { echo "openssl is required for the synthetic TLS fixture." >&2; exit 2; }

temp_dir="$(mktemp -d /tmp/l4ckos-mysql-attestation.XXXXXX)"
container_name="l4ckos-mysql-attestation-$$"
network_name="l4ckos-mysql-attestation-$$"
root_password="attestation-local-root-only"
cleanup() {
  docker rm --force "$container_name" >/dev/null 2>&1 || true
  docker network rm "$network_name" >/dev/null 2>&1 || true
  if [[ "$temp_dir" == /tmp/l4ckos-mysql-attestation.* && -d "$temp_dir" ]]; then
    find "$temp_dir" -type f -delete
    find "$temp_dir" -depth -type d -empty -delete
  fi
}
trap cleanup EXIT INT TERM

mkdir -p "$temp_dir/certs"
openssl req -x509 -newkey rsa:2048 -nodes -days 2 \
  -keyout "$temp_dir/certs/ca-key.pem" -out "$temp_dir/certs/ca.pem" \
  -subj "/CN=L4CKOS Synthetic Attestation CA" >/dev/null 2>&1
openssl req -newkey rsa:2048 -nodes \
  -keyout "$temp_dir/certs/server-key.pem" -out "$temp_dir/certs/server.csr" \
  -subj "/CN=mysql-attestation.local" >/dev/null 2>&1
cat > "$temp_dir/certs/server-ext.cnf" <<'EOF'
subjectAltName=DNS:mysql-attestation.local,IP:127.0.0.1
extendedKeyUsage=serverAuth
keyUsage=digitalSignature,keyEncipherment
EOF
openssl x509 -req -in "$temp_dir/certs/server.csr" \
  -CA "$temp_dir/certs/ca.pem" -CAkey "$temp_dir/certs/ca-key.pem" \
  -CAcreateserial -out "$temp_dir/certs/server-cert.pem" -days 2 \
  -extfile "$temp_dir/certs/server-ext.cnf" >/dev/null 2>&1
openssl req -x509 -newkey rsa:2048 -nodes -days 2 \
  -keyout "$temp_dir/certs/wrong-ca-key.pem" -out "$temp_dir/certs/wrong-ca.pem" \
  -subj "/CN=Untrusted Synthetic CA" >/dev/null 2>&1
chmod 644 "$temp_dir/certs"/*.pem "$temp_dir/certs"/*.cnf
cat > "$temp_dir/mysql-attestation.cnf" <<'EOF'
[mysqld]
ssl-ca=/certs/ca.pem
ssl-cert=/certs/server-cert.pem
ssl-key=/certs/server-key.pem
tls-version=TLSv1.3
require-secure-transport=ON
EOF

docker network create "$network_name" >/dev/null

docker run --pull=never --detach --rm \
  --name "$container_name" \
  --network "$network_name" \
  --network-alias mysql-attestation.local \
  --publish 127.0.0.1::3306 \
  --mount "type=bind,src=$temp_dir/certs,dst=/certs,readonly" \
  --mount "type=bind,src=$temp_dir/mysql-attestation.cnf,dst=/etc/mysql/conf.d/attestation.cnf,readonly" \
  --env MYSQL_ROOT_PASSWORD="$root_password" \
  mysql:8.4.11 >/dev/null

ready=0
for _ in $(seq 1 60); do
  if docker exec --env MYSQL_PWD="$root_password" "$container_name" \
    mysql --protocol=socket --host=localhost --user=root --batch \
      --skip-column-names --execute='SELECT 1' >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
[[ "$ready" == 1 ]] || { echo "Disposable TLS MySQL did not become ready." >&2; exit 2; }

cat > "$temp_dir/init.sql" <<'SQL'
CREATE DATABASE l4ckos_stock_test;
USE l4ckos_stock_test;
CREATE TABLE users (id INT PRIMARY KEY, email VARCHAR(320));
CREATE TABLE products (id INT PRIMARY KEY, name VARCHAR(100), stock INT);
CREATE TABLE productVariants (id INT PRIMARY KEY, productId INT, sku VARCHAR(50));
CREATE TABLE orders (id INT PRIMARY KEY, userId INT, totalPrice INT, status VARCHAR(30));
CREATE TABLE orderItems (id INT PRIMARY KEY, orderId INT, productId INT);
CREATE TABLE stockReservations (id INT PRIMARY KEY, orderId INT, variantId INT);
CREATE TABLE auditLogs (id INT PRIMARY KEY, actorUserId INT, action VARCHAR(80));
CREATE TABLE stockCheckoutAttempts (id INT PRIMARY KEY, attemptId VARCHAR(120));
CREATE TABLE stockCheckoutItems (id INT PRIMARY KEY, attemptId VARCHAR(120));
CREATE TABLE asaasWebhookEvents (id INT PRIMARY KEY, eventId VARCHAR(120));
CREATE TABLE stockWebhookEvents (id INT PRIMARY KEY, eventId VARCHAR(120));
CREATE TABLE userAddresses (id INT PRIMARY KEY, userId INT);
CREATE TABLE __drizzle_migrations (id INT PRIMARY KEY, hash VARCHAR(64), created_at BIGINT);
CREATE TABLE metadata_extra (id INT PRIMARY KEY, marker VARCHAR(50));
INSERT INTO __drizzle_migrations (id, hash, created_at) VALUES (1, 'synthetic-hash', 1000);
DELIMITER //
CREATE TRIGGER local_synthetic_orders_bi BEFORE INSERT ON orders
FOR EACH ROW SET NEW.status = COALESCE(NEW.status, 'pending')//
DELIMITER ;
CREATE USER 'attest_empty'@'%' IDENTIFIED BY 'synthetic-empty-password' REQUIRE SSL;
CREATE USER 'attest_trigger'@'%' IDENTIFIED BY 'synthetic-trigger-password' REQUIRE SSL;
CREATE USER 'attest_metadata'@'%' IDENTIFIED BY 'synthetic-metadata-password' REQUIRE SSL;
CREATE USER 'attest_history'@'%' IDENTIFIED BY 'synthetic-history-password' REQUIRE SSL;
GRANT REFERENCES ON l4ckos_stock_test.users TO 'attest_metadata'@'%';
GRANT REFERENCES ON l4ckos_stock_test.products TO 'attest_metadata'@'%';
GRANT REFERENCES ON l4ckos_stock_test.productVariants TO 'attest_metadata'@'%';
GRANT REFERENCES ON l4ckos_stock_test.orders TO 'attest_metadata'@'%';
GRANT REFERENCES ON l4ckos_stock_test.orderItems TO 'attest_metadata'@'%';
GRANT REFERENCES ON l4ckos_stock_test.stockReservations TO 'attest_metadata'@'%';
GRANT REFERENCES ON l4ckos_stock_test.auditLogs TO 'attest_metadata'@'%';
GRANT REFERENCES ON l4ckos_stock_test.asaasWebhookEvents TO 'attest_metadata'@'%';
GRANT REFERENCES ON l4ckos_stock_test.userAddresses TO 'attest_metadata'@'%';
GRANT REFERENCES ON l4ckos_stock_test.stockCheckoutAttempts TO 'attest_metadata'@'%';
GRANT REFERENCES ON l4ckos_stock_test.stockCheckoutItems TO 'attest_metadata'@'%';
GRANT REFERENCES ON l4ckos_stock_test.stockWebhookEvents TO 'attest_metadata'@'%';
GRANT REFERENCES ON l4ckos_stock_test.users TO 'attest_trigger'@'%';
GRANT REFERENCES ON l4ckos_stock_test.products TO 'attest_trigger'@'%';
GRANT REFERENCES ON l4ckos_stock_test.productVariants TO 'attest_trigger'@'%';
GRANT REFERENCES ON l4ckos_stock_test.orders TO 'attest_trigger'@'%';
GRANT REFERENCES ON l4ckos_stock_test.orderItems TO 'attest_trigger'@'%';
GRANT REFERENCES ON l4ckos_stock_test.stockReservations TO 'attest_trigger'@'%';
GRANT REFERENCES ON l4ckos_stock_test.auditLogs TO 'attest_trigger'@'%';
GRANT REFERENCES ON l4ckos_stock_test.asaasWebhookEvents TO 'attest_trigger'@'%';
GRANT REFERENCES ON l4ckos_stock_test.userAddresses TO 'attest_trigger'@'%';
GRANT REFERENCES ON l4ckos_stock_test.stockCheckoutAttempts TO 'attest_trigger'@'%';
GRANT REFERENCES ON l4ckos_stock_test.stockCheckoutItems TO 'attest_trigger'@'%';
GRANT REFERENCES ON l4ckos_stock_test.stockWebhookEvents TO 'attest_trigger'@'%';
GRANT TRIGGER ON l4ckos_stock_test.orders TO 'attest_trigger'@'%';
GRANT REFERENCES ON l4ckos_stock_test.users TO 'attest_history'@'%';
GRANT REFERENCES ON l4ckos_stock_test.products TO 'attest_history'@'%';
GRANT REFERENCES ON l4ckos_stock_test.productVariants TO 'attest_history'@'%';
GRANT REFERENCES ON l4ckos_stock_test.orders TO 'attest_history'@'%';
GRANT REFERENCES ON l4ckos_stock_test.orderItems TO 'attest_history'@'%';
GRANT REFERENCES ON l4ckos_stock_test.stockReservations TO 'attest_history'@'%';
GRANT REFERENCES ON l4ckos_stock_test.auditLogs TO 'attest_history'@'%';
GRANT REFERENCES ON l4ckos_stock_test.asaasWebhookEvents TO 'attest_history'@'%';
GRANT REFERENCES ON l4ckos_stock_test.userAddresses TO 'attest_history'@'%';
GRANT REFERENCES ON l4ckos_stock_test.stockCheckoutAttempts TO 'attest_history'@'%';
GRANT REFERENCES ON l4ckos_stock_test.stockCheckoutItems TO 'attest_history'@'%';
GRANT REFERENCES ON l4ckos_stock_test.stockWebhookEvents TO 'attest_history'@'%';
GRANT SELECT ON l4ckos_stock_test.__drizzle_migrations TO 'attest_history'@'%';
SQL
docker exec --interactive --env MYSQL_PWD="$root_password" "$container_name" \
  mysql --host=localhost --user=root < "$temp_dir/init.sql" >/dev/null

published_port="$(docker port "$container_name" 3306/tcp | sed -n 's/.*:\([0-9][0-9]*\)$/\1/p' | head -1)"
[[ -n "$published_port" ]] || { echo "Could not obtain the loopback-only MySQL port." >&2; exit 2; }

MYSQL_ATTESTATION_TEST=1 \
MYSQL_ATTESTATION_TEST_HOST=mysql-attestation.local \
MYSQL_ATTESTATION_TEST_PORT="$published_port" \
MYSQL_ATTESTATION_TEST_DATABASE=l4ckos_stock_test \
MYSQL_ATTESTATION_TEST_CA="$(cat "$temp_dir/certs/ca.pem")" \
MYSQL_ATTESTATION_TEST_WRONG_CA="$(cat "$temp_dir/certs/wrong-ca.pem")" \
  pnpm exec vitest run --fileParallelism=false \
    server/database/mysqlSchemaAttestation.test.ts \
    server/database/mysqlSchemaAttestationPublic.test.ts

if [[ -n "${MYSQL_ATTESTATION_PUBLIC_IMAGE:-}" ]]; then
  docker image inspect "$MYSQL_ATTESTATION_PUBLIC_IMAGE" >/dev/null 2>&1 || {
    echo "Requested public runner image is unavailable locally; refusing to pull." >&2
    exit 2
  }

  export MYSQL_ATTESTATION_APPROVED=YES
  export MYSQL_ATTESTATION_PRIVILEGE_ACK=REFERENCES_METADATA_ONLY
  export MYSQL_ATTESTATION_HOST=mysql-attestation.local
  export MYSQL_ATTESTATION_DATABASE=l4ckos_stock_test
  export MYSQL_ATTESTATION_USER=attest_metadata
  export MYSQL_ATTESTATION_PASSWORD=synthetic-metadata-password
  export MYSQL_ATTESTATION_TLS_CA_PEM="$(cat "$temp_dir/certs/ca.pem")"
  export MYSQL_ATTESTATION_RUN_ID=p19-local-synthetic

  docker run --pull=never --rm --network "$network_name" \
    --env MYSQL_ATTESTATION_APPROVED \
    --env MYSQL_ATTESTATION_PRIVILEGE_ACK \
    --env MYSQL_ATTESTATION_HOST \
    --env MYSQL_ATTESTATION_DATABASE \
    --env MYSQL_ATTESTATION_USER \
    --env MYSQL_ATTESTATION_PASSWORD \
    --env MYSQL_ATTESTATION_TLS_CA_PEM \
    --env MYSQL_ATTESTATION_RUN_ID \
    "$MYSQL_ATTESTATION_PUBLIC_IMAGE" \
    > "$temp_dir/public-image-attestation.json"

  PUBLIC_IMAGE_RESULT_PATH="$temp_dir/public-image-attestation.json" \
    node --input-type=module -e '
      import { readFileSync } from "node:fs";
      const result = JSON.parse(readFileSync(process.env.PUBLIC_IMAGE_RESULT_PATH, "utf8"));
      if (result.status !== "ok" || result.runId !== "p19-local-synthetic" || result.tlsVersion !== "TLSv1.3") {
        process.stderr.write("Public image synthetic attestation failed validation.\n");
        process.exit(1);
      }
      process.stdout.write("Public image one-shot MySQL/TLS fixture: PASS (TLS 1.3).\n");
    '
  unset MYSQL_ATTESTATION_APPROVED MYSQL_ATTESTATION_PRIVILEGE_ACK \
    MYSQL_ATTESTATION_HOST MYSQL_ATTESTATION_DATABASE MYSQL_ATTESTATION_USER \
    MYSQL_ATTESTATION_PASSWORD MYSQL_ATTESTATION_TLS_CA_PEM MYSQL_ATTESTATION_RUN_ID
fi
