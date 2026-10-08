CREATE TABLE `asaasWebhookEvents` (
  `id` int NOT NULL AUTO_INCREMENT,
  `eventId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `eventType` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `paymentId` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `checkoutId` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `orderId` int DEFAULT NULL,
  `payloadHash` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` enum('processing','processed','failed') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'processing',
  `processedAt` timestamp NULL DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `asaasWebhookEvents_eventId_unique` (`eventId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
