-- READ-ONLY preflight for drizzle/0013_p0_order_payment_integrity.sql.
-- Review results on a recent production backup before any remote migration.

SELECT 'negative_product_stock' AS diagnostic, COUNT(*) AS affected
FROM products
WHERE stock < 0;

SELECT 'negative_variant_stock' AS diagnostic, COUNT(*) AS affected
FROM productVariants
WHERE stock < 0;

SELECT 'products_with_options_but_no_variants' AS diagnostic, COUNT(*) AS affected
FROM products p
WHERE (
  (p.optionColors IS NOT NULL AND p.optionColors NOT IN ('', '[]')) OR
  (p.optionSizes IS NOT NULL AND p.optionSizes NOT IN ('', '[]'))
)
AND NOT EXISTS (
  SELECT 1 FROM productVariants pv WHERE pv.productId = p.id
);

SELECT
  'products_with_options_but_no_variants_detail' AS diagnostic,
  p.id,
  p.name,
  p.optionColors,
  p.optionSizes,
  p.stock
FROM products p
WHERE (
  (p.optionColors IS NOT NULL AND p.optionColors NOT IN ('', '[]')) OR
  (p.optionSizes IS NOT NULL AND p.optionSizes NOT IN ('', '[]'))
)
AND NOT EXISTS (
  SELECT 1 FROM productVariants pv WHERE pv.productId = p.id
)
ORDER BY p.id;

SELECT
  'duplicate_legacy_variant_name_per_product' AS diagnostic,
  productId,
  LOWER(TRIM(name)) AS normalizedName,
  COUNT(*) AS affected
FROM productVariants
GROUP BY productId, LOWER(TRIM(name))
HAVING COUNT(*) > 1;

SELECT
  'duplicate_legacy_variant_sku' AS diagnostic,
  LOWER(TRIM(sku)) AS normalizedSku,
  COUNT(*) AS affected
FROM productVariants
WHERE sku IS NOT NULL AND TRIM(sku) <> ''
GROUP BY LOWER(TRIM(sku))
HAVING COUNT(*) > 1;

SELECT
  'variant_product_stock_mismatch' AS diagnostic,
  p.id AS productId,
  p.name,
  p.stock AS productStock,
  SUM(pv.stock) AS variantStock,
  p.stock - SUM(pv.stock) AS difference
FROM products p
JOIN productVariants pv ON pv.productId = p.id
GROUP BY p.id, p.name, p.stock
HAVING p.stock <> SUM(pv.stock);

SELECT 'invalid_order_item_quantity' AS diagnostic, COUNT(*) AS affected
FROM orderItems
WHERE quantity <= 0;

SELECT 'orphan_order_items' AS diagnostic, COUNT(*) AS affected
FROM orderItems oi
LEFT JOIN orders o ON o.id = oi.orderId
WHERE o.id IS NULL;

SELECT 'orders_without_items' AS diagnostic, COUNT(*) AS affected
FROM orders o
WHERE NOT EXISTS (
  SELECT 1 FROM orderItems oi WHERE oi.orderId = o.id
);

SELECT 'orphan_reservations' AS diagnostic, COUNT(*) AS affected
FROM stockReservations sr
LEFT JOIN orders o ON o.id = sr.orderId
WHERE o.id IS NULL;

SELECT 'reservations_with_missing_product' AS diagnostic, COUNT(*) AS affected
FROM stockReservations sr
LEFT JOIN products p ON p.id = sr.productId
WHERE p.id IS NULL;

SELECT 'reservations_with_missing_user' AS diagnostic, COUNT(*) AS affected
FROM stockReservations sr
LEFT JOIN users u ON u.id = sr.userId
WHERE u.id IS NULL;

SELECT 'invalid_reservation_quantity' AS diagnostic, COUNT(*) AS affected
FROM stockReservations
WHERE quantity <= 0;

SELECT 'active_but_expired_reservations' AS diagnostic, COUNT(*) AS affected
FROM stockReservations
WHERE status = 'active' AND expiresAt <= CURRENT_TIMESTAMP;

SELECT 'duplicate_asaas_checkout_id' AS diagnostic, asaasCheckoutId, COUNT(*) AS affected
FROM orders
WHERE asaasCheckoutId IS NOT NULL AND asaasCheckoutId <> ''
GROUP BY asaasCheckoutId
HAVING COUNT(*) > 1;

SELECT
  'legacy_orders_without_reconcilable_payment_evidence' AS diagnostic,
  status,
  COUNT(*) AS affected
FROM orders
GROUP BY status
ORDER BY status;

SELECT
  'legacy_variants_require_structured_size_color_review' AS diagnostic,
  id,
  productId,
  name,
  sku
FROM productVariants
ORDER BY productId, id;

-- The new nullable optionKey cannot conflict during the additive migration:
-- MySQL permits multiple NULL values in a UNIQUE index. These rows must still
-- be reviewed before any later structured optionKey backfill.
SELECT
  'legacy_variants_missing_deterministic_option_key' AS diagnostic,
  COUNT(*) AS affected
FROM productVariants;
