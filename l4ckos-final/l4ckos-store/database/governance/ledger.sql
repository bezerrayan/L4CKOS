CREATE TABLE `_l4ckos_schema_migrations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(191) NOT NULL,
  `kind` enum('BASELINE','MIGRATION','RECONCILIATION') NOT NULL,
  `checksum` char(64) NOT NULL,
  `applicationCommit` char(40) NOT NULL,
  `description` varchar(500) NOT NULL,
  `preFingerprint` char(64) NOT NULL,
  `postFingerprint` char(64) NOT NULL,
  `manifestVersion` int NOT NULL,
  `runnerVersion` varchar(32) NOT NULL,
  `appliedAt` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `executionDurationMs` int unsigned NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `schema_migrations_name_unique` (`name`),
  CONSTRAINT `schema_migrations_checksum_chk` CHECK (`checksum` REGEXP '^[a-f0-9]{64}$'),
  CONSTRAINT `schema_migrations_commit_chk` CHECK (`applicationCommit` REGEXP '^[a-f0-9]{40}$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
