CREATE TABLE IF NOT EXISTS `orderEmailEvents` (
  `id` int AUTO_INCREMENT NOT NULL,
  `orderId` int NOT NULL,
  `eventType` enum('order_delivered_email','review_request_email') NOT NULL,
  `status` enum('pending','processing','sent','failed') NOT NULL DEFAULT 'pending',
  `idempotencyKey` varchar(191) NOT NULL,
  `scheduledAt` timestamp NULL,
  `providerMessageId` varchar(191) NULL,
  `attemptCount` int NOT NULL DEFAULT 0,
  `processingAt` timestamp NULL,
  `sentAt` timestamp NULL,
  `failedAt` timestamp NULL,
  `lastError` varchar(500) NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `orderEmailEvents_order_event_unique` UNIQUE (`orderId`, `eventType`)
);
