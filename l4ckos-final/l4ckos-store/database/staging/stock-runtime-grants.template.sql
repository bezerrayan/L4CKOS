-- Least-privilege grants for the APPLICATION runtime account on the STOCK checkout / Drops / reconciliation path.
-- TEMPLATE ONLY: it is applied by scripts/run-stock-mysql-tests.sh to a disposable local MySQL to PROVE the list.
-- It is NOT a migration and must never be executed remotely without a separate, explicit approval.
-- Placeholders: @DB@ (schema), @USER@ (account). No DDL, no TRIGGER, no GRANT OPTION, no global privileges, no DELETE/TRUNCATE on money tables.

-- Catalogue / batch rows the checkout locks with SELECT ... FOR UPDATE. MySQL requires UPDATE (or DELETE) in addition to SELECT for any
-- locking read, even though the checkout itself does not modify these rows (admin catalogue flows need INSERT/DELETE on top, not covered here).
GRANT SELECT, UPDATE ON `@DB@`.`products`                TO '@USER@'@'%';
GRANT SELECT, UPDATE ON `@DB@`.`productionBatches`       TO '@USER@'@'%';
GRANT SELECT, UPDATE ON `@DB@`.`productionBatchProducts` TO '@USER@'@'%';
GRANT SELECT         ON `@DB@`.`userAddresses`           TO '@USER@'@'%';

-- Identity / session: EVERY authenticated request upserts users.lastSignedIn (INSERT ... ON DUPLICATE KEY UPDATE), so a SELECT-only account
-- makes all authenticated requests fail with AuthenticationBackendUnavailable (503).
GRANT SELECT, INSERT, UPDATE ON `@DB@`.`users` TO '@USER@'@'%';

-- Checkout, reservation and payment lifecycle
GRANT SELECT, INSERT, UPDATE ON `@DB@`.`productVariants`        TO '@USER@'@'%';
GRANT SELECT, INSERT, UPDATE ON `@DB@`.`orders`                 TO '@USER@'@'%';
GRANT SELECT, INSERT, UPDATE ON `@DB@`.`orderItems`             TO '@USER@'@'%';
GRANT SELECT, INSERT, UPDATE ON `@DB@`.`stockReservations`      TO '@USER@'@'%';
GRANT SELECT, INSERT, UPDATE ON `@DB@`.`stockCheckoutAttempts`  TO '@USER@'@'%';
GRANT SELECT, INSERT, UPDATE ON `@DB@`.`stockCheckoutItems`     TO '@USER@'@'%';
GRANT SELECT, INSERT         ON `@DB@`.`stockWebhookEvents`     TO '@USER@'@'%';

-- Audit trail, including the late-approval reconciliation evidence (INSERT) and its idempotency check / admin query (SELECT)
GRANT SELECT, INSERT         ON `@DB@`.`auditLogs`              TO '@USER@'@'%';

-- Exclusive drops (quota, grants, requests, outbox)
GRANT SELECT, INSERT, UPDATE, DELETE ON `@DB@`.`exclusiveDrops`          TO '@USER@'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `@DB@`.`exclusiveDropProducts`   TO '@USER@'@'%';
GRANT SELECT, INSERT, UPDATE ON `@DB@`.`exclusiveAccessRequests`     TO '@USER@'@'%';
GRANT SELECT, INSERT, UPDATE ON `@DB@`.`exclusiveGrants`             TO '@USER@'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON `@DB@`.`exclusiveGrantUsage`            TO '@USER@'@'%';
GRANT SELECT, INSERT, UPDATE ON `@DB@`.`exclusiveRedeemAttempts`     TO '@USER@'@'%';
GRANT SELECT, INSERT         ON `@DB@`.`exclusiveEvents`             TO '@USER@'@'%';
GRANT SELECT, INSERT, UPDATE ON `@DB@`.`exclusiveNotificationOutbox` TO '@USER@'@'%';

-- ---------------------------------------------------------------------------------------------------------------------------------
-- NOT APPLIED / NOT PROVEN by the suite (derived from code review of server/payments/webhookInbox.ts, ingressProvenance.ts, webhookRecovery.ts).
-- Needed only when the inbound Asaas webhook is enabled for payment homologation; verify with the same least-privilege phase before use:
--   GRANT SELECT, INSERT, UPDATE ON `@DB@`.`asaasWebhookInbox`  TO '@USER@'@'%';   -- durable envelope + recovery state
--   GRANT SELECT                 ON `@DB@`.`asaasWebhookEvents` TO '@USER@'@'%';   -- legacy dedupe read
-- (auditLogs SELECT, INSERT above already covers ingress provenance and recovery audit rows.)
-- Account-management / catalogue admin flows (products INSERT/DELETE, productVariants, coupons, promoBanners, favorites, cartItems, profile,
-- reviews, notifications, backups) are outside this STOCK-path proof and must be inventoried separately before any non-read-only account is created.
