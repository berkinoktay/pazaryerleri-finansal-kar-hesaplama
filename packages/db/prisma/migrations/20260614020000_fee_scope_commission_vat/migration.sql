-- Denetim A (2026-06-14): komisyon KDV oranı + e-ticaret stopajı 'ALL' kapsamına.
--
-- Marketplace-parametre kuralı (AGENTS.md): oran/eşik/sabitler kodda değil DB'de
-- yaşamalı, deploy gerekmeden değişmeli. Komisyon KDV oranı (%20) koda gömülüydü
-- (TRENDYOL_COMMISSION_VAT_RATE). Onu fee_definitions'a, pazaryeri-bağımsız 'ALL'
-- kapsamına taşıyoruz; tüketiciler (order mapper + settlement handler'ları) oranı
-- buradan resolveFeeDefinition ile okur.
--
-- FeeScope, Platform'tan AYRI yeni bir enum (ALL'ı Platform'a koymak stores/orders'a
-- sızardı — schema.prisma yorumu). Yeni enum sıfırdan ALL ile yaratıldığından
-- PostgreSQL'in "ALTER TYPE ADD VALUE aynı işlemde kullanılamaz" kısıtı YOK.
--
-- NOT: bu repo db:push tabanlı (apps/api/tests/helpers/seed-fee-definitions.ts:
-- "prisma migrate dev shadow-DB sorunu" → migration SQL'i sırayla replay EDİLMEZ).
-- Şemayı db:push uygular. Aşağıdaki SEED bölümünü (marker'dan sonrası) seed-reference
-- + test helper PR-2 seed'inden SONRA idempotent yeniden koşar — bu yüzden geçiş
-- (stopaj TRENDYOL→ALL) DELETE+INSERT ile yazılır: PR-2 seed her koşuda TRENDYOL
-- stopaj satırını (id ...003) ekler; bu bölüm onu silip tek 'ALL' satıra (id ...007)
-- indirger. Böylece (a) PR-2 migration'ı dokunulmaz (migrate-replay geçerli, 'ALL'
-- Platform enum'una yazılmaz) (b) in-place upgrade idempotent + tek satır kalır.

CREATE TYPE "FeeScope" AS ENUM ('TRENDYOL', 'HEPSIBURADA', 'ALL');

-- fee_definitions.platform: Platform → FeeScope. Mevcut TRENDYOL satırları
-- 'TRENDYOL'::FeeScope'a sorunsuz cast olur. @@unique(platform,feeType,effectiveFrom)
-- ve @@index(platform,effectiveFrom) korunur (kolon adı değişmiyor).
ALTER TABLE "fee_definitions"
  ALTER COLUMN "platform" TYPE "FeeScope" USING "platform"::text::"FeeScope";

-- ─── Seed: fee_definitions (denetim A — stopaj 'ALL' + komisyon KDV) ─────
-- Bu bölüm seed-reference + test helper tarafından (PR-2 seed'inden SONRA) idempotent
-- yeniden koşulur. Stopajı 'ALL'a taşı: PR-2 (TRENDYOL, STOPPAGE, id ...003) satırını
-- SİL + tek 'ALL' satır (id ...007) ekle. DELETE+INSERT (UPDATE değil) ki PR-2 seed'in
-- her koşuda yeniden eklediği TRENDYOL satırı tek ALL satıra indirgensin (id reuse
-- olmadan → PK çakışması yok). order_fees.fee_definition_id FK'sı ON DELETE SET NULL:
-- silinen tanıma bağlı OrderFee'ler kaybolmaz, yalnız link NULL olur (feeType + tutar durur).
-- Fresh DB'de DELETE no-op (PR-2 seed aynı koşuda TRENDYOL stopaj'ı yeni ekler, bu siler).
DELETE FROM "fee_definitions" WHERE fee_type = 'STOPPAGE' AND platform = 'TRENDYOL';

INSERT INTO "fee_definitions" (id, platform, fee_type, display_name, calculation_kind, fixed_amount_net, rate_of_sale, default_vat_rate, effective_from, effective_to, is_required, created_at, updated_at)
VALUES
  -- E-ticaret Stopajı — saleSubtotalNet × %1 (KDV=0). 'ALL': tüm pazaryerlerinde sabit.
  -- id ...007 (...003 PR-2'de TRENDYOL stopaj, ...005 PR-8'de SHIPPING, ...006 komisyon KDV).
  ('11111111-1111-1111-1111-000000000007', 'ALL', 'STOPPAGE',           'E-ticaret Stopajı', 'RATE_OF_SALE', NULL, 0.0100, 0.00,  '2026-05-18 00:00:00', NULL, true,  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  -- Komisyon KDV oranı (%20) — 'ALL'. default_vat_rate = oran; tutar taşımaz (FIXED +
  -- fixed_amount_net NULL). order mapper + settlement handler'ları komisyonun KDV-dahil
  -- tutarını bu oranla net/KDV'ye böler. Eskiden TRENDYOL_COMMISSION_VAT_RATE sabitiydi.
  ('11111111-1111-1111-1111-000000000006', 'ALL', 'COMMISSION_INVOICE', 'Komisyon KDV',      'FIXED',        NULL, NULL,   20.00, '2026-05-18 00:00:00', NULL, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (platform, fee_type, effective_from) DO NOTHING;
