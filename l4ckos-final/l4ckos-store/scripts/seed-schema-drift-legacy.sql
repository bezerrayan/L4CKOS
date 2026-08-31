-- Synthetic pre-0015 fixture. Run only on an empty local homologation database.
INSERT INTO `users` (`id`,`openId`,`name`,`email`,`role`)
VALUES (15001,'schema-drift-user','Cliente Schema Drift','schema-drift@example.test','user');

INSERT INTO `products` (`id`,`name`,`category`,`price`,`stock`,`optionColors`,`optionSizes`,`sizeType`)
VALUES (15001,'Produto legado com imagem','teste',10000,2,'["Verde"]','["M"]','alpha');

INSERT INTO `productVariants` (`id`,`productId`,`name`,`sku`,`size`,`color`,`optionKey`,`price`,`stock`)
VALUES (15001,15001,'Produto Verde M','DRIFT-VERDE-M','M','Verde','size:m|color:verde',10000,2);

-- Pre-0015 productImages intentionally has no color column.
INSERT INTO `productImages` (`id`,`productId`,`imageUrl`,`alt`,`order`)
VALUES (15001,15001,'/uploads/legacy-product.jpg','Imagem legada',0);

-- Pre-0015 promoBanners intentionally has no media/link columns.
INSERT INTO `promoBanners` (`id`,`badge`,`title`,`description`,`ctaLabel`,`discountText`,`discountLabel`,`bgStyle`,`sortOrder`,`isActive`)
VALUES (15001,'LEGADO','Banner anterior à 0015','Banner sintético','Ver produtos','10%','OFF','linear-gradient(#111,#222)',0,1);

-- The insert path omits created_at and relies on CURRENT_TIMESTAMP.
INSERT INTO `waitlist_emails` (`id`,`email`)
VALUES (15001,'waitlist-schema-drift@example.test');

INSERT INTO `orders` (`id`,`userId`,`status`,`totalPrice`,`checkoutAttemptId`,`checkoutFingerprint`,`fulfillmentStatus`,`correlationId`)
VALUES (15001,15001,'pending',10000,'schema-drift-attempt','schema-drift-fingerprint','awaiting_payment','schema-drift-correlation');

INSERT INTO `orderItems` (`id`,`orderId`,`productId`,`variantId`,`productName`,`variantName`,`sku`,`size`,`color`,`quantity`,`unitPrice`,`totalPrice`)
VALUES (15001,15001,15001,15001,'Produto legado com imagem','Produto Verde M','DRIFT-VERDE-M','M','Verde',1,10000,10000);

INSERT INTO `stockReservations` (`id`,`orderId`,`userId`,`productId`,`variantId`,`orderItemId`,`quantity`,`status`,`expiresAt`)
VALUES (15001,15001,15001,15001,15001,15001,1,'active',DATE_ADD(CURRENT_TIMESTAMP,INTERVAL 1 HOUR));

INSERT INTO `payments` (`id`,`orderId`,`provider`,`providerPaymentId`,`billingType`,`amount`,`paidAmount`,`refundedAmount`,`netAmount`,`status`,`creationStatus`,`statusSource`,`externalReference`)
VALUES (15001,15001,'asaas','pay_schema_drift','PIX',10000,0,0,0,'pending','created','provider','order:15001');

INSERT INTO `paymentEvents` (`id`,`provider`,`providerEventId`,`paymentId`,`orderId`,`providerPaymentId`,`eventType`,`processingStatus`,`payload`)
VALUES (15001,'asaas','evt_schema_drift',15001,15001,'pay_schema_drift','PAYMENT_CREATED','processed','{}');

INSERT INTO `notificationOutbox` (`id`,`dedupeKey`,`type`,`orderId`,`paymentId`,`payload`,`status`,`attempts`)
VALUES (15001,'schema-drift:order-created','order-created',15001,15001,'{}','pending',0);

INSERT INTO `auditLogs` (`id`,`actorUserId`,`actorType`,`action`,`entity`,`entityId`,`orderId`,`paymentId`,`event`,`correlationId`)
VALUES (15001,15001,'system','schema_drift_fixture','order','15001',15001,15001,'fixture','schema-drift-correlation');
