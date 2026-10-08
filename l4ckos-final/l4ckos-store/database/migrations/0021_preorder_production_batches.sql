CREATE TABLE `productionBatches` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `status` enum('DRAFT','OPEN','CLOSED','IN_PRODUCTION','RECEIVED','SHIPPING','COMPLETED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
  `salesOpenAt` timestamp NULL DEFAULT NULL,
  `salesCloseAt` timestamp NULL DEFAULT NULL,
  `estimatedShippingStart` timestamp NULL DEFAULT NULL,
  `estimatedShippingEnd` timestamp NULL DEFAULT NULL,
  `productionStartedAt` timestamp NULL DEFAULT NULL,
  `receivedAt` timestamp NULL DEFAULT NULL,
  `shippingStartedAt` timestamp NULL DEFAULT NULL,
  `completedAt` timestamp NULL DEFAULT NULL,
  `minimumQuantity` int NOT NULL DEFAULT 0,
  `maximumQuantity` int DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`), KEY `productionBatches_status` (`status`),
  CONSTRAINT `batch_quantities` CHECK (`minimumQuantity` >= 0 AND (`maximumQuantity` IS NULL OR (`maximumQuantity` > 0 AND `maximumQuantity` >= `minimumQuantity`)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- l4ckos:statement-breakpoint
CREATE TABLE `productionBatchProducts` (
  `id` int NOT NULL AUTO_INCREMENT,
  `productionBatchId` int NOT NULL,
  `productId` int NOT NULL,
  PRIMARY KEY (`id`), UNIQUE KEY `batch_product_assignment` (`productId`),
  KEY `batch_products` (`productionBatchId`),
  CONSTRAINT `batch_products_batch_fk` FOREIGN KEY (`productionBatchId`) REFERENCES `productionBatches` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `batch_products_product_fk` FOREIGN KEY (`productId`) REFERENCES `products` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- l4ckos:statement-breakpoint
ALTER TABLE `products` ADD COLUMN `salesMode` enum('STOCK','PREORDER') NOT NULL DEFAULT 'STOCK';
-- l4ckos:statement-breakpoint
ALTER TABLE `orderItems`
  ADD COLUMN `salesModeAtPurchase` enum('STOCK','PREORDER') NOT NULL DEFAULT 'STOCK',
  ADD COLUMN `productionBatchId` int DEFAULT NULL,
  ADD COLUMN `productionBatchNameAtPurchase` varchar(255) DEFAULT NULL,
  ADD COLUMN `estimatedShippingStartAtPurchase` timestamp NULL DEFAULT NULL,
  ADD COLUMN `estimatedShippingEndAtPurchase` timestamp NULL DEFAULT NULL,
  ADD KEY `orderItems_batch_order` (`productionBatchId`, `orderId`),
  ADD CONSTRAINT `orderItems_batch_fk` FOREIGN KEY (`productionBatchId`) REFERENCES `productionBatches` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
