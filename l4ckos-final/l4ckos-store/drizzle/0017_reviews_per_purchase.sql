-- Uma nova compra do mesmo produto pode receber uma nova avaliação.
-- A restrição por reserva continua impedindo avaliações duplicadas para o
-- mesmo item comprado.
ALTER TABLE `productReviews`
  DROP INDEX `productReviews_user_product_unique`;
