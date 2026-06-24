-- Mikro ihracat "Yurt Dışı İade Operasyon Bedeli" kademe tablosu + seed.
--
-- İadeye dönen mikro ihracat ürününde hakediş (KDV-dahil satış − komisyon) üzerinden
-- kademeli oran kesilir; oran ürünün KDV-dahil satış fiyatına göre belirlenir
-- (Trendyol 16.07.2024 duyurusu): ≤2000₺ → %35, >2000₺ → %30. Oran/eşik DB'de
-- (data-driven; Trendyol değişirse SQL UPDATE). RLS: supabase/sql/rls-policies.sql.
--
-- NOT: bu repo db:push tabanlı; tabloyu schema.prisma'dan db:push yaratır. Aşağıdaki
-- SEED bölümü seed-reference + test-support (ensureMicroExportReturnTiers) tarafından
-- (tablo mevcutken) idempotent yeniden koşulur. CREATE IF NOT EXISTS yalnız migrate/kayıt yolu için.

CREATE TABLE IF NOT EXISTS "micro_export_return_fee_tiers" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "min_sale_gross" DECIMAL(12,2) NOT NULL,
  "max_sale_gross" DECIMAL(12,2) NOT NULL,
  "rate" DECIMAL(7,4) NOT NULL,
  "effective_from" DATE NOT NULL DEFAULT CURRENT_DATE,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "micro_export_return_fee_tiers_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "micro_export_return_fee_tiers_min_max_eff_key"
  ON "micro_export_return_fee_tiers" ("min_sale_gross", "max_sale_gross", "effective_from");
CREATE INDEX IF NOT EXISTS "micro_export_return_fee_tiers_min_max_idx"
  ON "micro_export_return_fee_tiers" ("min_sale_gross", "max_sale_gross");

-- ─── Seed: micro_export_return_fee_tiers (Yurt Dışı İade Operasyon Bedeli kademeleri) ───
-- Decimal(12,2) olduğundan 2000.00 ile 2000.01 arası değer yoktur: 2000.00 → %35 bandı
-- (≤2000 kuralı), 2000.01+ → %30 bandı (>2000 kuralı). effective_from 2024-07-16 (duyuru).
INSERT INTO "micro_export_return_fee_tiers" (id, min_sale_gross, max_sale_gross, rate, effective_from, created_at, updated_at)
VALUES
  ('22222222-2222-2222-2222-000000000001', 0.00,    2000.00,     0.3500, '2024-07-16', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('22222222-2222-2222-2222-000000000002', 2000.01, 99999999.99, 0.3000, '2024-07-16', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (min_sale_gross, max_sale_gross, effective_from) DO NOTHING;
