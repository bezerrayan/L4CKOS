-- P0: order snapshots, deterministic variants, atomic reservations and finance ledger.
-- Run scripts/preflight-p0-integrity.sql and review every result before applying.
-- This migration is additive for legacy business data. Nullable snapshot fields are
-- intentional: missing historical facts must not be invented.

ALTER TABLE `productVariants`
  ADD COLUMN `size` varchar(60) NULL,
  ADD COLUMN `color` varchar(60) NULL,
  ADD COLUMN `optionKey` varchar(191) NULL,
  ADD INDEX `productVariants_productId_idx` (`productId`),
  ADD UNIQUE INDEX `productVariants_product_option_unique` (`productId`, `optionKey`);
--> statement-breakpoint

ALTER TABLE `orders`
  ADD COLUMN `checkoutAttemptId` varchar(64) NULL,
  ADD COLUMN `checkoutFingerprint` varchar(64) NULL,
  ADD COLUMN `fulfillmentStatus` enum(
    'awaiting_payment',
    'ready',
    'processing',
    'shipped',
    'delivered',
    'cancelled',
    'on_hold',
    'inventory_exception'
  ) NOT NULL DEFAULT 'awaiting_payment',
  ADD COLUMN `fulfillmentIssue` varchar(191) NULL,
  ADD INDEX `orders_userId_idx` (`userId`),
  ADD INDEX `orders_status_idx` (`status`),
  ADD UNIQUE INDEX `orders_checkoutAttemptId_unique` (`checkoutAttemptId`);
--> statement-breakpoint

-- Preserve legacy logistics as a best-effort projection. This is not payment
-- reconciliation and does not create financial rows for historical orders.
UPDATE `orders`
SET `fulfillmentStatus` = CASE `status`
  WHEN 'processing' THEN 'processing'
  WHEN 'shipped' THEN 'shipped'
  WHEN 'delivered' THEN 'delivered'
  WHEN 'cancelled' THEN 'cancelled'
  WHEN 'paid' THEN 'ready'
  ELSE 'awaiting_payment'
END;
--> statement-breakpoint

ALTER TABLE `orderItems`
  CHANGE COLUMN `price` `unitPrice` int NOT NULL,
  ADD COLUMN `variantId` int NULL,
  ADD COLUMN `productName` varchar(255) NULL,
  ADD COLUMN `variantName` varchar(120) NULL,
  ADD COLUMN `sku` varchar(120) NULL,
  ADD COLUMN `size` varchar(60) NULL,
  ADD COLUMN `color` varchar(60) NULL,
  ADD COLUMN `totalPrice` int NULL,
  ADD COLUMN `imageUrl` varchar(500) NULL,
  ADD INDEX `orderItems_orderId_idx` (`orderId`),
  ADD INDEX `orderItems_productId_idx` (`productId`),
  ADD INDEX `orderItems_variantId_idx` (`variantId`);
--> statement-breakpoint

-- Arithmetic is safe to backfill; descriptive legacy snapshots remain NULL.
UPDATE `orderItems`
SET `totalPrice` = `unitPrice` * `quantity`
WHERE `totalPrice` IS NULL;
--> statement-breakpoint

ALTER TABLE `stockReservations`
  ADD COLUMN `variantId` int NULL,
  ADD COLUMN `orderItemId` int NULL,
  ADD INDEX `stockReservations_order_status_idx` (`orderId`, `status`),
  ADD INDEX `stockReservations_expiry_status_idx` (`expiresAt`, `status`),
  ADD UNIQUE INDEX `stockReservations_orderItemId_unique` (`orderItemId`);
--> statement-breakpoint

ALTER TABLE `auditLogs`
  MODIFY COLUMN `actorUserId` int NULL,
  ADD COLUMN `actorType` enum('admin', 'user', 'system') NOT NULL DEFAULT 'admin';
--> statement-breakpoint

CREATE TABLE `payments` (
  `id` int AUTO_INCREMENT NOT NULL,
  `orderId` int NOT NULL,
  `provider` varchar(32) NOT NULL DEFAULT 'asaas',
  `providerPaymentId` varchar(64) NULL,
  `providerCustomerId` varchar(64) NULL,
  `billingType` varchar(32) NOT NULL,
  `amount` int NOT NULL,
  `status` enum(
    'pending',
    'confirmed',
    'received',
    'failed',
    'overdue',
    'cancelled',
    'partially_refunded',
    'refunded',
    'chargeback'
  ) NOT NULL DEFAULT 'pending',
  `creationStatus` enum('not_started', 'creating', 'created', 'unknown', 'failed') NOT NULL DEFAULT 'not_started',
  `creationLeaseExpiresAt` timestamp NULL,
  `externalReference` varchar(191) NOT NULL,
  `invoiceUrl` varchar(500) NULL,
  `bankSlipUrl` varchar(500) NULL,
  `pixQrCode` text NULL,
  `pixCopyPaste` text NULL,
  `digitableLine` varchar(255) NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `confirmedAt` timestamp NULL,
  `receivedAt` timestamp NULL,
  `refundedAt` timestamp NULL,
  CONSTRAINT `payments_id` PRIMARY KEY (`id`),
  CONSTRAINT `payments_orderId_unique` UNIQUE (`orderId`),
  CONSTRAINT `payments_providerPaymentId_unique` UNIQUE (`providerPaymentId`),
  CONSTRAINT `payments_externalReference_unique` UNIQUE (`externalReference`),
  INDEX `payments_status_idx` (`status`)
);
--> statement-breakpoint

CREATE TABLE `paymentEvents` (
  `id` int AUTO_INCREMENT NOT NULL,
  `provider` varchar(32) NOT NULL DEFAULT 'asaas',
  `providerEventId` varchar(191) NOT NULL,
  `paymentId` int NULL,
  `orderId` int NULL,
  `providerPaymentId` varchar(64) NULL,
  `eventType` varchar(80) NOT NULL,
  `processingStatus` enum('pending', 'processing', 'processed', 'ignored', 'failed', 'conflict') NOT NULL DEFAULT 'pending',
  `payload` text NULL,
  `errorCode` varchar(120) NULL,
  `receivedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `processedAt` timestamp NULL,
  CONSTRAINT `paymentEvents_id` PRIMARY KEY (`id`),
  CONSTRAINT `paymentEvents_providerEventId_unique` UNIQUE (`providerEventId`),
  INDEX `paymentEvents_paymentId_idx` (`paymentId`),
  INDEX `paymentEvents_orderId_idx` (`orderId`),
  INDEX `paymentEvents_processingStatus_idx` (`processingStatus`)
);
--> statement-breakpoint

CREATE TABLE `notificationOutbox` (
  `id` int AUTO_INCREMENT NOT NULL,
  `dedupeKey` varchar(191) NOT NULL,
  `type` varchar(80) NOT NULL,
  `orderId` int NULL,
  `paymentId` int NULL,
  `payload` text NULL,
  `status` enum('pending', 'processing', 'sent', 'failed') NOT NULL DEFAULT 'pending',
  `attempts` int NOT NULL DEFAULT 0,
  `lastError` text NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `sentAt` timestamp NULL,
  CONSTRAINT `notificationOutbox_id` PRIMARY KEY (`id`),
  CONSTRAINT `notificationOutbox_dedupeKey_unique` UNIQUE (`dedupeKey`),
  INDEX `notificationOutbox_status_idx` (`status`)
);

