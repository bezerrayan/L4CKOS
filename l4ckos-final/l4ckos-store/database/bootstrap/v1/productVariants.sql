CREATE TABLE `productVariants` (
  `id` int NOT NULL AUTO_INCREMENT,
  `productId` int NOT NULL,
  `name` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `sku` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `price` int DEFAULT NULL,
  `stock` int NOT NULL DEFAULT '0',
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  `size` varchar(60) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `color` varchar(60) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `optionKey` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `productVariants_product_option_unique` (`productId`,`optionKey`),
  KEY `productVariants_productId_idx` (`productId`),
  CONSTRAINT `product_variants_stock_nonnegative_chk` CHECK ((`stock` >= 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
