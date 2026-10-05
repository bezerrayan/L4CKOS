CREATE TABLE `coupons` (
  `id` int NOT NULL AUTO_INCREMENT,
  `code` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `type` enum('percent','fixed') COLLATE utf8mb4_unicode_ci NOT NULL,
  `value` int NOT NULL,
  `maxUses` int DEFAULT NULL,
  `usedCount` int NOT NULL DEFAULT '0',
  `startsAt` timestamp NULL DEFAULT NULL,
  `expiresAt` timestamp NULL DEFAULT NULL,
  `isActive` int NOT NULL DEFAULT '1',
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `coupons_code_unique` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
