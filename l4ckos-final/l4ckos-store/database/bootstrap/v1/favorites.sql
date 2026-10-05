CREATE TABLE `favorites` (
  `id` int NOT NULL AUTO_INCREMENT,
  `userId` int NOT NULL,
  `productId` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
