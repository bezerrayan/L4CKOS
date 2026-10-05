CREATE TABLE `_l4ckos_schema_executions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `operation` varchar(191) NOT NULL,
  `checksum` char(64) NOT NULL,
  `applicationCommit` char(40) NOT NULL,
  `state` enum('STARTED','FAILED','COMPLETED') NOT NULL,
  `completedStatements` int unsigned NOT NULL DEFAULT 0,
  `preFingerprint` char(64) NOT NULL,
  `observedFingerprint` char(64) DEFAULT NULL,
  `errorCode` varchar(80) DEFAULT NULL,
  `startedAt` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `finishedAt` timestamp(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `schema_executions_state_idx` (`state`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
