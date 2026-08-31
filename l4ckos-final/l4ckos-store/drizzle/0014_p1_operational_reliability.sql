ALTER TABLE `orders`
  ADD COLUMN `fulfillmentIssueAt` timestamp NULL,
  ADD COLUMN `correlationId` varchar(191) NULL,
  ADD COLUMN `couponId` int NULL,
  ADD COLUMN `couponReleasedAt` timestamp NULL,
  ADD INDEX `orders_fulfillment_status_idx` (`fulfillmentStatus`),
  ADD INDEX `orders_correlation_id_idx` (`correlationId`);

ALTER TABLE `payments`
  ADD COLUMN `paidAmount` int NOT NULL DEFAULT 0,
  ADD COLUMN `refundedAmount` int NOT NULL DEFAULT 0,
  ADD COLUMN `netAmount` int NOT NULL DEFAULT 0,
  ADD COLUMN `statusSource` enum('provider','reconciliation','manual','system') NOT NULL DEFAULT 'provider',
  ADD COLUMN `financialIssue` varchar(191) NULL,
  ADD COLUMN `financialIssueAt` timestamp NULL,
  ADD COLUMN `manualConfirmedAt` timestamp NULL,
  ADD COLUMN `manualConfirmedBy` int NULL,
  ADD COLUMN `manualReason` varchar(500) NULL,
  ADD COLUMN `manualEvidence` varchar(500) NULL;

UPDATE `payments`
SET `paidAmount` = CASE WHEN `status` IN ('confirmed','received','partially_refunded','refunded','chargeback') THEN `amount` ELSE 0 END,
    `refundedAmount` = CASE WHEN `status` = 'refunded' THEN `amount` ELSE 0 END,
    `netAmount` = CASE WHEN `status` = 'refunded' THEN 0 WHEN `status` IN ('confirmed','received','partially_refunded','chargeback') THEN `amount` ELSE 0 END;

ALTER TABLE `stockReservations`
  MODIFY COLUMN `status` enum('active','consumed','released','expired','restocked') NOT NULL DEFAULT 'active';

ALTER TABLE `notificationOutbox`
  MODIFY COLUMN `status` enum('pending','processing','sent','failed','dead') NOT NULL DEFAULT 'pending',
  ADD COLUMN `nextAttemptAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN `lockedAt` timestamp NULL,
  ADD COLUMN `lockedBy` varchar(191) NULL,
  ADD COLUMN `leaseExpiresAt` timestamp NULL,
  ADD INDEX `notificationOutbox_claim_idx` (`status`,`nextAttemptAt`,`leaseExpiresAt`);

ALTER TABLE `auditLogs`
  ADD COLUMN `orderId` int NULL,
  ADD COLUMN `paymentId` int NULL,
  ADD COLUMN `event` varchar(120) NULL,
  ADD COLUMN `correlationId` varchar(191) NULL,
  ADD COLUMN `beforeState` text NULL,
  ADD COLUMN `afterState` text NULL,
  ADD INDEX `auditLogs_order_id_idx` (`orderId`),
  ADD INDEX `auditLogs_payment_id_idx` (`paymentId`),
  ADD INDEX `auditLogs_correlation_id_idx` (`correlationId`);

ALTER TABLE `products` ADD CONSTRAINT `products_stock_nonnegative_chk` CHECK (`stock` >= 0);
ALTER TABLE `productVariants` ADD CONSTRAINT `product_variants_stock_nonnegative_chk` CHECK (`stock` >= 0);
ALTER TABLE `orderItems`
  ADD CONSTRAINT `order_items_quantity_positive_chk` CHECK (`quantity` > 0),
  ADD CONSTRAINT `order_items_unit_price_nonnegative_chk` CHECK (`unitPrice` >= 0),
  ADD CONSTRAINT `order_items_total_price_nonnegative_chk` CHECK (`totalPrice` IS NULL OR `totalPrice` >= 0);
ALTER TABLE `stockReservations` ADD CONSTRAINT `stock_reservations_quantity_positive_chk` CHECK (`quantity` > 0);
ALTER TABLE `payments`
  ADD CONSTRAINT `payments_amount_nonnegative_chk` CHECK (`amount` >= 0),
  ADD CONSTRAINT `payments_paid_amount_nonnegative_chk` CHECK (`paidAmount` >= 0),
  ADD CONSTRAINT `payments_refunded_amount_nonnegative_chk` CHECK (`refundedAmount` >= 0),
  ADD CONSTRAINT `payments_net_amount_nonnegative_chk` CHECK (`netAmount` >= 0);

ALTER TABLE `orderItems`
  ADD CONSTRAINT `order_items_order_fk` FOREIGN KEY (`orderId`) REFERENCES `orders` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `stockReservations`
  ADD CONSTRAINT `stock_reservations_order_fk` FOREIGN KEY (`orderId`) REFERENCES `orders` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `stock_reservations_order_item_fk` FOREIGN KEY (`orderItemId`) REFERENCES `orderItems` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `payments`
  ADD CONSTRAINT `payments_order_fk` FOREIGN KEY (`orderId`) REFERENCES `orders` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `paymentEvents`
  ADD CONSTRAINT `payment_events_payment_fk` FOREIGN KEY (`paymentId`) REFERENCES `payments` (`id`) ON DELETE SET NULL ON UPDATE RESTRICT;
ALTER TABLE `notificationOutbox`
  ADD CONSTRAINT `notification_outbox_order_fk` FOREIGN KEY (`orderId`) REFERENCES `orders` (`id`) ON DELETE SET NULL ON UPDATE RESTRICT,
  ADD CONSTRAINT `notification_outbox_payment_fk` FOREIGN KEY (`paymentId`) REFERENCES `payments` (`id`) ON DELETE SET NULL ON UPDATE RESTRICT;
