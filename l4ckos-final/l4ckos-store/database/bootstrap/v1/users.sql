CREATE TABLE `users` (
  `id` int NOT NULL AUTO_INCREMENT,
  `openId` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` text COLLATE utf8mb4_unicode_ci,
  `email` varchar(320) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `loginMethod` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `role` enum('user','admin') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'user',
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  `lastSignedIn` timestamp NOT NULL DEFAULT (now()),
  `isVip` int NOT NULL DEFAULT '0',
  `isBlocked` int NOT NULL DEFAULT '0',
  `cpf` varchar(18) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `phone` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `asaasCustomerId` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sessionVersion` int NOT NULL DEFAULT '1',
  PRIMARY KEY (`id`),
  UNIQUE KEY `users_openId_unique` (`openId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
