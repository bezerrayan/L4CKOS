CREATE TABLE products (
  id INT NOT NULL AUTO_INCREMENT,
  name VARCHAR(191) NOT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE users (
  id INT NOT NULL AUTO_INCREMENT,
  openId VARCHAR(64) NOT NULL,
  name TEXT NULL,
  email VARCHAR(320) NULL,
  cpf VARCHAR(18) NULL,
  phone VARCHAR(32) NULL,
  asaasCustomerId VARCHAR(64) NULL,
  loginMethod VARCHAR(64) NULL,
  role ENUM('user', 'admin') NOT NULL DEFAULT 'user',
  isVip INT NOT NULL DEFAULT 0,
  isBlocked INT NOT NULL DEFAULT 0,
  sessionVersion INT NOT NULL DEFAULT 1,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  lastSignedIn DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY users_openId_unique (openId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE userAddresses (
  id INT NOT NULL AUTO_INCREMENT,
  userId INT NOT NULL,
  label VARCHAR(100) NOT NULL,
  recipient VARCHAR(255) NOT NULL,
  zipCode VARCHAR(20) NOT NULL,
  street VARCHAR(255) NOT NULL,
  number VARCHAR(30) NOT NULL,
  complement VARCHAR(255) NULL,
  neighborhood VARCHAR(255) NOT NULL,
  city VARCHAR(255) NOT NULL,
  state VARCHAR(100) NOT NULL,
  isDefault INT NOT NULL DEFAULT 0,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY userAddresses_user_idx (userId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE orders (
  id INT NOT NULL AUTO_INCREMENT,
  userId INT NOT NULL,
  status ENUM('pending', 'processing', 'paid', 'shipped', 'delivered', 'cancelled') NOT NULL DEFAULT 'pending',
  paymentStatus ENUM('unconfirmed', 'confirmed') NOT NULL DEFAULT 'unconfirmed',
  paymentConfirmationSource ENUM('asaas_webhook', 'manual') NULL,
  paymentConfirmedAt DATETIME(3) NULL,
  paymentConfirmedBy INT NULL,
  paymentConfirmationReference VARCHAR(191) NULL,
  trackingCode VARCHAR(120) NULL,
  totalPrice INT NOT NULL,
  asaasCheckoutId VARCHAR(64) NULL,
  stockAttemptId VARCHAR(120) NULL,
  stockPaymentId VARCHAR(120) NULL,
  shippingOptionId VARCHAR(120) NULL,
  shippingRecipient VARCHAR(255) NULL,
  shippingZipCode VARCHAR(20) NULL,
  shippingStreet VARCHAR(255) NULL,
  shippingNumber VARCHAR(30) NULL,
  shippingComplement VARCHAR(255) NULL,
  shippingNeighborhood VARCHAR(255) NULL,
  shippingCity VARCHAR(255) NULL,
  shippingState VARCHAR(100) NULL,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY orders_stockAttempt_unique (stockAttemptId),
  UNIQUE KEY orders_stockPayment_unique (stockPaymentId),
  KEY orders_user_idx (userId),
  KEY orders_status_created_idx (status, createdAt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE productVariants (
  id INT NOT NULL AUTO_INCREMENT,
  productId INT NOT NULL,
  sku VARCHAR(120) COLLATE utf8mb4_0900_ai_ci NOT NULL,
  size VARCHAR(60) NOT NULL,
  color VARCHAR(60) NOT NULL,
  price INT NOT NULL,
  stock INT NOT NULL DEFAULT 0,
  reservedStock INT NOT NULL DEFAULT 0,
  isActive INT NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY productVariants_sku_unique (sku),
  UNIQUE KEY productVariants_option_unique (productId, color, size),
  KEY productVariants_product_idx (productId),
  CONSTRAINT productVariants_product_fk FOREIGN KEY (productId) REFERENCES products (id),
  CONSTRAINT productVariants_stock_check CHECK (reservedStock <= stock),
  CONSTRAINT productVariants_active_check CHECK (isActive IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE orderItems (
  id INT NOT NULL AUTO_INCREMENT,
  orderId INT NOT NULL,
  productId INT NOT NULL,
  quantity INT NOT NULL,
  price INT NOT NULL,
  variantId INT NULL,
  skuSnapshot VARCHAR(120) NULL,
  sizeSnapshot VARCHAR(60) NULL,
  colorSnapshot VARCHAR(60) NULL,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY orderItems_order_idx (orderId),
  CONSTRAINT orderItems_order_fk FOREIGN KEY (orderId) REFERENCES orders (id),
  CONSTRAINT orderItems_variant_fk FOREIGN KEY (variantId) REFERENCES productVariants (id),
  CONSTRAINT orderItems_product_fk FOREIGN KEY (productId) REFERENCES products (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE stockCheckoutAttempts (
  attemptId VARCHAR(120) NOT NULL,
  ownerUserId INT NOT NULL,
  fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  orderId INT NOT NULL,
  status ENUM('reserved', 'paid', 'released') NOT NULL,
  providerState ENUM('not_started', 'creating', 'ambiguous', 'created', 'definitive_failure') NOT NULL DEFAULT 'not_started',
  amountCents BIGINT NOT NULL,
  paymentId VARCHAR(120) NULL,
  checkoutUrl VARCHAR(2048) NULL,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  reservationExpiresAt DATETIME(3) NOT NULL,
  expiryReviewedAt DATETIME(3) NULL,
  reconciliationRequiredAt DATETIME(3) NULL,
  paidAt DATETIME(3) NULL,
  releasedAt DATETIME(3) NULL,
  PRIMARY KEY (attemptId),
  UNIQUE KEY stockCheckoutAttempts_order_unique (orderId),
  UNIQUE KEY stockCheckoutAttempts_payment_unique (paymentId),
  KEY stockCheckoutAttempts_status_created_idx (status, createdAt),
  KEY stockCheckoutAttempts_owner_idx (ownerUserId, attemptId),
  KEY stockCheckoutAttempts_expiry_idx (status, reservationExpiresAt, expiryReviewedAt, attemptId),
  CONSTRAINT stockCheckoutAttempts_order_fk FOREIGN KEY (orderId) REFERENCES orders (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE stockCheckoutItems (
  attemptId VARCHAR(120) NOT NULL,
  lineNumber SMALLINT NOT NULL,
  variantId INT NOT NULL,
  productId INT NOT NULL,
  sku VARCHAR(120) NOT NULL,
  size VARCHAR(60) NOT NULL,
  color VARCHAR(60) NOT NULL,
  unitPriceCents INT NOT NULL,
  quantity SMALLINT NOT NULL,
  totalCents BIGINT NOT NULL,
  PRIMARY KEY (attemptId, lineNumber),
  KEY stockCheckoutItems_variant_idx (variantId),
  CONSTRAINT stockCheckoutItems_attempt_fk FOREIGN KEY (attemptId) REFERENCES stockCheckoutAttempts (attemptId),
  CONSTRAINT stockCheckoutItems_variant_fk FOREIGN KEY (variantId) REFERENCES productVariants (id),
  CONSTRAINT stockCheckoutItems_product_fk FOREIGN KEY (productId) REFERENCES products (id),
  CONSTRAINT stockCheckoutItems_quantity_check CHECK (quantity > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE stockReservations (
  id BIGINT NOT NULL AUTO_INCREMENT,
  orderId INT NOT NULL,
  userId INT NOT NULL,
  productId INT NOT NULL,
  attemptId VARCHAR(120) NULL,
  variantId INT NULL,
  skuSnapshot VARCHAR(120) NULL,
  sizeSnapshot VARCHAR(60) NULL,
  colorSnapshot VARCHAR(60) NULL,
  unitPriceCents INT NULL,
  quantity SMALLINT NOT NULL,
  status ENUM('active', 'consumed', 'released', 'expired') NOT NULL DEFAULT 'active',
  expiresAt DATETIME(3) NOT NULL,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY stockReservations_order_idx (orderId),
  KEY stockReservations_user_product_idx (userId, productId),
  UNIQUE KEY stockReservations_attempt_variant_unique (attemptId, variantId),
  KEY stockReservations_variant_status_idx (variantId, status),
  KEY stockReservations_attempt_status_idx (attemptId, status),
  CONSTRAINT stockReservations_attempt_fk FOREIGN KEY (attemptId) REFERENCES stockCheckoutAttempts (attemptId),
  CONSTRAINT stockReservations_variant_fk FOREIGN KEY (variantId) REFERENCES productVariants (id),
  CONSTRAINT stockReservations_order_fk FOREIGN KEY (orderId) REFERENCES orders (id),
  CONSTRAINT stockReservations_product_fk FOREIGN KEY (productId) REFERENCES products (id),
  CONSTRAINT stockReservations_quantity_check CHECK (quantity > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE stockWebhookEvents (
  eventId VARCHAR(191) NOT NULL,
  payloadHash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  receivedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (eventId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
