-- PR-2: FeeDefinition seed for Trendyol — kar hesaplama V1
-- design: docs/plans/2026-05-18-profit-calculation-design.md §3.4
-- guide:  docs/plans/2026-05-19-profit-calc-implementation-guide.md §3
--
-- 4 Trendyol satırı sistem-düzeyi ücret tanımları. Tüm seller'lara aynı kural.
-- effectiveFrom 2026-05-18 (Trendyol Platform Hizmet Bedeli docyman okuma tarihi).
-- Trendyol oranı değiştirirse yeni effectiveFrom row'u eklenir (eski'nin
-- effectiveTo set'lenir) — zaman bazlı sürümleme §3.4'te detaylı.
--
-- Idempotent: ON CONFLICT DO NOTHING — UNIQUE(platform, fee_type, effective_from)
-- nedeniyle ikinci kez uygulanırsa zarar yok. `db push` ardından bu migration
-- atlanırsa tests/helpers/seed-fee-definitions.ts globalSetup helper'ı çağırır.

-- ─── Seed: fee_definitions (Trendyol PR-2) ────────────────────────────
INSERT INTO fee_definitions (id, platform, fee_type, display_name, calculation_kind, fixed_amount_net, rate_of_sale, default_vat_rate, effective_from, effective_to, is_required, created_at, updated_at)
VALUES
  -- Platform Hizmet Bedeli standart — ₺10.99 + KDV %20 (design §3.4 satır 1).
  -- Sipariş başına applyEstimateOnOrderCreate (PR-6) tarafından conservative
  -- olarak yazılır; muafiyetler (status=RETURNED, micro, all-digital) kontrol
  -- edilirse OrderFee oluşturulmaz.
  ('11111111-1111-1111-1111-000000000001', 'TRENDYOL', 'PLATFORM_SERVICE',      'Platform Hizmet Bedeli',                'FIXED',        10.99, NULL,    20.00, '2026-05-18 00:00:00', NULL, true,  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  -- Platform Hizmet Bedeli indirimli — ₺6.99 + KDV %20 (Bugün Kargoda).
  -- T+0'da bilinmez (fastDelivery=true + deliveredOnTime=true geleceğin sonucu);
  -- T+~5 sale settlement geldikten sonra correction OrderFee CREDIT ile uygulanır.
  ('11111111-1111-1111-1111-000000000002', 'TRENDYOL', 'PLATFORM_SERVICE_FAST', 'Platform Hizmet Bedeli (Bugün Kargoda)','FIXED',         6.99, NULL,    20.00, '2026-05-18 00:00:00', NULL, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  -- E-ticaret Stopajı — saleSubtotalNet × %1 (KDV=0).
  -- PSF üzerine stopaj YAPILMAZ (330 Tebliği Madde 5/2) — applyEstimate matrahı
  -- yalnız satış toplamından alır, PSF tutarını eklemez.
  ('11111111-1111-1111-1111-000000000003', 'TRENDYOL', 'STOPPAGE',              'E-ticaret Stopajı',                     'RATE_OF_SALE',  NULL, 0.0100,   0.00, '2026-05-18 00:00:00', NULL, true,  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  -- İade Kargo Bedeli — tutar cargo-invoice/items endpoint'inden gelir
  -- (FIXED template, fixed_amount_net NULL — runtime'da CARGO_INVOICE source'lu
  -- OrderFee yaratırken Trendyol değerini kullan). default_vat_rate %20.
  ('11111111-1111-1111-1111-000000000004', 'TRENDYOL', 'RETURN_SHIPPING',       'İade Kargo Bedeli',                     'FIXED',         NULL, NULL,    20.00, '2026-05-18 00:00:00', NULL, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (platform, fee_type, effective_from) DO NOTHING;
