CREATE TABLE `emailUnsubscribes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `email` varchar(320) COLLATE utf8mb4_unicode_ci NOT NULL,
  `reason` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `source` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `emailUnsubscribes_email_unique` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
