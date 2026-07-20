ALTER TABLE `orders`
  ADD `paymentStatus` enum('unconfirmed','confirmed') DEFAULT 'unconfirmed' NOT NULL AFTER `status`,
  ADD `paymentConfirmationSource` enum('asaas_webhook','manual') AFTER `paymentStatus`,
  ADD `paymentConfirmedAt` timestamp NULL AFTER `paymentConfirmationSource`,
  ADD `paymentConfirmedBy` int NULL AFTER `paymentConfirmedAt`,
  ADD `paymentConfirmationReference` varchar(191) NULL AFTER `paymentConfirmedBy`;

-- Pedidos antigos só são reconhecidos como pagos quando existe evidência
-- persistida de um webhook do Asaas que foi processado com sucesso.
-- O status logístico do pedido nunca é usado como prova de pagamento.
UPDATE `orders` AS `o`
INNER JOIN (
  SELECT
    `orderId`,
    MAX(`processedAt`) AS `confirmedAt`,
    MAX(`eventId`) AS `reference`
  FROM `asaasWebhookEvents`
  WHERE
    `status` = 'processed'
    AND `orderId` IS NOT NULL
    AND `eventType` IN ('PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED', 'PAYMENT_OVERDUE_RECEIVED')
  GROUP BY `orderId`
) AS `e` ON `e`.`orderId` = `o`.`id`
SET
  `o`.`paymentStatus` = 'confirmed',
  `o`.`paymentConfirmationSource` = 'asaas_webhook',
  `o`.`paymentConfirmedAt` = COALESCE(`e`.`confirmedAt`, `o`.`updatedAt`),
  `o`.`paymentConfirmedBy` = NULL,
  `o`.`paymentConfirmationReference` = `e`.`reference`;
