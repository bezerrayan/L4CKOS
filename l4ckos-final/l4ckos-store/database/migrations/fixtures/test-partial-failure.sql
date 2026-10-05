ALTER TABLE orders ADD COLUMN partialFixture int DEFAULT NULL;
-- l4ckos:statement-breakpoint
CREATE TABLE orders (id int PRIMARY KEY) ENGINE=InnoDB;
