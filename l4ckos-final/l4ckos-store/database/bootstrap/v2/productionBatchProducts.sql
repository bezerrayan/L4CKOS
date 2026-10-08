CREATE TABLE `productionBatchProducts` (
  `id` int NOT NULL AUTO_INCREMENT,
  `productionBatchId` int NOT NULL,
  `productId` int NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `batch_product_assignment` (`productId`),
  KEY `batch_products` (`productionBatchId`),
  CONSTRAINT `batch_products_batch_fk` FOREIGN KEY (`productionBatchId`) REFERENCES `productionBatches` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `batch_products_product_fk` FOREIGN KEY (`productId`) REFERENCES `products` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
