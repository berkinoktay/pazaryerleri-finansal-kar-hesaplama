-- Data-only migration (no schema change): re-scope the denormalized product
-- aggregates to the default listing scope.
--
-- products.total_stock, min_sale_price and max_sale_price used to span every
-- variant of a product. From this release refreshProductAggregates
-- (packages/catalog-sync) counts only listed variants: delisted_at IS NULL and
-- status <> 'ARCHIVED' (LISTED_VARIANT_WHERE). The sync rewrites a product the
-- next time one of its variants changes, but a product whose variants were all
-- delisted before this release never changes again and would keep its old
-- totals. This one-time pass rewrites every product whose stored values differ
-- from the new rule, with the helper's result for a product that has no
-- variant in scope: total_stock 0 and NULL price bounds. updated_at moves only
-- on the rows that change, as the helper's Prisma update would move it.
--
-- The table is small at the time of this migration and has no production
-- traffic yet, so a single-statement UPDATE is used: no batching.

WITH "listed" AS (
  SELECT
    "product_id",
    SUM("quantity") AS "total_stock",
    MIN("sale_price") AS "min_sale_price",
    MAX("sale_price") AS "max_sale_price"
  FROM "product_variants"
  WHERE "delisted_at" IS NULL AND "status" <> 'ARCHIVED'
  GROUP BY "product_id"
),
"target" AS (
  SELECT
    p."id",
    COALESCE(l."total_stock", 0)::integer AS "total_stock",
    l."min_sale_price",
    l."max_sale_price"
  FROM "products" p
  LEFT JOIN "listed" l ON l."product_id" = p."id"
)
UPDATE "products" AS p
SET
  "total_stock" = t."total_stock",
  "min_sale_price" = t."min_sale_price",
  "max_sale_price" = t."max_sale_price",
  "updated_at" = CURRENT_TIMESTAMP
FROM "target" t
WHERE p."id" = t."id"
  AND (
    p."total_stock" IS DISTINCT FROM t."total_stock"
    OR p."min_sale_price" IS DISTINCT FROM t."min_sale_price"
    OR p."max_sale_price" IS DISTINCT FROM t."max_sale_price"
  );
