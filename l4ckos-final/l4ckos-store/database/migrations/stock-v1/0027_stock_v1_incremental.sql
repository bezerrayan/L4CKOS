-- STOCK V1 candidate 0027. Isolated from drizzle/meta/_journal.json and 0008–0017.
-- DO NOT run against production in this preparation task.
-- Preconditions are enforced before the first ALTER. The procedure is deliberately
-- fail-closed: a partial prior execution requires inspection and operator recovery.
-- No row-level SELECT, DML, inference, activation, or financial backfill is done.

DELIMITER $$
CREATE PROCEDURE __l4ckos_stock_v1_0027_apply()
apply_stock_v1: BEGIN
  DECLARE v_missing_tables INT DEFAULT 0;
  DECLARE v_bad_columns INT DEFAULT 0;
  DECLARE v_stock_objects INT DEFAULT 0;
  DECLARE v_existing_stock_tables INT DEFAULT 0;
  DECLARE v_target_columns INT DEFAULT 0;
  DECLARE v_non_innodb INT DEFAULT 0;
  DECLARE v_collation_mismatch INT DEFAULT 0;
  DECLARE v_expected_keys INT DEFAULT 0;
  DECLARE v_existing_fk INT DEFAULT 0;
  DECLARE v_new_table_columns INT DEFAULT 0;
  DECLARE v_expected_fks INT DEFAULT 0;
  DECLARE v_expected_checks INT DEFAULT 0;

  IF DATABASE() <> 'railway' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'STOCK V1 0027 blocked: expected schema railway';
  END IF;

  -- This attestation allowlist names the following four existing tables and two
  -- parents. Names alone are not treated as structural acceptance.
  SELECT COUNT(*) INTO v_missing_tables
    FROM (SELECT 'products' n UNION ALL SELECT 'productVariants' UNION ALL SELECT 'orders'
          UNION ALL SELECT 'orderItems' UNION ALL SELECT 'stockReservations'
          UNION ALL SELECT 'users') expected
    LEFT JOIN information_schema.tables t
      ON t.table_schema = DATABASE() AND t.table_name = expected.n AND t.table_type = 'BASE TABLE'
   WHERE t.table_name IS NULL;
  IF v_missing_tables <> 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'STOCK V1 0027 blocked: required legacy base table missing';
  END IF;

  SELECT COUNT(*) INTO v_non_innodb
    FROM information_schema.tables
   WHERE table_schema = DATABASE()
     AND table_name IN ('products','productVariants','orders','orderItems','stockReservations')
     AND engine <> 'InnoDB';
  IF v_non_innodb <> 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'STOCK V1 0027 blocked: legacy table engine is not InnoDB';
  END IF;

  -- IDs in all new FK paths are signed INT in the frozen P13 contract/adapter.
  SELECT COUNT(*) INTO v_bad_columns
    FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND ((table_name='products' AND column_name='id')
       OR (table_name='productVariants' AND column_name IN ('id','productId'))
       OR (table_name='orders' AND column_name IN ('id','userId'))
       OR (table_name='orderItems' AND column_name IN ('id','orderId','productId'))
       OR (table_name='stockReservations' AND column_name IN ('id','orderId','userId','productId')))
     AND (data_type <> 'int' OR column_type <> 'int');
  IF v_bad_columns <> 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'STOCK V1 0027 blocked: FK identifier type/signedness drift';
  END IF;
  SELECT COUNT(*) INTO v_bad_columns
    FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND ((table_name='products' AND column_name IN ('price','stock') AND data_type<>'int')
       OR (table_name='productVariants' AND column_name IN ('name','sku','price','stock','createdAt','updatedAt') AND
            NOT ((column_name IN ('name','sku') AND data_type='varchar' AND character_maximum_length=120)
              OR (column_name IN ('price','stock') AND data_type='int')
              OR (column_name IN ('createdAt','updatedAt') AND data_type='timestamp')))
       OR (table_name='orders' AND column_name IN ('status','paymentStatus','totalPrice','createdAt','updatedAt') AND
            NOT ((column_name IN ('status','paymentStatus') AND data_type='enum')
              OR (column_name='totalPrice' AND data_type='int')
              OR (column_name IN ('createdAt','updatedAt') AND data_type='timestamp')))
       OR (table_name='orderItems' AND column_name IN ('quantity','price','createdAt') AND
            NOT ((column_name IN ('quantity','price') AND data_type='int') OR (column_name='createdAt' AND data_type='timestamp')))
       OR (table_name='stockReservations' AND column_name IN ('quantity','status','expiresAt','createdAt','updatedAt') AND
            NOT ((column_name='quantity' AND data_type='int')
              OR (column_name='status' AND data_type='enum')
              OR (column_name IN ('expiresAt','createdAt','updatedAt') AND data_type='timestamp'))));
  IF v_bad_columns <> 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'STOCK V1 0027 blocked: legacy base column type drift';
  END IF;

  -- Required legacy columns from P13. Do not replay 0010 or 0016 here: if absent,
  -- this candidate stops without them. This is metadata-only validation.
  SELECT COUNT(*) INTO v_missing_tables
    FROM (SELECT 'products' t, 'id' c UNION ALL SELECT 'products','name'
          UNION ALL SELECT 'products','price' UNION ALL SELECT 'products','stock'
          UNION ALL SELECT 'productVariants','id' UNION ALL SELECT 'productVariants','productId'
          UNION ALL SELECT 'productVariants','name' UNION ALL SELECT 'productVariants','sku'
          UNION ALL SELECT 'productVariants','price' UNION ALL SELECT 'productVariants','stock'
          UNION ALL SELECT 'productVariants','createdAt' UNION ALL SELECT 'productVariants','updatedAt'
          UNION ALL SELECT 'orders','id' UNION ALL SELECT 'orders','userId'
          UNION ALL SELECT 'orders','status' UNION ALL SELECT 'orders','paymentStatus'
          UNION ALL SELECT 'orders','paymentConfirmationSource' UNION ALL SELECT 'orders','paymentConfirmedAt'
          UNION ALL SELECT 'orders','paymentConfirmedBy' UNION ALL SELECT 'orders','paymentConfirmationReference'
          UNION ALL SELECT 'orders','totalPrice' UNION ALL SELECT 'orders','asaasCheckoutId'
          UNION ALL SELECT 'orders','trackingCode'
          UNION ALL SELECT 'orders','shippingRecipient' UNION ALL SELECT 'orders','shippingZipCode'
          UNION ALL SELECT 'orders','shippingStreet' UNION ALL SELECT 'orders','shippingNumber'
          UNION ALL SELECT 'orders','shippingComplement' UNION ALL SELECT 'orders','shippingNeighborhood'
          UNION ALL SELECT 'orders','shippingCity' UNION ALL SELECT 'orders','shippingState'
          UNION ALL SELECT 'orders','createdAt' UNION ALL SELECT 'orders','updatedAt'
          UNION ALL SELECT 'orderItems','id' UNION ALL SELECT 'orderItems','orderId'
          UNION ALL SELECT 'orderItems','productId' UNION ALL SELECT 'orderItems','quantity'
          UNION ALL SELECT 'orderItems','price' UNION ALL SELECT 'orderItems','createdAt'
          UNION ALL SELECT 'stockReservations','id' UNION ALL SELECT 'stockReservations','orderId'
          UNION ALL SELECT 'stockReservations','userId' UNION ALL SELECT 'stockReservations','productId'
          UNION ALL SELECT 'stockReservations','quantity' UNION ALL SELECT 'stockReservations','status'
          UNION ALL SELECT 'stockReservations','expiresAt' UNION ALL SELECT 'stockReservations','createdAt'
          UNION ALL SELECT 'stockReservations','updatedAt' UNION ALL SELECT 'users','id') expected
    LEFT JOIN information_schema.columns c
      ON c.table_schema = DATABASE() AND c.table_name = expected.t AND c.column_name = expected.c
   WHERE c.column_name IS NULL;
  IF v_missing_tables <> 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'STOCK V1 0027 blocked: base contract column missing (migration chain drift)';
  END IF;

  SELECT COUNT(*) INTO v_expected_keys
    FROM information_schema.statistics
   WHERE table_schema = DATABASE() AND index_name = 'PRIMARY'
     AND table_name IN ('products','productVariants','orders','orderItems','stockReservations','users')
     AND seq_in_index = 1 AND column_name = 'id';
  IF v_expected_keys <> 6 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'STOCK V1 0027 blocked: legacy primary-key shape differs';
  END IF;

  -- FKs from new text keys require compatible table defaults. Reject mixed
  -- collations instead of guessing or coercing legacy data/schema.
  SELECT COUNT(*) INTO v_collation_mismatch
    FROM information_schema.tables t
    JOIN information_schema.schemata s ON s.schema_name = t.table_schema
   WHERE t.table_schema = DATABASE()
     AND t.table_name IN ('products','productVariants','orders','orderItems','stockReservations')
     AND t.table_collation <> s.default_collation_name;
  IF v_collation_mismatch <> 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'STOCK V1 0027 blocked: legacy table collation differs from schema default';
  END IF;

  -- 17 additive columns + three new tables is the only accepted object delta.
  -- Reapplication is a no-op only after every object exists; partial state stops.
  SELECT COUNT(*) INTO v_existing_stock_tables
    FROM information_schema.tables
   WHERE table_schema = DATABASE()
     AND table_name IN ('stockCheckoutAttempts','stockCheckoutItems','stockWebhookEvents');
  SELECT COUNT(*) INTO v_target_columns
    FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND ((table_name='productVariants' AND column_name IN ('size','color','reservedStock','isActive'))
       OR (table_name='orders' AND column_name IN ('stockAttemptId','stockPaymentId','shippingOptionId'))
       OR (table_name='orderItems' AND column_name IN ('variantId','skuSnapshot','sizeSnapshot','colorSnapshot'))
       OR (table_name='stockReservations' AND column_name IN ('attemptId','variantId','skuSnapshot','sizeSnapshot','colorSnapshot','unitPriceCents')));
  SET v_stock_objects = v_existing_stock_tables + v_target_columns;

  IF v_stock_objects = 20 THEN
    -- Validate the candidate's most important post-state type and named-key
    -- assertions before returning success on reapplication.
    SELECT COUNT(*) INTO v_bad_columns
      FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND ((table_name='productVariants' AND column_name IN ('size','color','reservedStock','isActive'))
         OR (table_name='orders' AND column_name IN ('stockAttemptId','stockPaymentId','shippingOptionId'))
         OR (table_name='orderItems' AND column_name IN ('variantId','skuSnapshot','sizeSnapshot','colorSnapshot'))
         OR (table_name='stockReservations' AND column_name IN ('attemptId','variantId','skuSnapshot','sizeSnapshot','colorSnapshot','unitPriceCents')))
       AND NOT ((column_name IN ('size','sizeSnapshot') AND data_type='varchar' AND character_maximum_length=60)
         OR (column_name IN ('color','colorSnapshot') AND data_type='varchar' AND character_maximum_length=60)
         OR (column_name IN ('skuSnapshot') AND data_type='varchar' AND character_maximum_length=120)
         OR (column_name IN ('stockAttemptId','stockPaymentId','shippingOptionId','attemptId') AND data_type='varchar' AND character_maximum_length=120)
         OR (column_name='reservedStock' AND data_type='int' AND is_nullable='NO')
         OR (column_name='isActive' AND data_type='int' AND is_nullable='NO')
         OR (column_name='variantId' AND data_type='int' AND is_nullable='YES')
         OR (column_name='unitPriceCents' AND data_type='int' AND is_nullable='YES'));
    IF v_bad_columns <> 0 THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'STOCK V1 0027 blocked: completed-looking schema has column drift';
    END IF;
    SELECT COUNT(*) INTO v_expected_keys
      FROM information_schema.statistics
     WHERE table_schema = DATABASE()
       AND ((table_name='productVariants' AND index_name IN ('productVariants_sku_unique','productVariants_product_color_size_unique'))
         OR (table_name='orders' AND index_name IN ('orders_stockAttempt_unique','orders_stockPayment_unique'))
         OR (table_name='stockReservations' AND index_name='stockReservations_attempt_variant_unique'));
    IF v_expected_keys < 5 THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'STOCK V1 0027 blocked: completed-looking schema lacks required unique keys';
    END IF;
    SELECT COUNT(*) INTO v_new_table_columns
      FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name IN ('stockCheckoutAttempts','stockCheckoutItems','stockWebhookEvents');
    IF v_new_table_columns <> 28 THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'STOCK V1 0027 blocked: completed-looking new tables have column drift';
    END IF;
    SELECT COUNT(*) INTO v_non_innodb
      FROM information_schema.tables
     WHERE table_schema = DATABASE()
       AND table_name IN ('stockCheckoutAttempts','stockCheckoutItems','stockWebhookEvents')
       AND engine <> 'InnoDB';
    IF v_non_innodb <> 0 THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'STOCK V1 0027 blocked: completed-looking STOCK table engine drift';
    END IF;
    SELECT COUNT(*) INTO v_expected_fks
      FROM information_schema.referential_constraints
     WHERE constraint_schema = DATABASE()
       AND constraint_name IN ('productVariants_product_fk','orderItems_order_fk','orderItems_product_fk',
         'orderItems_variant_fk','stockCheckoutAttempts_order_fk','stockCheckoutItems_attempt_fk',
         'stockCheckoutItems_variant_fk','stockCheckoutItems_product_fk','stockReservations_attempt_fk',
         'stockReservations_variant_fk','stockReservations_order_fk','stockReservations_product_fk');
    IF v_expected_fks <> 12 THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'STOCK V1 0027 blocked: completed-looking schema lacks required FKs';
    END IF;
    SELECT COUNT(*) INTO v_expected_checks
      FROM information_schema.table_constraints
     WHERE constraint_schema = DATABASE() AND constraint_type = 'CHECK'
       AND constraint_name IN ('productVariants_stock_bounds_check','productVariants_active_check',
         'productVariants_active_identity_check','stockReservations_quantity_positive_check',
         'stockCheckoutItems_quantity_check');
    IF v_expected_checks <> 5 THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'STOCK V1 0027 blocked: completed-looking schema lacks required CHECKs';
    END IF;
    LEAVE apply_stock_v1;
  ELSEIF v_stock_objects <> 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'STOCK V1 0027 blocked: partial prior STOCK DDL requires inspection';
  END IF;

  -- The candidate baseline has no FK on the relations this file creates. Any
  -- pre-existing relation requires review so duplicate or conflicting FKs are
  -- never added by assumption. Expected FKs from a completed application are
  -- handled by the no-op branch above.
  SELECT COUNT(*) INTO v_existing_fk
    FROM information_schema.key_column_usage
   WHERE table_schema = DATABASE() AND referenced_table_name IS NOT NULL
     AND ((table_name='productVariants' AND column_name='productId')
       OR (table_name='orderItems' AND column_name IN ('orderId','productId','variantId'))
       OR (table_name='stockReservations' AND column_name IN ('orderId','productId','variantId','attemptId')));
  IF v_existing_fk <> 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'STOCK V1 0027 blocked: existing FK relation needs reconciliation';
  END IF;

  -- This candidate accepts only the frozen generic legacy baseline. An existing
  -- partial STOCK expansion, new table, or incompatible base schema blocks above.
  ALTER TABLE productVariants
    ADD COLUMN size VARCHAR(60) NULL,
    ADD COLUMN color VARCHAR(60) NULL,
    ADD COLUMN reservedStock INT NOT NULL DEFAULT 0,
    ADD COLUMN isActive INT NOT NULL DEFAULT 0;
  ALTER TABLE orders
    ADD COLUMN stockAttemptId VARCHAR(120) NULL,
    ADD COLUMN stockPaymentId VARCHAR(120) NULL,
    ADD COLUMN shippingOptionId VARCHAR(120) NULL;
  ALTER TABLE orderItems
    ADD COLUMN variantId INT NULL,
    ADD COLUMN skuSnapshot VARCHAR(120) NULL,
    ADD COLUMN sizeSnapshot VARCHAR(60) NULL,
    ADD COLUMN colorSnapshot VARCHAR(60) NULL;
  ALTER TABLE stockReservations
    ADD COLUMN attemptId VARCHAR(120) NULL,
    ADD COLUMN variantId INT NULL,
    ADD COLUMN skuSnapshot VARCHAR(120) NULL,
    ADD COLUMN sizeSnapshot VARCHAR(60) NULL,
    ADD COLUMN colorSnapshot VARCHAR(60) NULL,
    ADD COLUMN unitPriceCents INT NULL;

  -- Unique DDL is the duplicate gate. It never reads/returns commercial rows.
  ALTER TABLE productVariants
    ADD UNIQUE KEY productVariants_sku_unique (sku),
    ADD UNIQUE KEY productVariants_product_color_size_unique (productId, color, size),
    ADD CONSTRAINT productVariants_stock_bounds_check CHECK (reservedStock >= 0 AND reservedStock <= stock),
    ADD CONSTRAINT productVariants_active_check CHECK (isActive IN (0,1)),
    ADD CONSTRAINT productVariants_active_identity_check CHECK
      (isActive = 0 OR (sku IS NOT NULL AND TRIM(sku) <> '' AND size IS NOT NULL AND TRIM(size) <> ''
       AND color IS NOT NULL AND TRIM(color) <> '' AND price IS NOT NULL AND price > 0));
  ALTER TABLE orders
    ADD UNIQUE KEY orders_stockAttempt_unique (stockAttemptId),
    ADD UNIQUE KEY orders_stockPayment_unique (stockPaymentId),
    ADD KEY orders_status_created_idx (status, createdAt);
  ALTER TABLE orderItems
    ADD KEY orderItems_variant_idx (variantId);
  ALTER TABLE stockReservations
    ADD UNIQUE KEY stockReservations_attempt_variant_unique (attemptId, variantId),
    ADD KEY stockReservations_user_product_idx (userId, productId),
    ADD KEY stockReservations_variant_status_idx (variantId, status),
    ADD KEY stockReservations_attempt_status_idx (attemptId, status),
    ADD CONSTRAINT stockReservations_quantity_positive_check CHECK (quantity > 0);

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

  ALTER TABLE productVariants
    ADD CONSTRAINT productVariants_product_fk FOREIGN KEY (productId) REFERENCES products (id);
  ALTER TABLE orderItems
    ADD CONSTRAINT orderItems_order_fk FOREIGN KEY (orderId) REFERENCES orders (id),
    ADD CONSTRAINT orderItems_product_fk FOREIGN KEY (productId) REFERENCES products (id),
    ADD CONSTRAINT orderItems_variant_fk FOREIGN KEY (variantId) REFERENCES productVariants (id);
  ALTER TABLE stockReservations
    ADD CONSTRAINT stockReservations_attempt_fk FOREIGN KEY (attemptId) REFERENCES stockCheckoutAttempts (attemptId),
    ADD CONSTRAINT stockReservations_variant_fk FOREIGN KEY (variantId) REFERENCES productVariants (id),
    ADD CONSTRAINT stockReservations_order_fk FOREIGN KEY (orderId) REFERENCES orders (id),
    ADD CONSTRAINT stockReservations_product_fk FOREIGN KEY (productId) REFERENCES products (id);
END$$

CALL __l4ckos_stock_v1_0027_apply()$$
DROP PROCEDURE __l4ckos_stock_v1_0027_apply$$
DELIMITER ;
