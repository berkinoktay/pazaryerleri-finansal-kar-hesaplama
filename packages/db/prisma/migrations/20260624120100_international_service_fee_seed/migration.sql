-- Uluslararası Hizmet Bedeli (mikro ihracat) FeeDefinition seed'i.
--
-- Trendyol: 16.07.2024'ten beri tüm Mikro İhracat (Azerbaycan, Körfez, Orta/Doğu Avrupa)
-- siparişlerinde, ürün başına, Trendyol-karşılamalı indirimler hariç diğer indirimler
-- düşülmüş satış fiyatı üzerinden KDV-dahil %6 "Uluslararası Hizmet Bedeli" uygulanır
-- (iptale dönen siparişlerde uygulanmaz). PSF mikro ihracatta uygulanmaz; bu ücret onun yerine geçer.
--
-- RATE_OF_SALE %6: amountGross = saleGross × 0.06 (KDV-dahil). default_vat_rate %20 → fee'nin
-- KDV bileşeni downstream grossToVat ile türetilir. Oran data-driven (Trendyol değişirse yeni
-- effective_from satırı; eski'ye effective_to). platform=TRENDYOL (mikro ihracat Trendyol-özgü).
--
-- NOT: bu repo db:push tabanlı; enum değeri schema.prisma'dan db:push ile eklenir, aşağıdaki
-- SEED bölümü seed-reference + test helper tarafından (enum mevcutken) idempotent yeniden koşulur.

-- ─── Seed: fee_definitions (mikro ihracat — Uluslararası Hizmet Bedeli) ─────
INSERT INTO "fee_definitions" (id, platform, fee_type, display_name, calculation_kind, fixed_amount_net, rate_of_sale, default_vat_rate, effective_from, effective_to, is_required, created_at, updated_at)
VALUES
  ('11111111-1111-1111-1111-000000000008', 'TRENDYOL', 'INTERNATIONAL_SERVICE', 'Uluslararası Hizmet Bedeli', 'RATE_OF_SALE', NULL, 0.0600, 20.00, '2024-07-16 00:00:00', NULL, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (platform, fee_type, effective_from) DO NOTHING;
