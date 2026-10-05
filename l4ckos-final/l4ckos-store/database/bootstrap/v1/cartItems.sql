CREATE TABLE `cartItems` (
  `id` int NOT NULL AUTO_INCREMENT,
  `userId` int NOT NULL,
  `productId` int NOT NULL,
  `quantity` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
