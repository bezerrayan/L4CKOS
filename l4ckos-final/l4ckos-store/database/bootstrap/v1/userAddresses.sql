CREATE TABLE `userAddresses` (
  `id` int NOT NULL AUTO_INCREMENT,
  `userId` int NOT NULL,
  `label` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `recipient` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `zipCode` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `street` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `number` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `complement` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `neighborhood` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `city` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `state` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `isDefault` int NOT NULL DEFAULT '0',
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
