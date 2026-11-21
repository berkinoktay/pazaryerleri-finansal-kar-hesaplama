-- Reference seed: the micro-export "Yurt Disi Iade Operasyon Bedeli" (overseas
-- return operation fee) tiers, as one dated tier set.
--
-- When a micro-export item comes back, Trendyol keeps a tiered share of the
-- settlement (VAT-inclusive sale minus commission). The rate depends on the item's
-- VAT-inclusive sale price (Trendyol announcement of 16.07.2024): up to 2000 TRY
-- 35%, above 2000 TRY 30%.
--
-- Owned by the db seed (scripts/seed-reference.ts, seedMicroExportReturnTiers) and
-- the test support (src/test-support.ts, ensureMicroExportReturnTiers). Both run
-- this file from the marker line below to the end. The tables come from the Prisma
-- schema; this file only writes rows. Every statement is idempotent (ON CONFLICT
-- DO NOTHING). Replaces 20260625120000_micro_export_return_fee_tiers.sql, the
-- pre-versioning layout; the bands and rates are copied from it unchanged.

-- ─── Seed: micro_export_return_fee_tier_versions
-- The set starts at Istanbul midnight of the announcement date (2024-07-16 00:00
-- in Istanbul, UTC+3), stored as the UTC instant 2024-07-15 21:00.
INSERT INTO "micro_export_return_fee_tier_versions" (id, effective_from, created_at, updated_at)
VALUES (gen_random_uuid(), TIMESTAMP '2024-07-15 21:00:00', now(), now())
ON CONFLICT (effective_from) DO NOTHING;

-- Decimal(12,2) has no value between 2000.00 and 2000.01: 2000.00 falls in the 35%
-- band (the "up to 2000" rule), 2000.01 and above in the 30% band (the "above 2000"
-- rule).
INSERT INTO "micro_export_return_fee_tiers" (id, version_id, min_sale_gross, max_sale_gross, rate, created_at, updated_at)
SELECT gen_random_uuid(), v.id, td.min_sale_gross, td.max_sale_gross, td.rate, now(), now()
FROM (
  VALUES
    (0.00,    2000.00,     0.3500),
    (2000.01, 99999999.99, 0.3000)
) AS td (min_sale_gross, max_sale_gross, rate)
JOIN "micro_export_return_fee_tier_versions" v ON v.effective_from = TIMESTAMP '2024-07-15 21:00:00'
ON CONFLICT (version_id, min_sale_gross, max_sale_gross) DO NOTHING;
