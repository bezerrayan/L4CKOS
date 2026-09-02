-- Additive media variants. Existing imageUrl values remain untouched so legacy
-- products and galleries keep their explicit fallback behavior.
ALTER TABLE `products`
  ADD COLUMN `imageThumbnailUrl` varchar(500) NULL AFTER `imageUrl`,
  ADD COLUMN `imageDetailUrl` varchar(500) NULL AFTER `imageThumbnailUrl`,
  ADD COLUMN `imageBannerUrl` varchar(500) NULL AFTER `imageDetailUrl`;
--> statement-breakpoint

ALTER TABLE `productImages`
  ADD COLUMN `imageThumbnailUrl` varchar(500) NULL AFTER `imageUrl`,
  ADD COLUMN `imageDetailUrl` varchar(500) NULL AFTER `imageThumbnailUrl`,
  ADD COLUMN `imageBannerUrl` varchar(500) NULL AFTER `imageDetailUrl`;
