CREATE TABLE `promoBanners` (
  `id` int NOT NULL AUTO_INCREMENT,
  `badge` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PROMOCAO',
  `title` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `ctaLabel` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Aproveitar Oferta',
  `imageUrl` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `mobileImageUrl` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `imageAlt` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `linkUrl` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `discountText` varchar(60) COLLATE utf8mb4_unicode_ci NOT NULL,
  `discountLabel` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'OFF',
  `bgStyle` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'linear-gradient(135deg, #1a1a1a 0%, #333333 100%)',
  `sortOrder` int NOT NULL DEFAULT '0',
  `isActive` int NOT NULL DEFAULT '1',
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
