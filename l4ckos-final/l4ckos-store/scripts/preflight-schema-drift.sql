-- READ-ONLY preflight for drizzle/0015_schema_drift_alignment.sql.
-- WARNING means the expected pre-0015 drift is present and the migration is needed.
-- BLOCKER must be resolved without inventing historical data before applying 0015.

SELECT
  'product_images_legacy_rows' AS check_name,
  COUNT(*) AS affected,
  IF(COUNT(*) = 0, 'OK', 'WARNING') AS classification,
  'Existing rows will retain color=NULL after the additive migration.' AS detail
FROM `productImages`;

SELECT
  'promo_banners_legacy_rows' AS check_name,
  COUNT(*) AS affected,
  IF(COUNT(*) = 0, 'OK', 'WARNING') AS classification,
  'Existing rows will retain nullable media/link fields as NULL.' AS detail
FROM `promoBanners`;

SELECT
  'waitlist_created_at_nulls' AS check_name,
  COUNT(*) AS affected,
  IF(COUNT(*) = 0, 'OK', 'BLOCKER') AS classification,
  IF(COUNT(*) = 0,
     'Safe to enforce NOT NULL; inserts already use CURRENT_TIMESTAMP by default.',
     'Do not invent signup timestamps. Classify and resolve these rows manually.') AS detail
FROM `waitlist_emails`
WHERE `created_at` IS NULL;

WITH expected AS (
  SELECT 'productImages' table_name, 'color' column_name, 'varchar(60)' expected_type, 'YES' expected_nullable, NULL expected_default
  UNION ALL SELECT 'promoBanners','imageUrl','varchar(500)','YES',NULL
  UNION ALL SELECT 'promoBanners','mobileImageUrl','varchar(500)','YES',NULL
  UNION ALL SELECT 'promoBanners','imageAlt','varchar(255)','YES',NULL
  UNION ALL SELECT 'promoBanners','linkUrl','varchar(500)','YES',NULL
  UNION ALL SELECT 'waitlist_emails','created_at','timestamp','NO','CURRENT_TIMESTAMP'
)
SELECT
  'drift_column_contract' AS check_name,
  expected.table_name,
  expected.column_name,
  expected.expected_type,
  columns.COLUMN_TYPE AS actual_type,
  expected.expected_nullable,
  columns.IS_NULLABLE AS actual_nullable,
  expected.expected_default,
  columns.COLUMN_DEFAULT AS actual_default,
  CASE
    WHEN columns.COLUMN_NAME IS NULL THEN 'WARNING'
    WHEN LOWER(columns.COLUMN_TYPE) <> expected.expected_type THEN 'BLOCKER'
    WHEN columns.IS_NULLABLE <> expected.expected_nullable THEN
      IF(expected.table_name='waitlist_emails' AND columns.IS_NULLABLE='YES', 'WARNING', 'BLOCKER')
    WHEN NOT (columns.COLUMN_DEFAULT <=> expected.expected_default) THEN 'BLOCKER'
    ELSE 'OK'
  END AS classification
FROM expected
LEFT JOIN information_schema.COLUMNS columns
  ON columns.TABLE_SCHEMA = DATABASE()
 AND columns.TABLE_NAME = expected.table_name
 AND columns.COLUMN_NAME = expected.column_name
ORDER BY expected.table_name, expected.column_name;

WITH expected_backup AS (
  SELECT * FROM JSON_TABLE(
    '[{"table":"auditLogs","columns":["id","actorUserId","actorType","action","entity","entityId","orderId","paymentId","event","correlationId","beforeState","afterState","metadata","createdAt"]},{"table":"coupons","columns":["id","code","type","value","maxUses","usedCount","startsAt","expiresAt","isActive","createdAt","updatedAt"]},{"table":"notificationOutbox","columns":["id","dedupeKey","type","orderId","paymentId","payload","status","attempts","nextAttemptAt","lockedAt","lockedBy","leaseExpiresAt","lastError","createdAt","updatedAt","sentAt"]},{"table":"orderItems","columns":["id","orderId","productId","variantId","productName","variantName","sku","size","color","quantity","unitPrice","totalPrice","imageUrl","createdAt"]},{"table":"orders","columns":["id","userId","status","trackingCode","totalPrice","asaasCheckoutId","checkoutAttemptId","checkoutFingerprint","fulfillmentStatus","fulfillmentIssue","fulfillmentIssueAt","correlationId","couponId","couponReleasedAt","shippingRecipient","shippingZipCode","shippingStreet","shippingNumber","shippingComplement","shippingNeighborhood","shippingCity","shippingState","createdAt","updatedAt"]},{"table":"paymentEvents","columns":["id","provider","providerEventId","paymentId","orderId","providerPaymentId","eventType","processingStatus","payload","errorCode","receivedAt","processedAt"]},{"table":"payments","columns":["id","orderId","provider","providerPaymentId","providerCustomerId","billingType","amount","paidAmount","refundedAmount","netAmount","status","creationStatus","creationLeaseExpiresAt","statusSource","financialIssue","financialIssueAt","manualConfirmedAt","manualConfirmedBy","manualReason","manualEvidence","externalReference","invoiceUrl","bankSlipUrl","pixQrCode","pixCopyPaste","digitableLine","createdAt","updatedAt","confirmedAt","receivedAt","refundedAt"]},{"table":"productImages","columns":["id","productId","imageUrl","color","alt","order","createdAt"]},{"table":"productReviews","columns":["id","productId","userId","rating","comment","createdAt","updatedAt"]},{"table":"productVariants","columns":["id","productId","name","sku","size","color","optionKey","price","stock","createdAt","updatedAt"]},{"table":"products","columns":["id","name","description","fullDescription","category","price","optionColors","optionSizes","sizeType","imageUrl","stock","createdAt","updatedAt"]},{"table":"promoBanners","columns":["id","badge","title","description","ctaLabel","imageUrl","mobileImageUrl","imageAlt","linkUrl","discountText","discountLabel","bgStyle","sortOrder","isActive","createdAt","updatedAt"]},{"table":"stockReservations","columns":["id","orderId","userId","productId","variantId","orderItemId","quantity","status","expiresAt","createdAt","updatedAt"]},{"table":"userAddresses","columns":["id","userId","label","recipient","zipCode","street","number","complement","neighborhood","city","state","isDefault","createdAt","updatedAt"]},{"table":"userPaymentMethods","columns":["id","userId","label","holderName","brand","last4","expiry","isDefault","createdAt","updatedAt"]},{"table":"userProfiles","columns":["id","userId","phone","createdAt","updatedAt"]},{"table":"users","columns":["id","openId","name","email","cpf","phone","asaasCustomerId","loginMethod","role","isVip","isBlocked","sessionVersion","createdAt","updatedAt","lastSignedIn"]},{"table":"waitlist_emails","columns":["id","email","created_at"]}]',
    '$[*]' COLUMNS(
      table_name varchar(64) PATH '$.table',
      NESTED PATH '$.columns[*]' COLUMNS(column_name varchar(64) PATH '$')
    )
  ) expected_rows
), missing AS (
  SELECT expected_backup.table_name, expected_backup.column_name
  FROM expected_backup
  LEFT JOIN information_schema.COLUMNS columns
    ON columns.TABLE_SCHEMA = DATABASE()
   AND columns.TABLE_NAME = expected_backup.table_name
   AND columns.COLUMN_NAME = expected_backup.column_name
  WHERE columns.COLUMN_NAME IS NULL
)
SELECT
  'backup_expected_columns' AS check_name,
  table_name,
  column_name,
  CASE
    WHEN (table_name='productImages' AND column_name='color')
      OR (table_name='promoBanners' AND column_name IN ('imageUrl','mobileImageUrl','imageAlt','linkUrl'))
      OR (table_name='waitlist_emails' AND column_name='created_at')
      THEN 'WARNING'
    ELSE 'BLOCKER'
  END AS classification
FROM missing
ORDER BY classification DESC, table_name, column_name;
