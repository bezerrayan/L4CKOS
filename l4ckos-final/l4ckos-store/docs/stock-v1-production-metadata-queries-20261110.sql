-- STOCK V1 production schema inventory proposal.
-- READ ONLY. Not executed. Target schema must be confirmed as `railway`.
-- Do not add SELECTs against application tables or commercial rows.

SELECT VERSION() AS mysql_version,
       @@lower_case_table_names AS lower_case_table_names,
       @@character_set_database AS database_charset,
       @@collation_database AS database_collation;

SELECT TABLE_NAME, TABLE_TYPE, ENGINE, TABLE_COLLATION
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = 'railway'
  AND TABLE_NAME IN (
    'products', 'productVariants', 'orders', 'orderItems', 'stockReservations',
    'stockCheckoutAttempts', 'stockCheckoutItems', 'stockWebhookEvents',
    'asaasWebhookEvents', 'auditLogs', 'userAddresses', 'users'
  )
ORDER BY TABLE_NAME;

SELECT TABLE_NAME, ORDINAL_POSITION, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE,
       COLUMN_DEFAULT, EXTRA, CHARACTER_SET_NAME, COLLATION_NAME
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = 'railway'
  AND TABLE_NAME IN (
    'products', 'productVariants', 'orders', 'orderItems', 'stockReservations',
    'stockCheckoutAttempts', 'stockCheckoutItems', 'stockWebhookEvents',
    'asaasWebhookEvents', 'auditLogs', 'userAddresses', 'users'
  )
ORDER BY TABLE_NAME, ORDINAL_POSITION;

SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME,
       COLLATION, SUB_PART, INDEX_TYPE
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = 'railway'
  AND TABLE_NAME IN (
    'products', 'productVariants', 'orders', 'orderItems', 'stockReservations',
    'stockCheckoutAttempts', 'stockCheckoutItems', 'stockWebhookEvents',
    'asaasWebhookEvents', 'auditLogs', 'userAddresses', 'users'
  )
ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX;

SELECT tc.TABLE_NAME, tc.CONSTRAINT_NAME, tc.CONSTRAINT_TYPE,
       cc.CHECK_CLAUSE
FROM information_schema.TABLE_CONSTRAINTS AS tc
LEFT JOIN information_schema.CHECK_CONSTRAINTS AS cc
  ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
 AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
WHERE tc.CONSTRAINT_SCHEMA = 'railway'
  AND tc.TABLE_NAME IN (
    'products', 'productVariants', 'orders', 'orderItems', 'stockReservations',
    'stockCheckoutAttempts', 'stockCheckoutItems', 'stockWebhookEvents',
    'asaasWebhookEvents', 'auditLogs', 'userAddresses', 'users'
  )
ORDER BY tc.TABLE_NAME, tc.CONSTRAINT_TYPE, tc.CONSTRAINT_NAME;

SELECT kcu.TABLE_NAME, kcu.CONSTRAINT_NAME, kcu.COLUMN_NAME,
       kcu.ORDINAL_POSITION, kcu.REFERENCED_TABLE_SCHEMA,
       kcu.REFERENCED_TABLE_NAME, kcu.REFERENCED_COLUMN_NAME,
       rc.UPDATE_RULE, rc.DELETE_RULE
FROM information_schema.KEY_COLUMN_USAGE AS kcu
LEFT JOIN information_schema.REFERENTIAL_CONSTRAINTS AS rc
  ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
 AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
 AND rc.TABLE_NAME = kcu.TABLE_NAME
WHERE kcu.TABLE_SCHEMA = 'railway'
  AND kcu.TABLE_NAME IN (
    'products', 'productVariants', 'orders', 'orderItems', 'stockReservations',
    'stockCheckoutAttempts', 'stockCheckoutItems', 'stockWebhookEvents',
    'asaasWebhookEvents', 'auditLogs', 'userAddresses', 'users'
  )
ORDER BY kcu.TABLE_NAME, kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION;

-- Discover candidate migration-history objects by metadata name only. Do not
-- assume a ledger name; inspect its structure before any separate authorized
-- query of migration identifiers/checksums.
SELECT TABLE_NAME
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = 'railway'
  AND (LOWER(TABLE_NAME) LIKE '%migration%' OR LOWER(TABLE_NAME) LIKE '%drizzle%')
ORDER BY TABLE_NAME;

-- Structure only for discovered migration-history candidates; never read rows.
SELECT TABLE_NAME, TABLE_TYPE, ENGINE, TABLE_COLLATION
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = 'railway'
  AND (LOWER(TABLE_NAME) LIKE '%migration%' OR LOWER(TABLE_NAME) LIKE '%drizzle%')
ORDER BY TABLE_NAME;

SELECT c.TABLE_NAME, c.ORDINAL_POSITION, c.COLUMN_NAME, c.COLUMN_TYPE,
       c.IS_NULLABLE, c.COLUMN_DEFAULT, c.EXTRA
FROM information_schema.COLUMNS AS c
JOIN information_schema.TABLES AS t
  ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME
WHERE c.TABLE_SCHEMA = 'railway'
  AND t.TABLE_TYPE = 'BASE TABLE'
  AND (LOWER(c.TABLE_NAME) LIKE '%migration%' OR LOWER(c.TABLE_NAME) LIKE '%drizzle%')
ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION;

SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME, INDEX_TYPE
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = 'railway'
  AND (LOWER(TABLE_NAME) LIKE '%migration%' OR LOWER(TABLE_NAME) LIKE '%drizzle%')
ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX;

SELECT TABLE_NAME, CONSTRAINT_NAME, CONSTRAINT_TYPE
FROM information_schema.TABLE_CONSTRAINTS
WHERE CONSTRAINT_SCHEMA = 'railway'
  AND (LOWER(TABLE_NAME) LIKE '%migration%' OR LOWER(TABLE_NAME) LIKE '%drizzle%')
ORDER BY TABLE_NAME, CONSTRAINT_TYPE, CONSTRAINT_NAME;

SELECT kcu.TABLE_NAME, kcu.CONSTRAINT_NAME, kcu.COLUMN_NAME,
       kcu.ORDINAL_POSITION, kcu.REFERENCED_TABLE_SCHEMA,
       kcu.REFERENCED_TABLE_NAME, kcu.REFERENCED_COLUMN_NAME,
       rc.UPDATE_RULE, rc.DELETE_RULE
FROM information_schema.KEY_COLUMN_USAGE AS kcu
LEFT JOIN information_schema.REFERENTIAL_CONSTRAINTS AS rc
  ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
 AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
 AND rc.TABLE_NAME = kcu.TABLE_NAME
WHERE kcu.TABLE_SCHEMA = 'railway'
  AND (LOWER(kcu.TABLE_NAME) LIKE '%migration%' OR LOWER(kcu.TABLE_NAME) LIKE '%drizzle%')
ORDER BY kcu.TABLE_NAME, kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION;

-- Trigger metadata for write-path tables, excluding DEFINER and SQL body.
SELECT TRIGGER_NAME, EVENT_OBJECT_TABLE, ACTION_TIMING, EVENT_MANIPULATION
FROM information_schema.TRIGGERS
WHERE TRIGGER_SCHEMA = 'railway'
  AND EVENT_OBJECT_TABLE IN (
    'products', 'productVariants', 'orders', 'orderItems', 'stockReservations',
    'stockCheckoutAttempts', 'stockCheckoutItems', 'stockWebhookEvents',
    'asaasWebhookEvents'
  )
ORDER BY EVENT_OBJECT_TABLE, TRIGGER_NAME;
