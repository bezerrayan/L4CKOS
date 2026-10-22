ALTER TABLE `productVariants`
  ADD COLUMN `isActive` tinyint NOT NULL DEFAULT 0,
  ADD CONSTRAINT `product_variants_active_boolean_chk` CHECK (`isActive` IN (0,1));
