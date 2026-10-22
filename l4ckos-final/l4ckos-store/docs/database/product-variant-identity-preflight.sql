-- PREPARAÇÃO SOMENTE LEITURA. Executar manualmente apenas numa cópia local descartável.
-- Não contém escrita, correção automática nem acesso a configuração/credenciais.

-- Produtos simples versus produtos que já possuem linhas de variante.
SELECT p.id AS productId, p.name, p.stock AS productStock, COUNT(v.id) AS variantCount,
       CASE
         WHEN COUNT(v.id) > 0 THEN 'HAS_VARIANTS'
         WHEN JSON_VALID(COALESCE(p.optionColors, '[]')) = 0 OR JSON_VALID(COALESCE(p.optionSizes, '[]')) = 0 THEN 'INVALID_OPTIONS_JSON'
         WHEN JSON_LENGTH(CASE WHEN JSON_VALID(COALESCE(p.optionColors, '[]')) THEN COALESCE(p.optionColors, '[]') ELSE '[]' END) > 0
           OR JSON_LENGTH(CASE WHEN JSON_VALID(COALESCE(p.optionSizes, '[]')) THEN COALESCE(p.optionSizes, '[]') ELSE '[]' END) > 0 THEN 'OPTIONS_WITHOUT_VARIANTS'
         ELSE 'SIMPLE'
       END AS classification
FROM products p
LEFT JOIN productVariants v ON v.productId = p.id
GROUP BY p.id, p.name, p.stock
ORDER BY p.id;

-- JSON de opções inválido é pendência de revisão, não gerar variantes automaticamente.
SELECT id AS productId, name, optionColors, optionSizes
FROM products
WHERE (optionColors IS NOT NULL AND JSON_VALID(optionColors) = 0)
   OR (optionSizes IS NOT NULL AND JSON_VALID(optionSizes) = 0)
ORDER BY id;

-- Variantes que precisam de classificação manual; não inferir dimensões por name.
SELECT id AS variantId, productId, color, size, optionKey, sku
FROM productVariants
WHERE color IS NULL OR TRIM(color) = ''
   OR size IS NULL OR TRIM(size) = ''
   OR optionKey IS NULL OR TRIM(optionKey) = ''
ORDER BY productId, id;

-- Colisões candidatas por dimensão (triagem SQL; normalização Unicode é verificada no helper).
SELECT productId, LOWER(TRIM(color)) AS colorCandidate, LOWER(TRIM(size)) AS sizeCandidate,
       COUNT(*) AS rowCount, GROUP_CONCAT(id ORDER BY id) AS variantIds
FROM productVariants
WHERE color IS NOT NULL AND TRIM(color) <> '' AND size IS NOT NULL AND TRIM(size) <> ''
GROUP BY productId, LOWER(TRIM(color)), LOWER(TRIM(size))
HAVING COUNT(*) > 1;

-- optionKey repetido no mesmo produto (o índice atual deve impedir novos casos não nulos).
SELECT productId, optionKey, COUNT(*) AS rowCount, GROUP_CONCAT(id ORDER BY id) AS variantIds
FROM productVariants
WHERE optionKey IS NOT NULL
GROUP BY productId, optionKey
HAVING COUNT(*) > 1;

-- SKUs repetidos; relatório para revisão, sem assumir unicidade existente.
SELECT LOWER(TRIM(sku)) AS normalizedSku, COUNT(*) AS rowCount, GROUP_CONCAT(id ORDER BY id) AS variantIds
FROM productVariants
WHERE sku IS NOT NULL AND TRIM(sku) <> ''
GROUP BY LOWER(TRIM(sku))
HAVING COUNT(*) > 1;

-- IDs preservados por itens históricos e reservas existentes.
SELECT v.id AS variantId, v.productId, v.sku,
       (SELECT COUNT(*) FROM orderItems oi WHERE oi.variantId = v.id) AS orderItemReferences,
       (SELECT COUNT(*) FROM stockReservations sr WHERE sr.variantId = v.id) AS reservationReferences
FROM productVariants v
WHERE EXISTS (SELECT 1 FROM orderItems oi WHERE oi.variantId = v.id)
   OR EXISTS (SELECT 1 FROM stockReservations sr WHERE sr.variantId = v.id)
ORDER BY v.productId, v.id;

-- Referências sem linha de variante correspondente; não corrigir automaticamente.
SELECT refs.variantId,
       SUM(refs.orderItemReferences) AS orderItemReferences,
       SUM(refs.reservationReferences) AS reservationReferences
FROM (
  SELECT variantId, COUNT(*) AS orderItemReferences, 0 AS reservationReferences
  FROM orderItems WHERE variantId IS NOT NULL GROUP BY variantId
  UNION ALL
  SELECT variantId, 0 AS orderItemReferences, COUNT(*) AS reservationReferences
  FROM stockReservations WHERE variantId IS NOT NULL GROUP BY variantId
) refs
LEFT JOIN productVariants v ON v.id = refs.variantId
WHERE v.id IS NULL
GROUP BY refs.variantId;

-- Divergência meramente informativa para produtos de pronta entrega; não gravar o total agregado.
SELECT p.id AS productId, p.stock AS productStock, SUM(v.stock) AS variantStockTotal
FROM products p
JOIN productVariants v ON v.productId = p.id
WHERE COALESCE(p.salesMode, 'STOCK') <> 'PREORDER'
GROUP BY p.id, p.stock
HAVING p.stock <> SUM(v.stock);

-- Valores inválidos ou negativos, caso CHECKs tenham sido ignorados em schema antigo.
SELECT id AS variantId, productId, price, stock
FROM productVariants
WHERE stock < 0 OR price < 0;
