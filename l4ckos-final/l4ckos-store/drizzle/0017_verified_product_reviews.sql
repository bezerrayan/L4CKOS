-- Additive verified-review metadata. Legacy reviews intentionally retain no
-- inferred purchase proof: all new nullable references stay NULL and the
-- verification flag defaults to 0.
ALTER TABLE `productReviews`
  ADD COLUMN `orderId` int NULL AFTER `productId`,
  ADD COLUMN `stockReservationId` int NULL AFTER `orderId`,
  ADD COLUMN `sizePerception` enum('small','true_to_size','large') NULL AFTER `rating`,
  ADD COLUMN `imageUrl` varchar(500) NULL AFTER `comment`,
  ADD COLUMN `imageStatus` enum('none','pending','approved','rejected') NOT NULL DEFAULT 'none' AFTER `imageUrl`,
  ADD COLUMN `moderationStatus` enum('published','hidden_spam','hidden_offensive') NOT NULL DEFAULT 'published' AFTER `imageStatus`,
  ADD COLUMN `verifiedPurchase` int NOT NULL DEFAULT 0 AFTER `moderationStatus`,
  ADD COLUMN `moderatedBy` int NULL AFTER `verifiedPurchase`,
  ADD COLUMN `moderatedAt` timestamp NULL AFTER `moderatedBy`;
--> statement-breakpoint

CREATE INDEX `productReviews_public_idx` ON `productReviews` (`productId`,`verifiedPurchase`,`moderationStatus`,`createdAt`);
--> statement-breakpoint

CREATE UNIQUE INDEX `productReviews_stockReservationId_unique` ON `productReviews` (`stockReservationId`);
--> statement-breakpoint

CREATE TABLE `productReviewUploads` (
  `token` varchar(64) NOT NULL,
  `userId` int NOT NULL,
  `productId` int NOT NULL,
  `imageUrl` varchar(500) NOT NULL,
  `expiresAt` timestamp NOT NULL,
  `claimedAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `productReviewUploads_token` PRIMARY KEY(`token`)
);
--> statement-breakpoint

CREATE INDEX `productReviewUploads_user_product_idx` ON `productReviewUploads` (`userId`,`productId`);
--> statement-breakpoint

CREATE INDEX `productReviewUploads_expiry_idx` ON `productReviewUploads` (`expiresAt`);
