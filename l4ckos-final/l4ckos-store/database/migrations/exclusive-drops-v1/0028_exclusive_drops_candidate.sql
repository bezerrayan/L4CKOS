-- EXCLUSIVE DROPS V1 — candidate migration 0028. LOCAL CANDIDATE ONLY.
-- Not part of drizzle/meta/_journal.json. DO NOT run against staging or production without the release runbook
-- (l4ckos-release-verification) and an attested backup. Additive only: new tables, no ALTER of existing tables.
-- Tested on disposable MySQL 9.7.2 (server/exclusive/exclusiveDrops.mysql.test.ts).
-- Requires: users(id INT), products(id INT) and STOCK V1 0027 (legacy) OR 0027-V6 (stock-v1/v6) tables/columns before any DDL starts.
-- Tables inherit the schema default collation (utf8mb4_0900_ai_ci on the legacy base, utf8mb4_unicode_ci on the V6 lineage)
-- so the attemptId FK is collation-compatible with stockCheckoutAttempts on either lineage.

DELIMITER $$
DROP PROCEDURE IF EXISTS __l4ckos_exclusive_drops_0028_preflight$$
CREATE PROCEDURE __l4ckos_exclusive_drops_0028_preflight()
BEGIN
  DECLARE v_missing INT DEFAULT 0;
  DECLARE v_non_innodb INT DEFAULT 0;
  DECLARE v_bad_columns INT DEFAULT 0;
  DECLARE v_attempt_key INT DEFAULT 0;

  SELECT COUNT(*) INTO v_missing
    FROM (SELECT 'users' n UNION ALL SELECT 'products' UNION ALL SELECT 'stockCheckoutAttempts') expected
    LEFT JOIN information_schema.tables t
      ON t.table_schema = DATABASE() AND t.table_name = expected.n AND t.table_type = 'BASE TABLE'
   WHERE t.table_name IS NULL;
  IF v_missing <> 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Exclusive Drops 0028 blocked: apply and attest STOCK 0027 first';
  END IF;

  SELECT COUNT(*) INTO v_non_innodb
    FROM information_schema.tables
   WHERE table_schema = DATABASE()
     AND table_name IN ('users','products','stockCheckoutAttempts')
     AND engine <> 'InnoDB';
  IF v_non_innodb <> 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Exclusive Drops 0028 blocked: required parent table is not InnoDB';
  END IF;

  SELECT COUNT(*) INTO v_bad_columns
    FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND ((table_name IN ('users','products') AND column_name = 'id' AND data_type <> 'int')
       OR (table_name = 'stockCheckoutAttempts' AND column_name IN ('attemptId','ownerUserId','status','providerState','reconciliationRequiredAt')
           AND NOT ((column_name = 'attemptId' AND data_type = 'varchar' AND character_maximum_length >= 120)
             OR (column_name = 'ownerUserId' AND data_type = 'int')
             OR (column_name IN ('status','providerState') AND data_type = 'enum')
             OR (column_name = 'reconciliationRequiredAt' AND data_type IN ('timestamp','datetime')))));
  IF v_bad_columns <> 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Exclusive Drops 0028 blocked: STOCK 0027 column contract drift';
  END IF;

  SELECT COUNT(*) INTO v_missing
    FROM (SELECT 'attemptId' n UNION ALL SELECT 'ownerUserId' UNION ALL SELECT 'status'
          UNION ALL SELECT 'providerState' UNION ALL SELECT 'reconciliationRequiredAt') expected
    LEFT JOIN information_schema.columns c
      ON c.table_schema = DATABASE() AND c.table_name = 'stockCheckoutAttempts' AND c.column_name = expected.n
   WHERE c.column_name IS NULL;
  IF v_missing <> 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Exclusive Drops 0028 blocked: STOCK 0027 columns are missing';
  END IF;

  SELECT COUNT(*) INTO v_attempt_key
    FROM information_schema.statistics
   WHERE table_schema = DATABASE() AND table_name = 'stockCheckoutAttempts'
     AND column_name = 'attemptId' AND non_unique = 0;
  IF v_attempt_key = 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Exclusive Drops 0028 blocked: STOCK attemptId is not uniquely keyed';
  END IF;
END$$
CALL __l4ckos_exclusive_drops_0028_preflight()$$
DROP PROCEDURE __l4ckos_exclusive_drops_0028_preflight$$
DELIMITER ;

CREATE TABLE IF NOT EXISTS exclusiveDrops (
  id INT NOT NULL AUTO_INCREMENT,
  slug VARCHAR(80) NOT NULL,
  name VARCHAR(160) NOT NULL,
  description TEXT NULL,
  timezone VARCHAR(64) NOT NULL DEFAULT 'America/Sao_Paulo',
  requestStartsAt DATETIME(3) NULL,
  requestEndsAt DATETIME(3) NULL,
  purchaseStartsAt DATETIME(3) NOT NULL,
  purchaseEndsAt DATETIME(3) NOT NULL,
  isPublic TINYINT NOT NULL DEFAULT 1,
  requiresAuthorization TINYINT NOT NULL DEFAULT 1,
  defaultUnitLimit SMALLINT NOT NULL DEFAULT 1,
  status ENUM('draft', 'published', 'closed') NOT NULL DEFAULT 'draft',
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY exclusiveDrops_slug_unique (slug),
  CONSTRAINT exclusiveDrops_window_check CHECK (purchaseEndsAt > purchaseStartsAt),
  CONSTRAINT exclusiveDrops_limit_check CHECK (defaultUnitLimit BETWEEN 1 AND 99)
) ENGINE=InnoDB;

-- A product belongs to at most one drop: exclusivity can never be ambiguous.
CREATE TABLE IF NOT EXISTS exclusiveDropProducts (
  productId INT NOT NULL,
  dropId INT NOT NULL,
  PRIMARY KEY (productId),
  KEY exclusiveDropProducts_drop_idx (dropId),
  CONSTRAINT exclusiveDropProducts_drop_fk FOREIGN KEY (dropId) REFERENCES exclusiveDrops (id),
  CONSTRAINT exclusiveDropProducts_product_fk FOREIGN KEY (productId) REFERENCES products (id)
) ENGINE=InnoDB;

-- One row per (drop, user): a second click while pending is a no-op, not a duplicate.
CREATE TABLE IF NOT EXISTS exclusiveAccessRequests (
  id BIGINT NOT NULL AUTO_INCREMENT,
  dropId INT NOT NULL,
  userId INT NOT NULL,
  status ENUM('pending', 'approved', 'rejected', 'revoked') NOT NULL DEFAULT 'pending',
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  decidedAt DATETIME(3) NULL,
  decidedByUserId INT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY exclusiveAccessRequests_drop_user_unique (dropId, userId),
  KEY exclusiveAccessRequests_status_idx (status, createdAt),
  CONSTRAINT exclusiveAccessRequests_drop_fk FOREIGN KEY (dropId) REFERENCES exclusiveDrops (id),
  CONSTRAINT exclusiveAccessRequests_user_fk FOREIGN KEY (userId) REFERENCES users (id)
) ENGINE=InnoDB;

-- Individual authorization. Only the hash of the code is stored.
CREATE TABLE IF NOT EXISTS exclusiveGrants (
  id BIGINT NOT NULL AUTO_INCREMENT,
  requestId BIGINT NOT NULL,
  dropId INT NOT NULL,
  userId INT NOT NULL,
  codeHash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  unitLimit SMALLINT NOT NULL,
  expiresAt DATETIME(3) NOT NULL,
  unlockedAt DATETIME(3) NULL,
  revokedAt DATETIME(3) NULL,
  createdByUserId INT NOT NULL,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY exclusiveGrants_code_unique (codeHash),
  KEY exclusiveGrants_drop_user_idx (dropId, userId),
  KEY exclusiveGrants_request_idx (requestId),
  CONSTRAINT exclusiveGrants_request_fk FOREIGN KEY (requestId) REFERENCES exclusiveAccessRequests (id),
  CONSTRAINT exclusiveGrants_drop_fk FOREIGN KEY (dropId) REFERENCES exclusiveDrops (id),
  CONSTRAINT exclusiveGrants_user_fk FOREIGN KEY (userId) REFERENCES users (id),
  CONSTRAINT exclusiveGrants_limit_check CHECK (unitLimit BETWEEN 1 AND 99)
) ENGINE=InnoDB;

-- Quota ledger. A row claims `units` of a grant for one STOCK attempt (idempotent per attempt).
-- The units still counted are DERIVED from stockCheckoutAttempts at read time (see server/exclusive/store.ts),
-- so release on cancel/expiry is idempotent and never ahead of STOCK's own reconciliation.
-- attemptId deliberately has no FK: the claim is taken BEFORE the STOCK attempt row exists.
CREATE TABLE IF NOT EXISTS exclusiveGrantUsage (
  grantId BIGINT NOT NULL,
  attemptId VARCHAR(120) NOT NULL,
  units SMALLINT NOT NULL,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (grantId, attemptId),
  KEY exclusiveGrantUsage_attempt_idx (attemptId),
  CONSTRAINT exclusiveGrantUsage_grant_fk FOREIGN KEY (grantId) REFERENCES exclusiveGrants (id),
  CONSTRAINT exclusiveGrantUsage_units_check CHECK (units > 0)
) ENGINE=InnoDB;

-- Brute-force protection for code redemption (survives restarts and works across instances).
CREATE TABLE IF NOT EXISTS exclusiveRedeemAttempts (
  id BIGINT NOT NULL AUTO_INCREMENT,
  userId INT NOT NULL,
  success TINYINT NOT NULL,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY exclusiveRedeemAttempts_user_idx (userId, createdAt)
) ENGINE=InnoDB;

-- Authorization history (decisions and usage). Never contains a code or a code hash.
CREATE TABLE IF NOT EXISTS exclusiveEvents (
  id BIGINT NOT NULL AUTO_INCREMENT,
  dropId INT NOT NULL,
  requestId BIGINT NULL,
  grantId BIGINT NULL,
  subjectUserId INT NOT NULL,
  actorUserId INT NULL,
  event VARCHAR(40) NOT NULL,
  details VARCHAR(500) NULL,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY exclusiveEvents_drop_idx (dropId, createdAt),
  KEY exclusiveEvents_grant_idx (grantId, createdAt)
) ENGINE=InnoDB;

-- Transactional e-mail outbox: the event is written in the same transaction as the decision.
-- eventKey is the persistent logical idempotency key (request + event + decision version): retries never duplicate it.
CREATE TABLE IF NOT EXISTS exclusiveNotificationOutbox (
  id BIGINT NOT NULL AUTO_INCREMENT,
  eventKey VARCHAR(120) NOT NULL,
  eventType ENUM('request_received', 'access_approved', 'access_rejected', 'access_revoked') NOT NULL,
  userId INT NOT NULL,
  requestId BIGINT NOT NULL,
  status ENUM('pending', 'processing', 'sent', 'failed') NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  leaseExpiresAt DATETIME(3) NULL,
  lastError VARCHAR(255) NULL,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  sentAt DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY exclusiveNotificationOutbox_key_unique (eventKey),
  KEY exclusiveNotificationOutbox_status_idx (status, createdAt)
) ENGINE=InnoDB;

-- IF NOT EXISTS is only an idempotent DDL replay. Verify the complete table set
-- after DDL so a partially existing/divergent schema cannot be declared ready.
DELIMITER $$
DROP PROCEDURE IF EXISTS __l4ckos_exclusive_drops_0028_verify$$
CREATE PROCEDURE __l4ckos_exclusive_drops_0028_verify()
BEGIN
  DECLARE v_missing INT DEFAULT 0;
  DECLARE v_non_innodb INT DEFAULT 0;
  DECLARE v_missing_columns INT DEFAULT 0;
  DECLARE v_missing_foreign_keys INT DEFAULT 0;
  SELECT COUNT(*) INTO v_missing
    FROM (SELECT 'exclusiveDrops' n UNION ALL SELECT 'exclusiveDropProducts' UNION ALL SELECT 'exclusiveAccessRequests'
          UNION ALL SELECT 'exclusiveGrants' UNION ALL SELECT 'exclusiveGrantUsage' UNION ALL SELECT 'exclusiveRedeemAttempts'
          UNION ALL SELECT 'exclusiveEvents' UNION ALL SELECT 'exclusiveNotificationOutbox') expected
    LEFT JOIN information_schema.tables t
      ON t.table_schema = DATABASE() AND t.table_name = expected.n AND t.table_type = 'BASE TABLE'
   WHERE t.table_name IS NULL;
  IF v_missing <> 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Exclusive Drops 0028 incomplete: required table missing';
  END IF;
  SELECT COUNT(*) INTO v_non_innodb
    FROM information_schema.tables
   WHERE table_schema = DATABASE()
     AND table_name IN ('exclusiveDrops','exclusiveDropProducts','exclusiveAccessRequests','exclusiveGrants',
                        'exclusiveGrantUsage','exclusiveRedeemAttempts','exclusiveEvents','exclusiveNotificationOutbox')
     AND engine <> 'InnoDB';
  IF v_non_innodb <> 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Exclusive Drops 0028 incomplete: required table is not InnoDB';
  END IF;

  SELECT COUNT(*) INTO v_missing_columns
    FROM (
      SELECT 'exclusiveDrops' t, 'id' c UNION ALL SELECT 'exclusiveDrops','slug' UNION ALL SELECT 'exclusiveDrops','purchaseStartsAt' UNION ALL SELECT 'exclusiveDrops','purchaseEndsAt' UNION ALL SELECT 'exclusiveDrops','requiresAuthorization' UNION ALL
      SELECT 'exclusiveDropProducts','productId' UNION ALL SELECT 'exclusiveDropProducts','dropId' UNION ALL
      SELECT 'exclusiveAccessRequests','dropId' UNION ALL SELECT 'exclusiveAccessRequests','userId' UNION ALL SELECT 'exclusiveAccessRequests','status' UNION ALL
      SELECT 'exclusiveGrants','requestId' UNION ALL SELECT 'exclusiveGrants','dropId' UNION ALL SELECT 'exclusiveGrants','userId' UNION ALL SELECT 'exclusiveGrants','codeHash' UNION ALL SELECT 'exclusiveGrants','unitLimit' UNION ALL SELECT 'exclusiveGrants','unlockedAt' UNION ALL SELECT 'exclusiveGrants','revokedAt' UNION ALL
      SELECT 'exclusiveGrantUsage','grantId' UNION ALL SELECT 'exclusiveGrantUsage','attemptId' UNION ALL SELECT 'exclusiveGrantUsage','units' UNION ALL
      SELECT 'exclusiveRedeemAttempts','userId' UNION ALL SELECT 'exclusiveRedeemAttempts','success' UNION ALL
      SELECT 'exclusiveEvents','dropId' UNION ALL SELECT 'exclusiveEvents','subjectUserId' UNION ALL SELECT 'exclusiveEvents','event' UNION ALL
      SELECT 'exclusiveNotificationOutbox','eventKey' UNION ALL SELECT 'exclusiveNotificationOutbox','eventType' UNION ALL SELECT 'exclusiveNotificationOutbox','userId' UNION ALL SELECT 'exclusiveNotificationOutbox','requestId' UNION ALL SELECT 'exclusiveNotificationOutbox','status'
    ) expected
    LEFT JOIN information_schema.columns c
      ON c.table_schema = DATABASE() AND c.table_name = expected.t AND c.column_name = expected.c
   WHERE c.column_name IS NULL;
  IF v_missing_columns <> 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Exclusive Drops 0028 incomplete: required column missing';
  END IF;

  SELECT COUNT(*) INTO v_missing_foreign_keys
    FROM (
      SELECT 'exclusiveDropProducts_drop_fk' n UNION ALL SELECT 'exclusiveDropProducts_product_fk' UNION ALL
      SELECT 'exclusiveAccessRequests_drop_fk' UNION ALL SELECT 'exclusiveAccessRequests_user_fk' UNION ALL
      SELECT 'exclusiveGrants_request_fk' UNION ALL SELECT 'exclusiveGrants_drop_fk' UNION ALL SELECT 'exclusiveGrants_user_fk' UNION ALL
      SELECT 'exclusiveGrantUsage_grant_fk'
    ) expected
    LEFT JOIN information_schema.referential_constraints r
      ON r.constraint_schema = DATABASE() AND r.constraint_name = expected.n
   WHERE r.constraint_name IS NULL;
  IF v_missing_foreign_keys <> 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Exclusive Drops 0028 incomplete: required foreign key missing';
  END IF;
END$$
CALL __l4ckos_exclusive_drops_0028_verify()$$
DROP PROCEDURE __l4ckos_exclusive_drops_0028_verify$$
DELIMITER ;
