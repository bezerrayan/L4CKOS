CREATE TABLE `homeHighlightSettings` (
  `id` tinyint unsigned NOT NULL,
  `displayMode` enum('single','rotate') NOT NULL DEFAULT 'single',
  `rotationIntervalSeconds` tinyint unsigned NOT NULL DEFAULT '8',
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `home_highlight_settings_singleton` CHECK (`id` = 1),
  CONSTRAINT `home_highlight_settings_interval` CHECK (`rotationIntervalSeconds` IN (5, 8, 10))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- l4ckos:statement-breakpoint
INSERT INTO `homeHighlightSettings` (`id`, `displayMode`, `rotationIntervalSeconds`)
VALUES (1, 'single', 8);
