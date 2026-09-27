-- Forward-only lease ownership for safe reclaim of abandoned outbox dispatches.
ALTER TABLE `orderEmailEvents`
  ADD COLUMN `processingToken` varchar(64) NULL AFTER `processingAt`;
