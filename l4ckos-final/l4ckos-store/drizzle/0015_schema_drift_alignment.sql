-- Align the physical schema with fields already used by the current application.
-- All descriptive media fields remain nullable: legacy values must not be invented.
-- Run scripts/preflight-schema-drift.sql first. Any NULL waitlist timestamp is a blocker.

ALTER TABLE `productImages`
  ADD COLUMN `color` varchar(60) NULL AFTER `imageUrl`;
--> statement-breakpoint

ALTER TABLE `promoBanners`
  ADD COLUMN `imageUrl` varchar(500) NULL AFTER `ctaLabel`,
  ADD COLUMN `mobileImageUrl` varchar(500) NULL AFTER `imageUrl`,
  ADD COLUMN `imageAlt` varchar(255) NULL AFTER `mobileImageUrl`,
  ADD COLUMN `linkUrl` varchar(500) NULL AFTER `imageAlt`;
--> statement-breakpoint

-- Existing NULL values are deliberately not backfilled. The preflight must be zero
-- before this statement is applied, otherwise MySQL must stop the migration.
ALTER TABLE `waitlist_emails`
  MODIFY COLUMN `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP;
