CREATE TABLE `asaasWebhookEvents` (
  `id` int AUTO_INCREMENT NOT NULL,
  `eventId` varchar(191) NOT NULL,
  `eventType` varchar(80) NOT NULL,
  `paymentId` varchar(120),
  `checkoutId` varchar(120),
  `orderId` int,
  `payloadHash` varchar(64) NOT NULL,
  `status` enum('processing','processed','failed') NOT NULL DEFAULT 'processing',
  `processedAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `asaasWebhookEvents_id` PRIMARY KEY(`id`),
  CONSTRAINT `asaasWebhookEvents_eventId_unique` UNIQUE(`eventId`)
);
