-- EXCLUSIVE DROPS V1 — candidate migration 0028. LOCAL CANDIDATE ONLY.
-- Not part of drizzle/meta/_journal.json. DO NOT run against staging or production without the release runbook
-- (l4ckos-release-verification) and an attested backup. Additive only: new tables, no ALTER of existing tables.
-- Tested on disposable MySQL 9.7.2 (server/exclusive/exclusiveDrops.mysql.test.ts).
-- Requires: users(id INT), products(id INT) and, for quota derivation, the STOCK V1 tables (stockCheckoutAttempts).

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- A product belongs to at most one drop: exclusivity can never be ambiguous.
CREATE TABLE IF NOT EXISTS exclusiveDropProducts (
  productId INT NOT NULL,
  dropId INT NOT NULL,
  PRIMARY KEY (productId),
  KEY exclusiveDropProducts_drop_idx (dropId),
  CONSTRAINT exclusiveDropProducts_drop_fk FOREIGN KEY (dropId) REFERENCES exclusiveDrops (id),
  CONSTRAINT exclusiveDropProducts_product_fk FOREIGN KEY (productId) REFERENCES products (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Brute-force protection for code redemption (survives restarts and works across instances).
CREATE TABLE IF NOT EXISTS exclusiveRedeemAttempts (
  id BIGINT NOT NULL AUTO_INCREMENT,
  userId INT NOT NULL,
  success TINYINT NOT NULL,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY exclusiveRedeemAttempts_user_idx (userId, createdAt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
