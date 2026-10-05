CREATE TABLE `orderEmailEvents` (
  `id` int NOT NULL AUTO_INCREMENT,
  `orderId` int NOT NULL,
  `eventType` enum('order_delivered_email','review_request_email') COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` enum('pending','processing','sent','failed') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `idempotencyKey` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `scheduledAt` timestamp NULL DEFAULT NULL,
  `providerMessageId` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `attemptCount` int NOT NULL DEFAULT '0',
  `processingAt` timestamp NULL DEFAULT NULL,
  `processingToken` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sentAt` timestamp NULL DEFAULT NULL,
  `failedAt` timestamp NULL DEFAULT NULL,
  `lastError` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `orderEmailEvents_order_event_unique` (`orderId`,`eventType`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
