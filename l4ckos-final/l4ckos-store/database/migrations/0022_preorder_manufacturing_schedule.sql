ALTER TABLE `productionBatches`
  ADD COLUMN `estimatedManufacturingStart` date NULL DEFAULT NULL,
  ADD COLUMN `estimatedManufacturingEnd` date NULL DEFAULT NULL,
  ADD COLUMN `manufacturingScheduleRequired` tinyint NOT NULL DEFAULT 0;
-- l4ckos:statement-breakpoint
ALTER TABLE `productionBatches`
  ALTER COLUMN `manufacturingScheduleRequired` SET DEFAULT 1;
-- l4ckos:statement-breakpoint
ALTER TABLE `orderItems`
  ADD COLUMN `estimatedManufacturingStartAtPurchase` date NULL DEFAULT NULL,
  ADD COLUMN `estimatedManufacturingEndAtPurchase` date NULL DEFAULT NULL;
