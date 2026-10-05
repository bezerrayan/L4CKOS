CREATE TABLE `userPaymentMethods` (
  `id` int NOT NULL AUTO_INCREMENT,
  `userId` int NOT NULL,
  `label` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `holderName` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `brand` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `last4` varchar(4) COLLATE utf8mb4_unicode_ci NOT NULL,
  `expiry` varchar(8) COLLATE utf8mb4_unicode_ci NOT NULL,
  `isDefault` int NOT NULL DEFAULT '0',
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
