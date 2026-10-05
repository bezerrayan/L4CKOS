CREATE TABLE `passwordResetTokens` (
  `id` int NOT NULL AUTO_INCREMENT,
  `userId` int NOT NULL,
  `tokenHash` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL,
  `expiresAt` timestamp NOT NULL,
  `usedAt` timestamp NULL DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `passwordResetTokens_tokenHash_unique` (`tokenHash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
