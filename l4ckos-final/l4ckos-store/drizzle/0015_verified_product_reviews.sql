DELETE duplicate_review
FROM `productReviews` duplicate_review
INNER JOIN `productReviews` original_review
  ON duplicate_review.`userId` = original_review.`userId`
  AND duplicate_review.`productId` = original_review.`productId`
  AND duplicate_review.`id` > original_review.`id`;

ALTER TABLE `productReviews`
  ADD `orderId` int,
  ADD `stockReservationId` int,
  ADD `sizePerception` enum('small','true_to_size','large'),
  ADD `imageUrl` varchar(500),
  ADD `imageStatus` enum('none','pending','approved','rejected') NOT NULL DEFAULT 'none',
  ADD `moderationStatus` enum('published','hidden_spam','hidden_offensive') NOT NULL DEFAULT 'published',
  ADD `verifiedPurchase` int NOT NULL DEFAULT 0,
  ADD `moderatedBy` int,
  ADD `moderatedAt` timestamp NULL,
  ADD CONSTRAINT `productReviews_user_product_unique` UNIQUE (`userId`, `productId`),
  ADD CONSTRAINT `productReviews_reservation_unique` UNIQUE (`stockReservationId`),
  ADD INDEX `productReviews_product_publication_idx` (`productId`, `verifiedPurchase`, `moderationStatus`, `createdAt`);

CREATE TABLE `productReviewUploads` (
  `token` varchar(64) NOT NULL,
  `userId` int NOT NULL,
  `productId` int NOT NULL,
  `imageUrl` varchar(500) NOT NULL,
  `expiresAt` timestamp NOT NULL,
  `claimedAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `productReviewUploads_token` PRIMARY KEY (`token`),
  INDEX `productReviewUploads_owner_product_idx` (`userId`, `productId`),
  INDEX `productReviewUploads_expires_idx` (`expiresAt`)
);
