-- Reference seed: the Trendyol shipping catalogue. Writes the carriers, one dated
-- tariff version per carrier and that version's desi and Barem prices.
--
-- Owned by the db seed (scripts/seed-reference.ts, seedShippingTariffs) and the
-- test support (src/test-support.ts, ensureShippingReferenceData). Both run this
-- file from the marker line below to the end. The tables come from the Prisma
-- schema (migrations, or db push on the test DB); this file only writes rows.
-- Every statement is idempotent (ON CONFLICT DO NOTHING), so a re-run on a seeded
-- database adds nothing. A carrier's 2000-01-01 version is written only while the
-- carrier has no version at all, so a re-run never brings back a version an admin
-- replaced or removed; the desi/Barem rows join to that version, so none are
-- written where it no longer exists.
--
-- Replaces 20260517085409_shipping_tariffs.sql, the pre-versioning layout. The
-- carrier list, the Barem attributes and the desi/Barem prices are copied from it
-- unchanged; order_cargo_names comes from migration
-- 20261105094822_shipping_carrier_order_cargo_names. Each carrier's first version
-- starts 2000-01-01 00:00 UTC, open towards the past so historic orders keep a
-- tariff. Turkish letters are written as U&'...' escapes so the file stays ASCII
-- apart from the marker line below.

-- ─── Seed: shipping_tariff_versions
-- Carriers: the Trendyol getProviders list. order_cargo_names holds the exact
-- cargoProviderName strings Trendyol writes on orders and packages; the order profit
-- path matches an order's cargo name against these OR the display name.
INSERT INTO "shipping_carriers" (id, platform, external_id, code, display_name, order_cargo_names, tax_number, sort_order, active, created_at, updated_at) VALUES
  (gen_random_uuid(), 'TRENDYOL',  4, 'YKMP',        U&'Yurti\00E7i Kargo', ARRAY[U&'Yurti\00E7i Kargo Marketplace'], '3130557669', 1,  true, now(), now()),
  (gen_random_uuid(), 'TRENDYOL',  7, 'ARASMP',      'Aras Kargo',          ARRAY['Aras Kargo Marketplace'],         '720039666',  2,  true, now(), now()),
  (gen_random_uuid(), 'TRENDYOL',  9, 'SURATMP',     U&'S\00FCrat Kargo',   ARRAY[U&'S\00FCrat Kargo Marketplace'],   '7870233582', 3,  true, now(), now()),
  (gen_random_uuid(), 'TRENDYOL', 10, 'DHLECOMMP',   'DHL eCommerce',       ARRAY['DHL eCommerce Marketplace'],      '6080712084', 4,  true, now(), now()),
  (gen_random_uuid(), 'TRENDYOL', 17, 'TEXMP',       'Trendyol Express',    ARRAY['Trendyol Express Marketplace'],   '8590921777', 5,  true, now(), now()),
  (gen_random_uuid(), 'TRENDYOL', 19, 'PTTMP',       'PTT Kargo',           ARRAY['PTT Kargo Marketplace'],          '7320068060', 6,  true, now(), now()),
  (gen_random_uuid(), 'TRENDYOL', 38, 'SENDEOMP',    'Kolay Gelsin',        ARRAY['Kolay Gelsin Marketplace'],       '2910804196', 7,  true, now(), now()),
  (gen_random_uuid(), 'TRENDYOL',  6, 'HOROZMP',     'Horoz Lojistik',      ARRAY['Horoz Kargo Marketplace'],        '4630097122', 9,  true, now(), now()),
  (gen_random_uuid(), 'TRENDYOL', 20, 'CEVAMP',      'CEVA',                ARRAY['CEVA Marketplace'],               '8450298557', 10, true, now(), now()),
  (gen_random_uuid(), 'TRENDYOL', 30, 'CEVATEDARIK', 'CEVA Tedarik',        ARRAY['Ceva Tedarik Marketplace'],       '1800038254', 11, true, now(), now())
ON CONFLICT (platform, code) DO NOTHING;

-- Versions: one per carrier, starting 2000-01-01 00:00 UTC, carrying the carrier's
-- Barem attributes (Barem Destek support, the largest Barem desi, the longest
-- delivery duration in days that still qualifies for Barem). Written only for a
-- carrier with no version yet (NOT EXISTS), so an admin's versions are kept.
INSERT INTO "shipping_tariff_versions" (id, carrier_id, effective_from, supports_barem_destek, max_barem_desi, max_barem_eligible_delivery_duration, created_at, updated_at)
SELECT gen_random_uuid(), c.id, TIMESTAMP '2000-01-01 00:00:00', vd.supports_barem_destek, vd.max_barem_desi, vd.max_barem_eligible_delivery_duration, now(), now()
FROM (
  VALUES
    ('YKMP',        true,  10, 1),
    ('ARASMP',      true,  10, 1),
    ('SURATMP',     true,  10, 1),
    ('DHLECOMMP',   true,  10, 1),
    ('TEXMP',       true,  10, 1),
    ('PTTMP',       true,  10, 1),
    ('SENDEOMP',    true,  10, 1),
    ('HOROZMP',     false, 10, 1),
    ('CEVAMP',      false, 10, 1),
    ('CEVATEDARIK', false, 10, 1)
) AS vd (carrier_code, supports_barem_destek, max_barem_desi, max_barem_eligible_delivery_duration)
JOIN "shipping_carriers" c ON c.platform = 'TRENDYOL' AND c.code = vd.carrier_code
WHERE NOT EXISTS (SELECT 1 FROM "shipping_tariff_versions" v WHERE v.carrier_id = c.id)
ON CONFLICT (carrier_id, effective_from) DO NOTHING;

-- Desi prices: Trendyol contracted cargo prices (15 April 2026, TRY, VAT excluded).
WITH tariff_data (carrier_code, desi, price_net) AS (
  VALUES
    ('ARASMP', 0, 83.93), ('ARASMP', 1, 83.93), ('ARASMP', 2, 83.93), ('ARASMP', 3, 95.12),
    ('ARASMP', 4, 103.68), ('ARASMP', 5, 111.17), ('ARASMP', 6, 121.12), ('ARASMP', 7, 128.46),
    ('ARASMP', 8, 137.05), ('ARASMP', 9, 144.91), ('ARASMP', 10, 153.48), ('ARASMP', 11, 161.77),
    ('ARASMP', 12, 167.73),
    ('DHLECOMMP', 0, 92.99), ('DHLECOMMP', 1, 92.99), ('DHLECOMMP', 2, 92.99), ('DHLECOMMP', 3, 103.99),
    ('DHLECOMMP', 4, 116.99), ('DHLECOMMP', 5, 129.99), ('DHLECOMMP', 6, 141.99), ('DHLECOMMP', 7, 149.99),
    ('DHLECOMMP', 8, 159.99), ('DHLECOMMP', 9, 169.99), ('DHLECOMMP', 10, 176.99), ('DHLECOMMP', 11, 184.99),
    ('DHLECOMMP', 12, 194.99),
    ('SENDEOMP', 0, 91.99), ('SENDEOMP', 1, 91.99), ('SENDEOMP', 2, 91.99), ('SENDEOMP', 3, 101.99),
    ('SENDEOMP', 4, 112.99), ('SENDEOMP', 5, 121.99), ('SENDEOMP', 6, 131.99), ('SENDEOMP', 7, 140.99),
    ('SENDEOMP', 8, 150.99), ('SENDEOMP', 9, 159.99), ('SENDEOMP', 10, 170.99), ('SENDEOMP', 11, 180.99),
    ('SENDEOMP', 12, 191.99),
    ('PTTMP', 0, 77.54), ('PTTMP', 1, 77.54), ('PTTMP', 2, 77.54), ('PTTMP', 3, 96.00),
    ('PTTMP', 4, 96.00), ('PTTMP', 5, 100.55), ('PTTMP', 6, 106.83), ('PTTMP', 7, 113.15),
    ('PTTMP', 8, 125.73), ('PTTMP', 9, 138.34), ('PTTMP', 10, 157.26), ('PTTMP', 11, 165.01),
    ('PTTMP', 12, 173.31),
    ('SURATMP', 0, 89.71), ('SURATMP', 1, 89.71), ('SURATMP', 2, 89.71), ('SURATMP', 3, 99.96),
    ('SURATMP', 4, 109.30), ('SURATMP', 5, 114.94), ('SURATMP', 6, 126.28), ('SURATMP', 7, 134.85),
    ('SURATMP', 8, 143.29), ('SURATMP', 9, 151.87), ('SURATMP', 10, 160.43), ('SURATMP', 11, 171.83),
    ('SURATMP', 12, 181.55),
    ('TEXMP', 0, 77.54), ('TEXMP', 1, 77.54), ('TEXMP', 2, 77.54), ('TEXMP', 3, 93.63),
    ('TEXMP', 4, 101.46), ('TEXMP', 5, 107.98), ('TEXMP', 6, 118.30), ('TEXMP', 7, 125.66),
    ('TEXMP', 8, 134.21), ('TEXMP', 9, 142.42), ('TEXMP', 10, 153.47), ('TEXMP', 11, 162.13),
    ('TEXMP', 12, 170.33),
    ('YKMP', 0, 112.77), ('YKMP', 1, 112.77), ('YKMP', 2, 112.77), ('YKMP', 3, 120.56),
    ('YKMP', 4, 123.15), ('YKMP', 5, 142.91), ('YKMP', 6, 149.82), ('YKMP', 7, 169.44),
    ('YKMP', 8, 175.96), ('YKMP', 9, 186.86), ('YKMP', 10, 195.12), ('YKMP', 11, 207.75),
    ('YKMP', 12, 220.80),
    ('CEVATEDARIK', 0, 494.22), ('CEVATEDARIK', 1, 494.22), ('CEVATEDARIK', 2, 494.22),
    ('CEVATEDARIK', 3, 494.22), ('CEVATEDARIK', 4, 494.22), ('CEVATEDARIK', 5, 494.22),
    ('CEVATEDARIK', 6, 494.22), ('CEVATEDARIK', 7, 494.22), ('CEVATEDARIK', 8, 494.22),
    ('CEVATEDARIK', 9, 494.22), ('CEVATEDARIK', 10, 494.22), ('CEVATEDARIK', 11, 494.22),
    ('CEVATEDARIK', 12, 494.22),
    ('CEVAMP', 0, 651.74), ('CEVAMP', 1, 651.74), ('CEVAMP', 2, 651.74),
    ('CEVAMP', 3, 651.74), ('CEVAMP', 4, 651.74), ('CEVAMP', 5, 651.74),
    ('CEVAMP', 6, 651.74), ('CEVAMP', 7, 651.74), ('CEVAMP', 8, 651.74),
    ('CEVAMP', 9, 651.74), ('CEVAMP', 10, 651.74), ('CEVAMP', 11, 651.74),
    ('CEVAMP', 12, 651.74),
    ('HOROZMP', 0, 599.13), ('HOROZMP', 1, 599.13), ('HOROZMP', 2, 599.13),
    ('HOROZMP', 3, 599.13), ('HOROZMP', 4, 599.13), ('HOROZMP', 5, 599.13),
    ('HOROZMP', 6, 599.13), ('HOROZMP', 7, 599.13), ('HOROZMP', 8, 599.13),
    ('HOROZMP', 9, 599.13), ('HOROZMP', 10, 599.13), ('HOROZMP', 11, 599.13),
    ('HOROZMP', 12, 599.13)
)
INSERT INTO "shipping_desi_tariffs" (id, version_id, desi, price_net, created_at, updated_at)
SELECT gen_random_uuid(), v.id, td.desi, td.price_net, now(), now()
FROM tariff_data td
JOIN "shipping_carriers" c ON c.platform = 'TRENDYOL' AND c.code = td.carrier_code
JOIN "shipping_tariff_versions" v ON v.carrier_id = c.id AND v.effective_from = TIMESTAMP '2000-01-01 00:00:00'
ON CONFLICT (version_id, desi) DO NOTHING;

-- Barem prices: Trendyol Kargo Barem Destek (26 March 2026, TRY, VAT excluded).
-- min_order_amount and max_order_amount are both INCLUSIVE, matching Trendyol's
-- documented "0 - 199,99 TL" / "200 - 349,99 TL" tier wording. The service and the
-- SQL estimate compare with a closed interval, so 199.99 falls in tier 1 and 200.00
-- in tier 2: no overlap, no gap. Every band here is Barem table 1 (BaremTier
-- TABLE_1); the 2000-01-01 versions predate the 10 August 2026 table 2.
WITH barem_data (carrier_code, min_amount, max_amount, price_net) AS (
  VALUES
    ('TEXMP',     0.00, 199.99, 34.16), ('PTTMP',     0.00, 199.99, 34.16),
    ('ARASMP',    0.00, 199.99, 42.91), ('SURATMP',   0.00, 199.99, 48.74),
    ('SENDEOMP',  0.00, 199.99, 51.24), ('DHLECOMMP', 0.00, 199.99, 52.08),
    ('YKMP',      0.00, 199.99, 74.58),
    ('TEXMP',     200.00, 349.99, 65.83), ('PTTMP',     200.00, 349.99, 65.83),
    ('ARASMP',    200.00, 349.99, 73.74), ('SURATMP',   200.00, 349.99, 79.58),
    ('SENDEOMP',  200.00, 349.99, 82.08), ('DHLECOMMP', 200.00, 349.99, 82.91),
    ('YKMP',      200.00, 349.99, 104.58)
)
INSERT INTO "shipping_barem_tariffs" (id, version_id, tier, min_order_amount, max_order_amount, price_net, created_at, updated_at)
SELECT gen_random_uuid(), v.id, 'TABLE_1', bd.min_amount, bd.max_amount, bd.price_net, now(), now()
FROM barem_data bd
JOIN "shipping_carriers" c ON c.platform = 'TRENDYOL' AND c.code = bd.carrier_code
JOIN "shipping_tariff_versions" v ON v.carrier_id = c.id AND v.effective_from = TIMESTAMP '2000-01-01 00:00:00'
ON CONFLICT (version_id, tier, min_order_amount, max_order_amount) DO NOTHING;
