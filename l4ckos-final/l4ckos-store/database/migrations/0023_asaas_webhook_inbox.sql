CREATE TABLE `asaasWebhookInbox` (
  `eventId` varchar(191) COLLATE utf8mb4_bin NOT NULL,
  `payload` text COLLATE utf8mb4_bin,
  `payloadHash` varchar(64) COLLATE utf8mb4_bin NOT NULL,
  `state` enum('received','processing','processed','failed','rejected') NOT NULL DEFAULT 'received',
  `attempts` int NOT NULL DEFAULT 0,
  `errorCode` varchar(64) COLLATE utf8mb4_bin,
  `nextAttemptAt` timestamp NULL DEFAULT NULL,
  `completedAt` timestamp NULL DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`eventId`),
  KEY `inbox_pending` (`state`,`nextAttemptAt`,`createdAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
