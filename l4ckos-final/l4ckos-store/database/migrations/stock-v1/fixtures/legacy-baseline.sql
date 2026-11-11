-- Synthetic P13 legacy baseline for local disposable-MySQL migration testing only.
-- All row values are fabricated and must never be copied into a remote database.
CREATE TABLE users (
  id INT NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (id)
) ENGINE=InnoDB;
CREATE TABLE products (
  id INT NOT NULL AUTO_INCREMENT,
  name VARCHAR(191) NOT NULL,
  price INT NOT NULL DEFAULT 0,
  stock INT NOT NULL DEFAULT 0,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE productVariants (
  id INT NOT NULL AUTO_INCREMENT,
  productId INT NOT NULL,
  name VARCHAR(120) NOT NULL,
  sku VARCHAR(120) NULL,
  price INT NULL,
  stock INT NOT NULL DEFAULT 0,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY productVariants_productId_idx (productId),
  CONSTRAINT product_variants_stock_nonnegative_chk CHECK (stock >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE orders (
  id INT NOT NULL AUTO_INCREMENT,
  userId INT NOT NULL,
  status ENUM('pending','processing','paid','shipped','delivered','cancelled') NOT NULL DEFAULT 'pending',
  paymentStatus ENUM('unconfirmed','confirmed') NOT NULL DEFAULT 'unconfirmed',
  paymentConfirmationSource ENUM('asaas_webhook','manual') NULL,
  paymentConfirmedAt TIMESTAMP NULL,
  paymentConfirmedBy INT NULL,
  paymentConfirmationReference VARCHAR(191) NULL,
  totalPrice INT NOT NULL,
  asaasCheckoutId VARCHAR(64) NULL,
  trackingCode VARCHAR(120) NULL,
  shippingRecipient VARCHAR(255) NULL,
  shippingZipCode VARCHAR(20) NULL,
  shippingStreet VARCHAR(255) NULL,
  shippingNumber VARCHAR(30) NULL,
  shippingComplement VARCHAR(255) NULL,
  shippingNeighborhood VARCHAR(255) NULL,
  shippingCity VARCHAR(255) NULL,
  shippingState VARCHAR(100) NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY orders_userId_idx (userId),
  KEY orders_status_idx (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE orderItems (
  id INT NOT NULL AUTO_INCREMENT,
  orderId INT NOT NULL,
  productId INT NOT NULL,
  quantity INT NOT NULL,
  price INT NOT NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY orderItems_orderId_idx (orderId),
  KEY orderItems_productId_idx (productId),
  CONSTRAINT order_items_quantity_positive_chk CHECK (quantity > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE stockReservations (
  id INT NOT NULL AUTO_INCREMENT,
  orderId INT NOT NULL,
  userId INT NOT NULL,
  productId INT NOT NULL,
  quantity INT NOT NULL,
  status ENUM('active','consumed','released','expired','restocked') NOT NULL DEFAULT 'active',
  expiresAt TIMESTAMP NOT NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY stockReservations_order_status_idx (orderId,status),
  KEY stockReservations_expiry_status_idx (expiresAt,status),
  CONSTRAINT stock_reservations_quantity_positive_chk CHECK (quantity > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Synthetic legacy rows verify that expansion leaves old snapshots/statuses intact.
INSERT INTO users (id) VALUES (710001);
INSERT INTO products (id,name,price,stock) VALUES (710001,'synthetic legacy product',1200,8);
INSERT INTO productVariants (id,productId,name,sku,price,stock)
VALUES (710001,710001,'synthetic legacy variant','SYN-710001',1200,3);
INSERT INTO orders (id,userId,status,paymentStatus,totalPrice,shippingRecipient,shippingZipCode,shippingStreet,shippingNumber,shippingCity,shippingState)
VALUES (710001,710001,'pending','unconfirmed',1200,'Synthetic Recipient','00000-000','Synthetic Street','1','Synthetic City','SP');
INSERT INTO orderItems (id,orderId,productId,quantity,price) VALUES (710001,710001,710001,1,1200);
INSERT INTO stockReservations (id,orderId,userId,productId,quantity,status,expiresAt)
VALUES (710001,710001,710001,710001,1,'active',DATE_ADD(CURRENT_TIMESTAMP,INTERVAL 1 HOUR));
