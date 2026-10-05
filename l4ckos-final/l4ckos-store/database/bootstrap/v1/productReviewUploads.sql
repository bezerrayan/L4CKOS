CREATE TABLE `productReviewUploads` (
  `token` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `userId` int NOT NULL,
  `productId` int NOT NULL,
  `imageUrl` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL,
  `expiresAt` timestamp NOT NULL,
  `claimedAt` timestamp NULL DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`token`),
  KEY `productReviewUploads_user_product_idx` (`userId`,`productId`),
  KEY `productReviewUploads_expiry_idx` (`expiresAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
