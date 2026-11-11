-- STOCK V1 candidate 0027-V6 ("on V6 lineage"). LOCAL CANDIDATE ONLY.
--
-- ARTIFACT:      stock-v1/v6/0027_stock_v1_on_v6_lineage.sql (version 1)
-- SUPERSEDES:    stock-v1/0027_stock_v1_incremental.sql FOR THE V6 LINEAGE ONLY. That legacy file stays frozen and
--                still fails closed on a V6 schema; it must never be applied to a database that has 0021..0025.
-- APPLICABLE TO: a database whose physical schema is the audited baseline + 0020..0025 (V6 / preorder / inbox /
--                variant identity): orderItems.unitPrice/totalPrice, productVariants.optionKey/size/color/isActive,
--                orderItems.variantId, stockReservations.variantId/orderItemId, asaasWebhookInbox, productionBatches.
-- NOT APPLICABLE: legacy base with orderItems.price (use the legacy 0027), or any schema failing the checks below.
-- NOT part of drizzle/meta/_journal.json; the Drizzle chain does NOT run this file. DO NOT run against staging or
-- production without the release runbook (l4ckos-release-verification), a current physical inventory and a
-- restorable, verified backup. Forward-only; no row-level SELECT, no DML, no backfill, no activation.
--
-- REUSES (never recreated or altered): productVariants.optionKey (+ unique (productId, optionKey), which is the
-- STOCK colour/size identity), size, color, isActive TINYINT (+ boolean CHECK), sku, price, stock;
-- orderItems.unitPrice/totalPrice/variantId/(variantId idx) and their CHECKs; orders.checkoutAttemptId;
-- stockReservations.variantId/orderItemId, quantity-positive CHECK, order/orderItem FKs.
-- ADDS ONLY: productVariants.reservedStock; orders.stockAttemptId/stockPaymentId/shippingOptionId;
-- orderItems.skuSnapshot/sizeSnapshot/colorSnapshot; stockReservations.attemptId/skuSnapshot/sizeSnapshot/
-- colorSnapshot/unitPriceCents; three STOCK tables; the unique keys / CHECKs STOCK relies on.
-- DELIBERATELY NOT ADDED: FKs on pre-existing columns (orderItems.variantId/productId, stockReservations.variantId,
-- productVariants.productId): they could be rejected by legacy orphan rows and are an operator decision after the
-- physical inventory. New tables carry their own FKs. New tables use the schema default collation (no hard-coded
-- collation), matching the V6 lineage; the Drops 0028 candidate follows the same rule.
--
-- Data-dependent DDL (unique sku, active-identity CHECK) runs FIRST so a duplicate/invalid legacy row stops the
-- file before any other STOCK object exists. Any partial prior state is detected and requires operator inspection.

DELIMITER $$
DROP PROCEDURE IF EXISTS __l4ckos_stock_v1_0027_v6_apply$$
CREATE PROCEDURE __l4ckos_stock_v1_0027_v6_apply()
apply_stock_v1_v6: BEGIN
  DECLARE v_count INT DEFAULT 0;
  DECLARE v_objects INT DEFAULT 0;

  IF DATABASE() <> 'railway' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'STOCK V1 0027-V6 blocked: expected schema railway';
  END IF;

  -- 1. Required tables, InnoDB, schema-default collation.
  SELECT COUNT(*) INTO v_count
    FROM (SELECT 'users' n UNION ALL SELECT 'products' UNION ALL SELECT 'productVariants' UNION ALL SELECT 'orders'
          UNION ALL SELECT 'orderItems' UNION ALL SELECT 'stockReservations'
          UNION ALL SELECT 'asaasWebhookInbox' UNION ALL SELECT 'productionBatches') expected
    LEFT JOIN information_schema.tables t
      ON t.table_schema = DATABASE() AND t.table_name = expected.n AND t.table_type = 'BASE TABLE' AND t.engine = 'InnoDB'
   WHERE t.table_name IS NULL;
  IF v_count <> 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'STOCK V1 0027-V6 blocked: V6 lineage table missing or not InnoDB';
  END IF;

  SELECT COUNT(*) INTO v_count
    FROM information_schema.tables t JOIN information_schema.schemata s ON s.schema_name = t.table_schema
   WHERE t.table_schema = DATABASE()
     AND t.table_name IN ('products','productVariants','orders','orderItems','stockReservations')
     AND t.table_collation <> s.default_collation_name;
  IF v_count <> 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'STOCK V1 0027-V6 blocked: table collation differs from schema default';
  END IF;

  -- 2. The legacy `price` column must NOT exist (that is the legacy base: use the legacy 0027).
  SELECT COUNT(*) INTO v_count FROM information_schema.columns
   WHERE table_schema = DATABASE() AND table_name = 'orderItems' AND column_name = 'price';
  IF v_count <> 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'STOCK V1 0027-V6 blocked: legacy orderItems.price present (not the V6 lineage)';
  END IF;

  -- 3. V6 column contract: exact types/nullability of what is reused.
  SELECT COUNT(*) INTO v_count
    FROM (SELECT 'users' t, 'id' c, 'int' ty, 'NO' nl UNION ALL
          SELECT 'products','id','int','NO' UNION ALL
          SELECT 'products','price','int','NO' UNION ALL
          SELECT 'orders','id','int','NO' UNION ALL SELECT 'orders','userId','int','NO' UNION ALL
          SELECT 'orders','totalPrice','int','NO' UNION ALL SELECT 'orders','checkoutAttemptId','varchar','YES' UNION ALL
          SELECT 'productVariants','id','int','NO' UNION ALL SELECT 'productVariants','productId','int','NO' UNION ALL
          SELECT 'productVariants','sku','varchar','YES' UNION ALL SELECT 'productVariants','price','int','YES' UNION ALL
          SELECT 'productVariants','stock','int','NO' UNION ALL SELECT 'productVariants','size','varchar','YES' UNION ALL
          SELECT 'productVariants','color','varchar','YES' UNION ALL SELECT 'productVariants','optionKey','varchar','YES' UNION ALL
          SELECT 'productVariants','isActive','tinyint','NO' UNION ALL
          SELECT 'orderItems','id','int','NO' UNION ALL SELECT 'orderItems','orderId','int','NO' UNION ALL
          SELECT 'orderItems','productId','int','NO' UNION ALL SELECT 'orderItems','quantity','int','NO' UNION ALL
          SELECT 'orderItems','unitPrice','int','NO' UNION ALL SELECT 'orderItems','totalPrice','int','YES' UNION ALL
          SELECT 'orderItems','variantId','int','YES' UNION ALL
          SELECT 'stockReservations','id','int','NO' UNION ALL SELECT 'stockReservations','orderId','int','NO' UNION ALL
          SELECT 'stockReservations','userId','int','NO' UNION ALL SELECT 'stockReservations','productId','int','NO' UNION ALL
          SELECT 'stockReservations','quantity','int','NO' UNION ALL SELECT 'stockReservations','variantId','int','YES' UNION ALL
          SELECT 'stockReservations','orderItemId','int','YES') expected
    LEFT JOIN information_schema.columns c
      ON c.table_schema = DATABASE() AND c.table_name = expected.t AND c.column_name = expected.c
     AND c.data_type = expected.ty AND c.is_nullable = expected.nl
     AND (expected.ty <> 'int' OR c.column_type = 'int')
   WHERE c.column_name IS NULL;
  IF v_count <> 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'STOCK V1 0027-V6 blocked: V6 column contract drift';
  END IF;

  SELECT COUNT(*) INTO v_count FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND ((table_name='productVariants' AND column_name IN ('sku','name') AND character_maximum_length <> 120)
       OR (table_name='productVariants' AND column_name IN ('size','color') AND character_maximum_length <> 60));
  IF v_count <> 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'STOCK V1 0027-V6 blocked: V6 variant text length drift';
  END IF;

  -- 4. Reused V6 keys/constraints must exist exactly as the STOCK identity needs them.
  SELECT COUNT(*) INTO v_count FROM information_schema.statistics
   WHERE table_schema = DATABASE() AND table_name = 'productVariants' AND index_name = 'productVariants_product_option_unique'
     AND non_unique = 0 AND ((seq_in_index = 1 AND column_name = 'productId') OR (seq_in_index = 2 AND column_name = 'optionKey'));
  IF v_count <> 2 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'STOCK V1 0027-V6 blocked: productVariants (productId, optionKey) unique key missing';
  END IF;
  SELECT COUNT(*) INTO v_count FROM information_schema.table_constraints
   WHERE constraint_schema = DATABASE() AND constraint_type = 'CHECK'
     AND constraint_name IN ('product_variants_active_boolean_chk','product_variants_stock_nonnegative_chk',
                             'order_items_unit_price_nonnegative_chk','order_items_quantity_positive_chk',
                             'stock_reservations_quantity_positive_chk');
  IF v_count <> 5 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'STOCK V1 0027-V6 blocked: V6 CHECK constraints missing';
  END IF;

  -- 5. Applied-state accounting: 12 columns + 3 tables + 4 unique keys on existing tables + 2 productVariants CHECKs.
  SELECT COUNT(*) INTO v_objects FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND ((table_name='productVariants' AND column_name='reservedStock')
       OR (table_name='orders' AND column_name IN ('stockAttemptId','stockPaymentId','shippingOptionId'))
       OR (table_name='orderItems' AND column_name IN ('skuSnapshot','sizeSnapshot','colorSnapshot'))
       OR (table_name='stockReservations' AND column_name IN ('attemptId','skuSnapshot','sizeSnapshot','colorSnapshot','unitPriceCents')));
  SELECT COUNT(*) INTO v_count FROM information_schema.tables
   WHERE table_schema = DATABASE() AND table_name IN ('stockCheckoutAttempts','stockCheckoutItems','stockWebhookEvents');
  SET v_objects = v_objects + v_count;
  SELECT COUNT(DISTINCT index_name) INTO v_count FROM information_schema.statistics
   WHERE table_schema = DATABASE() AND non_unique = 0
     AND ((table_name='productVariants' AND index_name='productVariants_sku_unique')
       OR (table_name='orders' AND index_name IN ('orders_stockAttempt_unique','orders_stockPayment_unique'))
       OR (table_name='stockReservations' AND index_name='stockReservations_attempt_variant_unique'));
  SET v_objects = v_objects + v_count;
  SELECT COUNT(*) INTO v_count FROM information_schema.table_constraints
   WHERE constraint_schema = DATABASE() AND constraint_type = 'CHECK' AND table_name = 'productVariants'
     AND constraint_name IN ('productVariants_stock_bounds_check','productVariants_active_identity_check');
  SET v_objects = v_objects + v_count;

  IF v_objects = 21 THEN
    -- Completed-looking: verify instead of re-applying; any drift stops.
    SELECT COUNT(*) INTO v_count FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND ((table_name='productVariants' AND column_name='reservedStock' AND data_type='int' AND is_nullable='NO')
         OR (table_name='orders' AND column_name IN ('stockAttemptId','stockPaymentId','shippingOptionId')
             AND data_type='varchar' AND character_maximum_length=120 AND is_nullable='YES')
         OR (table_name='orderItems' AND column_name='skuSnapshot' AND data_type='varchar' AND character_maximum_length=120)
         OR (table_name='orderItems' AND column_name IN ('sizeSnapshot','colorSnapshot') AND data_type='varchar' AND character_maximum_length=60)
         OR (table_name='stockReservations' AND column_name='attemptId' AND data_type='varchar' AND character_maximum_length=120)
         OR (table_name='stockReservations' AND column_name='skuSnapshot' AND data_type='varchar' AND character_maximum_length=120)
         OR (table_name='stockReservations' AND column_name IN ('sizeSnapshot','colorSnapshot') AND data_type='varchar' AND character_maximum_length=60)
         OR (table_name='stockReservations' AND column_name='unitPriceCents' AND data_type='int' AND is_nullable='YES'));
    IF v_count <> 12 THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'STOCK V1 0027-V6 blocked: completed-looking schema has column drift';
    END IF;
    SELECT COUNT(*) INTO v_count FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name IN ('stockCheckoutAttempts','stockCheckoutItems','stockWebhookEvents');
    IF v_count <> 28 THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'STOCK V1 0027-V6 blocked: completed-looking STOCK tables have column drift';
    END IF;
    SELECT COUNT(*) INTO v_count FROM information_schema.referential_constraints
     WHERE constraint_schema = DATABASE()
       AND constraint_name IN ('stockCheckoutAttempts_order_fk','stockCheckoutItems_attempt_fk','stockCheckoutItems_variant_fk',
                               'stockCheckoutItems_product_fk','stockReservations_attempt_fk');
    IF v_count <> 5 THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'STOCK V1 0027-V6 blocked: completed-looking schema lacks required FKs';
    END IF;
    SELECT COUNT(*) INTO v_count FROM information_schema.table_constraints
     WHERE constraint_schema = DATABASE() AND constraint_type = 'CHECK' AND constraint_name = 'stockCheckoutItems_quantity_check';
    IF v_count <> 1 THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'STOCK V1 0027-V6 blocked: completed-looking schema lacks required CHECKs';
    END IF;
    LEAVE apply_stock_v1_v6;
  ELSEIF v_objects <> 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'STOCK V1 0027-V6 blocked: partial prior STOCK DDL requires inspection';
  END IF;

  -- 6. Data-dependent DDL FIRST (duplicate sku / invalid active identity stop here, before any other object).
  ALTER TABLE productVariants
    ADD UNIQUE KEY productVariants_sku_unique (sku);
  ALTER TABLE productVariants
    ADD CONSTRAINT productVariants_active_identity_check CHECK
      (isActive = 0 OR (sku IS NOT NULL AND TRIM(sku) <> '' AND size IS NOT NULL AND TRIM(size) <> ''
       AND color IS NOT NULL AND TRIM(color) <> '' AND price IS NOT NULL AND price > 0));

  -- 7. Additive columns (all nullable or defaulted; no backfill).
  ALTER TABLE productVariants
    ADD COLUMN reservedStock INT NOT NULL DEFAULT 0;
  ALTER TABLE orders
    ADD COLUMN stockAttemptId VARCHAR(120) NULL,
    ADD COLUMN stockPaymentId VARCHAR(120) NULL,
    ADD COLUMN shippingOptionId VARCHAR(120) NULL;
  ALTER TABLE orderItems
    ADD COLUMN skuSnapshot VARCHAR(120) NULL,
    ADD COLUMN sizeSnapshot VARCHAR(60) NULL,
    ADD COLUMN colorSnapshot VARCHAR(60) NULL;
  ALTER TABLE stockReservations
    ADD COLUMN attemptId VARCHAR(120) NULL,
    ADD COLUMN skuSnapshot VARCHAR(120) NULL,
    ADD COLUMN sizeSnapshot VARCHAR(60) NULL,
    ADD COLUMN colorSnapshot VARCHAR(60) NULL,
    ADD COLUMN unitPriceCents INT NULL;

  ALTER TABLE productVariants
    ADD CONSTRAINT productVariants_stock_bounds_check CHECK (reservedStock >= 0 AND reservedStock <= stock);
  ALTER TABLE orders
    ADD UNIQUE KEY orders_stockAttempt_unique (stockAttemptId),
    ADD UNIQUE KEY orders_stockPayment_unique (stockPaymentId);
  ALTER TABLE stockReservations
    ADD UNIQUE KEY stockReservations_attempt_variant_unique (attemptId, variantId),
    ADD KEY stockReservations_user_product_idx (userId, productId),
    ADD KEY stockReservations_variant_status_idx (variantId, status),
    ADD KEY stockReservations_attempt_status_idx (attemptId, status);

  CREATE TABLE stockCheckoutAttempts (
    attemptId VARCHAR(120) NOT NULL,
    ownerUserId INT NOT NULL,
    fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    orderId INT NOT NULL,
    status ENUM('reserved','paid','released') NOT NULL,
    providerState ENUM('not_started','creating','ambiguous','created','definitive_failure') NOT NULL DEFAULT 'not_started',
    amountCents BIGINT NOT NULL,
    paymentId VARCHAR(120) NULL,
    checkoutUrl VARCHAR(2048) NULL,
    createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    reservationExpiresAt DATETIME(3) NOT NULL,
    expiryReviewedAt DATETIME(3) NULL,
    reconciliationRequiredAt DATETIME(3) NULL,
    paidAt DATETIME(3) NULL,
    releasedAt DATETIME(3) NULL,
    PRIMARY KEY (attemptId),
    UNIQUE KEY stockCheckoutAttempts_order_unique (orderId),
    UNIQUE KEY stockCheckoutAttempts_payment_unique (paymentId),
    KEY stockCheckoutAttempts_status_created_idx (status, createdAt),
    KEY stockCheckoutAttempts_owner_idx (ownerUserId, attemptId),
    KEY stockCheckoutAttempts_expiry_idx (status, reservationExpiresAt, expiryReviewedAt, attemptId),
    CONSTRAINT stockCheckoutAttempts_order_fk FOREIGN KEY (orderId) REFERENCES orders (id)
  ) ENGINE=InnoDB;

  CREATE TABLE stockCheckoutItems (
    attemptId VARCHAR(120) NOT NULL,
    lineNumber SMALLINT NOT NULL,
    variantId INT NOT NULL,
    productId INT NOT NULL,
    sku VARCHAR(120) NOT NULL,
    size VARCHAR(60) NOT NULL,
    color VARCHAR(60) NOT NULL,
    unitPriceCents INT NOT NULL,
    quantity SMALLINT NOT NULL,
    totalCents BIGINT NOT NULL,
    PRIMARY KEY (attemptId, lineNumber),
    KEY stockCheckoutItems_variant_idx (variantId),
    CONSTRAINT stockCheckoutItems_attempt_fk FOREIGN KEY (attemptId) REFERENCES stockCheckoutAttempts (attemptId),
    CONSTRAINT stockCheckoutItems_variant_fk FOREIGN KEY (variantId) REFERENCES productVariants (id),
    CONSTRAINT stockCheckoutItems_product_fk FOREIGN KEY (productId) REFERENCES products (id),
    CONSTRAINT stockCheckoutItems_quantity_check CHECK (quantity > 0)
  ) ENGINE=InnoDB;

  CREATE TABLE stockWebhookEvents (
    eventId VARCHAR(191) NOT NULL,
    payloadHash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    receivedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (eventId)
  ) ENGINE=InnoDB;

  ALTER TABLE stockReservations
    ADD CONSTRAINT stockReservations_attempt_fk FOREIGN KEY (attemptId) REFERENCES stockCheckoutAttempts (attemptId);
END$$

CALL __l4ckos_stock_v1_0027_v6_apply()$$
DROP PROCEDURE __l4ckos_stock_v1_0027_v6_apply$$
DELIMITER ;
