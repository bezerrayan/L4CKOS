-- P1 preflight: read-only. Every result set must be empty or zero before migration 0014.
SELECT 'unexpected_payment_status' AS check_name, `status`, COUNT(*) AS affected
FROM `payments`
WHERE `status` NOT IN ('pending','confirmed','received','failed','overdue','cancelled','partially_refunded','refunded','chargeback')
GROUP BY `status`;

SELECT 'unexpected_fulfillment_status' AS check_name, `fulfillmentStatus`, COUNT(*) AS affected
FROM `orders`
WHERE `fulfillmentStatus` NOT IN ('awaiting_payment','ready','processing','shipped','delivered','cancelled','on_hold','inventory_exception')
GROUP BY `fulfillmentStatus`;

SELECT 'unexpected_reservation_status' AS check_name, `status`, COUNT(*) AS affected
FROM `stockReservations`
WHERE `status` NOT IN ('active','consumed','released','expired','restocked') GROUP BY `status`;

SELECT 'negative_or_invalid_values' AS check_name,
  SUM(`products`.`stock` < 0) AS negative_product_stock
FROM `products`;
SELECT 'negative_variant_stock' AS check_name, COUNT(*) AS affected FROM `productVariants` WHERE `stock` < 0;
SELECT 'invalid_order_items' AS check_name, COUNT(*) AS affected FROM `orderItems`
WHERE `quantity` <= 0 OR `unitPrice` < 0 OR (`totalPrice` IS NOT NULL AND `totalPrice` < 0);
SELECT 'invalid_reservations' AS check_name, COUNT(*) AS affected FROM `stockReservations` WHERE `quantity` <= 0;
SELECT 'negative_payment_amount' AS check_name, COUNT(*) AS affected FROM `payments` WHERE `amount` < 0;
SELECT 'invalid_payment_totals' AS check_name, COUNT(*) AS affected FROM `payments`
WHERE `paidAmount` < 0 OR `refundedAmount` < 0 OR `netAmount` < 0
   OR `refundedAmount` > `paidAmount` OR `netAmount` <> `paidAmount` - `refundedAmount`;
SELECT 'refund_status_amount_mismatch' AS check_name, COUNT(*) AS affected FROM `payments`
WHERE (`status` = 'refunded' AND (`refundedAmount` <> `paidAmount` OR `netAmount` <> 0))
   OR (`status` = 'partially_refunded' AND (`refundedAmount` <= 0 OR `refundedAmount` >= `paidAmount`))
   OR (`status` NOT IN ('partially_refunded','refunded') AND `refundedAmount` > 0);

SELECT 'orphan_order_items' AS check_name, COUNT(*) AS affected FROM `orderItems` oi LEFT JOIN `orders` o ON o.id=oi.orderId WHERE o.id IS NULL;
SELECT 'orphan_reservation_orders' AS check_name, COUNT(*) AS affected FROM `stockReservations` r LEFT JOIN `orders` o ON o.id=r.orderId WHERE o.id IS NULL;
SELECT 'orphan_reservation_items' AS check_name, COUNT(*) AS affected FROM `stockReservations` r LEFT JOIN `orderItems` oi ON oi.id=r.orderItemId WHERE r.orderItemId IS NOT NULL AND oi.id IS NULL;
SELECT 'orphan_payments' AS check_name, COUNT(*) AS affected FROM `payments` p LEFT JOIN `orders` o ON o.id=p.orderId WHERE o.id IS NULL;
SELECT 'orphan_payment_events' AS check_name, COUNT(*) AS affected FROM `paymentEvents` e LEFT JOIN `payments` p ON p.id=e.paymentId WHERE e.paymentId IS NOT NULL AND p.id IS NULL;
SELECT 'orphan_outbox_orders' AS check_name, COUNT(*) AS affected FROM `notificationOutbox` n LEFT JOIN `orders` o ON o.id=n.orderId WHERE n.orderId IS NOT NULL AND o.id IS NULL;
SELECT 'orphan_outbox_payments' AS check_name, COUNT(*) AS affected FROM `notificationOutbox` n LEFT JOIN `payments` p ON p.id=n.paymentId WHERE n.paymentId IS NOT NULL AND p.id IS NULL;

SELECT 'duplicate_order_payment' AS check_name, orderId, COUNT(*) AS affected FROM `payments` GROUP BY orderId HAVING COUNT(*) > 1;
SELECT 'financial_amount_mismatch' AS check_name, p.id, p.orderId, p.amount, o.totalPrice
FROM `payments` p JOIN `orders` o ON o.id=p.orderId WHERE p.amount <> o.totalPrice;

SELECT 'order_items_total_mismatch' AS check_name, o.id AS orderId, o.totalPrice, SUM(oi.totalPrice) AS itemsTotal
FROM `orders` o JOIN `orderItems` oi ON oi.orderId=o.id
GROUP BY o.id, o.totalPrice HAVING SUM(oi.totalPrice) <> o.totalPrice;

SELECT 'paid_order_awaiting_payment' AS check_name, COUNT(*) AS affected
FROM `orders` o JOIN `payments` p ON p.orderId=o.id
WHERE p.status IN ('confirmed','received','partially_refunded') AND o.fulfillmentStatus='awaiting_payment';
SELECT 'unpaid_order_in_fulfillment' AS check_name, COUNT(*) AS affected
FROM `orders` o LEFT JOIN `payments` p ON p.orderId=o.id
WHERE o.fulfillmentStatus IN ('ready','processing','shipped','delivered')
  AND (p.id IS NULL OR p.status NOT IN ('confirmed','received','partially_refunded'));
SELECT 'fulfillment_issue_fields_mismatch' AS check_name, COUNT(*) AS affected
FROM `orders`
WHERE (`fulfillmentStatus`='inventory_exception' AND (`fulfillmentIssue` IS NULL OR `fulfillmentIssueAt` IS NULL))
   OR (`fulfillmentStatus`<>'inventory_exception' AND (`fulfillmentIssue` IS NOT NULL OR `fulfillmentIssueAt` IS NOT NULL));

SELECT 'active_expired_reservations' AS check_name, COUNT(*) AS affected
FROM `stockReservations` WHERE `status`='active' AND `expiresAt` <= CURRENT_TIMESTAMP;
SELECT 'consumed_reservation_unpaid' AS check_name, COUNT(*) AS affected
FROM `stockReservations` r JOIN `payments` p ON p.orderId=r.orderId
WHERE r.status='consumed' AND p.status NOT IN ('confirmed','received','partially_refunded','refunded','chargeback');

SELECT 'payment_event_order_mismatch' AS check_name, COUNT(*) AS affected
FROM `paymentEvents` e JOIN `payments` p ON p.id=e.paymentId
WHERE e.orderId IS NOT NULL AND e.orderId <> p.orderId;
SELECT 'payment_event_provider_payment_mismatch' AS check_name, COUNT(*) AS affected
FROM `paymentEvents` e JOIN `payments` p ON p.id=e.paymentId
WHERE e.providerPaymentId IS NOT NULL AND p.providerPaymentId IS NOT NULL
  AND e.providerPaymentId <> p.providerPaymentId;

SELECT 'outbox_processing_without_valid_lease' AS check_name, COUNT(*) AS affected
FROM `notificationOutbox`
WHERE `status`='processing' AND (`lockedAt` IS NULL OR `lockedBy` IS NULL OR `leaseExpiresAt` IS NULL);
SELECT 'outbox_nonprocessing_with_lock' AS check_name, COUNT(*) AS affected
FROM `notificationOutbox`
WHERE `status`<>'processing' AND (`lockedAt` IS NOT NULL OR `lockedBy` IS NOT NULL OR `leaseExpiresAt` IS NOT NULL);
SELECT 'outbox_sent_timestamp_mismatch' AS check_name, COUNT(*) AS affected
FROM `notificationOutbox`
WHERE (`status`='sent' AND `sentAt` IS NULL) OR (`status`<>'sent' AND `sentAt` IS NOT NULL);
