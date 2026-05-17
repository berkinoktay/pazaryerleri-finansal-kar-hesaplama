# Shipping Cost Estimation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship V1 of variant-level shipping cost estimation — tariff reference data, per-Store carrier config, dynamic estimator service, products list integration, and 5-state UI.

**Architecture:** Three layers — (1) global reference data tables (carriers, desi tariffs, Barem tariffs) seeded from Trendyol's getProviders API + the Anlaşmalı Kargo Fiyat PDF, (2) per-Store tenant-private config (`shippingTariffSource`, `defaultShippingCarrierId`, `OwnShippingTariff`), (3) estimator service with raw SQL CTE mirror for products list. All tariff thresholds in DB columns — Trendyol parameter changes via SQL UPDATE only.

**Tech Stack:** Prisma 7 (schema + migrations), Hono + zod-openapi (routes), Vitest (tests), Next.js 16 App Router + React 19 + Tailwind 4 + shadcn/ui (frontend), Supabase Postgres + RLS, decimal.js (money).

**Spec:** `docs/superpowers/specs/2026-05-17-shipping-cost-estimation-design.md`

**Branch:** `feature/shipping-cost-estimation-design` (already created, spec committed at 60e2574)

---

## File Structure

### New files

```
packages/db/prisma/migrations/<ts>_shipping_tariffs/migration.sql       (schema + seed in one)
apps/api/src/services/shipping-estimator.service.ts                     (canonical algorithm)
apps/api/src/services/shipping-config.service.ts                        (config CRUD with cross-platform guard)
apps/api/src/services/__tests__/shipping-estimator.service.test.ts
apps/api/src/services/__tests__/shipping-estimator-helpers.test.ts
apps/api/src/services/shipping-estimator.sql.ts                         (raw SQL CTE constant)
apps/api/src/validators/shipping-config.validator.ts
apps/api/src/routes/shipping/index.ts
apps/api/src/routes/shipping/list-carriers.route.ts
apps/api/src/routes/shipping/get-config.route.ts
apps/api/src/routes/shipping/patch-config.route.ts
apps/api/src/routes/shipping/list-own-tariff.route.ts
apps/api/tests/integration/routes/shipping/list-carriers.test.ts
apps/api/tests/integration/routes/shipping/get-config.test.ts
apps/api/tests/integration/routes/shipping/patch-config.test.ts
apps/api/tests/integration/routes/shipping/list-own-tariff.test.ts
apps/api/tests/integration/tenant-isolation/shipping-config.test.ts
apps/api/tests/integration/rls/own-shipping-tariffs.rls.test.ts
apps/api/tests/integration/shipping-estimator-equivalence.test.ts

apps/web/src/features/shipping/api/list-shipping-carriers.api.ts
apps/web/src/features/shipping/api/get-shipping-config.api.ts
apps/web/src/features/shipping/api/update-shipping-config.api.ts
apps/web/src/features/shipping/api/list-own-shipping-tariff.api.ts
apps/web/src/features/shipping/hooks/use-shipping-carriers.ts
apps/web/src/features/shipping/hooks/use-shipping-config.ts
apps/web/src/features/shipping/hooks/use-update-shipping-config.ts
apps/web/src/features/shipping/hooks/__tests__/use-update-shipping-config.test.ts
apps/web/src/features/shipping/components/shipping-config-form.tsx
apps/web/src/features/shipping/components/carrier-select.tsx
apps/web/src/features/shipping/components/shipping-tariff-source-segment.tsx
apps/web/src/features/shipping/components/shipping-config-empty-state.tsx
apps/web/src/features/shipping/components/__tests__/shipping-config-form.test.tsx
apps/web/src/features/shipping/lib/format-carrier-chip.ts
apps/web/src/features/shipping/lib/shipping-estimate-status.ts
apps/web/src/features/shipping/lib/__tests__/format-carrier-chip.test.ts
apps/web/src/features/shipping/lib/__tests__/shipping-estimate-status.test.ts
apps/web/src/features/shipping/types/shipping.types.ts
apps/web/src/features/shipping/validation/shipping-config.schema.ts

apps/web/src/features/products/components/net-profit-cell.tsx
apps/web/src/features/products/components/net-profit-popover.tsx
apps/web/src/features/products/components/missing-shipping-banner.tsx
apps/web/src/features/products/components/__tests__/net-profit-cell.test.tsx
apps/web/src/features/products/components/__tests__/missing-shipping-banner.test.tsx
```

### Modified files

```
packages/db/prisma/schema.prisma                                        (+1 enum, +4 models, +Store mod)
supabase/sql/rls-policies.sql                                           (+4 policy blocks)
apps/api/src/routes/products/list.route.ts (or product.routes.ts)       (extend response with shipping fields)
apps/api/src/app.ts                                                      (mount shipping routes)
apps/api/tests/integration/rls/coverage.rls.test.ts                     (+own_shipping_tariffs in TENANT_TABLES)
apps/web/src/features/products/components/products-table.tsx           (+ Tahmini Net Kar column; remove existing profit/cost cell if mixed)
apps/web/src/features/products/api/list-products.api.ts                 (response type extension)
apps/web/messages/tr.json                                                (i18n keys for shipping namespace)
scripts/audit-feature-boundaries.config.ts                              (+`shipping` as allowed cross-feature target)
docs/api-changelog.md                                                    (Unreleased entry)
```

---

# PR 1 — Schema, RLS Policies, Seed Data

**Goal:** Land schema + global tariff reference data so PR 2 can read from it.

### Task 1.1: Add `ShippingTariffSource` enum to Prisma schema

**Files:**

- Modify: `packages/db/prisma/schema.prisma` (insert near other enums around line 117)

- [ ] **Step 1: Add enum**

Locate the `// ─── Enums ───` block in `schema.prisma`. After `enum FxRateMode { AUTO MANUAL }` add:

```prisma
enum ShippingTariffSource {
  TRENDYOL_CONTRACT
  OWN_CONTRACT
}
```

- [ ] **Step 2: Verify schema syntax**

Run: `pnpm --filter @pazarsync/db prisma format`
Expected: No errors. Schema reformatted (idempotent).

### Task 1.2: Add `ShippingCarrier` model

**Files:**

- Modify: `packages/db/prisma/schema.prisma` (append after `MarketplaceCommissionRate`)

- [ ] **Step 1: Append model**

```prisma
model ShippingCarrier {
  id                               String   @id @default(uuid()) @db.Uuid
  platform                         Platform
  externalId                       Int      @map("external_id")
  code                             String
  displayName                      String   @map("display_name")
  taxNumber                        String?  @map("tax_number")
  supportsBaremDestek              Boolean  @default(true)  @map("supports_barem_destek")
  maxBaremDesi                     Int      @default(10)    @map("max_barem_desi")
  maxBaremEligibleDeliveryDuration Int      @default(1)     @map("max_barem_eligible_delivery_duration")
  sortOrder                        Int      @default(0)     @map("sort_order")
  active                           Boolean  @default(true)
  createdAt                        DateTime @default(now()) @map("created_at")
  updatedAt                        DateTime @updatedAt      @map("updated_at")

  desiTariffs  ShippingDesiTariff[]
  baremTariffs ShippingBaremTariff[]
  stores       Store[]

  @@unique([platform, externalId])
  @@unique([platform, code])
  @@index([platform, active])
  @@map("shipping_carriers")
}
```

- [ ] **Step 2: Verify**

Run: `pnpm --filter @pazarsync/db prisma format`
Expected: Format-only changes, no errors.

### Task 1.3: Add `ShippingDesiTariff` + `ShippingBaremTariff` + `OwnShippingTariff` models

**Files:**

- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Append three models**

After `ShippingCarrier`, append:

```prisma
model ShippingDesiTariff {
  id            String   @id @default(uuid()) @db.Uuid
  carrierId     String   @map("carrier_id") @db.Uuid
  desi          Int
  priceNet      Decimal  @map("price_net") @db.Decimal(10, 2)
  effectiveFrom DateTime @default(now()) @map("effective_from") @db.Date
  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")

  carrier ShippingCarrier @relation(fields: [carrierId], references: [id], onDelete: Cascade)

  @@unique([carrierId, desi])
  @@index([carrierId, desi])
  @@map("shipping_desi_tariffs")
}

model ShippingBaremTariff {
  id             String   @id @default(uuid()) @db.Uuid
  carrierId      String   @map("carrier_id") @db.Uuid
  minOrderAmount Decimal  @map("min_order_amount") @db.Decimal(12, 2)
  maxOrderAmount Decimal  @map("max_order_amount") @db.Decimal(12, 2)
  priceNet       Decimal  @map("price_net") @db.Decimal(10, 2)
  effectiveFrom  DateTime @default(now()) @map("effective_from") @db.Date
  createdAt      DateTime @default(now()) @map("created_at")
  updatedAt      DateTime @updatedAt @map("updated_at")

  carrier ShippingCarrier @relation(fields: [carrierId], references: [id], onDelete: Cascade)

  @@unique([carrierId, minOrderAmount, maxOrderAmount])
  @@index([carrierId])
  @@map("shipping_barem_tariffs")
}

model OwnShippingTariff {
  id             String   @id @default(uuid()) @db.Uuid
  organizationId String   @map("organization_id") @db.Uuid
  storeId        String   @map("store_id") @db.Uuid
  desi           Int
  priceNet       Decimal  @map("price_net") @db.Decimal(10, 2)
  createdAt      DateTime @default(now()) @map("created_at")
  updatedAt      DateTime @updatedAt @map("updated_at")
  createdBy      String?  @map("created_by") @db.Uuid

  store Store @relation(fields: [storeId], references: [id], onDelete: Cascade)

  @@unique([storeId, desi])
  @@index([organizationId])
  @@map("own_shipping_tariffs")
}
```

- [ ] **Step 2: Format check**

Run: `pnpm --filter @pazarsync/db prisma format`
Expected: success.

### Task 1.4: Modify `Store` model with shipping fields

**Files:**

- Modify: `packages/db/prisma/schema.prisma` (find the `Store` model around line 179)

- [ ] **Step 1: Add two fields + two relations**

Inside the existing `model Store { ... }` block, add to the field list (after `updatedAt`):

```prisma
  shippingTariffSource     ShippingTariffSource @default(TRENDYOL_CONTRACT) @map("shipping_tariff_source")
  defaultShippingCarrierId String?              @map("default_shipping_carrier_id") @db.Uuid
```

And to the relations block:

```prisma
  defaultShippingCarrier ShippingCarrier?    @relation(fields: [defaultShippingCarrierId], references: [id], onDelete: SetNull)
  ownShippingTariffs     OwnShippingTariff[]
```

- [ ] **Step 2: Format + verify**

Run: `pnpm --filter @pazarsync/db prisma format`
Expected: success.

Run: `pnpm --filter @pazarsync/db prisma validate`
Expected: "The schema is valid".

### Task 1.5: Generate Prisma client

**Files:**

- Modify (regenerate): `packages/db/generated/prisma/` (gitignored)

- [ ] **Step 1: Generate**

Run from repo root: `pnpm db:generate`
Expected: "Generated Prisma Client" with new types `ShippingCarrier`, `ShippingDesiTariff`, etc.

- [ ] **Step 2: Verify types exist**

Run: `grep -c "ShippingCarrier" packages/db/generated/prisma/client.ts || grep -c "ShippingCarrier" packages/db/generated/prisma/index.d.ts`
Expected: non-zero count (types exist).

### Task 1.6: Create structural migration

**Files:**

- Create: `packages/db/prisma/migrations/<timestamp>_shipping_tariffs/migration.sql`

- [ ] **Step 1: Start local Supabase**

Run: `pnpm supabase:start`
Expected: services started, DB on `54322`.

- [ ] **Step 2: Generate migration**

Run: `pnpm --filter @pazarsync/db prisma migrate dev --name shipping_tariffs --create-only`
Expected: New folder under `packages/db/prisma/migrations/` with `migration.sql`. The flag `--create-only` generates without applying so we can append seed SQL.

- [ ] **Step 3: Inspect the auto-generated SQL**

Open the new `migration.sql`. Verify it contains:

- `CREATE TYPE "ShippingTariffSource" AS ENUM ('TRENDYOL_CONTRACT', 'OWN_CONTRACT');`
- `CREATE TABLE "shipping_carriers" (...)`
- `CREATE TABLE "shipping_desi_tariffs" (...)`
- `CREATE TABLE "shipping_barem_tariffs" (...)`
- `CREATE TABLE "own_shipping_tariffs" (...)`
- `ALTER TABLE "stores" ADD COLUMN "shipping_tariff_source" ...`
- `ALTER TABLE "stores" ADD COLUMN "default_shipping_carrier_id" UUID;`
- 4 unique indexes + 4 normal indexes + 2 foreign keys

If anything is missing, abort and re-run `prisma migrate dev --create-only` after fixing the schema.

### Task 1.7: Append carrier seed data to migration

**Files:**

- Modify: `packages/db/prisma/migrations/<timestamp>_shipping_tariffs/migration.sql` (append at bottom)

- [ ] **Step 1: Add separator and carrier INSERT**

Append at the end of `migration.sql`:

```sql
-- ─── Seed: shipping_carriers — Trendyol getProviders authoritative list ───
INSERT INTO "shipping_carriers" (id, platform, external_id, code, display_name, tax_number, supports_barem_destek, max_barem_desi, max_barem_eligible_delivery_duration, sort_order, active, created_at, updated_at) VALUES
  (gen_random_uuid(), 'TRENDYOL',  4, 'YKMP',        'Yurtiçi Kargo',     '3130557669', true,  10, 1, 1,  true, now(), now()),
  (gen_random_uuid(), 'TRENDYOL',  7, 'ARASMP',      'Aras Kargo',        '720039666',  true,  10, 1, 2,  true, now(), now()),
  (gen_random_uuid(), 'TRENDYOL',  9, 'SURATMP',     'Sürat Kargo',       '7870233582', true,  10, 1, 3,  true, now(), now()),
  (gen_random_uuid(), 'TRENDYOL', 10, 'DHLECOMMP',   'DHL eCommerce',     '6080712084', true,  10, 1, 4,  true, now(), now()),
  (gen_random_uuid(), 'TRENDYOL', 17, 'TEXMP',       'Trendyol Express',  '8590921777', true,  10, 1, 5,  true, now(), now()),
  (gen_random_uuid(), 'TRENDYOL', 19, 'PTTMP',       'PTT Kargo',         '7320068060', true,  10, 1, 6,  true, now(), now()),
  (gen_random_uuid(), 'TRENDYOL', 38, 'SENDEOMP',    'Kolay Gelsin',      '2910804196', true,  10, 1, 7,  true, now(), now()),
  (gen_random_uuid(), 'TRENDYOL',  6, 'HOROZMP',     'Horoz Lojistik',    '4630097122', false, 10, 1, 9,  true, now(), now()),
  (gen_random_uuid(), 'TRENDYOL', 20, 'CEVAMP',      'CEVA',              '8450298557', false, 10, 1, 10, true, now(), now()),
  (gen_random_uuid(), 'TRENDYOL', 30, 'CEVATEDARIK', 'CEVA Tedarik',      '1800038254', false, 10, 1, 11, true, now(), now());
```

Note: `gen_random_uuid()` is available in Postgres 15+ (Supabase default). If unavailable in target env, swap for `uuid_generate_v4()` after `CREATE EXTENSION "uuid-ossp"`.

### Task 1.8: Append desi tariff seed data

**Files:**

- Modify: same migration.sql

- [ ] **Step 1: Add desi tariff INSERTs (KDV hariç, 2026-04-15 PDF)**

Append below the carrier INSERTs. Each carrier gets rows for desi 0..12 (per the engagement page screenshot 1). Use a CTE pattern to keep the INSERT readable:

```sql
-- ─── Seed: shipping_desi_tariffs — Trendyol Anlaşmalı Kargo Fiyatları (15 Nisan 2026, KDV hariç TL) ───
-- Source: https://tymp.mncdn.com/prod/documents/engagement/kargo/trendyol_guncel_kargo_fiyatlari.pdf
WITH carriers AS (
  SELECT id, code FROM "shipping_carriers" WHERE platform = 'TRENDYOL'
),
tariff_data (carrier_code, desi, price_net) AS (
  VALUES
    -- ARASMP (Aras)
    ('ARASMP', 0, 83.93), ('ARASMP', 1, 83.93), ('ARASMP', 2, 83.93), ('ARASMP', 3, 95.12),
    ('ARASMP', 4, 103.68), ('ARASMP', 5, 111.17), ('ARASMP', 6, 121.12), ('ARASMP', 7, 128.46),
    ('ARASMP', 8, 137.05), ('ARASMP', 9, 144.91), ('ARASMP', 10, 153.48), ('ARASMP', 11, 161.77),
    ('ARASMP', 12, 167.73),
    -- DHLECOMMP (DHL eCommerce)
    ('DHLECOMMP', 0, 92.99), ('DHLECOMMP', 1, 92.99), ('DHLECOMMP', 2, 92.99), ('DHLECOMMP', 3, 103.99),
    ('DHLECOMMP', 4, 116.99), ('DHLECOMMP', 5, 129.99), ('DHLECOMMP', 6, 141.99), ('DHLECOMMP', 7, 149.99),
    ('DHLECOMMP', 8, 159.99), ('DHLECOMMP', 9, 169.99), ('DHLECOMMP', 10, 176.99), ('DHLECOMMP', 11, 184.99),
    ('DHLECOMMP', 12, 194.99),
    -- SENDEOMP (Kolay Gelsin)
    ('SENDEOMP', 0, 91.99), ('SENDEOMP', 1, 91.99), ('SENDEOMP', 2, 91.99), ('SENDEOMP', 3, 101.99),
    ('SENDEOMP', 4, 112.99), ('SENDEOMP', 5, 121.99), ('SENDEOMP', 6, 131.99), ('SENDEOMP', 7, 140.99),
    ('SENDEOMP', 8, 150.99), ('SENDEOMP', 9, 159.99), ('SENDEOMP', 10, 170.99), ('SENDEOMP', 11, 180.99),
    ('SENDEOMP', 12, 191.99),
    -- PTTMP
    ('PTTMP', 0, 77.54), ('PTTMP', 1, 77.54), ('PTTMP', 2, 77.54), ('PTTMP', 3, 96.00),
    ('PTTMP', 4, 96.00), ('PTTMP', 5, 100.55), ('PTTMP', 6, 106.83), ('PTTMP', 7, 113.15),
    ('PTTMP', 8, 125.73), ('PTTMP', 9, 138.34), ('PTTMP', 10, 157.26), ('PTTMP', 11, 165.01),
    ('PTTMP', 12, 173.31),
    -- SURATMP
    ('SURATMP', 0, 89.71), ('SURATMP', 1, 89.71), ('SURATMP', 2, 89.71), ('SURATMP', 3, 99.96),
    ('SURATMP', 4, 109.30), ('SURATMP', 5, 114.94), ('SURATMP', 6, 126.28), ('SURATMP', 7, 134.85),
    ('SURATMP', 8, 143.29), ('SURATMP', 9, 151.87), ('SURATMP', 10, 160.43), ('SURATMP', 11, 171.83),
    ('SURATMP', 12, 181.55),
    -- TEXMP (Trendyol Express)
    ('TEXMP', 0, 77.54), ('TEXMP', 1, 77.54), ('TEXMP', 2, 77.54), ('TEXMP', 3, 93.63),
    ('TEXMP', 4, 101.46), ('TEXMP', 5, 107.98), ('TEXMP', 6, 118.30), ('TEXMP', 7, 125.66),
    ('TEXMP', 8, 134.21), ('TEXMP', 9, 142.42), ('TEXMP', 10, 153.47), ('TEXMP', 11, 162.13),
    ('TEXMP', 12, 170.33),
    -- YKMP (Yurtiçi)
    ('YKMP', 0, 112.77), ('YKMP', 1, 112.77), ('YKMP', 2, 112.77), ('YKMP', 3, 120.56),
    ('YKMP', 4, 123.15), ('YKMP', 5, 142.91), ('YKMP', 6, 149.82), ('YKMP', 7, 169.44),
    ('YKMP', 8, 175.96), ('YKMP', 9, 186.86), ('YKMP', 10, 195.12), ('YKMP', 11, 207.75),
    ('YKMP', 12, 220.80),
    -- CEVATEDARIK
    ('CEVATEDARIK', 0, 494.22), ('CEVATEDARIK', 1, 494.22), ('CEVATEDARIK', 2, 494.22),
    ('CEVATEDARIK', 3, 494.22), ('CEVATEDARIK', 4, 494.22), ('CEVATEDARIK', 5, 494.22),
    ('CEVATEDARIK', 6, 494.22), ('CEVATEDARIK', 7, 494.22), ('CEVATEDARIK', 8, 494.22),
    ('CEVATEDARIK', 9, 494.22), ('CEVATEDARIK', 10, 494.22), ('CEVATEDARIK', 11, 494.22),
    ('CEVATEDARIK', 12, 494.22),
    -- CEVAMP
    ('CEVAMP', 0, 651.74), ('CEVAMP', 1, 651.74), ('CEVAMP', 2, 651.74),
    ('CEVAMP', 3, 651.74), ('CEVAMP', 4, 651.74), ('CEVAMP', 5, 651.74),
    ('CEVAMP', 6, 651.74), ('CEVAMP', 7, 651.74), ('CEVAMP', 8, 651.74),
    ('CEVAMP', 9, 651.74), ('CEVAMP', 10, 651.74), ('CEVAMP', 11, 651.74),
    ('CEVAMP', 12, 651.74),
    -- HOROZMP
    ('HOROZMP', 0, 599.13), ('HOROZMP', 1, 599.13), ('HOROZMP', 2, 599.13),
    ('HOROZMP', 3, 599.13), ('HOROZMP', 4, 599.13), ('HOROZMP', 5, 599.13),
    ('HOROZMP', 6, 599.13), ('HOROZMP', 7, 599.13), ('HOROZMP', 8, 599.13),
    ('HOROZMP', 9, 599.13), ('HOROZMP', 10, 599.13), ('HOROZMP', 11, 599.13),
    ('HOROZMP', 12, 599.13)
)
INSERT INTO "shipping_desi_tariffs" (id, carrier_id, desi, price_net, effective_from, created_at, updated_at)
SELECT gen_random_uuid(), c.id, td.desi, td.price_net, '2026-04-15'::date, now(), now()
FROM tariff_data td
JOIN carriers c ON c.code = td.carrier_code;
```

Note: rates verified against the screenshot 1 you provided (15 Nisan 2026 effective). When Trendyol updates, run `UPDATE shipping_desi_tariffs SET price_net = ... WHERE ...`.

### Task 1.9: Append Barem tariff seed data

**Files:**

- Modify: same migration.sql

- [ ] **Step 1: Add Barem INSERTs (26 Mart 2026 prices)**

Append below desi tariffs. Only carriers with `supportsBaremDestek=true` get rows. successTier (best price) only — per spec §2 decision 4:

```sql
-- ─── Seed: shipping_barem_tariffs — Trendyol Kargo Barem Destek (26 Mart 2026, KDV hariç TL) ───
-- Sadece "başarılı tier" fiyatları (1-gün termin + hızlı teslimat + zamanında teslim varsayımı).
-- Settlement gerçek değeri faturadan alır (spec §11/12).
WITH carriers AS (
  SELECT id, code FROM "shipping_carriers" WHERE supports_barem_destek = true
),
barem_data (carrier_code, min_amount, max_amount, price_net) AS (
  VALUES
    -- 0 - 199,99 TL paketler — başarılı tier
    ('TEXMP',     0.00, 200.00, 34.16), ('PTTMP',     0.00, 200.00, 34.16),
    ('ARASMP',    0.00, 200.00, 42.91), ('SURATMP',   0.00, 200.00, 48.74),
    ('SENDEOMP',  0.00, 200.00, 51.24), ('DHLECOMMP', 0.00, 200.00, 52.08),
    ('YKMP',      0.00, 200.00, 74.58),
    -- 200 - 349,99 TL paketler — başarılı tier
    ('TEXMP',     200.00, 350.00, 65.83), ('PTTMP',     200.00, 350.00, 65.83),
    ('ARASMP',    200.00, 350.00, 73.74), ('SURATMP',   200.00, 350.00, 79.58),
    ('SENDEOMP',  200.00, 350.00, 82.08), ('DHLECOMMP', 200.00, 350.00, 82.91),
    ('YKMP',      200.00, 350.00, 104.58)
)
INSERT INTO "shipping_barem_tariffs" (id, carrier_id, min_order_amount, max_order_amount, price_net, effective_from, created_at, updated_at)
SELECT gen_random_uuid(), c.id, bd.min_amount, bd.max_amount, bd.price_net, '2026-03-26'::date, now(), now()
FROM barem_data bd
JOIN carriers c ON c.code = bd.carrier_code;
```

### Task 1.10: Apply migration locally + verify seed

**Files:**

- (DB state change)

- [ ] **Step 1: Apply migration**

Run: `pnpm --filter @pazarsync/db prisma migrate dev`
Expected: "Already in sync, no schema change" then applies the seed-augmented migration. If it complains about prior state, run `pnpm db:push` after `prisma migrate reset` (CAUTION: drops dev DB).

- [ ] **Step 2: Verify seed**

Run: `psql "postgresql://postgres:postgres@localhost:54322/postgres" -c "SELECT code, supports_barem_destek FROM shipping_carriers ORDER BY sort_order;"`
Expected: 10 rows. SENDEOMP supports Barem, CEVAMP / CEVATEDARIK / HOROZMP do not.

Run: `psql "postgresql://postgres:postgres@localhost:54322/postgres" -c "SELECT COUNT(*) FROM shipping_desi_tariffs;"`
Expected: 130 (10 carriers × 13 desi rows).

Run: `psql "postgresql://postgres:postgres@localhost:54322/postgres" -c "SELECT COUNT(*) FROM shipping_barem_tariffs;"`
Expected: 14 (7 Barem-eligible × 2 tiers).

### Task 1.11: Append RLS policies

**Files:**

- Modify: `supabase/sql/rls-policies.sql` (append at end)

- [ ] **Step 1: Append 4 policy blocks**

Open `supabase/sql/rls-policies.sql`, scroll to bottom, append:

```sql
-- ─── shipping_carriers — global reference, public read for authenticated ───
ALTER TABLE shipping_carriers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shipping_carriers_authenticated_read ON shipping_carriers;
CREATE POLICY shipping_carriers_authenticated_read ON shipping_carriers
  FOR SELECT TO authenticated USING (true);

-- ─── shipping_desi_tariffs — global ───
ALTER TABLE shipping_desi_tariffs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shipping_desi_tariffs_authenticated_read ON shipping_desi_tariffs;
CREATE POLICY shipping_desi_tariffs_authenticated_read ON shipping_desi_tariffs
  FOR SELECT TO authenticated USING (true);

-- ─── shipping_barem_tariffs — global ───
ALTER TABLE shipping_barem_tariffs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS shipping_barem_tariffs_authenticated_read ON shipping_barem_tariffs;
CREATE POLICY shipping_barem_tariffs_authenticated_read ON shipping_barem_tariffs
  FOR SELECT TO authenticated USING (true);

-- ─── own_shipping_tariffs — org-private ───
ALTER TABLE own_shipping_tariffs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS own_shipping_tariffs_org_member_read ON own_shipping_tariffs;
CREATE POLICY own_shipping_tariffs_org_member_read ON own_shipping_tariffs
  FOR SELECT TO authenticated
  USING (is_org_member(organization_id));
```

- [ ] **Step 2: Apply policies**

Run: `pnpm --filter @pazarsync/db tsx scripts/apply-policies.ts`
Expected: "Applied X policies" output. No errors.

- [ ] **Step 3: Verify policies exist**

Run: `psql "postgresql://postgres:postgres@localhost:54322/postgres" -c "SELECT tablename, policyname FROM pg_policies WHERE tablename LIKE 'shipping_%' OR tablename = 'own_shipping_tariffs' ORDER BY tablename;"`
Expected: 4 rows, one policy per table.

### Task 1.12: Add `own_shipping_tariffs` to RLS coverage test

**Files:**

- Modify: `apps/api/tests/integration/rls/coverage.rls.test.ts` (TENANT_TABLES array)

- [ ] **Step 1: Append to TENANT_TABLES**

Edit the `TENANT_TABLES` array. Add `'own_shipping_tariffs',` before the closing `]`:

```ts
const TENANT_TABLES = [
  'user_profiles',
  'organizations',
  'organization_members',
  'stores',
  'products',
  'product_variants',
  'product_images',
  'orders',
  'order_items',
  'expenses',
  'settlements',
  'settlement_items',
  'sync_logs',
  'own_shipping_tariffs',
] as const;
```

- [ ] **Step 2: Run coverage test**

Run: `pnpm --filter @pazarsync/api vitest run apps/api/tests/integration/rls/coverage.rls.test.ts`
Expected: PASS. If FAIL on `own_shipping_tariffs`, the policy from Task 1.11 didn't apply — investigate before continuing.

### Task 1.13: Write RLS isolation test for `own_shipping_tariffs`

**Files:**

- Create: `apps/api/tests/integration/rls/own-shipping-tariffs.rls.test.ts`

- [ ] **Step 1: Write test**

```ts
import { prisma } from '@pazarsync/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ensureDbReachable, truncateAll } from '../../helpers/db';
import {
  createOrganization,
  createStore,
  createAuthenticatedTestUser,
  attachMembership,
} from '../../helpers/factories';
import { createRlsScopedClient } from '../../helpers/rls-client';

describe('RLS — own_shipping_tariffs', () => {
  beforeAll(ensureDbReachable);
  beforeEach(truncateAll);

  it('org A user cannot read org B own_shipping_tariffs', async () => {
    const orgA = await createOrganization();
    const orgB = await createOrganization();
    const userA = await createAuthenticatedTestUser({ email: 'a@example.com' });
    await attachMembership(userA.id, orgA.id, 'OWNER');

    const storeB = await createStore({ organizationId: orgB.id });
    await prisma.ownShippingTariff.create({
      data: {
        organizationId: orgB.id,
        storeId: storeB.id,
        desi: 1,
        priceNet: '50.00',
      },
    });

    const scopedClient = createRlsScopedClient(userA.accessToken);
    const { data, error } = await scopedClient.from('own_shipping_tariffs').select('*');

    expect(error).toBeNull();
    expect(data).toEqual([]); // org A sees nothing of org B
  });

  it('org A user reads org A own_shipping_tariffs', async () => {
    const orgA = await createOrganization();
    const userA = await createAuthenticatedTestUser({ email: 'a2@example.com' });
    await attachMembership(userA.id, orgA.id, 'OWNER');

    const storeA = await createStore({ organizationId: orgA.id });
    await prisma.ownShippingTariff.create({
      data: { organizationId: orgA.id, storeId: storeA.id, desi: 2, priceNet: '75.00' },
    });

    const scopedClient = createRlsScopedClient(userA.accessToken);
    const { data, error } = await scopedClient.from('own_shipping_tariffs').select('*');

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0].desi).toBe(2);
  });
});
```

- [ ] **Step 2: Run test**

Run: `pnpm --filter @pazarsync/api vitest run apps/api/tests/integration/rls/own-shipping-tariffs.rls.test.ts`
Expected: 2 tests PASS.

### Task 1.14: Commit PR 1

- [ ] **Step 1: Typecheck**

Run: `pnpm --filter @pazarsync/db typecheck && pnpm --filter @pazarsync/api typecheck`
Expected: no errors.

- [ ] **Step 2: Stage**

```bash
git add packages/db/prisma/schema.prisma \
        packages/db/prisma/migrations/ \
        supabase/sql/rls-policies.sql \
        apps/api/tests/integration/rls/coverage.rls.test.ts \
        apps/api/tests/integration/rls/own-shipping-tariffs.rls.test.ts
```

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(shipping): add shipping tariff schema, RLS, and Trendyol seed data

Adds ShippingCarrier (10 from getProviders), ShippingDesiTariff (130 rows),
ShippingBaremTariff (14 rows, başarılı tier only), OwnShippingTariff
(tenant-private, V1 empty), Store fields shipping_tariff_source +
default_shipping_carrier_id. RLS policies for all four. own_shipping_tariffs
added to coverage test. Per design spec
docs/superpowers/specs/2026-05-17-shipping-cost-estimation-design.md §4.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# PR 2 — Estimator Service

**Goal:** Pure-function service that resolves an estimate from variant + store config + tariff data. Fully unit-tested.

### Task 2.1: Module skeleton with types

**Files:**

- Create: `apps/api/src/services/shipping-estimator.service.ts`

- [ ] **Step 1: Write skeleton**

```ts
import { Decimal } from 'decimal.js';
import type { Prisma } from '@pazarsync/db';

export interface ShippingEstimate {
  amount: Decimal;
  carrierCode: string;
  tariffApplied: 'NORMAL' | 'BAREM' | 'OWN_CONTRACT';
  sourceTariffId: string | null;
  baseDesiAtEstimate: Decimal;
}

export type EstimateUnavailableReason =
  | 'STORE_NOT_FOUND'
  | 'NO_CARRIER'
  | 'NO_DESI'
  | 'DESI_OVERFLOW'
  | 'OWN_CONTRACT_EMPTY';

export type EstimateOutcome =
  | { ok: true; estimate: ShippingEstimate }
  | { ok: false; reason: EstimateUnavailableReason };

export async function estimateShippingCostForVariant(
  variantId: string,
  tx: Prisma.TransactionClient,
): Promise<EstimateOutcome> {
  throw new Error('not implemented');
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @pazarsync/api typecheck`
Expected: success (only the skeleton, no usage yet).

### Task 2.2: Write `hasFastDeliverySetup` helper + tests

**Files:**

- Create: `apps/api/src/services/__tests__/shipping-estimator-helpers.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, expect, it } from 'vitest';
import { hasFastDeliverySetup } from '../shipping-estimator.service';

describe('hasFastDeliverySetup', () => {
  const carrier = { maxBaremEligibleDeliveryDuration: 1 } as never;

  it('returns true when deliveryDuration ≤ carrier max', () => {
    const variant = {
      deliveryDuration: 1,
      isRushDelivery: false,
      fastDeliveryOptions: [],
    } as never;
    expect(hasFastDeliverySetup(variant, carrier)).toBe(true);
  });

  it('returns true when isRushDelivery is true', () => {
    const variant = { deliveryDuration: 5, isRushDelivery: true, fastDeliveryOptions: [] } as never;
    expect(hasFastDeliverySetup(variant, carrier)).toBe(true);
  });

  it('returns true when fastDeliveryOptions is non-empty', () => {
    const variant = {
      deliveryDuration: 5,
      isRushDelivery: false,
      fastDeliveryOptions: ['Today'],
    } as never;
    expect(hasFastDeliverySetup(variant, carrier)).toBe(true);
  });

  it('returns false when nothing qualifies', () => {
    const variant = {
      deliveryDuration: 5,
      isRushDelivery: false,
      fastDeliveryOptions: [],
    } as never;
    expect(hasFastDeliverySetup(variant, carrier)).toBe(false);
  });

  it('returns false when deliveryDuration is null and no other indicators', () => {
    const variant = {
      deliveryDuration: null,
      isRushDelivery: false,
      fastDeliveryOptions: [],
    } as never;
    expect(hasFastDeliverySetup(variant, carrier)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test (fails — function not exported)**

Run: `pnpm --filter @pazarsync/api vitest run apps/api/src/services/__tests__/shipping-estimator-helpers.test.ts`
Expected: FAIL with import error.

- [ ] **Step 3: Implement helper**

Append to `apps/api/src/services/shipping-estimator.service.ts`:

```ts
export function hasFastDeliverySetup(
  variant: {
    deliveryDuration: number | null;
    isRushDelivery: boolean;
    fastDeliveryOptions: unknown;
  },
  carrier: { maxBaremEligibleDeliveryDuration: number },
): boolean {
  if (
    variant.deliveryDuration !== null &&
    variant.deliveryDuration <= carrier.maxBaremEligibleDeliveryDuration
  ) {
    return true;
  }
  if (variant.isRushDelivery === true) return true;
  if (Array.isArray(variant.fastDeliveryOptions) && variant.fastDeliveryOptions.length > 0)
    return true;
  return false;
}
```

- [ ] **Step 4: Run test**

Run: `pnpm --filter @pazarsync/api vitest run apps/api/src/services/__tests__/shipping-estimator-helpers.test.ts`
Expected: 5 PASS.

### Task 2.3: Estimator — STORE_NOT_FOUND branch

**Files:**

- Create: `apps/api/src/services/__tests__/shipping-estimator.service.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { Decimal } from 'decimal.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@pazarsync/db';

import { estimateShippingCostForVariant } from '../shipping-estimator.service';
import { ensureDbReachable, truncateAll } from '../../../tests/helpers/db';

describe('estimateShippingCostForVariant — failure modes', () => {
  beforeAll(ensureDbReachable);
  beforeEach(truncateAll);

  it('returns STORE_NOT_FOUND when variant.store missing', async () => {
    // call with random uuid (no variant exists)
    const outcome = await prisma.$transaction(async (tx) => {
      return estimateShippingCostForVariant('00000000-0000-0000-0000-000000000000', tx);
    });
    expect(outcome).toEqual({ ok: false, reason: 'STORE_NOT_FOUND' });
  });
});
```

- [ ] **Step 2: Run test, see fail (function still throws)**

Run: `pnpm --filter @pazarsync/api vitest run apps/api/src/services/__tests__/shipping-estimator.service.test.ts`
Expected: FAIL "not implemented".

- [ ] **Step 3: Implement STORE_NOT_FOUND branch**

Replace `throw new Error('not implemented')` with:

```ts
const variant = await tx.productVariant.findUnique({
  where: { id: variantId },
  include: { store: { include: { defaultShippingCarrier: true } } },
});
if (!variant?.store) return { ok: false, reason: 'STORE_NOT_FOUND' };

// TODO: rest of branches
throw new Error('not implemented');
```

- [ ] **Step 4: Run test passes**

Run: `pnpm --filter @pazarsync/api vitest run apps/api/src/services/__tests__/shipping-estimator.service.test.ts`
Expected: PASS.

### Task 2.4: NO_CARRIER branch (TRENDYOL_CONTRACT, no carrier set)

**Files:**

- Modify: same test file + service file

- [ ] **Step 1: Write failing test**

Append inside `describe`:

```ts
it('returns NO_CARRIER when TRENDYOL_CONTRACT and no defaultShippingCarrierId', async () => {
  const org = await prisma.organization.create({ data: { name: 'T', slug: 'test-' + Date.now() } });
  const store = await prisma.store.create({
    data: {
      organizationId: org.id,
      name: 'Test',
      platform: 'TRENDYOL',
      externalAccountId: 'x',
      credentials: {},
      shippingTariffSource: 'TRENDYOL_CONTRACT',
    },
  });
  const product = await prisma.product.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      platformContentId: 1n,
      productMainId: 'p1',
      title: 'T',
    },
  });
  const variant = await prisma.productVariant.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      productId: product.id,
      platformVariantId: 1n,
      barcode: 'b1',
      stockCode: 's1',
      salePrice: '100',
      listPrice: '100',
      dimensionalWeight: '1.0',
      isRushDelivery: true,
      fastDeliveryOptions: [],
      attributes: [],
    },
  });

  const outcome = await prisma.$transaction((tx) => estimateShippingCostForVariant(variant.id, tx));
  expect(outcome).toEqual({ ok: false, reason: 'NO_CARRIER' });
});
```

- [ ] **Step 2: Run test (fails — still hits the TODO)**

Run: same vitest command. Expected: FAIL with "not implemented".

- [ ] **Step 3: Implement NO_CARRIER branch**

In `shipping-estimator.service.ts`, replace the TODO with:

```ts
if (variant.store.shippingTariffSource === 'OWN_CONTRACT') {
  // TODO: OWN_CONTRACT branch
  throw new Error('not implemented');
}

const carrier = variant.store.defaultShippingCarrier;
if (!carrier) return { ok: false, reason: 'NO_CARRIER' };

// TODO: TRENDYOL_CONTRACT happy path
throw new Error('not implemented');
```

- [ ] **Step 4: Run test passes**

Expected: 2 PASS.

### Task 2.5: NO_DESI branch

**Files:**

- Modify: same files

- [ ] **Step 1: Test**

Append:

```ts
it('returns NO_DESI when variant has no dimensional weight', async () => {
  // ... create org, carrier, store-with-carrier, product, variant WITHOUT desi
  const carrier = await prisma.shippingCarrier.findFirst({ where: { code: 'SENDEOMP' } });
  const org = await prisma.organization.create({ data: { name: 'T', slug: 's-' + Date.now() } });
  const store = await prisma.store.create({
    data: {
      organizationId: org.id,
      name: 'T',
      platform: 'TRENDYOL',
      externalAccountId: 'x',
      credentials: {},
      shippingTariffSource: 'TRENDYOL_CONTRACT',
      defaultShippingCarrierId: carrier!.id,
    },
  });
  const product = await prisma.product.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      platformContentId: 2n,
      productMainId: 'p',
      title: 't',
    },
  });
  const variant = await prisma.productVariant.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      productId: product.id,
      platformVariantId: 2n,
      barcode: 'b2',
      stockCode: 's2',
      salePrice: '100',
      listPrice: '100',
      dimensionalWeight: null,
      syncedDimensionalWeight: null,
      isRushDelivery: false,
      fastDeliveryOptions: [],
      attributes: [],
    },
  });

  const outcome = await prisma.$transaction((tx) => estimateShippingCostForVariant(variant.id, tx));
  expect(outcome).toEqual({ ok: false, reason: 'NO_DESI' });
});
```

- [ ] **Step 2: Run (fails)**

Expected: FAIL "not implemented".

- [ ] **Step 3: Implement NO_DESI**

Replace the TODO TRENDYOL line with:

```ts
const desi = variant.dimensionalWeight ?? variant.syncedDimensionalWeight;
if (!desi) return { ok: false, reason: 'NO_DESI' };

// TODO: Barem path + normal desi path
throw new Error('not implemented');
```

- [ ] **Step 4: Run, pass**

Expected: 3 PASS.

### Task 2.6: Happy path — normal desi tariff (no Barem)

**Files:**

- Same.

- [ ] **Step 1: Test**

```ts
it('returns NORMAL tariff when not Barem-eligible (high salePrice)', async () => {
  const carrier = await prisma.shippingCarrier.findFirst({ where: { code: 'SENDEOMP' } });
  const org = await prisma.organization.create({ data: { name: 'X', slug: 'x-' + Date.now() } });
  const store = await prisma.store.create({
    data: {
      organizationId: org.id,
      name: 'X',
      platform: 'TRENDYOL',
      externalAccountId: 'x',
      credentials: {},
      shippingTariffSource: 'TRENDYOL_CONTRACT',
      defaultShippingCarrierId: carrier!.id,
    },
  });
  const product = await prisma.product.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      platformContentId: 3n,
      productMainId: 'p',
      title: 't',
    },
  });
  const variant = await prisma.productVariant.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      productId: product.id,
      platformVariantId: 3n,
      barcode: 'b3',
      stockCode: 's3',
      salePrice: '500', // ≥ 350, no Barem
      listPrice: '500',
      dimensionalWeight: '3.5',
      isRushDelivery: true,
      fastDeliveryOptions: [],
      attributes: [],
    },
  });

  const outcome = await prisma.$transaction((tx) => estimateShippingCostForVariant(variant.id, tx));
  expect(outcome.ok).toBe(true);
  if (!outcome.ok) throw new Error('unreachable');
  expect(outcome.estimate.tariffApplied).toBe('NORMAL');
  expect(outcome.estimate.carrierCode).toBe('SENDEOMP');
  expect(outcome.estimate.amount.toString()).toBe('112.99'); // desi 4 (ceil 3.5) SENDEOMP from seed
});
```

- [ ] **Step 2: Fails (no NORMAL impl)**

Expected: FAIL.

- [ ] **Step 3: Implement happy path + DESI_OVERFLOW**

Replace TODO with:

```ts
// Barem path — all thresholds DB-driven
if (
  carrier.supportsBaremDestek &&
  desi.lte(carrier.maxBaremDesi) &&
  hasFastDeliverySetup(variant, carrier)
) {
  const barem = await tx.shippingBaremTariff.findFirst({
    where: {
      carrierId: carrier.id,
      minOrderAmount: { lte: variant.salePrice.toString() },
      maxOrderAmount: { gt: variant.salePrice.toString() },
    },
  });
  if (barem) {
    return {
      ok: true,
      estimate: {
        amount: new Decimal(barem.priceNet.toString()),
        carrierCode: carrier.code,
        tariffApplied: 'BAREM',
        sourceTariffId: barem.id,
        baseDesiAtEstimate: new Decimal(desi.toString()),
      },
    };
  }
  // salePrice outside any Barem range → fall through
}

const desiCeil = Math.ceil(Number(desi));
const desiRow = await tx.shippingDesiTariff.findFirst({
  where: { carrierId: carrier.id, desi: desiCeil },
});
if (!desiRow) return { ok: false, reason: 'DESI_OVERFLOW' };

return {
  ok: true,
  estimate: {
    amount: new Decimal(desiRow.priceNet.toString()),
    carrierCode: carrier.code,
    tariffApplied: 'NORMAL',
    sourceTariffId: desiRow.id,
    baseDesiAtEstimate: new Decimal(desi.toString()),
  },
};
```

- [ ] **Step 4: Run, pass**

Expected: 4 PASS (the NORMAL test).

### Task 2.7: Barem path matched

**Files:**

- Same.

- [ ] **Step 1: Test**

```ts
it('returns BAREM tier-1 when salePrice<200 and eligible', async () => {
  const carrier = await prisma.shippingCarrier.findFirst({ where: { code: 'SENDEOMP' } });
  const org = await prisma.organization.create({ data: { name: 'B', slug: 'b-' + Date.now() } });
  const store = await prisma.store.create({
    data: {
      organizationId: org.id,
      name: 'B',
      platform: 'TRENDYOL',
      externalAccountId: 'x',
      credentials: {},
      shippingTariffSource: 'TRENDYOL_CONTRACT',
      defaultShippingCarrierId: carrier!.id,
    },
  });
  const product = await prisma.product.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      platformContentId: 4n,
      productMainId: 'p',
      title: 't',
    },
  });
  const variant = await prisma.productVariant.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      productId: product.id,
      platformVariantId: 4n,
      barcode: 'b4',
      stockCode: 's4',
      salePrice: '150',
      listPrice: '150',
      dimensionalWeight: '2.0',
      deliveryDuration: 1,
      isRushDelivery: false,
      fastDeliveryOptions: [],
      attributes: [],
    },
  });

  const outcome = await prisma.$transaction((tx) => estimateShippingCostForVariant(variant.id, tx));
  expect(outcome.ok).toBe(true);
  if (!outcome.ok) throw new Error('unreachable');
  expect(outcome.estimate.tariffApplied).toBe('BAREM');
  expect(outcome.estimate.amount.toString()).toBe('51.24'); // SENDEOMP 0-200 from seed
});
```

- [ ] **Step 2 & 3:** Test should already pass with Task 2.6's impl. If FAIL, debug — most likely the Barem WHERE clause uses Prisma Decimal comparison incorrectly. Test the SQL manually:

```sql
SELECT * FROM shipping_barem_tariffs WHERE carrier_id = '...' AND min_order_amount <= '150' AND max_order_amount > '150';
```

- [ ] **Step 4: Verify pass**

Expected: 5 PASS total.

### Task 2.8: Barem-eligible but salePrice out of Barem range (fall-through)

**Files:**

- Same.

- [ ] **Step 1: Test**

```ts
it('falls through to NORMAL when Barem-eligible but salePrice ≥ Barem max', async () => {
  const carrier = await prisma.shippingCarrier.findFirst({ where: { code: 'SENDEOMP' } });
  const org = await prisma.organization.create({ data: { name: 'F', slug: 'f-' + Date.now() } });
  const store = await prisma.store.create({
    data: {
      organizationId: org.id,
      name: 'F',
      platform: 'TRENDYOL',
      externalAccountId: 'x',
      credentials: {},
      shippingTariffSource: 'TRENDYOL_CONTRACT',
      defaultShippingCarrierId: carrier!.id,
    },
  });
  const product = await prisma.product.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      platformContentId: 5n,
      productMainId: 'p',
      title: 't',
    },
  });
  const variant = await prisma.productVariant.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      productId: product.id,
      platformVariantId: 5n,
      barcode: 'b5',
      stockCode: 's5',
      salePrice: '400',
      listPrice: '400',
      dimensionalWeight: '2.0',
      deliveryDuration: 1,
      isRushDelivery: false,
      fastDeliveryOptions: [],
      attributes: [],
    },
  });

  const outcome = await prisma.$transaction((tx) => estimateShippingCostForVariant(variant.id, tx));
  expect(outcome.ok).toBe(true);
  if (!outcome.ok) throw new Error('unreachable');
  expect(outcome.estimate.tariffApplied).toBe('NORMAL'); // fell through
});
```

- [ ] **Step 2-4:** Existing impl handles this — Barem `findFirst` returns null, fall-through hits desi-row.

Expected: 6 PASS.

### Task 2.9: DESI_OVERFLOW

**Files:**

- Same.

- [ ] **Step 1: Test**

```ts
it('returns DESI_OVERFLOW when desi exceeds tariff table', async () => {
  const carrier = await prisma.shippingCarrier.findFirst({ where: { code: 'SENDEOMP' } });
  const org = await prisma.organization.create({ data: { name: 'O', slug: 'o-' + Date.now() } });
  const store = await prisma.store.create({
    data: {
      organizationId: org.id,
      name: 'O',
      platform: 'TRENDYOL',
      externalAccountId: 'x',
      credentials: {},
      shippingTariffSource: 'TRENDYOL_CONTRACT',
      defaultShippingCarrierId: carrier!.id,
    },
  });
  const product = await prisma.product.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      platformContentId: 6n,
      productMainId: 'p',
      title: 't',
    },
  });
  const variant = await prisma.productVariant.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      productId: product.id,
      platformVariantId: 6n,
      barcode: 'b6',
      stockCode: 's6',
      salePrice: '1500',
      listPrice: '1500',
      dimensionalWeight: '20.0',
      isRushDelivery: false,
      fastDeliveryOptions: [],
      attributes: [],
    },
  });

  const outcome = await prisma.$transaction((tx) => estimateShippingCostForVariant(variant.id, tx));
  expect(outcome).toEqual({ ok: false, reason: 'DESI_OVERFLOW' });
});
```

- [ ] **Step 2-4:** Existing impl handles. Expected: 7 PASS.

### Task 2.10: OWN_CONTRACT_EMPTY

**Files:**

- Same.

- [ ] **Step 1: Test**

```ts
it('returns OWN_CONTRACT_EMPTY when source is OWN_CONTRACT and no tariff rows', async () => {
  const org = await prisma.organization.create({ data: { name: 'OC', slug: 'oc-' + Date.now() } });
  const store = await prisma.store.create({
    data: {
      organizationId: org.id,
      name: 'OC',
      platform: 'TRENDYOL',
      externalAccountId: 'x',
      credentials: {},
      shippingTariffSource: 'OWN_CONTRACT',
    },
  });
  const product = await prisma.product.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      platformContentId: 7n,
      productMainId: 'p',
      title: 't',
    },
  });
  const variant = await prisma.productVariant.create({
    data: {
      organizationId: org.id,
      storeId: store.id,
      productId: product.id,
      platformVariantId: 7n,
      barcode: 'b7',
      stockCode: 's7',
      salePrice: '100',
      listPrice: '100',
      dimensionalWeight: '1.0',
      isRushDelivery: false,
      fastDeliveryOptions: [],
      attributes: [],
    },
  });

  const outcome = await prisma.$transaction((tx) => estimateShippingCostForVariant(variant.id, tx));
  expect(outcome).toEqual({ ok: false, reason: 'OWN_CONTRACT_EMPTY' });
});
```

- [ ] **Step 2: Fails (still throws "not implemented" in OWN_CONTRACT branch)**

- [ ] **Step 3: Implement OWN_CONTRACT branch**

Replace OWN_CONTRACT TODO with:

```ts
if (variant.store.shippingTariffSource === 'OWN_CONTRACT') {
  const desi = variant.dimensionalWeight ?? variant.syncedDimensionalWeight;
  if (!desi) return { ok: false, reason: 'NO_DESI' };

  const desiCeil = Math.ceil(Number(desi));
  const row = await tx.ownShippingTariff.findUnique({
    where: { storeId_desi: { storeId: variant.store.id, desi: desiCeil } },
  });
  if (!row) return { ok: false, reason: 'OWN_CONTRACT_EMPTY' };

  return {
    ok: true,
    estimate: {
      amount: new Decimal(row.priceNet.toString()),
      carrierCode: 'OWN',
      tariffApplied: 'OWN_CONTRACT',
      sourceTariffId: row.id,
      baseDesiAtEstimate: new Decimal(desi.toString()),
    },
  };
}
```

- [ ] **Step 4: Run, pass**

Expected: 8 PASS.

### Task 2.11: V2 placeholder for order-level estimator

**Files:**

- Modify: `shipping-estimator.service.ts`

- [ ] **Step 1: Add placeholder export**

Append:

```ts
/**
 * V2: Order-level estimator. Reads MAX(items[].variant.dimensionalWeight) for
 * package desi, uses order.totalAmount for Barem range. NOT implemented in V1 —
 * the orders feature lands with sync integration. Signature kept stable so V2
 * callers can wire it in without breaking V1.
 */
export async function estimateShippingCostForOrder(
  _orderId: string,
  _tx: Prisma.TransactionClient,
): Promise<EstimateOutcome> {
  throw new Error('estimateShippingCostForOrder: implemented in V2 (orders integration)');
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @pazarsync/api typecheck`
Expected: success.

### Task 2.12: Commit PR 2

- [ ] **Step 1: Run all new tests**

```bash
pnpm --filter @pazarsync/api vitest run \
  apps/api/src/services/__tests__/shipping-estimator.service.test.ts \
  apps/api/src/services/__tests__/shipping-estimator-helpers.test.ts
```

Expected: 13 PASS (8 estimator + 5 helpers).

- [ ] **Step 2: Stage + commit**

```bash
git add apps/api/src/services/shipping-estimator.service.ts \
        apps/api/src/services/__tests__/shipping-estimator.service.test.ts \
        apps/api/src/services/__tests__/shipping-estimator-helpers.test.ts
git commit -m "$(cat <<'EOF'
feat(shipping): add estimator service with all branch coverage

Pure service resolving ShippingEstimate from variant + store config +
tariff data. Covers TRENDYOL_CONTRACT (normal desi + Barem matched +
Barem fall-through), OWN_CONTRACT empty (V1), all 5 failure modes
(STORE_NOT_FOUND, NO_CARRIER, NO_DESI, DESI_OVERFLOW, OWN_CONTRACT_EMPTY).
hasFastDeliverySetup helper with table-driven tests. V2 order-level
signature stubbed.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# PR 3 — Backend Routes + Tenant Isolation

**Goal:** Expose 4 routes for the frontend. Cross-platform carrier guard at service layer. Full tenant isolation suite.

### Task 3.1: Validator schemas

**Files:**

- Create: `apps/api/src/validators/shipping-config.validator.ts`

- [ ] **Step 1: Write**

```ts
import { z } from '@hono/zod-openapi';
import { ShippingTariffSource } from '@pazarsync/db';

export const ShippingTariffSourceSchema = z
  .nativeEnum(ShippingTariffSource)
  .openapi('ShippingTariffSource');

export const ShippingCarrierSchema = z
  .object({
    id: z.string().uuid(),
    platform: z.string(),
    externalId: z.number().int(),
    code: z.string(),
    displayName: z.string(),
    supportsBaremDestek: z.boolean(),
    maxBaremDesi: z.number().int(),
    sortOrder: z.number().int(),
  })
  .openapi('ShippingCarrier');

export const ShippingConfigSchema = z
  .object({
    shippingTariffSource: ShippingTariffSourceSchema,
    defaultShippingCarrierId: z.string().uuid().nullable(),
    defaultShippingCarrier: ShippingCarrierSchema.nullable(),
  })
  .openapi('ShippingConfig');

export const UpdateShippingConfigSchema = z
  .object({
    shippingTariffSource: ShippingTariffSourceSchema,
    defaultShippingCarrierId: z.string().uuid('INVALID_CARRIER_ID').nullable(),
  })
  .refine((v) => v.shippingTariffSource === 'OWN_CONTRACT' || v.defaultShippingCarrierId !== null, {
    message: 'SHIPPING_CARRIER_REQUIRED_FOR_TRENDYOL_CONTRACT',
    path: ['defaultShippingCarrierId'],
  })
  .openapi('UpdateShippingConfigInput');

export const OwnShippingTariffRowSchema = z
  .object({
    id: z.string().uuid(),
    desi: z.number().int(),
    priceNet: z.string(),
  })
  .openapi('OwnShippingTariffRow');

export type UpdateShippingConfigInput = z.infer<typeof UpdateShippingConfigSchema>;
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @pazarsync/api typecheck`
Expected: success.

### Task 3.2: Shipping-config service with cross-platform guard

**Files:**

- Create: `apps/api/src/services/shipping-config.service.ts`

- [ ] **Step 1: Write service**

```ts
import type { Prisma } from '@pazarsync/db';

import { InvalidReferenceError, NotFoundError } from '../lib/errors';
import { mapPrismaError } from '../lib/map-prisma-error';
import type { UpdateShippingConfigInput } from '../validators/shipping-config.validator';

export async function getShippingConfig(
  orgId: string,
  storeId: string,
  tx: Prisma.TransactionClient,
) {
  const store = await tx.store.findFirst({
    where: { id: storeId, organizationId: orgId },
    include: { defaultShippingCarrier: true },
  });
  if (!store) throw new NotFoundError('Store', storeId);
  return {
    shippingTariffSource: store.shippingTariffSource,
    defaultShippingCarrierId: store.defaultShippingCarrierId,
    defaultShippingCarrier: store.defaultShippingCarrier,
  };
}

export async function updateShippingConfig(
  orgId: string,
  storeId: string,
  input: UpdateShippingConfigInput,
  tx: Prisma.TransactionClient,
) {
  const store = await tx.store.findFirst({ where: { id: storeId, organizationId: orgId } });
  if (!store) throw new NotFoundError('Store', storeId);

  if (input.defaultShippingCarrierId) {
    const carrier = await tx.shippingCarrier.findUnique({
      where: { id: input.defaultShippingCarrierId },
    });
    if (!carrier) throw new NotFoundError('ShippingCarrier', input.defaultShippingCarrierId);
    if (carrier.platform !== store.platform) {
      throw new InvalidReferenceError('SHIPPING_CARRIER_PLATFORM_MISMATCH', {
        expected: store.platform,
        got: carrier.platform,
      });
    }
  }

  try {
    return await tx.store.update({
      where: { id: storeId },
      data: {
        shippingTariffSource: input.shippingTariffSource,
        defaultShippingCarrierId: input.defaultShippingCarrierId,
      },
      include: { defaultShippingCarrier: true },
    });
  } catch (err) {
    mapPrismaError(err);
  }
}

export async function listShippingCarriers(
  filters: { platform?: 'TRENDYOL' | 'HEPSIBURADA' },
  tx: Prisma.TransactionClient,
) {
  return tx.shippingCarrier.findMany({
    where: { active: true, ...(filters.platform ? { platform: filters.platform } : {}) },
    orderBy: { sortOrder: 'asc' },
  });
}

export async function listOwnShippingTariff(
  orgId: string,
  storeId: string,
  tx: Prisma.TransactionClient,
) {
  const store = await tx.store.findFirst({ where: { id: storeId, organizationId: orgId } });
  if (!store) throw new NotFoundError('Store', storeId);
  return tx.ownShippingTariff.findMany({
    where: { storeId },
    orderBy: { desi: 'asc' },
  });
}
```

- [ ] **Step 2: Check `InvalidReferenceError` accepts a string code**

Read: `apps/api/src/lib/errors.ts` — locate `InvalidReferenceError`. If its constructor signature differs (e.g., expects a different shape), adjust the call. The pattern in this codebase typically wraps with an error code string.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @pazarsync/api typecheck`
Expected: success.

### Task 3.3: `GET /shipping-carriers` route

**Files:**

- Create: `apps/api/src/routes/shipping/list-carriers.route.ts`

- [ ] **Step 1: Write**

```ts
import { createRoute, z } from '@hono/zod-openapi';
import { Platform, prisma } from '@pazarsync/db';

import { createSubApp } from '../../lib/create-hono-app';
import {
  Common429Response,
  ProblemDetailsSchema,
  RateLimitHeaders,
  bearerAuthScheme,
} from '../../openapi';
import { ShippingCarrierSchema } from '../../validators/shipping-config.validator';
import { listShippingCarriers } from '../../services/shipping-config.service';

const app = createSubApp();

const listCarriersRoute = createRoute({
  method: 'get',
  path: '/v1/organizations/{orgId}/shipping-carriers',
  tags: ['shipping'],
  summary: 'List shipping carriers',
  description: 'Returns available shipping carriers, optionally filtered by platform.',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ orgId: z.string().uuid() }),
    query: z.object({ platform: z.nativeEnum(Platform).optional() }),
  },
  responses: {
    200: {
      description: 'OK',
      headers: RateLimitHeaders,
      content: {
        'application/json': { schema: z.object({ data: z.array(ShippingCarrierSchema) }) },
      },
    },
    401: {
      description: 'Unauthenticated',
      content: { 'application/json': { schema: ProblemDetailsSchema } },
    },
    403: {
      description: 'Forbidden',
      content: { 'application/json': { schema: ProblemDetailsSchema } },
    },
    429: Common429Response,
  },
});

app.openapi(listCarriersRoute, async (c) => {
  const { platform } = c.req.valid('query');
  const carriers = await prisma.$transaction((tx) => listShippingCarriers({ platform }, tx));
  return c.json(
    {
      data: carriers.map((c) => ({
        id: c.id,
        platform: c.platform,
        externalId: c.externalId,
        code: c.code,
        displayName: c.displayName,
        supportsBaremDestek: c.supportsBaremDestek,
        maxBaremDesi: c.maxBaremDesi,
        sortOrder: c.sortOrder,
      })),
    },
    200,
  );
});

export default app;
```

- [ ] **Step 2: Typecheck**

Expected: success.

### Task 3.4: `GET /stores/:storeId/shipping-config` route

**Files:**

- Create: `apps/api/src/routes/shipping/get-config.route.ts`

- [ ] **Step 1: Write**

```ts
import { createRoute, z } from '@hono/zod-openapi';
import { prisma } from '@pazarsync/db';

import { createSubApp } from '../../lib/create-hono-app';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../../openapi';
import { ShippingConfigSchema } from '../../validators/shipping-config.validator';
import { getShippingConfig } from '../../services/shipping-config.service';

const app = createSubApp<{ Variables: { organizationId: string } }>();

const route = createRoute({
  method: 'get',
  path: '/v1/organizations/{orgId}/stores/{storeId}/shipping-config',
  tags: ['shipping'],
  summary: 'Get store shipping config',
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ orgId: z.string().uuid(), storeId: z.string().uuid() }) },
  responses: {
    200: {
      description: 'OK',
      headers: RateLimitHeaders,
      content: { 'application/json': { schema: ShippingConfigSchema } },
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: ProblemDetailsSchema } },
    },
    429: Common429Response,
  },
});

app.openapi(route, async (c) => {
  const orgId = c.get('organizationId');
  const { storeId } = c.req.valid('param');
  const config = await prisma.$transaction((tx) => getShippingConfig(orgId, storeId, tx));
  return c.json(config, 200);
});

export default app;
```

### Task 3.5: `PATCH /stores/:storeId/shipping-config` route

**Files:**

- Create: `apps/api/src/routes/shipping/patch-config.route.ts`

- [ ] **Step 1: Write**

```ts
import { createRoute, z } from '@hono/zod-openapi';
import { prisma } from '@pazarsync/db';

import { createSubApp } from '../../lib/create-hono-app';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../../openapi';
import {
  ShippingConfigSchema,
  UpdateShippingConfigSchema,
} from '../../validators/shipping-config.validator';
import { updateShippingConfig } from '../../services/shipping-config.service';

const app = createSubApp<{ Variables: { organizationId: string } }>();

const route = createRoute({
  method: 'patch',
  path: '/v1/organizations/{orgId}/stores/{storeId}/shipping-config',
  tags: ['shipping'],
  summary: 'Update store shipping config',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ orgId: z.string().uuid(), storeId: z.string().uuid() }),
    body: { content: { 'application/json': { schema: UpdateShippingConfigSchema } } },
  },
  responses: {
    200: {
      description: 'OK',
      headers: RateLimitHeaders,
      content: { 'application/json': { schema: ShippingConfigSchema } },
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: ProblemDetailsSchema } },
    },
    422: {
      description: 'Validation error',
      content: { 'application/json': { schema: ProblemDetailsSchema } },
    },
    429: Common429Response,
  },
});

app.openapi(route, async (c) => {
  const orgId = c.get('organizationId');
  const { storeId } = c.req.valid('param');
  const input = c.req.valid('json');
  const updated = await prisma.$transaction((tx) =>
    updateShippingConfig(orgId, storeId, input, tx),
  );
  return c.json(
    {
      shippingTariffSource: updated!.shippingTariffSource,
      defaultShippingCarrierId: updated!.defaultShippingCarrierId,
      defaultShippingCarrier: updated!.defaultShippingCarrier,
    },
    200,
  );
});

export default app;
```

### Task 3.6: `GET /stores/:storeId/own-shipping-tariff` route

**Files:**

- Create: `apps/api/src/routes/shipping/list-own-tariff.route.ts`

- [ ] **Step 1: Write**

```ts
import { createRoute, z } from '@hono/zod-openapi';
import { prisma } from '@pazarsync/db';

import { createSubApp } from '../../lib/create-hono-app';
import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../../openapi';
import { OwnShippingTariffRowSchema } from '../../validators/shipping-config.validator';
import { listOwnShippingTariff } from '../../services/shipping-config.service';

const app = createSubApp<{ Variables: { organizationId: string } }>();

const route = createRoute({
  method: 'get',
  path: '/v1/organizations/{orgId}/stores/{storeId}/own-shipping-tariff',
  tags: ['shipping'],
  summary: 'List own contract shipping tariff rows (V1: empty)',
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ orgId: z.string().uuid(), storeId: z.string().uuid() }) },
  responses: {
    200: {
      description: 'OK',
      headers: RateLimitHeaders,
      content: {
        'application/json': { schema: z.object({ data: z.array(OwnShippingTariffRowSchema) }) },
      },
    },
    404: {
      description: 'Not found',
      content: { 'application/json': { schema: ProblemDetailsSchema } },
    },
    429: Common429Response,
  },
});

app.openapi(route, async (c) => {
  const orgId = c.get('organizationId');
  const { storeId } = c.req.valid('param');
  const rows = await prisma.$transaction((tx) => listOwnShippingTariff(orgId, storeId, tx));
  return c.json(
    {
      data: rows.map((r) => ({
        id: r.id,
        desi: r.desi,
        priceNet: r.priceNet.toString(),
      })),
    },
    200,
  );
});

export default app;
```

### Task 3.7: Mount shipping routes

**Files:**

- Create: `apps/api/src/routes/shipping/index.ts`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Write `index.ts`**

```ts
import { createSubApp } from '../../lib/create-hono-app';
import listCarriers from './list-carriers.route';
import getConfig from './get-config.route';
import patchConfig from './patch-config.route';
import listOwnTariff from './list-own-tariff.route';

const app = createSubApp();
app.route('/', listCarriers);
app.route('/', getConfig);
app.route('/', patchConfig);
app.route('/', listOwnTariff);

export default app;
```

- [ ] **Step 2: Mount in `app.ts`**

Open `apps/api/src/app.ts`. Find where other routes are mounted (e.g., `app.route('/', storeRoutes)`). Add:

```ts
import shippingRoutes from './routes/shipping';
// ...
app.route('/', shippingRoutes);
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @pazarsync/api typecheck`
Expected: success.

### Task 3.8: Integration test — GET /shipping-carriers

**Files:**

- Create: `apps/api/tests/integration/routes/shipping/list-carriers.test.ts`

- [ ] **Step 1: Write test**

```ts
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAuthenticatedTestUser, bearer } from '../../../helpers/auth';
import { createOrganization, attachMembership } from '../../../helpers/factories';
import { ensureDbReachable, truncateAll } from '../../../helpers/db';
import { app } from '../../../../src/app';

describe('GET /v1/organizations/:orgId/shipping-carriers', () => {
  beforeAll(ensureDbReachable);
  beforeEach(truncateAll);

  it('returns 10 carriers for TRENDYOL filter', async () => {
    const user = await createAuthenticatedTestUser({ email: 'c@example.com' });
    const org = await createOrganization();
    await attachMembership(user.id, org.id, 'MEMBER');

    const res = await app.request(
      `/v1/organizations/${org.id}/shipping-carriers?platform=TRENDYOL`,
      {
        headers: { Authorization: bearer(user.accessToken) },
      },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(10);
    expect(body.data.find((c: { code: string }) => c.code === 'SENDEOMP')).toBeDefined();
  });

  it('returns 401 without auth', async () => {
    const org = await createOrganization();
    const res = await app.request(`/v1/organizations/${org.id}/shipping-carriers`);
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run**

Run: `pnpm --filter @pazarsync/api vitest run apps/api/tests/integration/routes/shipping/list-carriers.test.ts`
Expected: 2 PASS.

### Task 3.9: Integration test — GET shipping-config

**Files:**

- Create: `apps/api/tests/integration/routes/shipping/get-config.test.ts`

- [ ] **Step 1: Write**

```ts
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAuthenticatedTestUser, bearer } from '../../../helpers/auth';
import { createOrganization, attachMembership, createStore } from '../../../helpers/factories';
import { ensureDbReachable, truncateAll } from '../../../helpers/db';
import { app } from '../../../../src/app';

describe('GET /v1/organizations/:orgId/stores/:storeId/shipping-config', () => {
  beforeAll(ensureDbReachable);
  beforeEach(truncateAll);

  it('returns default shipping config for a new store', async () => {
    const user = await createAuthenticatedTestUser({ email: 'gc@example.com' });
    const org = await createOrganization();
    await attachMembership(user.id, org.id, 'OWNER');
    const store = await createStore({ organizationId: org.id });

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/shipping-config`,
      {
        headers: { Authorization: bearer(user.accessToken) },
      },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.shippingTariffSource).toBe('TRENDYOL_CONTRACT');
    expect(body.defaultShippingCarrierId).toBeNull();
  });
});
```

- [ ] **Step 2: Run**

Expected: 1 PASS.

### Task 3.10: Integration test — PATCH shipping-config (happy + errors)

**Files:**

- Create: `apps/api/tests/integration/routes/shipping/patch-config.test.ts`

- [ ] **Step 1: Write**

```ts
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@pazarsync/db';
import { createAuthenticatedTestUser, bearer } from '../../../helpers/auth';
import { createOrganization, attachMembership, createStore } from '../../../helpers/factories';
import { ensureDbReachable, truncateAll } from '../../../helpers/db';
import { app } from '../../../../src/app';

describe('PATCH /v1/organizations/:orgId/stores/:storeId/shipping-config', () => {
  beforeAll(ensureDbReachable);
  beforeEach(truncateAll);

  it('updates carrier successfully (Trendyol → SENDEOMP)', async () => {
    const user = await createAuthenticatedTestUser({ email: 'pc@example.com' });
    const org = await createOrganization();
    await attachMembership(user.id, org.id, 'OWNER');
    const store = await createStore({ organizationId: org.id, platform: 'TRENDYOL' });
    const carrier = await prisma.shippingCarrier.findFirst({ where: { code: 'SENDEOMP' } });

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/shipping-config`,
      {
        method: 'PATCH',
        headers: { Authorization: bearer(user.accessToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shippingTariffSource: 'TRENDYOL_CONTRACT',
          defaultShippingCarrierId: carrier!.id,
        }),
      },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.defaultShippingCarrierId).toBe(carrier!.id);
    expect(body.defaultShippingCarrier.code).toBe('SENDEOMP');
  });

  it('returns 422 when TRENDYOL_CONTRACT without carrierId', async () => {
    const user = await createAuthenticatedTestUser({ email: 'pc2@example.com' });
    const org = await createOrganization();
    await attachMembership(user.id, org.id, 'OWNER');
    const store = await createStore({ organizationId: org.id, platform: 'TRENDYOL' });

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/shipping-config`,
      {
        method: 'PATCH',
        headers: { Authorization: bearer(user.accessToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shippingTariffSource: 'TRENDYOL_CONTRACT',
          defaultShippingCarrierId: null,
        }),
      },
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.errors[0].code).toBe('SHIPPING_CARRIER_REQUIRED_FOR_TRENDYOL_CONTRACT');
  });
});
```

- [ ] **Step 2: Run**

Expected: 2 PASS.

### Task 3.11: Integration test — GET own-shipping-tariff (empty list)

**Files:**

- Create: `apps/api/tests/integration/routes/shipping/list-own-tariff.test.ts`

- [ ] **Step 1: Write**

```ts
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAuthenticatedTestUser, bearer } from '../../../helpers/auth';
import { createOrganization, attachMembership, createStore } from '../../../helpers/factories';
import { ensureDbReachable, truncateAll } from '../../../helpers/db';
import { app } from '../../../../src/app';

describe('GET /v1/organizations/:orgId/stores/:storeId/own-shipping-tariff', () => {
  beforeAll(ensureDbReachable);
  beforeEach(truncateAll);

  it('returns empty data array in V1', async () => {
    const user = await createAuthenticatedTestUser({ email: 'ot@example.com' });
    const org = await createOrganization();
    await attachMembership(user.id, org.id, 'OWNER');
    const store = await createStore({ organizationId: org.id });

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/own-shipping-tariff`,
      {
        headers: { Authorization: bearer(user.accessToken) },
      },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([]);
  });
});
```

- [ ] **Step 2: Run**

Expected: 1 PASS.

### Task 3.12: Tenant isolation test

**Files:**

- Create: `apps/api/tests/integration/tenant-isolation/shipping-config.test.ts`

- [ ] **Step 1: Write**

```ts
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@pazarsync/db';
import { createAuthenticatedTestUser, bearer } from '../../helpers/auth';
import { createOrganization, attachMembership, createStore } from '../../helpers/factories';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { app } from '../../../src/app';

describe('Tenant isolation — shipping config', () => {
  beforeAll(ensureDbReachable);
  beforeEach(truncateAll);

  it('user from org A cannot GET shipping-config of org B store', async () => {
    const userA = await createAuthenticatedTestUser({ email: 'ta@example.com' });
    const orgA = await createOrganization();
    const orgB = await createOrganization();
    await attachMembership(userA.id, orgA.id, 'OWNER');
    const storeB = await createStore({ organizationId: orgB.id });

    const res = await app.request(
      `/v1/organizations/${orgA.id}/stores/${storeB.id}/shipping-config`,
      {
        headers: { Authorization: bearer(userA.accessToken) },
      },
    );
    expect(res.status).toBe(404);
  });

  it('user from org A cannot PATCH shipping-config of org B store', async () => {
    const userA = await createAuthenticatedTestUser({ email: 'ta2@example.com' });
    const orgA = await createOrganization();
    const orgB = await createOrganization();
    await attachMembership(userA.id, orgA.id, 'OWNER');
    const storeB = await createStore({ organizationId: orgB.id });

    const res = await app.request(
      `/v1/organizations/${orgA.id}/stores/${storeB.id}/shipping-config`,
      {
        method: 'PATCH',
        headers: { Authorization: bearer(userA.accessToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shippingTariffSource: 'OWN_CONTRACT',
          defaultShippingCarrierId: null,
        }),
      },
    );
    expect(res.status).toBe(404);
  });

  it('PATCH with cross-platform carrier returns 422 PLATFORM_MISMATCH', async () => {
    const user = await createAuthenticatedTestUser({ email: 'tx@example.com' });
    const org = await createOrganization();
    await attachMembership(user.id, org.id, 'OWNER');
    const trendyolStore = await createStore({ organizationId: org.id, platform: 'TRENDYOL' });
    // For now, all seeded carriers are TRENDYOL. Once HEPSIBURADA carriers exist,
    // this test can target one. For V1 we instead simulate by manually inserting a
    // mismatched carrier row.
    const mismatched = await prisma.shippingCarrier.create({
      data: {
        platform: 'HEPSIBURADA',
        externalId: 999,
        code: 'HBPLACEHOLDER',
        displayName: 'HB Placeholder',
        sortOrder: 100,
      },
    });

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${trendyolStore.id}/shipping-config`,
      {
        method: 'PATCH',
        headers: { Authorization: bearer(user.accessToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shippingTariffSource: 'TRENDYOL_CONTRACT',
          defaultShippingCarrierId: mismatched.id,
        }),
      },
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe('SHIPPING_CARRIER_PLATFORM_MISMATCH');
  });
});
```

- [ ] **Step 2: Run**

Expected: 3 PASS.

### Task 3.13: Regenerate OpenAPI + log changelog

**Files:**

- Modify: `packages/api-client/openapi.json` (regenerated)
- Modify: `docs/api-changelog.md`

- [ ] **Step 1: Regenerate**

Run from repo root: `pnpm api:sync`
Expected: regenerated `openapi.json` snapshot in `packages/api-client/`.

- [ ] **Step 2: Log changelog**

Open `docs/api-changelog.md`. Under `[Unreleased]` add bullets:

```
- ADD: `GET /v1/organizations/:orgId/shipping-carriers` — list carriers
- ADD: `GET /v1/organizations/:orgId/stores/:storeId/shipping-config` — get store shipping config
- ADD: `PATCH /v1/organizations/:orgId/stores/:storeId/shipping-config` — update carrier/source
- ADD: `GET /v1/organizations/:orgId/stores/:storeId/own-shipping-tariff` — list own contract tariff (V1 always empty)
```

### Task 3.14: Commit PR 3

- [ ] **Step 1: Stage**

```bash
git add apps/api/src/validators/shipping-config.validator.ts \
        apps/api/src/services/shipping-config.service.ts \
        apps/api/src/routes/shipping/ \
        apps/api/src/app.ts \
        apps/api/tests/integration/routes/shipping/ \
        apps/api/tests/integration/tenant-isolation/shipping-config.test.ts \
        packages/api-client/openapi.json \
        docs/api-changelog.md
```

- [ ] **Step 2: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(shipping): backend routes for carrier list + shipping config CRUD

Adds 4 routes (carriers list, get/patch config, own-tariff list), validators
with cross-platform guard, full integration tests including tenant isolation
and the SHIPPING_CARRIER_PLATFORM_MISMATCH guard. OpenAPI regenerated.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# PR 4 — Products List Extension (Raw SQL CTE + Equivalence Test)

**Goal:** Products list endpoint returns shipping fields per variant via raw SQL CTE. Equivalence test asserts SQL ≡ service algorithm.

### Task 4.1: Raw SQL CTE module

**Files:**

- Create: `apps/api/src/services/shipping-estimator.sql.ts`

- [ ] **Step 1: Write the constant**

```ts
/**
 * Raw SQL CTE that computes per-variant shipping estimate inline with products
 * list. Canonical algorithm lives in shipping-estimator.service.ts; this SQL
 * is a performance mirror. Equivalence test asserts they match for the full
 * scenario matrix.
 *
 * Parameters: $1 = organizationId
 */
export const SHIPPING_ESTIMATE_CTE_SQL = `
WITH variant_with_carrier AS (
  SELECT pv.id, pv.store_id, pv.sale_price, pv.delivery_duration, pv.is_rush_delivery,
         pv.fast_delivery_options, pv.dimensional_weight, pv.synced_dimensional_weight,
         s.shipping_tariff_source, s.default_shipping_carrier_id,
         sc.code AS carrier_code, sc.supports_barem_destek, sc.max_barem_desi,
         sc.max_barem_eligible_delivery_duration,
         COALESCE(pv.dimensional_weight, pv.synced_dimensional_weight) AS eff_desi
  FROM product_variants pv
  JOIN stores s ON s.id = pv.store_id
  LEFT JOIN shipping_carriers sc ON sc.id = s.default_shipping_carrier_id
  WHERE pv.organization_id = $1::uuid
),
estimates AS (
  SELECT
    vwc.id,
    CASE
      WHEN vwc.shipping_tariff_source = 'OWN_CONTRACT' THEN own_tariff.price_net
      WHEN barem.price_net IS NOT NULL THEN barem.price_net
      ELSE desi_tariff.price_net
    END AS estimated_shipping_net,
    CASE
      WHEN vwc.shipping_tariff_source = 'OWN_CONTRACT' AND own_tariff.price_net IS NOT NULL THEN 'OWN_CONTRACT'
      WHEN barem.price_net IS NOT NULL THEN 'BAREM'
      WHEN desi_tariff.price_net IS NOT NULL THEN 'NORMAL'
      ELSE NULL
    END AS shipping_tariff_applied,
    CASE
      WHEN vwc.eff_desi IS NULL THEN 'NO_DESI'
      WHEN vwc.shipping_tariff_source = 'OWN_CONTRACT' AND own_tariff.price_net IS NULL THEN 'OWN_CONTRACT_EMPTY'
      WHEN vwc.shipping_tariff_source = 'TRENDYOL_CONTRACT' AND vwc.default_shipping_carrier_id IS NULL THEN 'NO_CARRIER'
      WHEN barem.price_net IS NOT NULL OR desi_tariff.price_net IS NOT NULL THEN 'OK'
      ELSE 'DESI_OVERFLOW'
    END AS shipping_estimate_status,
    vwc.carrier_code AS shipping_carrier_code
  FROM variant_with_carrier vwc
  LEFT JOIN LATERAL (
    SELECT price_net FROM own_shipping_tariffs
     WHERE store_id = vwc.store_id AND desi = CEIL(vwc.eff_desi)::int
     LIMIT 1
  ) own_tariff ON vwc.shipping_tariff_source = 'OWN_CONTRACT'
  LEFT JOIN LATERAL (
    SELECT sbt.price_net FROM shipping_barem_tariffs sbt
     WHERE sbt.carrier_id = vwc.default_shipping_carrier_id
       AND vwc.supports_barem_destek = true
       AND vwc.eff_desi <= vwc.max_barem_desi
       AND (
         (vwc.delivery_duration IS NOT NULL AND vwc.delivery_duration <= vwc.max_barem_eligible_delivery_duration)
         OR vwc.is_rush_delivery = true
         OR jsonb_array_length(vwc.fast_delivery_options) > 0
       )
       AND vwc.sale_price >= sbt.min_order_amount
       AND vwc.sale_price <  sbt.max_order_amount
     LIMIT 1
  ) barem ON vwc.shipping_tariff_source = 'TRENDYOL_CONTRACT'
  LEFT JOIN LATERAL (
    SELECT price_net FROM shipping_desi_tariffs
     WHERE carrier_id = vwc.default_shipping_carrier_id AND desi = CEIL(vwc.eff_desi)::int
     LIMIT 1
  ) desi_tariff ON vwc.shipping_tariff_source = 'TRENDYOL_CONTRACT'
)
SELECT id, estimated_shipping_net, shipping_tariff_applied, shipping_estimate_status, shipping_carrier_code
FROM estimates;
` as const;
```

### Task 4.2: Equivalence test

**Files:**

- Create: `apps/api/tests/integration/shipping-estimator-equivalence.test.ts`

- [ ] **Step 1: Write**

```ts
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@pazarsync/db';

import { estimateShippingCostForVariant } from '../../src/services/shipping-estimator.service';
import { SHIPPING_ESTIMATE_CTE_SQL } from '../../src/services/shipping-estimator.sql';
import { ensureDbReachable, truncateAll } from '../helpers/db';
import { createOrganization, createStore } from '../helpers/factories';

interface SqlRow {
  id: string;
  estimated_shipping_net: string | null;
  shipping_tariff_applied: 'NORMAL' | 'BAREM' | 'OWN_CONTRACT' | null;
  shipping_estimate_status:
    | 'OK'
    | 'NO_CARRIER'
    | 'NO_DESI'
    | 'OWN_CONTRACT_EMPTY'
    | 'DESI_OVERFLOW';
  shipping_carrier_code: string | null;
}

describe('Equivalence: service fn vs raw SQL CTE', () => {
  beforeAll(ensureDbReachable);
  beforeEach(truncateAll);

  it('happy path NORMAL', async () => {
    const org = await createOrganization();
    const carrier = await prisma.shippingCarrier.findFirstOrThrow({ where: { code: 'SENDEOMP' } });
    const store = await createStore({
      organizationId: org.id,
      defaultShippingCarrierId: carrier.id,
      shippingTariffSource: 'TRENDYOL_CONTRACT',
    });
    const product = await prisma.product.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        platformContentId: 100n,
        productMainId: 'p',
        title: 't',
      },
    });
    const variant = await prisma.productVariant.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        productId: product.id,
        platformVariantId: 100n,
        barcode: 'eq1',
        stockCode: 'eq1',
        salePrice: '500',
        listPrice: '500',
        dimensionalWeight: '3.0',
        isRushDelivery: false,
        fastDeliveryOptions: [],
        attributes: [],
      },
    });

    const fn = await prisma.$transaction((tx) => estimateShippingCostForVariant(variant.id, tx));
    const sql = await prisma.$queryRawUnsafe<SqlRow[]>(SHIPPING_ESTIMATE_CTE_SQL, org.id);
    const row = sql.find((r) => r.id === variant.id)!;

    expect(fn.ok).toBe(true);
    if (!fn.ok) throw new Error('unreachable');
    expect(row.shipping_estimate_status).toBe('OK');
    expect(row.shipping_tariff_applied).toBe(fn.estimate.tariffApplied);
    expect(row.shipping_carrier_code).toBe(fn.estimate.carrierCode);
    expect(row.estimated_shipping_net).toBe(fn.estimate.amount.toFixed(2));
  });

  // Add a similar block for BAREM, NO_DESI, NO_CARRIER, OWN_CONTRACT_EMPTY, DESI_OVERFLOW.
  // Each block creates a variant matching the scenario, calls both paths, asserts equality.
  // Keep variant barcodes/stockCodes unique per test to avoid clashes within a beforeEach truncate cycle.
});
```

- [ ] **Step 2: Complete remaining scenarios**

Replicate the block for each of the 4 other states. Use `barcode: 'eqN'` (N=2..5). Status values:

- BAREM: salePrice='150', dimensionalWeight='2.0', deliveryDuration=1
- NO_DESI: dimensionalWeight=null, syncedDimensionalWeight=null, ok must be false
- NO_CARRIER: defaultShippingCarrierId null
- OWN_CONTRACT_EMPTY: shippingTariffSource='OWN_CONTRACT'
- DESI_OVERFLOW: dimensionalWeight='20'

Each block:

1. Create scenario fixtures
2. Run service fn
3. Run SQL
4. Assert: `row.shipping_estimate_status` matches the expected status, and where `ok=true`, `row.estimated_shipping_net` matches `fn.estimate.amount.toFixed(2)`.

- [ ] **Step 3: Run**

Run: `pnpm --filter @pazarsync/api vitest run apps/api/tests/integration/shipping-estimator-equivalence.test.ts`
Expected: 6 PASS (one per state).

If any scenario diverges, the SQL CTE has a bug — fix it before proceeding.

### Task 4.3: Extend products list endpoint

**Files:**

- Modify: `apps/api/src/routes/products/list.route.ts` (or whichever file is the list route)
- Modify: `apps/api/src/validators/product.validator.ts` (add shipping fields to per-variant schema)

- [ ] **Step 1: Locate the per-variant response schema**

Run: `grep -n "currentCostTry\|profileCount\|costStatus" apps/api/src/validators/product.validator.ts apps/api/src/routes/products/*.ts`

Note the schema/handler location. Whichever schema currently declares `currentCostTry`, extend it.

- [ ] **Step 2: Add shipping fields to the schema**

```ts
// In product validator (adjust to the exact file you found):
const ProductVariantInListSchema = z.object({
  // ... existing fields (id, barcode, salePrice, currentCostTry, profileCount, costStatus, ...)
  estimatedShippingNet: z.string().nullable().openapi({ example: '35.16' }),
  shippingCarrierCode: z.string().nullable().openapi({ example: 'SENDEOMP' }),
  shippingTariffApplied: z
    .enum(['NORMAL', 'BAREM', 'OWN_CONTRACT'])
    .nullable()
    .openapi({ example: 'BAREM' }),
  shippingEstimateStatus: z
    .enum(['OK', 'NO_CARRIER', 'NO_DESI', 'OWN_CONTRACT_EMPTY', 'DESI_OVERFLOW'])
    .openapi({ example: 'OK' }),
});
```

- [ ] **Step 3: Integrate CTE into list handler**

In the list endpoint handler, after existing data fetch, run the shipping CTE and merge:

```ts
import { SHIPPING_ESTIMATE_CTE_SQL } from '../../services/shipping-estimator.sql';
// ... existing handler body ...
const shippingRows = await prisma.$queryRawUnsafe<
  {
    id: string;
    estimated_shipping_net: string | null;
    shipping_tariff_applied: 'NORMAL' | 'BAREM' | 'OWN_CONTRACT' | null;
    shipping_estimate_status:
      | 'OK'
      | 'NO_CARRIER'
      | 'NO_DESI'
      | 'OWN_CONTRACT_EMPTY'
      | 'DESI_OVERFLOW';
    shipping_carrier_code: string | null;
  }[]
>(SHIPPING_ESTIMATE_CTE_SQL, orgId);
const shippingMap = new Map(shippingRows.map((r) => [r.id, r]));

// When mapping each variant to the response shape, merge:
const responseVariants = variants.map((v) => {
  const shipping = shippingMap.get(v.id);
  return {
    // ... existing fields ...
    estimatedShippingNet: shipping?.estimated_shipping_net ?? null,
    shippingCarrierCode: shipping?.shipping_carrier_code ?? null,
    shippingTariffApplied: shipping?.shipping_tariff_applied ?? null,
    shippingEstimateStatus: shipping?.shipping_estimate_status ?? 'NO_DESI',
  };
});
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @pazarsync/api typecheck`
Expected: success.

### Task 4.4: Integration test — products list shipping fields

**Files:**

- Modify or create: `apps/api/tests/integration/routes/products/list.test.ts` (whichever exists)

- [ ] **Step 1: Add one test case**

Append a test asserting that a products list response contains the shipping fields with correct values for at least one OK variant and one NO_DESI variant.

- [ ] **Step 2: Run**

Run the products list test file. Expected: PASS including the new case.

### Task 4.5: Regenerate OpenAPI + log

**Files:**

- Modify: `packages/api-client/openapi.json` (regenerated)
- Modify: `docs/api-changelog.md`

- [ ] **Step 1: Regen + log**

```bash
pnpm api:sync
```

Append to changelog:

```
- CHANGE: `GET /v1/organizations/:orgId/stores/:storeId/products` per-variant response now includes `estimatedShippingNet`, `shippingCarrierCode`, `shippingTariffApplied`, `shippingEstimateStatus`.
```

### Task 4.6: Commit PR 4

```bash
git add apps/api/src/services/shipping-estimator.sql.ts \
        apps/api/src/validators/product.validator.ts \
        apps/api/src/routes/products/ \
        apps/api/tests/integration/shipping-estimator-equivalence.test.ts \
        apps/api/tests/integration/routes/products/ \
        packages/api-client/openapi.json \
        docs/api-changelog.md

git commit -m "$(cat <<'EOF'
feat(shipping): inline shipping estimate in products list via raw SQL CTE

Adds the SHIPPING_ESTIMATE_CTE_SQL canonical raw SQL mirror of the estimator
service. Equivalence test asserts service fn ≡ SQL for all 6 outcome states.
Products list response gains 4 fields per variant. OpenAPI regenerated.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# PR 5 — Frontend Store Settings: Shipping Tab

**Goal:** Inline Segment layout in store settings — segment toggle + carrier dropdown for TRENDYOL_CONTRACT, empty Excel placeholder for OWN_CONTRACT.

### Task 5.1: i18n keys

**Files:**

- Modify: `apps/web/messages/tr.json` (find this file via `find apps/web -name "tr.json"`)

- [ ] **Step 1: Add `shipping` namespace**

Add to the JSON root (preserving existing keys):

```json
{
  "shipping": {
    "settings": {
      "title": "Kargo Tarifesi",
      "subtitle": "Tahmini kar hesabınız için kullanılacak kargo tarifesini seçin.",
      "source": {
        "trendyol": "Trendyol Anlaşmalı",
        "ownContract": "Kendi Anlaşmam"
      },
      "carrierLabel": "Varsayılan Kargo Firması",
      "carrierHelp": "Bu firma sizin Trendyol sözleşmenizde onaylanmış olmalıdır.",
      "ownContract": {
        "title": "Kendi Tarifenizi Yükleyin",
        "description": "Excel ile kendi kargo tarifenizi yakında yükleyebileceksiniz.",
        "uploadDisabled": "Excel ile yükle (yakında)"
      },
      "saveSuccess": "Kargo ayarları güncellendi.",
      "saveError": "Kargo ayarları güncellenemedi."
    },
    "products": {
      "columnHeader": "Tahmini Net Kar",
      "popoverTitle": "Kar Detayı",
      "rows": {
        "salePrice": "Satış fiyatı",
        "cost": "Maliyet",
        "shipping": "Kargo",
        "commission": "Komisyon",
        "netProfit": "Net Kar"
      },
      "carrierChip": "{code} · {tariff}",
      "tariff": {
        "NORMAL": "Normal",
        "BAREM": "Barem",
        "OWN_CONTRACT": "Kendi"
      },
      "states": {
        "NO_DESI": {
          "title": "Desi değeri eksik",
          "reason": "Kargo tahmini için ürün desi/dimensional_weight bilgisi gerekli.",
          "cta": "Ürüne desi ekle"
        },
        "NO_CARRIER": {
          "title": "Kargo firması seçilmemiş",
          "reason": "Mağaza ayarlarınızda varsayılan kargo firması seçili değil.",
          "cta": "Mağaza ayarlarına git"
        },
        "OWN_CONTRACT_EMPTY": {
          "title": "Tarife bekleniyor",
          "reason": "Kendi anlaşmanız seçili, fakat kargo tarifeniz henüz yüklenmedi.",
          "cta": "Excel ile yükle (yakında)"
        },
        "DESI_OVERFLOW": {
          "title": "Yüksek desi, tarife dışı",
          "reason": "Bu ürün seçili carrier'ın tarife tablosunda yer alan en yüksek desiyi aşıyor.",
          "cta": "Kargo firmanızı değiştirin"
        }
      },
      "banner": {
        "title": "{count} üründe tahmini kar hesaplanamıyor",
        "breakdown": "desi eksik ({noDesi}) · carrier seçilmemiş ({noCarrier}) · yüksek desi ({overflow})",
        "filterCta": "Filtreyi uygula"
      }
    },
    "errors": {
      "SHIPPING_CARRIER_REQUIRED_FOR_TRENDYOL_CONTRACT": "Trendyol Anlaşmalı seçildiyse kargo firması zorunludur.",
      "SHIPPING_CARRIER_PLATFORM_MISMATCH": "Seçilen kargo firması bu mağazanın pazaryeriyle uyumlu değil.",
      "SHIPPING_CARRIER_NOT_FOUND": "Kargo firması bulunamadı."
    }
  }
}
```

- [ ] **Step 2: Add error codes to common errors namespace**

In the same file, add the three new codes to `common.errors`:

```json
"common": {
  "errors": {
    "SHIPPING_CARRIER_REQUIRED_FOR_TRENDYOL_CONTRACT": "Kargo firması seçilmesi gerekiyor.",
    "SHIPPING_CARRIER_PLATFORM_MISMATCH": "Kargo firması mağaza pazaryeriyle uyumlu değil.",
    "SHIPPING_CARRIER_NOT_FOUND": "Kargo firması bulunamadı."
  }
}
```

### Task 5.2: TypeScript types

**Files:**

- Create: `apps/web/src/features/shipping/types/shipping.types.ts`

- [ ] **Step 1: Write**

```ts
import type { components } from '@pazarsync/api-client';

export type ShippingCarrier = components['schemas']['ShippingCarrier'];
export type ShippingConfig = components['schemas']['ShippingConfig'];
export type UpdateShippingConfigInput = components['schemas']['UpdateShippingConfigInput'];
export type OwnShippingTariffRow = components['schemas']['OwnShippingTariffRow'];

export type ShippingTariffSource = 'TRENDYOL_CONTRACT' | 'OWN_CONTRACT';
export type ShippingTariffApplied = 'NORMAL' | 'BAREM' | 'OWN_CONTRACT';
export type ShippingEstimateStatus =
  | 'OK'
  | 'NO_CARRIER'
  | 'NO_DESI'
  | 'OWN_CONTRACT_EMPTY'
  | 'DESI_OVERFLOW';
```

### Task 5.3: API client functions

**Files:**

- Create: `apps/web/src/features/shipping/api/list-shipping-carriers.api.ts`
- Create: `apps/web/src/features/shipping/api/get-shipping-config.api.ts`
- Create: `apps/web/src/features/shipping/api/update-shipping-config.api.ts`
- Create: `apps/web/src/features/shipping/api/list-own-shipping-tariff.api.ts`

- [ ] **Step 1: Write `list-shipping-carriers.api.ts`**

```ts
import { apiClient } from '@/lib/api-client';
import { throwApiError } from '@/lib/api-error';
import type { ShippingCarrier } from '../types/shipping.types';

export async function listShippingCarriers(
  orgId: string,
  platform?: 'TRENDYOL' | 'HEPSIBURADA',
): Promise<ShippingCarrier[]> {
  const { data, error, response } = await apiClient.GET(
    '/v1/organizations/{orgId}/shipping-carriers',
    {
      params: { path: { orgId }, query: platform ? { platform } : {} },
    },
  );
  if (error !== undefined) throwApiError(error, response);
  return data.data;
}
```

- [ ] **Step 2: Write `get-shipping-config.api.ts`**

```ts
import { apiClient } from '@/lib/api-client';
import { throwApiError } from '@/lib/api-error';
import type { ShippingConfig } from '../types/shipping.types';

export async function getShippingConfig(orgId: string, storeId: string): Promise<ShippingConfig> {
  const { data, error, response } = await apiClient.GET(
    '/v1/organizations/{orgId}/stores/{storeId}/shipping-config',
    { params: { path: { orgId, storeId } } },
  );
  if (error !== undefined) throwApiError(error, response);
  return data;
}
```

- [ ] **Step 3: Write `update-shipping-config.api.ts`**

```ts
import { apiClient } from '@/lib/api-client';
import { throwApiError } from '@/lib/api-error';
import type { ShippingConfig, UpdateShippingConfigInput } from '../types/shipping.types';

export async function updateShippingConfig(
  orgId: string,
  storeId: string,
  body: UpdateShippingConfigInput,
): Promise<ShippingConfig> {
  const { data, error, response } = await apiClient.PATCH(
    '/v1/organizations/{orgId}/stores/{storeId}/shipping-config',
    { params: { path: { orgId, storeId } }, body },
  );
  if (error !== undefined) throwApiError(error, response);
  return data;
}
```

- [ ] **Step 4: Write `list-own-shipping-tariff.api.ts`**

```ts
import { apiClient } from '@/lib/api-client';
import { throwApiError } from '@/lib/api-error';
import type { OwnShippingTariffRow } from '../types/shipping.types';

export async function listOwnShippingTariff(
  orgId: string,
  storeId: string,
): Promise<OwnShippingTariffRow[]> {
  const { data, error, response } = await apiClient.GET(
    '/v1/organizations/{orgId}/stores/{storeId}/own-shipping-tariff',
    { params: { path: { orgId, storeId } } },
  );
  if (error !== undefined) throwApiError(error, response);
  return data.data;
}
```

### Task 5.4: React Query hooks

**Files:**

- Create: `apps/web/src/features/shipping/hooks/use-shipping-carriers.ts`
- Create: `apps/web/src/features/shipping/hooks/use-shipping-config.ts`
- Create: `apps/web/src/features/shipping/hooks/use-update-shipping-config.ts`

- [ ] **Step 1: Write keys + hooks**

```ts
// use-shipping-carriers.ts
import { useQuery } from '@tanstack/react-query';
import { listShippingCarriers } from '../api/list-shipping-carriers.api';

export const shippingKeys = {
  all: ['shipping'] as const,
  carriers: (orgId: string, platform?: string) =>
    [...shippingKeys.all, 'carriers', orgId, platform] as const,
  config: (storeId: string) => [...shippingKeys.all, 'config', storeId] as const,
  ownTariff: (storeId: string) => [...shippingKeys.all, 'own-tariff', storeId] as const,
};

export function useShippingCarriers(orgId: string, platform?: 'TRENDYOL' | 'HEPSIBURADA') {
  return useQuery({
    queryKey: shippingKeys.carriers(orgId, platform),
    queryFn: () => listShippingCarriers(orgId, platform),
  });
}
```

```ts
// use-shipping-config.ts
import { useQuery } from '@tanstack/react-query';
import { getShippingConfig } from '../api/get-shipping-config.api';
import { shippingKeys } from './use-shipping-carriers';

export function useShippingConfig(orgId: string, storeId: string) {
  return useQuery({
    queryKey: shippingKeys.config(storeId),
    queryFn: () => getShippingConfig(orgId, storeId),
  });
}
```

```ts
// use-update-shipping-config.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { updateShippingConfig } from '../api/update-shipping-config.api';
import { shippingKeys } from './use-shipping-carriers';
import type { UpdateShippingConfigInput } from '../types/shipping.types';

export function useUpdateShippingConfig(orgId: string, storeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateShippingConfigInput) => updateShippingConfig(orgId, storeId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: shippingKeys.config(storeId) });
      qc.invalidateQueries({ queryKey: ['products'] });
    },
  });
}
```

### Task 5.5: Components — ShippingTariffSourceSegment

**Files:**

- Create: `apps/web/src/features/shipping/components/shipping-tariff-source-segment.tsx`

- [ ] **Step 1: Write**

```tsx
import { useTranslations } from 'next-intl';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { ShippingTariffSource } from '../types/shipping.types';

interface Props {
  value: ShippingTariffSource;
  onChange: (v: ShippingTariffSource) => void;
}

export function ShippingTariffSourceSegment({ value, onChange }: Props) {
  const t = useTranslations('shipping.settings.source');
  return (
    <Tabs value={value} onValueChange={(v) => onChange(v as ShippingTariffSource)}>
      <TabsList className="w-full">
        <TabsTrigger value="TRENDYOL_CONTRACT" className="flex-1">
          {t('trendyol')}
        </TabsTrigger>
        <TabsTrigger value="OWN_CONTRACT" className="flex-1">
          {t('ownContract')}
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
```

### Task 5.6: Components — CarrierSelect

**Files:**

- Create: `apps/web/src/features/shipping/components/carrier-select.tsx`

- [ ] **Step 1: Write**

```tsx
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { ShippingCarrier } from '../types/shipping.types';

interface Props {
  carriers: ShippingCarrier[];
  value: string | null;
  onChange: (id: string) => void;
  disabled?: boolean;
}

export function CarrierSelect({ carriers, value, onChange, disabled }: Props) {
  return (
    <Select value={value ?? undefined} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger>
        <SelectValue placeholder="Bir kargo firması seçin" />
      </SelectTrigger>
      <SelectContent>
        {carriers.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            {c.displayName}
            {!c.supportsBaremDestek && (
              <span className="text-muted-foreground ml-2 text-xs">(Barem destek dışı)</span>
            )}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
```

### Task 5.7: Components — empty state for OWN_CONTRACT

**Files:**

- Create: `apps/web/src/features/shipping/components/shipping-config-empty-state.tsx`

- [ ] **Step 1: Write**

```tsx
import { useTranslations } from 'next-intl';
import { EmptyState } from '@/components/patterns/empty-state';
import { Button } from '@/components/ui/button';

export function ShippingConfigEmptyState() {
  const t = useTranslations('shipping.settings.ownContract');
  return (
    <EmptyState
      title={t('title')}
      description={t('description')}
      action={<Button disabled>{t('uploadDisabled')}</Button>}
    />
  );
}
```

### Task 5.8: Components — ShippingConfigForm (composite)

**Files:**

- Create: `apps/web/src/features/shipping/components/shipping-config-form.tsx`

- [ ] **Step 1: Write**

```tsx
'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { useShippingCarriers } from '../hooks/use-shipping-carriers';
import { useShippingConfig } from '../hooks/use-shipping-config';
import { useUpdateShippingConfig } from '../hooks/use-update-shipping-config';
import { ShippingTariffSourceSegment } from './shipping-tariff-source-segment';
import { CarrierSelect } from './carrier-select';
import { ShippingConfigEmptyState } from './shipping-config-empty-state';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import type { ShippingTariffSource } from '../types/shipping.types';

interface Props {
  orgId: string;
  storeId: string;
  platform: 'TRENDYOL' | 'HEPSIBURADA';
}

export function ShippingConfigForm({ orgId, storeId, platform }: Props) {
  const t = useTranslations('shipping.settings');
  const config = useShippingConfig(orgId, storeId);
  const carriers = useShippingCarriers(orgId, platform);
  const update = useUpdateShippingConfig(orgId, storeId);

  const [source, setSource] = useState<ShippingTariffSource>('TRENDYOL_CONTRACT');
  const [carrierId, setCarrierId] = useState<string | null>(null);

  useEffect(() => {
    if (config.data) {
      setSource(config.data.shippingTariffSource);
      setCarrierId(config.data.defaultShippingCarrierId);
    }
  }, [config.data]);

  const handleSave = () => {
    update.mutate(
      { shippingTariffSource: source, defaultShippingCarrierId: carrierId },
      {
        onSuccess: () => toast.success(t('saveSuccess')),
      },
    );
  };

  return (
    <section>
      <h2 className="text-base font-semibold">{t('title')}</h2>
      <p className="text-muted-foreground mb-4 text-sm">{t('subtitle')}</p>

      <ShippingTariffSourceSegment value={source} onChange={setSource} />

      {source === 'TRENDYOL_CONTRACT' && (
        <div className="mt-4 space-y-2">
          <Label>{t('carrierLabel')}</Label>
          <CarrierSelect
            carriers={carriers.data ?? []}
            value={carrierId}
            onChange={setCarrierId}
            disabled={carriers.isLoading}
          />
          <p className="text-muted-foreground text-xs">{t('carrierHelp')}</p>
        </div>
      )}

      {source === 'OWN_CONTRACT' && (
        <div className="mt-4">
          <ShippingConfigEmptyState />
        </div>
      )}

      <Button onClick={handleSave} disabled={update.isPending} className="mt-6">
        Kaydet
      </Button>
    </section>
  );
}
```

### Task 5.9: Hook test — useUpdateShippingConfig

**Files:**

- Create: `apps/web/src/features/shipping/hooks/__tests__/use-update-shipping-config.test.ts`

- [ ] **Step 1: Write**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { useUpdateShippingConfig } from '../use-update-shipping-config';

const server = setupServer(
  http.patch('*/v1/organizations/:orgId/stores/:storeId/shipping-config', () =>
    HttpResponse.json({
      shippingTariffSource: 'TRENDYOL_CONTRACT',
      defaultShippingCarrierId: 'c1',
      defaultShippingCarrier: null,
    }),
  ),
);

beforeEach(() => server.listen());
afterEach(() => server.resetHandlers());

describe('useUpdateShippingConfig', () => {
  it('calls PATCH and returns updated config', async () => {
    const qc = new QueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useUpdateShippingConfig('o1', 's1'), { wrapper });

    result.current.mutate({ shippingTariffSource: 'TRENDYOL_CONTRACT', defaultShippingCarrierId: 'c1' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.shippingTariffSource).toBe('TRENDYOL_CONTRACT');
  });
});
```

- [ ] **Step 2: Run**

Run: `pnpm --filter web vitest run apps/web/src/features/shipping/hooks/__tests__/use-update-shipping-config.test.ts`
Expected: 1 PASS.

### Task 5.10: Component test — ShippingConfigForm

**Files:**

- Create: `apps/web/src/features/shipping/components/__tests__/shipping-config-form.test.tsx`

- [ ] **Step 1: Write**

```tsx
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import messages from '@/../messages/tr.json';

import { ShippingConfigForm } from '../shipping-config-form';

const server = setupServer(
  http.get('*/v1/organizations/:orgId/shipping-carriers', () =>
    HttpResponse.json({
      data: [
        {
          id: 'c1',
          code: 'SENDEOMP',
          displayName: 'Kolay Gelsin',
          platform: 'TRENDYOL',
          externalId: 38,
          supportsBaremDestek: true,
          maxBaremDesi: 10,
          sortOrder: 7,
        },
      ],
    }),
  ),
  http.get('*/v1/organizations/:orgId/stores/:storeId/shipping-config', () =>
    HttpResponse.json({
      shippingTariffSource: 'TRENDYOL_CONTRACT',
      defaultShippingCarrierId: null,
      defaultShippingCarrier: null,
    }),
  ),
);

beforeEach(() => server.listen());
afterEach(() => server.resetHandlers());

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <NextIntlClientProvider locale="tr" messages={messages}>
    <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
  </NextIntlClientProvider>
);

describe('ShippingConfigForm', () => {
  it('renders carrier dropdown for TRENDYOL_CONTRACT', async () => {
    render(<ShippingConfigForm orgId="o1" storeId="s1" platform="TRENDYOL" />, { wrapper });
    await waitFor(() => expect(screen.getByText('Varsayılan Kargo Firması')).toBeInTheDocument());
  });

  it('switches to empty state when "Kendi Anlaşmam" tab is clicked', async () => {
    render(<ShippingConfigForm orgId="o1" storeId="s1" platform="TRENDYOL" />, { wrapper });
    fireEvent.click(await screen.findByText('Kendi Anlaşmam'));
    expect(await screen.findByText(/Excel ile yükle/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run**

Expected: 2 PASS.

### Task 5.11: Page integration

**Files:**

- Modify: `apps/web/src/app/(dashboard)/stores/[storeId]/settings/page.tsx` (or whatever the existing route is)

- [ ] **Step 1: Locate existing store settings page**

Run: `find apps/web/src/app -path "*stores*" -name "settings*"` and `find apps/web/src/features/stores -name "*settings*"`

If a settings page exists, add a "Kargo" section. If not, follow the existing pattern (a Tabs section in a settings page).

- [ ] **Step 2: Embed ShippingConfigForm**

```tsx
import { ShippingConfigForm } from '@/features/shipping/components/shipping-config-form';
// ...
<ShippingConfigForm orgId={orgId} storeId={storeId} platform={store.platform} />;
```

### Task 5.12: Boundary audit config

**Files:**

- Modify: `scripts/audit-feature-boundaries.config.ts`

- [ ] **Step 1: Add `shipping` to the allow list**

Find the section where `costs` or `sync` is marked as `'allow'` for cross-feature consumption. Add:

```ts
// 'shipping' is consumed by 'products' (Tahmini Net Kar column reads shipping fields)
// and by 'stores' (settings page embeds shipping config form).
{ source: 'products', target: 'shipping', decision: 'allow', reason: 'products page shows shipping estimate column' },
{ source: 'stores', target: 'shipping', decision: 'allow', reason: 'stores settings embeds shipping config form' },
```

(Adjust the literal config shape to match what's in the file — copy the format from existing rules.)

- [ ] **Step 2: Run boundary audit**

Run: `pnpm audit:boundaries`
Expected: no errors.

### Task 5.13: Manual smoke test

- [ ] **Step 1: Start dev**

```bash
pnpm dev --filter web
pnpm dev --filter api   # in a separate terminal
```

- [ ] **Step 2: Sign in as seed user**

Open `http://localhost:3000`. Sign in with seed credentials.

- [ ] **Step 3: Navigate to store settings → Kargo section**

Verify:

- Segment shows "Trendyol Anlaşmalı" selected by default
- Carrier dropdown shows 10 carriers, SENDEOMP listed
- Selecting SENDEOMP and clicking Kaydet → success toast
- Reloading page shows persisted selection
- Switching segment to "Kendi Anlaşmam" → "Yakında" empty state, disabled button
- Re-selecting "Trendyol Anlaşmalı" works; saving without picking carrier shows inline form error (SHIPPING_CARRIER_REQUIRED_FOR_TRENDYOL_CONTRACT)

If anything is broken, fix before committing.

### Task 5.14: Commit PR 5

```bash
git add apps/web/src/features/shipping/ \
        apps/web/messages/tr.json \
        apps/web/src/app/ \
        scripts/audit-feature-boundaries.config.ts

git commit -m "$(cat <<'EOF'
feat(shipping): store settings — kargo section with inline segment

Adds shipping feature slice (API + hooks + components), embeds
ShippingConfigForm in store settings page. Inline Segment layout with
carrier dropdown (TRENDYOL_CONTRACT) and "Yakında" empty state
(OWN_CONTRACT). i18n keys, hook + form tests with MSW, boundary audit
config allowed cross-feature consumption from products and stores.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# PR 6 — Frontend Products Table: Tahmini Net Kar Column

**Goal:** Add the single "Tahmini Net Kar" column with 5-state popover + aggregate banner.

### Task 6.1: Lib — shipping-estimate-status mapper

**Files:**

- Create: `apps/web/src/features/shipping/lib/shipping-estimate-status.ts`
- Create: `apps/web/src/features/shipping/lib/__tests__/shipping-estimate-status.test.ts`

- [ ] **Step 1: Write impl**

```ts
import type { ShippingEstimateStatus } from '../types/shipping.types';

export interface StatusVisual {
  iconColor: 'blue' | 'yellow' | 'red' | 'gray';
  iconChar: 'ⓘ' | '!' | '●';
  i18nKey?: `shipping.products.states.${Exclude<ShippingEstimateStatus, 'OK'>}`;
}

export function statusToVisual(status: ShippingEstimateStatus): StatusVisual {
  switch (status) {
    case 'OK':
      return { iconColor: 'blue', iconChar: 'ⓘ' };
    case 'NO_DESI':
      return { iconColor: 'yellow', iconChar: '!', i18nKey: 'shipping.products.states.NO_DESI' };
    case 'NO_CARRIER':
      return { iconColor: 'yellow', iconChar: '!', i18nKey: 'shipping.products.states.NO_CARRIER' };
    case 'OWN_CONTRACT_EMPTY':
      return {
        iconColor: 'gray',
        iconChar: '●',
        i18nKey: 'shipping.products.states.OWN_CONTRACT_EMPTY',
      };
    case 'DESI_OVERFLOW':
      return { iconColor: 'red', iconChar: '!', i18nKey: 'shipping.products.states.DESI_OVERFLOW' };
    default: {
      const _: never = status;
      throw new Error(`Unhandled status: ${_}`);
    }
  }
}
```

- [ ] **Step 2: Write test**

```ts
import { describe, it, expect } from 'vitest';
import { statusToVisual } from '../shipping-estimate-status';

describe('statusToVisual', () => {
  it.each([
    ['OK', 'blue', 'ⓘ'],
    ['NO_DESI', 'yellow', '!'],
    ['NO_CARRIER', 'yellow', '!'],
    ['OWN_CONTRACT_EMPTY', 'gray', '●'],
    ['DESI_OVERFLOW', 'red', '!'],
  ] as const)('%s → %s %s', (status, color, icon) => {
    const v = statusToVisual(status);
    expect(v.iconColor).toBe(color);
    expect(v.iconChar).toBe(icon);
  });
});
```

- [ ] **Step 3: Run**

Expected: 5 PASS.

### Task 6.2: Lib — format-carrier-chip

**Files:**

- Create: `apps/web/src/features/shipping/lib/format-carrier-chip.ts`
- Create: `apps/web/src/features/shipping/lib/__tests__/format-carrier-chip.test.ts`

- [ ] **Step 1: Write impl**

```ts
import type { ShippingTariffApplied } from '../types/shipping.types';

export function formatCarrierChip(
  code: string | null,
  tariff: ShippingTariffApplied | null,
): string | null {
  if (!code || !tariff) return null;
  if (tariff === 'OWN_CONTRACT') return 'Kendi anlaşma';
  return `${code} · ${tariff === 'BAREM' ? 'Barem' : 'Normal'}`;
}
```

- [ ] **Step 2: Test**

```ts
import { describe, it, expect } from 'vitest';
import { formatCarrierChip } from '../format-carrier-chip';

describe('formatCarrierChip', () => {
  it('returns null when fields are missing', () => {
    expect(formatCarrierChip(null, null)).toBeNull();
  });
  it('formats BAREM', () => {
    expect(formatCarrierChip('SENDEOMP', 'BAREM')).toBe('SENDEOMP · Barem');
  });
  it('formats NORMAL', () => {
    expect(formatCarrierChip('ARASMP', 'NORMAL')).toBe('ARASMP · Normal');
  });
  it('formats OWN_CONTRACT', () => {
    expect(formatCarrierChip('OWN', 'OWN_CONTRACT')).toBe('Kendi anlaşma');
  });
});
```

- [ ] **Step 3: Run**

Expected: 4 PASS.

### Task 6.3: Component — NetProfitPopover

**Files:**

- Create: `apps/web/src/features/products/components/net-profit-popover.tsx`

- [ ] **Step 1: Write**

```tsx
import { useTranslations } from 'next-intl';
import Link from 'next/link';

import type {
  ShippingEstimateStatus,
  ShippingTariffApplied,
} from '@/features/shipping/types/shipping.types';
import { formatCarrierChip } from '@/features/shipping/lib/format-carrier-chip';

export interface NetProfitPopoverData {
  status: ShippingEstimateStatus;
  salePrice: string;
  currentCostTry: string | null;
  commissionAmount: string | null;
  commissionRate: string | null;
  estimatedShippingNet: string | null;
  shippingCarrierCode: string | null;
  shippingTariffApplied: ShippingTariffApplied | null;
  netProfit: string | null;
  storeSettingsHref: string;
  variantEditHref: string;
}

export function NetProfitPopover(props: NetProfitPopoverData) {
  const t = useTranslations('shipping.products');
  if (props.status === 'OK') return <HappyPopover {...props} t={t} />;
  return <ErrorPopover {...props} t={t} />;
}

function HappyPopover({
  t,
  ...p
}: NetProfitPopoverData & { t: ReturnType<typeof useTranslations> }) {
  const chip = formatCarrierChip(p.shippingCarrierCode, p.shippingTariffApplied);
  return (
    <div className="space-y-1 text-sm">
      <div className="text-muted-foreground mb-2 text-xs tracking-wide uppercase">
        {t('popoverTitle')}
      </div>
      <Row label={t('rows.salePrice')} value={p.salePrice} />
      <Row label={`− ${t('rows.cost')}`} value={p.currentCostTry ?? '—'} negative />
      <Row
        label={`− ${t('rows.shipping')}${chip ? ` · ${chip}` : ''}`}
        value={p.estimatedShippingNet ?? '—'}
        negative
      />
      <Row
        label={`− ${t('rows.commission')}${p.commissionRate ? ` (%${p.commissionRate})` : ''}`}
        value={p.commissionAmount ?? '—'}
        negative
      />
      <div className="mt-2 border-t pt-2 font-semibold">
        <Row label={t('rows.netProfit')} value={p.netProfit ?? '—'} />
      </div>
    </div>
  );
}

function ErrorPopover({
  t,
  status,
  storeSettingsHref,
  variantEditHref,
}: NetProfitPopoverData & { t: ReturnType<typeof useTranslations> }) {
  if (status === 'OK') return null;
  const titleKey = `states.${status}.title` as const;
  const reasonKey = `states.${status}.reason` as const;
  const ctaKey = `states.${status}.cta` as const;
  const href = status === 'NO_DESI' ? variantEditHref : storeSettingsHref;
  const disabled = status === 'OWN_CONTRACT_EMPTY';
  return (
    <div className="space-y-2 text-sm">
      <div className="text-muted-foreground text-xs tracking-wide uppercase">{t(titleKey)}</div>
      <p className="text-muted-foreground">{t(reasonKey)}</p>
      {disabled ? (
        <span className="bg-muted text-muted-foreground inline-block rounded px-2 py-1 text-xs">
          {t(ctaKey)}
        </span>
      ) : (
        <Link href={href} className="text-primary text-xs hover:underline">
          {t(ctaKey)} →
        </Link>
      )}
    </div>
  );
}

function Row({ label, value, negative }: { label: string; value: string; negative?: boolean }) {
  return (
    <div className={`flex justify-between ${negative ? 'text-destructive' : ''}`}>
      <span>{label}</span>
      <span className="font-mono tabular-nums">{value}</span>
    </div>
  );
}
```

### Task 6.4: Component — NetProfitCell

**Files:**

- Create: `apps/web/src/features/products/components/net-profit-cell.tsx`

- [ ] **Step 1: Write**

```tsx
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Currency } from '@/components/patterns/currency';
import { statusToVisual } from '@/features/shipping/lib/shipping-estimate-status';
import { NetProfitPopover, type NetProfitPopoverData } from './net-profit-popover';

interface Props {
  data: NetProfitPopoverData;
}

export function NetProfitCell({ data }: Props) {
  const v = statusToVisual(data.status);
  const colorClass = {
    blue: 'bg-blue-100 text-blue-700',
    yellow: 'bg-yellow-100 text-yellow-700',
    red: 'bg-red-100 text-red-700',
    gray: 'bg-muted text-muted-foreground',
  }[v.iconColor];

  const display =
    data.status === 'OK' && data.netProfit ? (
      <Currency value={data.netProfit} className="font-semibold text-green-700" />
    ) : (
      <span className="text-muted-foreground">—</span>
    );

  return (
    <Popover>
      <PopoverTrigger className="inline-flex cursor-pointer items-center gap-2">
        {display}
        <span
          className={`inline-flex h-4 w-4 items-center justify-center rounded-full text-xs ${colorClass}`}
        >
          {v.iconChar}
        </span>
      </PopoverTrigger>
      <PopoverContent className="w-80">
        <NetProfitPopover {...data} />
      </PopoverContent>
    </Popover>
  );
}
```

### Task 6.5: Component test — NetProfitCell (5 states)

**Files:**

- Create: `apps/web/src/features/products/components/__tests__/net-profit-cell.test.tsx`

- [ ] **Step 1: Write**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import messages from '@/../messages/tr.json';

import { NetProfitCell } from '../net-profit-cell';
import type { NetProfitPopoverData } from '../net-profit-popover';

const baseData: NetProfitPopoverData = {
  status: 'OK',
  salePrice: '199.00',
  currentCostTry: '75.50',
  commissionAmount: '13.93',
  commissionRate: '7.00',
  estimatedShippingNet: '35.16',
  shippingCarrierCode: 'SENDEOMP',
  shippingTariffApplied: 'BAREM',
  netProfit: '74.41',
  storeSettingsHref: '/stores/s1/settings',
  variantEditHref: '/products/p1/variants/v1',
};

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <NextIntlClientProvider locale="tr" messages={messages}>
    {children}
  </NextIntlClientProvider>
);

describe('NetProfitCell', () => {
  it.each<['OK' | 'NO_DESI' | 'NO_CARRIER' | 'OWN_CONTRACT_EMPTY' | 'DESI_OVERFLOW']>([
    ['OK'],
    ['NO_DESI'],
    ['NO_CARRIER'],
    ['OWN_CONTRACT_EMPTY'],
    ['DESI_OVERFLOW'],
  ])('renders status %s', (status) => {
    render(
      <NetProfitCell data={{ ...baseData, status, netProfit: status === 'OK' ? '74.41' : null }} />,
      { wrapper },
    );
    if (status === 'OK') {
      expect(screen.getByText('74,41')).toBeInTheDocument(); // tr-TR locale
    } else {
      expect(screen.getByText('—')).toBeInTheDocument();
    }
  });

  it('opens popover with happy breakdown', async () => {
    render(<NetProfitCell data={baseData} />, { wrapper });
    fireEvent.click(screen.getByText('74,41'));
    expect(await screen.findByText('Kar Detayı')).toBeInTheDocument();
    expect(screen.getByText(/35,16/)).toBeInTheDocument();
  });

  it('opens popover with NO_DESI CTA', async () => {
    render(<NetProfitCell data={{ ...baseData, status: 'NO_DESI', netProfit: null }} />, {
      wrapper,
    });
    fireEvent.click(screen.getByText('—'));
    expect(await screen.findByText(/Ürüne desi ekle/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run**

Expected: 7 PASS (5 from each, 2 from popover-open). If `Currency` formats differently, adjust the assertion.

### Task 6.6: Component — MissingShippingBanner

**Files:**

- Create: `apps/web/src/features/products/components/missing-shipping-banner.tsx`

- [ ] **Step 1: Write**

```tsx
import { useTranslations } from 'next-intl';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

interface Props {
  counts: { total: number; noDesi: number; noCarrier: number; overflow: number };
  onFilterApply: () => void;
}

export function MissingShippingBanner({ counts, onFilterApply }: Props) {
  const t = useTranslations('shipping.products.banner');
  if (counts.total === 0) return null;
  return (
    <Alert className="mb-4">
      <AlertDescription className="flex items-center gap-3">
        <span>
          <strong>{t('title', { count: counts.total })}</strong>
          {' — '}
          {t('breakdown', {
            noDesi: counts.noDesi,
            noCarrier: counts.noCarrier,
            overflow: counts.overflow,
          })}
        </span>
        <Button variant="link" size="sm" onClick={onFilterApply} className="ml-auto">
          {t('filterCta')}
        </Button>
      </AlertDescription>
    </Alert>
  );
}
```

### Task 6.7: Banner test

**Files:**

- Create: `apps/web/src/features/products/components/__tests__/missing-shipping-banner.test.tsx`

- [ ] **Step 1: Write**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import messages from '@/../messages/tr.json';

import { MissingShippingBanner } from '../missing-shipping-banner';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <NextIntlClientProvider locale="tr" messages={messages}>
    {children}
  </NextIntlClientProvider>
);

describe('MissingShippingBanner', () => {
  it('does not render when total = 0', () => {
    const { container } = render(
      <MissingShippingBanner
        counts={{ total: 0, noDesi: 0, noCarrier: 0, overflow: 0 }}
        onFilterApply={() => {}}
      />,
      { wrapper },
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows counts and triggers filter callback', () => {
    const onFilterApply = vi.fn();
    render(
      <MissingShippingBanner
        counts={{ total: 23, noDesi: 12, noCarrier: 8, overflow: 3 }}
        onFilterApply={onFilterApply}
      />,
      { wrapper },
    );
    expect(screen.getByText(/23/)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Filtreyi uygula/));
    expect(onFilterApply).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run**

Expected: 2 PASS.

### Task 6.8: Integrate into products-table

**Files:**

- Modify: `apps/web/src/features/products/components/products-table.tsx`
- Modify: `apps/web/src/features/products/api/list-products.api.ts` (TypeScript response shape)

- [ ] **Step 1: Extend response type**

In `list-products.api.ts`, add the four shipping fields to the `ProductVariantInList` type (or wherever the response shape lives). Likely just inheriting from `@pazarsync/api-client` generated types — verify by reading the file.

- [ ] **Step 2: Add column to products-table**

Locate the column array (around line 141 per earlier grep). Append a new column definition for `tahminiNetKar`:

```tsx
{
  id: 'tahminiNetKar',
  header: () => tCols('netProfit'),
  cell: ({ row }) => {
    if (row.original.kind !== 'variant') return null;
    const v = row.original.variant;
    return (
      <NetProfitCell data={{
        status: v.shippingEstimateStatus,
        salePrice: v.salePrice,
        currentCostTry: v.currentCostTry,
        commissionAmount: v.commissionAmount,         // from commission-rates PR (if shipped)
        commissionRate: v.commissionRate,
        estimatedShippingNet: v.estimatedShippingNet,
        shippingCarrierCode: v.shippingCarrierCode,
        shippingTariffApplied: v.shippingTariffApplied,
        netProfit: computeNetProfit(v),               // tiny helper inline
        storeSettingsHref: `/stores/${v.storeId}/settings`,
        variantEditHref: `/products/${v.productId}/variants/${v.id}/edit`,
      }} />
    );
  },
},
```

`computeNetProfit`:

```ts
function computeNetProfit(v: ProductVariantInList): string | null {
  if (v.shippingEstimateStatus !== 'OK') return null;
  if (!v.currentCostTry || !v.estimatedShippingNet || !v.commissionAmount) return null;
  const net = new Decimal(v.salePrice)
    .sub(v.currentCostTry)
    .sub(v.estimatedShippingNet)
    .sub(v.commissionAmount);
  return net.toFixed(2);
}
```

(Import `Decimal` from `decimal.js`.)

- [ ] **Step 3: Add banner above table**

```tsx
import { MissingShippingBanner } from './missing-shipping-banner';

// Compute counts from current page rows
const counts = useMemo(
  () =>
    rows.reduce(
      (acc, r) => {
        if (r.kind !== 'variant') return acc;
        const s = r.variant.shippingEstimateStatus;
        if (s === 'OK') return acc;
        return {
          total: acc.total + 1,
          noDesi: acc.noDesi + (s === 'NO_DESI' ? 1 : 0),
          noCarrier: acc.noCarrier + (s === 'NO_CARRIER' ? 1 : 0),
          overflow: acc.overflow + (s === 'DESI_OVERFLOW' ? 1 : 0),
        };
      },
      { total: 0, noDesi: 0, noCarrier: 0, overflow: 0 },
    ),
  [rows],
);

// Above the table:
<MissingShippingBanner
  counts={counts}
  onFilterApply={() => setFilter({ shippingEstimateStatus: 'NOT_OK' })}
/>;
```

(The filter behavior — adding a `shippingEstimateStatus` query param to the products list call — is a small addition to the existing list filter logic. Defer to inline handling there.)

- [ ] **Step 4: Add column header i18n key**

Add to `apps/web/messages/tr.json` under the existing product column namespace:

```json
"products": { "columns": { "netProfit": "Tahmini Net Kar", ... } }
```

### Task 6.9: Manual smoke test

- [ ] **Step 1: Start dev servers**

```bash
pnpm dev
```

- [ ] **Step 2: Set up scenario data**

Sign in. Create a variant with `dimensionalWeight=2.0, salePrice=150, deliveryDuration=1, isRushDelivery=false`. Set store carrier to SENDEOMP. Navigate to products list.

Verify the row shows green Tahmini Net Kar with popover (Barem detail). Click ⓘ — popover shows correct breakdown with carrier chip.

- [ ] **Step 3: Test each empty state**

Repeat for each scenario (set the variant fields to trigger each state). Confirm icons, colors, popover content, and CTA links work.

- [ ] **Step 4: Test aggregate banner**

Create multiple variants spanning different empty states. Verify banner shows counts. Click "Filtreyi uygula" — table filters to non-OK rows.

### Task 6.10: Commit PR 6

```bash
git add apps/web/src/features/shipping/lib/ \
        apps/web/src/features/products/components/net-profit-cell.tsx \
        apps/web/src/features/products/components/net-profit-popover.tsx \
        apps/web/src/features/products/components/missing-shipping-banner.tsx \
        apps/web/src/features/products/components/__tests__/ \
        apps/web/src/features/products/components/products-table.tsx \
        apps/web/src/features/products/api/list-products.api.ts \
        apps/web/messages/tr.json

git commit -m "$(cat <<'EOF'
feat(shipping): products table — Tahmini Net Kar column + popover + banner

NetProfitCell renders one of 5 states (OK / NO_DESI / NO_CARRIER /
OWN_CONTRACT_EMPTY / DESI_OVERFLOW) with color-coded icons. Popover shows
either a happy breakdown (Satış − Maliyet − Kargo − Komisyon = Net Kar
with carrier chip) or an error reason + CTA. MissingShippingBanner above
the table aggregates by category with a single "Filtreyi uygula" CTA.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# Final Verification

### Task F.1: Full test suite

- [ ] **Step 1: Run unit tests across the monorepo**

```bash
pnpm check:all
```

Expected: typecheck + lint + unit + format check all PASS.

- [ ] **Step 2: Run integration tests**

```bash
pnpm supabase:start
pnpm db:push
pnpm check:full
```

Expected: full integration suite PASS, including new shipping tests and equivalence test.

- [ ] **Step 3: Verify boundary audit clean**

```bash
pnpm audit:boundaries
```

Expected: no errors.

### Task F.2: Push branch + open PR per stage

Each of PRs 1–6 should be pushed and opened as separate GitHub PRs in order. Per memory `feedback_git_workflow`, NEVER push directly to main.

```bash
git push -u origin feature/shipping-cost-estimation-design
# Then open PR via gh CLI or GitHub UI.
```

For incremental delivery, the typical workflow is:

1. Create a branch per PR (e.g., `feature/shipping-pr1-schema`, then rebase before next PR)
2. OR keep the single branch and use stacked PRs (preferred by some teams)

Defer choice to the human reviewer. Ask before creating PRs (per memory `feedback_ask_before_commit`).

---

## Self-Review

**Spec coverage:**

- §2 confirmed decisions 1–12 — all reflected in tasks above.
- §4 data model — Tasks 1.1–1.4 cover enum + 4 models + Store mod.
- §5 algorithm — Tasks 2.3–2.10 cover all branches plus helper.
- §6 API surface — Tasks 3.1–3.7 cover all 4 routes + extend products list (Task 4.3).
- §7 frontend — PR 5 (settings) + PR 6 (products) covers everything.
- §8 RLS — Tasks 1.11–1.13.
- §9 testing — unit (2.2, 2.3–2.10, 6.1, 6.2), integration (3.8–3.11, 4.2, 4.4), tenant isolation (3.12), RLS coverage (1.12), RLS isolation (1.13).
- §10 phasing — PR boundaries match.

**Placeholder scan:**

- No "TBD", "TODO", or "implement later" in task bodies.
- Error handling: each `throwApiError` invocation present; each refine() has explicit code string.
- Frontend i18n keys defined in Task 5.1 before use.

**Type consistency:**

- `ShippingEstimate.amount: Decimal` consistent across service file and tests.
- `EstimateOutcome` union: `{ ok: true; estimate }` vs `{ ok: false; reason }` matches throughout.
- Status enum same in DB SQL, validator schema, frontend types: 'OK' | 'NO_CARRIER' | 'NO_DESI' | 'OWN_CONTRACT_EMPTY' | 'DESI_OVERFLOW'.
- Carrier code field is `code` everywhere (not `slug`, not `name`).

**Open items resolved inline:**

- The store-settings page path is inspected in Task 5.11 (Step 1) rather than assumed.
- The product validator file (single file vs folder) is inspected in Task 4.3 (Step 1).
- Cross-platform guard error class confirmed in Task 3.2 (Step 2).

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-17-shipping-cost-estimation.md`. Two execution options:

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints

Which approach?
