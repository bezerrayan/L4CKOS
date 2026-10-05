CREATE TABLE `localAuthUsers` (
  `id` int NOT NULL AUTO_INCREMENT,
  `userId` int NOT NULL,
  `email` varchar(320) COLLATE utf8mb4_unicode_ci NOT NULL,
  `passwordHash` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `localAuthUsers_email_unique` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
