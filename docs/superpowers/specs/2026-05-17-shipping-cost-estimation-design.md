# Shipping Cost Estimation — Design Spec

**Status:** Draft, pending user review
**Author:** Brainstorm session 2026-05-17
**Implementation:** Tracked via separate `docs/superpowers/plans/` plan (writing-plans phase)

---

## 1. Summary

Sellers configure a default Trendyol-contracted shipping carrier per Store (or opt for "Own Contract" — UI placeholder in V1, Excel upload deferred to V2). The system seeds Trendyol's official contracted shipping tariff data (per-carrier desi tables + Barem destek tier prices) into global reference tables.

For each product variant in the catalog, the system **dynamically estimates shipping cost** using the seller's chosen carrier, the variant's `dimensionalWeight` (desi), the variant's `salePrice` (for Barem tier matching), and the variant's existing fast-delivery setup fields (`deliveryDuration`, `isRushDelivery`, `fastDeliveryOptions`) to decide Barem eligibility. The estimate flows through the products list endpoint as a new field (`estimatedShippingNet`) alongside the cost-profile system's `currentCostTry` and the commission-rates feature's commission display. The products table renders a single "Tahmini Net Kar" column with a popover showing the full breakdown.

V1 is **variant-level dynamic only**. Order-level snapshot (write-once when sipariş webhook arrives) and settlement reconciliation (real vs estimated discrepancy) are forward-designed in the schema and service interface but deferred to V2 (when the orders integration feature lands).

This is the third pillar of PazarSync's profit engine, alongside cost profiles (PR #176-era) and commission rates (current PR pipeline).

---

## 2. Confirmed Product Decisions

| #   | Decision                                               | Notes                                                                                                                                                                                                                                                                                |
| --- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **Dynamic per-variant computation (no caching)**       | Raw SQL CTE in products list, same pattern as cost-profile `current_cost_try`. Tariff change → automatic next page load.                                                                                                                                                             |
| 2   | **Multi-item order: MAX(items.desi)**                  | Not sum, not multiply by quantity. Mirrors Trendyol's "tek paket" billing reality. (V2 — interface ready in V1)                                                                                                                                                                      |
| 3   | **Per-product Barem detection**                        | Eligibility derived from variant's existing `deliveryDuration` / `isRushDelivery` / `fastDeliveryOptions`. No user toggle, no settings switch.                                                                                                                                       |
| 4   | **Optimistic estimates**                               | V1 always assumes "successful Barem tier" (cheapest). Real cost reconciles at settlement. No `successTier` field stored.                                                                                                                                                             |
| 5   | **All thresholds in DB**                               | No hard-coded numbers: 350 TL Barem cutoff lives in `shipping_barem_tariffs.max_order_amount`, 10-desi cap in `shipping_carriers.max_barem_desi`, 1-day terminal in `shipping_carriers.max_barem_eligible_delivery_duration`. Trendyol changes → SQL UPDATE only, zero code changes. |
| 6   | **getProviders authoritative codes**                   | `ShippingCarrier.code` matches Trendyol's `getProviders` API (`SENDEOMP`, `ARASMP`, …) — not `changeCargoProvider`'s older `KOLAYGELSINMP` naming. Includes Trendyol numeric `externalId` and `taxNumber` for invoice matching.                                                      |
| 7   | **Per-Store carrier scope**                            | One Store = one Trendyol seller account. Each Store has its own default carrier + own-contract toggle. Different Stores in same Org can use different carriers.                                                                                                                      |
| 8   | **Own-contract UI: active segment + empty Excel page** | Seller CAN switch to "Kendi Anlaşmam" in V1; sees a "Yakında" Excel upload placeholder. Estimator returns `OWN_CONTRACT_EMPTY` until V2 ships Excel upload.                                                                                                                          |
| 9   | **Manual tariff updates (no admin UI V1)**             | Tariff changes via SQL update by ops/admin. Reference data REPLACE semantics — same as `MarketplaceCommissionRate`.                                                                                                                                                                  |
| 10  | **Single popover for breakdown**                       | Products table column shows only "Tahmini Net Kar"; click/hover reveals Satış − Maliyet − Kargo (with carrier+tariffApplied chip) − Komisyon = Net Kar breakdown.                                                                                                                    |
| 11  | **Aggregate banner at top of products table**          | Counts variants with missing estimate by category ("desi eksik (12) · carrier (8) · yüksek desi (3)") with single "Filtreyi uygula" CTA. Category-specific filters deferred (V2).                                                                                                    |
| 12  | **5 cell states with distinct popover + CTA**          | Happy / NO_DESI / NO_CARRIER / OWN_CONTRACT_EMPTY / DESI_OVERFLOW. Color-coded icons (blue ⓘ, yellow !, red !, gray ●). Each empty state has a CTA pointing to the fix path.                                                                                                         |

### Implicit decisions

- Tariffs stored **KDV hariç (net)** — consistent with cost-profile `amount` convention. UI/popover renders with optional KDV indicator.
- Tariffs are **global reference data** (RLS: `USING (true)` for authenticated), same as `MarketplaceCommissionRate`. Manual updates go through the `postgres` role.
- `own_shipping_tariffs` is **tenant-private** (RLS: `is_org_member(organization_id)`). V1 always empty.
- Estimator service is **single source of truth**; raw SQL CTE in products list is a performance mirror, tested via an equivalence test.
- The `shipping` feature is intentionally consumable cross-feature — `products` feature reads from it. An `'allow'` rule will be added to `audit-feature-boundaries.config.ts` matching the `sync` and `costs` precedents.

---

## 3. Architecture Overview

Three layers:

```
┌─────────────────────────────────────────────────────────────────┐
│  REFERENCE DATA (per-platform, global; RLS public-read)          │
│  • ShippingCarrier      — 10 Trendyol carriers (Id+Code+TaxNo)   │
│  • ShippingDesiTariff   — (carrier × desi) → priceNet            │
│  • ShippingBaremTariff  — (carrier × [min,max] tutar) → priceNet │
│  Manual SQL update path (no admin UI V1)                          │
└────────────────────────────┬─────────────────────────────────────┘
                             │ consumed by
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  PER-STORE CONFIGURATION (tenant-private)                         │
│  • Store.shippingTariffSource  (TRENDYOL_CONTRACT | OWN_CONTRACT)│
│  • Store.defaultShippingCarrierId                                │
│  • OwnShippingTariff           (V1 empty, V2 Excel destination)  │
└────────────────────────────┬─────────────────────────────────────┘
                             │ called by
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  ESTIMATOR SERVICE  (apps/api/src/services/shipping-estimator)   │
│  • estimateShippingCostForVariant(id, tx) → EstimateOutcome      │
│  • estimateShippingCostForOrder(id, tx)   → V2 placeholder       │
│  Reads carrier config + tariffs + variant fields.                │
└──────┬──────────────────────────────────────────────┬───────────┘
       │ (V1)                                          │ (V2)
       ▼                                               ▼
   PRODUCTS LIST API                          ORDER WEBHOOK SNAPSHOT
   • Raw SQL CTE (no N+1)                     • Order.estimatedShippingCost
   • Returns per-variant estimate             • Write-once at arrival
   • Source of truth: service fn              • Reconciliation at settlement
   • Equivalence test                         • Forward-designed in V1
```

---

## 4. Data Model

4 new tables, 1 modification, 1 new enum. All money is `Decimal`. All enum values live in Prisma schema only (`feedback_no_string_literal_enum_duplicates`).

### 4.1 `ShippingCarrier` — global reference

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

### 4.2 `ShippingDesiTariff` — global reference

```prisma
model ShippingDesiTariff {
  id            String   @id @default(uuid()) @db.Uuid
  carrierId     String   @map("carrier_id") @db.Uuid
  desi          Int                                            // 0, 1, 2, ... (PDF'in tüm desi satırları)
  priceNet      Decimal  @map("price_net") @db.Decimal(10, 2)  // KDV hariç
  effectiveFrom DateTime @default(now()) @map("effective_from") @db.Date
  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")

  carrier ShippingCarrier @relation(fields: [carrierId], references: [id], onDelete: Cascade)

  @@unique([carrierId, desi])
  @@index([carrierId, desi])
  @@map("shipping_desi_tariffs")
}
```

### 4.3 `ShippingBaremTariff` — global reference

```prisma
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
```

### 4.4 `OwnShippingTariff` — tenant-private (V1 empty)

```prisma
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

### 4.5 `Store` modification

```prisma
model Store {
  // ... existing fields preserved ...
  shippingTariffSource     ShippingTariffSource @default(TRENDYOL_CONTRACT) @map("shipping_tariff_source")
  defaultShippingCarrierId String?              @map("default_shipping_carrier_id") @db.Uuid

  defaultShippingCarrier ShippingCarrier?    @relation(fields: [defaultShippingCarrierId], references: [id], onDelete: SetNull)
  ownShippingTariffs     OwnShippingTariff[]
}
```

### 4.6 New enum

```prisma
enum ShippingTariffSource {
  TRENDYOL_CONTRACT
  OWN_CONTRACT
}
```

`ShippingTariffApplied` is a **service-layer type** (not persisted in V1 — only relevant when V2 adds order snapshot persistence):

```ts
type ShippingTariffApplied = 'NORMAL' | 'BAREM' | 'OWN_CONTRACT';
```

### 4.7 V1 seed data (Prisma migration)

10 carriers from Trendyol's `getProviders` endpoint:

| externalId | code        | displayName      | supportsBaremDestek | sortOrder |
| ---------- | ----------- | ---------------- | ------------------- | --------- |
| 4          | YKMP        | Yurtiçi Kargo    | true                | 1         |
| 6          | HOROZMP     | Horoz Lojistik   | **false**           | 9         |
| 7          | ARASMP      | Aras Kargo       | true                | 2         |
| 9          | SURATMP     | Sürat Kargo      | true                | 3         |
| 10         | DHLECOMMP   | DHL eCommerce    | true                | 4         |
| 17         | TEXMP       | Trendyol Express | true                | 5         |
| 19         | PTTMP       | PTT Kargo        | true                | 6         |
| 20         | CEVAMP      | CEVA             | **false**           | 10        |
| 30         | CEVATEDARIK | CEVA Tedarik     | **false**           | 11        |
| 38         | SENDEOMP    | Kolay Gelsin     | true                | 7         |

Plus desi-tariff rows (carrier × desi 0..N) and Barem rows (carrier × amount-range) seeded from the 2026-04-15 Trendyol Anlaşmalı Kargo Fiyatları PDF. Initial Barem ranges: `[0, 200)` and `[200, 350)`. 10-desi cap, 1-day terminal eligibility.

---

## 5. Calculation & Estimator Pipeline

### 5.1 When estimates happen

**V1: per-variant, on every products list request.** No caching. Raw SQL CTE in the existing products list endpoint (`apps/api/src/routes/product.routes.ts`) computes estimates inline alongside `current_cost_try` and commission display.

**V2 (future): per-order, at sipariş webhook arrival.** Snapshot captured via `estimateShippingCostForOrder()` and persisted to `Order.estimatedShippingCost` (new column, write-once). Reconciliation logic against settlement-derived `Order.shippingCost` is V2's concern.

### 5.2 `estimateShippingCostForVariant(variantId, tx)`

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
  const variant = await tx.productVariant.findUnique({
    where: { id: variantId },
    include: { store: { include: { defaultShippingCarrier: true } } },
  });
  if (!variant?.store) return { ok: false, reason: 'STORE_NOT_FOUND' };

  if (variant.store.shippingTariffSource === 'OWN_CONTRACT') {
    const own = await resolveOwnContractForVariant(variant, tx);
    return own ?? { ok: false, reason: 'OWN_CONTRACT_EMPTY' };
  }

  const carrier = variant.store.defaultShippingCarrier;
  if (!carrier) return { ok: false, reason: 'NO_CARRIER' };

  const desi = variant.dimensionalWeight ?? variant.syncedDimensionalWeight;
  if (!desi) return { ok: false, reason: 'NO_DESI' };

  // Barem path — tüm eşikler veriden okunur
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
          amount: new Decimal(barem.priceNet),
          carrierCode: carrier.code,
          tariffApplied: 'BAREM',
          sourceTariffId: barem.id,
          baseDesiAtEstimate: desi,
        },
      };
    }
    // salePrice Barem range'i dışında → normal desi tariff'e düş
  }

  // Normal desi-bazlı tariff
  const desiCeil = Math.ceil(desi.toNumber());
  const desiRow = await tx.shippingDesiTariff.findFirst({
    where: { carrierId: carrier.id, desi: desiCeil },
  });
  if (!desiRow) return { ok: false, reason: 'DESI_OVERFLOW' };

  return {
    ok: true,
    estimate: {
      amount: new Decimal(desiRow.priceNet),
      carrierCode: carrier.code,
      tariffApplied: 'NORMAL',
      sourceTariffId: desiRow.id,
      baseDesiAtEstimate: desi,
    },
  };
}

function hasFastDeliverySetup(variant: ProductVariant, carrier: ShippingCarrier): boolean {
  return (
    (variant.deliveryDuration !== null &&
      variant.deliveryDuration <= carrier.maxBaremEligibleDeliveryDuration) ||
    variant.isRushDelivery === true ||
    (Array.isArray(variant.fastDeliveryOptions) && variant.fastDeliveryOptions.length > 0)
  );
}
```

### 5.3 V2 forward-design: `estimateShippingCostForOrder`

Interface only — implementation lands with the orders integration feature:

```ts
export async function estimateShippingCostForOrder(
  orderId: string,
  tx: Prisma.TransactionClient,
): Promise<EstimateOutcome>;
```

V2 logic (sketched): take `MAX(items[].variant.dimensionalWeight)` as the package desi; use `order.totalAmount` instead of `variant.salePrice` for Barem range matching; rest of the algorithm identical to variant-level. Order webhook caller persists the result to `Order.estimatedShippingCost` (new write-once column) inside the same transaction that creates the order.

### 5.4 Products list endpoint: raw SQL CTE

For the products list query, N+1 calls to the service function are avoided by inlining the same algorithm as a raw SQL CTE — identical pattern to cost-profile `current_cost_try`. Full SQL shown in section 3.5 of the brainstorming transcript (kept in spec but elided here for brevity; lives in `apps/api/src/services/shipping-estimator.sql.ts` as a constant).

The service function is the **canonical algorithm**; the raw SQL is a **performance mirror** validated by an equivalence test (§9.5).

### 5.5 Edge cases

| Case                                                                        | Behavior                                                                                               |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Store with no defaultShippingCarrierId AND TRENDYOL_CONTRACT                | `{ ok: false, reason: 'NO_CARRIER' }` — UI shows yellow ! state with "Mağaza ayarlarına git" CTA       |
| Variant with both `dimensionalWeight` and `syncedDimensionalWeight` null    | `{ ok: false, reason: 'NO_DESI' }` — UI shows yellow ! state with "Ürüne desi ekle" CTA                |
| Variant desi > max desi-tariff row for the carrier                          | `{ ok: false, reason: 'DESI_OVERFLOW' }` — UI shows red ! state suggesting CEVA/CEVA Tedarik/Horoz     |
| Store with OWN_CONTRACT and no own tariff data (V1 always)                  | `{ ok: false, reason: 'OWN_CONTRACT_EMPTY' }` — UI shows gray ● soft state with disabled "yakında" CTA |
| Variant salePrice within Barem range but variant has NO fast delivery setup | Falls through to normal desi-bazlı tariff (NOT eligible for Barem)                                     |
| Variant Barem-eligible but salePrice ≥ all Barem ranges (i.e., ≥ 350)       | Falls through to normal desi-bazlı tariff                                                              |
| Carrier `supportsBaremDestek = false` (CEVA, CEVA Tedarik, Horoz)           | Skip Barem path entirely, use desi tariff                                                              |
| Tariff updated mid-session                                                  | Next products list request reflects new tariff (no cache)                                              |

### 5.6 Idempotency & write-once (V2 concern)

V1 has no persistence — every call is fresh. V2 adds order-level snapshot which uses the same write-once pattern as cost-profile `unit_cost_snapshot` (app-layer guard + DB trigger). Out of scope for this V1 spec.

---

## 6. API Surface

All routes nest under `/api/v1/organizations/:orgId/...`. Generated to typed `@pazarsync/api-client` via `@hono/zod-openapi`.

### 6.1 New routes (4)

| Method | Path                                   | Purpose                                                                               |
| ------ | -------------------------------------- | ------------------------------------------------------------------------------------- |
| GET    | `/shipping-carriers`                   | List available carriers; filter `?platform=TRENDYOL`. Drives Store settings dropdown. |
| GET    | `/stores/:storeId/shipping-config`     | Get current store's shipping config (source + carrierId + carrier details).           |
| PATCH  | `/stores/:storeId/shipping-config`     | Update source and/or carrier.                                                         |
| GET    | `/stores/:storeId/own-shipping-tariff` | List own contract tariff rows (V1: always empty array).                               |

### 6.2 Extended route (existing products list)

`GET /v1/organizations/:orgId/stores/:storeId/products` — per-variant response gains:

```ts
type ProductVariantInList = {
  // existing: id, barcode, salePrice, currentCostTry, profileCount, costStatus, ...
  estimatedShippingNet: string | null; // Decimal string, KDV hariç TRY
  shippingCarrierCode: string | null; // 'SENDEOMP' | ... | null
  shippingTariffApplied: 'NORMAL' | 'BAREM' | 'OWN_CONTRACT' | null;
  shippingEstimateStatus: 'OK' | 'NO_CARRIER' | 'NO_DESI' | 'OWN_CONTRACT_EMPTY' | 'DESI_OVERFLOW';
};
```

### 6.3 Validators

`apps/api/src/validators/shipping-config.validator.ts`:

```ts
import { z } from 'zod';
import { ShippingTariffSource } from '@pazarsync/db';

export const updateShippingConfigSchema = z
  .object({
    shippingTariffSource: z.enum(ShippingTariffSource),
    defaultShippingCarrierId: z.string().uuid('INVALID_CARRIER_ID').nullable(),
  })
  .refine((v) => v.shippingTariffSource === 'OWN_CONTRACT' || v.defaultShippingCarrierId !== null, {
    message: 'SHIPPING_CARRIER_REQUIRED_FOR_TRENDYOL_CONTRACT',
    path: ['defaultShippingCarrierId'],
  });

export type UpdateShippingConfigInput = z.infer<typeof updateShippingConfigSchema>;
```

### 6.4 Error codes

| Class                   | HTTP | code                                              | When                                                          |
| ----------------------- | ---- | ------------------------------------------------- | ------------------------------------------------------------- |
| `ValidationError`       | 422  | `SHIPPING_CARRIER_REQUIRED_FOR_TRENDYOL_CONTRACT` | TRENDYOL_CONTRACT seçildi, carrierId null                     |
| `InvalidReferenceError` | 422  | `SHIPPING_CARRIER_PLATFORM_MISMATCH`              | Trendyol store'a Hepsiburada carrier set edilmeye çalışılıyor |
| `NotFoundError`         | 404  | `SHIPPING_CARRIER_NOT_FOUND`                      | Bilinmeyen carrier ID                                         |

Existing classes reused — no new domain errors. Frontend translates `code` → `common.errors.<CODE>` via existing global `QueryCache` `onError`.

### 6.5 Service surface (not exposed as routes)

```ts
// apps/api/src/services/shipping-estimator.service.ts
export async function estimateShippingCostForVariant(variantId, tx): Promise<EstimateOutcome>;
export async function estimateShippingCostForOrder(orderId, tx): Promise<EstimateOutcome>; // V2 placeholder
```

Called from products list endpoint (V1) and order webhook (V2). Both via `Prisma.TransactionClient` — no standalone DB pool.

### 6.6 OpenAPI

All new routes use `createRoute()` with `.openapi(name, { description, example })` schema metadata. `pnpm api:sync` regenerates `packages/api-client/openapi.json`. Log in `docs/api-changelog.md` under `[Unreleased]`.

---

## 7. Frontend Architecture

### 7.1 New feature slice

```
apps/web/src/features/shipping/
├── api/
│   ├── list-shipping-carriers.api.ts
│   ├── get-shipping-config.api.ts
│   ├── update-shipping-config.api.ts
│   └── list-own-shipping-tariff.api.ts
├── components/
│   ├── shipping-config-form.tsx           # Inline Segment + carrier dropdown + own-contract empty state
│   ├── shipping-config-empty-state.tsx    # "Excel upload yakında" placeholder
│   ├── carrier-select.tsx                 # Dropdown with 10 carriers, sorted, Barem-support icon
│   └── shipping-tariff-source-segment.tsx # 2-option segment control
├── hooks/
│   ├── use-shipping-carriers.ts
│   ├── use-shipping-config.ts
│   └── use-update-shipping-config.ts
├── lib/
│   ├── format-carrier-chip.ts
│   └── shipping-estimate-status.ts        # Status → translation key mapper
├── validation/
│   └── shipping-config.schema.ts
└── types/
    └── shipping.types.ts
```

### 7.2 Page route placement

The shipping config lives inside the existing Store settings page, NOT as a separate route. New tab/section:

`apps/web/src/app/(dashboard)/stores/[storeId]/settings/page.tsx` — extended with a new "Kargo" section/tab (depending on existing settings structure).

### 7.3 Cross-feature touches

| File                                                       | Change                                            |
| ---------------------------------------------------------- | ------------------------------------------------- |
| `features/products/components/products-table.tsx`          | New `Tahmini Net Kar` column (single number cell) |
| `features/products/components/net-profit-cell.tsx`         | NEW — renders 5 states with popover               |
| `features/products/components/net-profit-popover.tsx`      | NEW — 5 popover variants (happy + 4 empty)        |
| `features/products/components/missing-shipping-banner.tsx` | NEW — aggregate banner                            |
| `features/products/api/list-products.api.ts`               | Response type extended with shipping fields       |
| `features/stores/components/store-settings-page.tsx`       | Embed `ShippingConfigForm` in settings layout     |
| `scripts/audit-feature-boundaries.config.ts`               | `'allow'` rule for `shipping` as target feature   |

### 7.4 Component composition (UI workflow cascade)

Per `apps/web/CLAUDE.md` rules: scan `components/patterns/` first, then `components/ui/`, then shadcn registry, custom last.

| Need                            | Layer         | Component                                             |
| ------------------------------- | ------------- | ----------------------------------------------------- |
| Settings tab page chrome        | patterns      | `PageHeader`                                          |
| Inline Segment control          | ui            | `Tabs` (or shadcn `ToggleGroup` if better fits)       |
| Carrier dropdown                | ui            | `Select` (with icon slot for Barem indicator)         |
| Empty state in "Kendi Anlaşmam" | patterns      | `EmptyState`                                          |
| Save button                     | ui            | `Button`                                              |
| Products table net profit cell  | feature-local | NEW (`NetProfitCell`)                                 |
| Popover on cell                 | ui            | `Popover`                                             |
| Carrier chip in popover         | feature-local | NEW (`CarrierChip`) — promotion candidate to patterns |
| Status icons                    | external      | Hugeicons (consistent with existing design system)    |
| Aggregate banner                | ui            | `Alert` (compose)                                     |

No new primitives, no forks. Promote `CarrierChip` to `components/patterns/` if reused by orders feature in V2.

### 7.5 React Query keys

```ts
export const shippingKeys = {
  all: ['shipping'] as const,
  carriers: (filters?: { platform?: Platform }) =>
    [...shippingKeys.all, 'carriers', filters] as const,
  config: (storeId: string) => [...shippingKeys.all, 'config', storeId] as const,
  ownTariff: (storeId: string) => [...shippingKeys.all, 'own-tariff', storeId] as const,
};
```

### 7.6 Mutation invalidation matrix

| Mutation                        | Invalidates                                                                               |
| ------------------------------- | ----------------------------------------------------------------------------------------- |
| `updateShippingConfig(storeId)` | `config(storeId)`, `productsKeys.all` (whole products list — estimate depends on carrier) |

### 7.7 Empty/error states (5)

All five states render in the products table's `Tahmini Net Kar` column. Each gets its own popover content and CTA — see Section 12 (Out of Scope) for why we didn't make banner categories individually filterable in V1.

| Status             | Icon | Color  | Popover Content                            | CTA                                     |
| ------------------ | ---- | ------ | ------------------------------------------ | --------------------------------------- |
| OK (happy)         | ⓘ    | blue   | Full breakdown table                       | "Detayları gör" (passive)               |
| NO_DESI            | !    | yellow | "Desi değeri eksik..."                     | "Ürüne desi ekle" → edit product        |
| NO_CARRIER         | !    | yellow | "Varsayılan kargo firması seçili değil..." | "Mağaza ayarlarına git" → settings      |
| OWN_CONTRACT_EMPTY | ●    | gray   | "Excel upload yakında..."                  | "Excel ile yükle" (disabled V1)         |
| DESI_OVERFLOW      | !    | red    | "Tarife dışı, CEVA/Horoz dene"             | "Kargo firmanızı değiştirin" → settings |

### 7.8 Aggregate banner

`MissingShippingBanner` at top of products table, hidden when `shippingEstimateStatus = 'OK'` for all visible variants. Shows category breakdown ("desi eksik (12) · carrier (8) · yüksek desi (3)"). Single "Filtreyi uygula" CTA filters products list to show only variants with non-OK status (V1 — category-specific filters deferred to V2).

---

## 8. Security: Multi-tenancy & RLS

### 8.1 Invariants (defense-in-depth)

| Layer      | Mechanism                                                                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Middleware | `requireOrgMembership(:orgId)` — existing                                                                                                        |
| API        | All queries pass `organizationId = ctx.orgId`                                                                                                    |
| Service    | `updateShippingConfig()` checks `carrier.platform === store.platform`; OwnShippingTariff INSERT checks `store.organizationId === ctx.orgId` (V2) |
| RLS        | Policies appended to `supabase/sql/rls-policies.sql` (§8.2)                                                                                      |
| Schema     | `own_shipping_tariffs.organization_id` denormalized + indexed                                                                                    |

### 8.2 RLS policies (append to `supabase/sql/rls-policies.sql`)

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

**RLS strategy:** SELECT-only via RLS, writes default-deny for `authenticated`. Backend Hono uses Prisma with `postgres` role (bypasses RLS), service-layer enforces cross-org checks before INSERT/UPDATE.

**Flat `is_org_member(organization_id)` check** — no cross-table EXISTS in policy bodies (per `feedback_rls_recursion_security_definer`).

Add `own_shipping_tariffs` to `coverage.rls.test.ts`'s TENANT_TABLES list.

### 8.3 Cross-platform carrier guard (service layer)

```ts
// services/shipping-config.service.ts
async function updateShippingConfig(storeId, orgId, input, tx) {
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

  return tx.store.update({
    where: { id: storeId },
    data: {
      shippingTariffSource: input.shippingTariffSource,
      defaultShippingCarrierId: input.defaultShippingCarrierId,
    },
  });
}
```

### 8.4 Write-once for V2 (not in V1)

When V2 adds `Order.estimatedShippingCost`, a DB trigger `reject_order_estimated_shipping_update` will mirror the `reject_snapshot_update` pattern from cost-profiles. V1 doesn't ship this trigger because no persisted estimate exists yet.

---

## 9. Testing Strategy

### 9.1 Unit (TDD)

| Path                                                                            | Coverage                                                                                                                                                               |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/services/__tests__/shipping-estimator.service.test.ts`            | All branches: TRENDYOL_CONTRACT happy, Barem path matched, Barem path eligible but salePrice out-of-range → falls through to desi, OWN_CONTRACT empty, 5 failure modes |
| `apps/api/src/services/__tests__/shipping-estimator-helpers.test.ts`            | `hasFastDeliverySetup()` table-driven; permutations of deliveryDuration / isRushDelivery / fastDeliveryOptions vs `maxBaremEligibleDeliveryDuration`                   |
| `apps/web/src/features/shipping/lib/__tests__/format-carrier-chip.test.ts`      | All 10 carriers + Barem chip variant                                                                                                                                   |
| `apps/web/src/features/shipping/lib/__tests__/shipping-estimate-status.test.ts` | 5 status values → i18n key                                                                                                                                             |

### 9.2 Integration (route-level, real DB)

```
apps/api/tests/integration/routes/shipping/
├── get-shipping-carriers.test.ts
├── get-shipping-config.test.ts
├── patch-shipping-config.test.ts
└── get-own-shipping-tariff.test.ts        # V1: empty array response
```

Each: happy path, validation error, not-found, platform-mismatch error.

### 9.3 Tenant isolation (NON-NEGOTIABLE)

```
apps/api/tests/integration/tenant-isolation/shipping-config.test.ts
```

- Org A user GET /stores/orgB-store/shipping-config → 404
- Org A user PATCH /stores/orgB-store/shipping-config → 404
- Org A user GET /stores/orgB-store/own-shipping-tariff → 404
- Org A user PATCH /stores/orgA-store with carrierId from a different-platform store → 422

### 9.4 RLS coverage

```
apps/api/tests/integration/rls/own-shipping-tariffs.rls.test.ts
```

`createRlsScopedClient` with real JWT; Org A scoped client cannot SELECT Org B rows. Append `own_shipping_tariffs` to TENANT_TABLES in `coverage.rls.test.ts`.

Verify global tables (`shipping_carriers`, `shipping_desi_tariffs`, `shipping_barem_tariffs`) are READable by authenticated users but not anonymous.

### 9.5 Equivalence test (CRITICAL)

```
apps/api/tests/integration/shipping-estimator-equivalence.test.ts
```

Table-driven test: for each scenario (10+ rows: happy/Barem matched/Barem fallback/desi normal/desi overflow/no carrier/no desi/own contract empty), run:

1. `estimateShippingCostForVariant(id, tx)` — canonical
2. Raw SQL CTE on same variant
3. Assert outputs equal (amount, carrierCode, tariffApplied, status)

This test catches "I changed the service but forgot the SQL" regressions.

### 9.6 Frontend

| Path                                                                                   | Coverage                                                                                     |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `apps/web/src/features/shipping/components/__tests__/shipping-config-form.test.tsx`    | Segment toggle re-renders, carrier dropdown populated, form submit, validation error display |
| `apps/web/src/features/shipping/hooks/__tests__/use-update-shipping-config.test.ts`    | MSW: mutation → invalidates products keys                                                    |
| `apps/web/src/features/products/components/__tests__/net-profit-cell.test.tsx`         | All 5 states render correctly, popover content matches, CTAs navigate                        |
| `apps/web/src/features/products/components/__tests__/missing-shipping-banner.test.tsx` | Conditional render (hide when all OK), category counts, single CTA link                      |

---

## 10. Phasing (PR Breakdown)

| PR    | Scope                                                                                                                          | Approx. size | Depends on |
| ----- | ------------------------------------------------------------------------------------------------------------------------------ | ------------ | ---------- |
| **1** | Schema (4 tables + Store mod + 1 enum) + RLS + seed migration (10 carriers + Trendyol desi/Barem tariff rows)                  | M            | —          |
| **2** | Estimator service (`shipping-estimator.service.ts`) + helpers + unit tests                                                     | S            | 1          |
| **3** | Backend routes (carriers list, shipping-config GET/PATCH, own-tariff list) + validators + integration tests + tenant isolation | M            | 1, 2       |
| **4** | Products list endpoint extension (raw SQL CTE) + equivalence test + OpenAPI regen                                              | S            | 1, 2       |
| **5** | Frontend Store settings "Kargo" section (Inline Segment + dropdown + "Yakında" placeholder) + form/hook/tests                  | M            | 3          |
| **6** | Frontend products table — Tahmini Net Kar column + 5-state popover + aggregate banner                                          | M            | 4          |

**Critical path:** 1 → 2 → 4 → 6.

PR 3 and PR 5 can parallel with PR 4 once 1+2 land.

PR 6 depends on PR 4 (products list response shape).

Total: ~6 PRs, smaller than cost-profile's 11 because V1 scope excludes order snapshot and settlement reconciliation.

---

## 11. Open Issues / Risks

1. **Tariff PDF parsing for seed migration** — Need to manually transcribe 10 carriers × ~50 desi rows + Barem rows from Trendyol PDF into the seed SQL. PR 1 should checksum the PDF source date.
2. **Raw SQL CTE complexity** — The CTE has multiple LEFT JOIN LATERAL clauses. Equivalence test (§9.5) is the safety net. If query p99 grows on large product catalogs, evaluate materialized view (similar to cost-profile risk #3).
3. **Carrier code drift** — Trendyol's `getProviders` and `changeCargoProvider` use different codes for Kolay Gelsin (SENDEOMP vs KOLAYGELSINMP). V1 uses getProviders codes. If V2/V3 adds carrier change operations, a mapping table will be needed.
4. **What if Trendyol changes the Barem structure entirely** (e.g., removes Barem, adds 3rd tier)? Data-driven schema handles range edits and new INSERT rows, but structural changes (e.g., new field) need migration. Low frequency risk per Trendyol's historical pattern.
5. **`Order.shippingCost` semantic** — Currently filled at order sync with whatever Trendyol order API returns. V2 needs to clarify: is this the "real" value, or a Trendyol-provided estimate that gets reconciled at settlement? Outside V1 scope.
6. **Aggregate banner category filters** — V1 has single "Filtreyi uygula" CTA. If sellers ask for "show me only the carrier-missing variants," V2 adds category-specific query params.
7. **Live test/preview calculator** in Store settings — Would help sellers validate carrier choice ("3 desi, 250 TL → 95 TL"). Not critical for V1; could be a 5-line addition in V2.
8. **`fastDeliveryOptions` JSON shape** — Currently a Json array. Algorithm checks `length > 0`. If Trendyol adds nuanced options (e.g., "Today Cargo" specifically eligible vs other labels not), we'd need to inspect the values. V2 if needed.
9. **OwnShippingTariff data model for non-integer desi ranges** — V1 schema uses integer `desi`. When V2 ships Excel upload, if sellers' own contracts use decimal/range desi (e.g., "0.5-2 desi"), schema needs revision. Defer to Excel upload PR.

---

## 12. Out of Scope (v1)

- **Order-level estimatedShippingCost snapshot** — interface forward-designed, implementation V2
- **Settlement reconciliation** (real vs estimated discrepancy UI/reporting) — V2
- **Excel upload for own contract** — V2 (user explicit defer)
- **Admin UI for tariff CRUD** — manual SQL via `postgres` role only V1; V3+ if scale demands
- **Per-product carrier override** — varsayılan carrier yeterli V1; V3+ if requested
- **Tariff history/versioning** (`effective_to`) — V1 has `effective_from` audit-only; full versioning V2
- **Live test/preview calculator** in Store settings — V2
- **Aggregate banner category filters** (individual click on "desi eksik (12)") — V1 single CTA
- **`ShippingTariffApplied` persistence** at Order level — V2
- **Hepsiburada tariff data seed** — schema is multi-platform-ready, but only Trendyol seeded V1
- **Estimated commission column** — handled by separate commission-rates frontend PR (parallel work, not blocking)
- **`Order.netProfit` write-once DB trigger** — V2 with order snapshot
- **Carrier logos in dropdown** — V2 polish
- **Bulk re-attach UI** when seller switches default carrier — invalidation handles it automatically (React Query)
- **changeCargoProvider integration** (operational, not pricing) — V3+

---

## 13. References

- Project memory: `marketplace-parameters-data-driven`, `estimates-optimistic-settlement-reconciles`, `trendyol-carrier-codes`, `no-string-literal-enum-duplicates`, `rls-recursion-security-definer`, `realtime-wire-shapes-mirror-api`, `tests-dont-wipe-seed`, `schema-only-pr-is-a-lie`, `sync-is-cross-feature-by-design`
- `docs/SECURITY.md` — multi-tenancy + credential rules
- `docs/TESTING.md` — test pattern library (multi-tenancy section)
- `docs/integrations/trendyol/7-trendyol-marketplace-entegrasyonu/siparis-entegrasyonlari.md` — §11 (changeCargoProvider) and §17 (Kargo firmaları)
- `docs/integrations/trendyol/7-trendyol-marketplace-entegrasyonu/urun-entegrasyonlari-v2.md` — getProviders authoritative carrier list
- `docs/integrations/trendyol/8-trendyol-muhasebe-ve-finans-entegrasyonu/kargo-faturasi-detaylari.md` — settlement-time real shipping cost shape (V2 reconciliation source)
- Engagement page (2026-04-15 dated): Trendyol Anlaşmalı Kargo Fiyatları PDF — tariff seed source
- `docs/superpowers/specs/2026-05-09-cost-profiles-design.md` — sister system for snapshot pattern + `current_cost_try` pattern reference
- `apps/api/CLAUDE.md` — RFC 7807 error vocabulary, route architecture
- `apps/web/CLAUDE.md` — UI cascade rules (patterns/ → ui/ → registry → custom), error handling pipeline
