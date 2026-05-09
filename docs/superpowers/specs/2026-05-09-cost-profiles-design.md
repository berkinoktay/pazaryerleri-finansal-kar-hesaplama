# Cost Profiles — Design Spec

**Status:** Draft, pending user review
**Author:** Brainstorm session 2026-05-09
**Implementation:** Tracked via separate `docs/superpowers/plans/` plan (writing-plans phase)

---

## 1. Summary

Sellers attach reusable **cost profiles** (purchase, packaging, software, etc.) to product variants. Profiles are org-scoped, typed, multi-currency, and edit-history-tracked. When orders arrive via marketplace sync, the cost is **snapshotted write-once** into the order line: past calculations are sealed forever, and future cost edits never propagate backward. The products table renders **live current cost** (which moves with FX rates) per variant, while order profit is computed once and frozen. Variants without any attached profile have null cost snapshots and null profit; the UI surfaces this prominently in two places (products table banner and dashboard widget) so the seller knows what to complete.

This is the foundational economics primitive the rest of the platform (profit reports, settlement reconciliation, expense tracking) depends on.

---

## 2. Confirmed Product Decisions

| #   | Decision                                                       | Notes                                                                                                                 |
| --- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 1   | **Variant-level** profile attachment                           | Order lines are variant-keyed; per-variant cost differences are real (S vs XXL, plain vs printed)                     |
| 2   | **Truly write-once snapshots**                                 | Past calculations are completely locked; no recalculate, no manual adjustments, no escape hatch                       |
| 3   | **Native currency + per-profile FX mode**                      | TRY/USD/EUR; AUTO (TCMB rates, daily cron) or MANUAL (per-profile fixed rate); rates frozen into order snapshots      |
| 4   | **Typed enum**                                                 | `COGS · PACKAGING · SHIPPING · SOFTWARE · MARKETING · OTHER` — for reporting only; calculation sums all types equally |
| 5   | **Cell popover + inline create + parent aggregate + bulk FAB** | Single-cell ops and bulk ops share the same backend endpoints (length-1 arrays vs N-arrays)                           |
| 6   | **No backfill**                                                | Orders synced when no profiles exist stay null forever; UI warns in products table banner + dashboard widget          |

### Implicit decisions baked in

- Profiles are **organization-scoped** — one set per Org, attachable to variants in any store
- `profile.amount` is **net** (assumes VAT-registered seller); `vatRate: Int` stored separately for display + future reporting
- **Append-only versions** table for history; **soft archive** (`archivedAt`), no hard delete
- TCMB rate refreshes do **not** generate audit events (external market data ≠ user action)
- Cross-feature consumption: `costs` feature is intentionally consumable by `products`, `dashboard`, `orders`, `settlements`. An `'allow'` rule is added to `audit-feature-boundaries.config.ts` matching the `sync` precedent.

---

## 3. Architecture Overview

### Data flow

```
                                            ┌─ user edits profile ──┐
                                            │                        ▼
                                ┌──────────────────────────────────────┐
                                │  CostProfile (mutable; org-scoped)   │
                                │  ── append-only mirror ──▶ Versions  │
                                └────────────────────┬─────────────────┘
                                                     │ M:N attach (link table)
                                                     ▼
                                ┌──────────────────────────────────────┐
                                │  ProductVariant                       │
                                │  cost cell renders LIVE from profiles │
                                └────────────────────┬─────────────────┘
                                                     │ ordered as
                                                     ▼
   marketplace sync ──▶  capture snapshot   ──▶  ┌─────────────────────────┐
   (Trendyol order)      • sum profile amounts   │ OrderItem               │
                         • FX rates used         │ ─ unitCostSnapshot      │
                         • profile IDs + names   │ ─ snapshotCapturedAt    │ ◀── frozen
                                                 │ + components rows       │     forever
                                                 └─────────────────────────┘

   FX cron (daily) ──▶  fx_rates table  ──▶  read by AUTO profiles for live "current TRY"
                        (TCMB endpoint)         and for the rate captured into snapshots
```

### Key invariants

1. **`OrderItem.unitCostSnapshot` is write-once.** No code path UPDATEs that column. Enforced at the app layer + a Postgres trigger that rejects updates.
2. **Calculation triggers exactly one event:** order arrival via marketplace sync. No "recalculate" code path exists anywhere in the codebase. PRs that introduce one are rejected.
3. **Profile mutations are append-only at the version layer.** The current row is mutable; every save also INSERTs into `cost_profile_versions` in the same transaction.
4. **Cross-tenant invariant:** every query filters by `organizationId`. The variant↔profile link is rejected if `variant.org !== profile.org !== ctx.org`. Enforced at app layer + RLS.

### Module placement

| Layer                   | Path                                                                                          |
| ----------------------- | --------------------------------------------------------------------------------------------- |
| Frontend feature        | `apps/web/src/features/costs/`                                                                |
| Frontend touches        | `apps/web/src/features/products/`, `apps/web/src/features/dashboard/`                         |
| Backend routes          | `apps/api/src/routes/cost-profiles/`, `apps/api/src/routes/cost-profile-attachments/`         |
| Backend services        | `apps/api/src/services/cost-snapshot.service.ts`, `apps/api/src/services/fx-rates.service.ts` |
| Edge function           | `supabase/functions/fx-rates-sync/`                                                           |
| Schema                  | `packages/db/prisma/schema.prisma`                                                            |
| RLS                     | `supabase/sql/cost-profiles-rls.sql`, `supabase/sql/cost-snapshot-immutable.sql`              |
| Audit-boundaries policy | `scripts/audit-feature-boundaries.config.ts`                                                  |

---

## 4. Data Model

5 new tables + 1 modification to `OrderItem`. All money is `Decimal`; all enum values live in Prisma schema (no string-literal duplicates per `feedback_no_string_literal_enum_duplicates`).

### 4.1 `CostProfile` — mutable, org-scoped

```prisma
model CostProfile {
  id              String          @id @default(uuid()) @db.Uuid
  organizationId  String          @map("organization_id") @db.Uuid
  name            String
  type            CostProfileType
  amount          Decimal         @db.Decimal(12, 2)               // NET amount, in `currency`
  currency        Currency        @default(TRY)
  vatRate         Int             @default(0) @map("vat_rate")     // 0/1/8/10/18/20 (KDV)
  fxRateMode      FxRateMode      @default(AUTO) @map("fx_rate_mode")
  manualFxRate    Decimal?        @map("manual_fx_rate") @db.Decimal(14, 6)
  note            String?
  archivedAt      DateTime?       @map("archived_at")
  createdAt       DateTime        @default(now()) @map("created_at")
  updatedAt       DateTime        @updatedAt @map("updated_at")
  createdBy       String?         @map("created_by") @db.Uuid
  updatedBy       String?         @map("updated_by") @db.Uuid

  organization Organization                @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  versions     CostProfileVersion[]
  variantLinks ProductVariantCostProfile[]

  @@unique([organizationId, name])
  @@index([organizationId, archivedAt])
  @@index([organizationId, type])
  @@map("cost_profiles")
}

enum CostProfileType { COGS PACKAGING SHIPPING SOFTWARE MARKETING OTHER }
enum Currency        { TRY USD EUR }
enum FxRateMode      { AUTO MANUAL }
```

### 4.2 `CostProfileVersion` — append-only mirror

```prisma
model CostProfileVersion {
  id             String          @id @default(uuid()) @db.Uuid
  profileId      String          @map("profile_id") @db.Uuid
  organizationId String          @map("organization_id") @db.Uuid     // denormalized for RLS
  version        Int                                                   // 1, 2, 3... per profile
  // full snapshot of profile state at this version:
  name           String
  type           CostProfileType
  amount         Decimal         @db.Decimal(12, 2)
  currency       Currency
  vatRate        Int             @map("vat_rate")
  fxRateMode     FxRateMode      @map("fx_rate_mode")
  manualFxRate   Decimal?        @map("manual_fx_rate") @db.Decimal(14, 6)
  note           String?
  archivedAt     DateTime?       @map("archived_at")
  // change metadata:
  changedFields  String[]        @map("changed_fields")
  changedBy      String?         @map("changed_by") @db.Uuid
  changedAt      DateTime        @default(now()) @map("changed_at")
  changeReason   String?         @map("change_reason")

  profile CostProfile @relation(fields: [profileId], references: [id], onDelete: Cascade)

  @@unique([profileId, version])
  @@index([profileId, changedAt(sort: Desc)])
  @@index([organizationId])
  @@map("cost_profile_versions")
}
```

### 4.3 `ProductVariantCostProfile` — M:N link

```prisma
model ProductVariantCostProfile {
  id               String   @id @default(uuid()) @db.Uuid
  productVariantId String   @map("product_variant_id") @db.Uuid
  profileId        String   @map("profile_id") @db.Uuid
  organizationId   String   @map("organization_id") @db.Uuid       // denormalized; cross-org guard
  attachedAt       DateTime @default(now()) @map("attached_at")
  attachedBy       String?  @map("attached_by") @db.Uuid

  productVariant ProductVariant @relation(fields: [productVariantId], references: [id], onDelete: Cascade)
  profile        CostProfile    @relation(fields: [profileId], references: [id], onDelete: Restrict)
  // ↑ Restrict: profile cannot be hard-deleted while variants reference it. Soft-archive only.

  @@unique([productVariantId, profileId])
  @@index([profileId])
  @@index([organizationId, productVariantId])
  @@map("product_variant_cost_profiles")
}
```

### 4.4 `OrderItemCostSnapshotComponent` — frozen, write-once

```prisma
model OrderItemCostSnapshotComponent {
  id             String          @id @default(uuid()) @db.Uuid
  orderItemId    String          @map("order_item_id") @db.Uuid
  organizationId String          @map("organization_id") @db.Uuid
  // captured AT calc time (frozen even if profile changes later):
  profileId      String          @map("profile_id") @db.Uuid     // FK kept for traceability
  profileName    String          @map("profile_name")             // denormalized — survives rename
  profileType    CostProfileType @map("profile_type")
  amount         Decimal         @db.Decimal(12, 2)               // native amount
  currency       Currency
  vatRate        Int             @map("vat_rate")
  amountInTry    Decimal         @map("amount_in_try") @db.Decimal(12, 2)
  fxRateMode     FxRateMode      @map("fx_rate_mode")
  fxRateUsed     Decimal         @map("fx_rate_used") @db.Decimal(14, 6)
  fxRateSource   String          @map("fx_rate_source")           // 'TCMB-2026-05-09' | 'MANUAL' | 'TRY-NATIVE'

  orderItem OrderItem   @relation(fields: [orderItemId], references: [id], onDelete: Cascade)
  profile   CostProfile @relation(fields: [profileId], references: [id], onDelete: Restrict)

  @@index([orderItemId])
  @@index([organizationId, profileType])    // reporting: cost-by-type aggregations
  @@index([organizationId, profileId])      // reporting: per-profile usage
  @@map("order_item_cost_snapshot_components")
}
```

### 4.5 `FxRate` — daily TCMB cache, global

```prisma
model FxRate {
  id        String   @id @default(uuid()) @db.Uuid
  currency  Currency
  rateDate  DateTime @map("rate_date") @db.Date
  rateToTry Decimal  @map("rate_to_try") @db.Decimal(14, 6)
  source    String                                          // 'TCMB' for now
  fetchedAt DateTime @default(now()) @map("fetched_at")

  @@unique([currency, rateDate])
  @@index([currency, rateDate(sort: Desc)])
  @@map("fx_rates")
}
```

### 4.6 `OrderItem` modification

```prisma
model OrderItem {
  // ...existing fields preserved (id, orderId, productVariantId, quantity, unitPrice, commissionRate, commissionAmount)...
  organizationId         String?   @map("organization_id") @db.Uuid                          // NEW
  unitCostSnapshot       Decimal?  @map("unit_cost_snapshot") @db.Decimal(12, 2)             // NEW
  snapshotCapturedAt     DateTime? @map("snapshot_captured_at")                               // NEW
  costSnapshotComponents OrderItemCostSnapshotComponent[]                                     // NEW

  @@index([organizationId, snapshotCapturedAt])  // NEW: "uncalculated orders" + "calculated in date range"
}
```

### 4.7 Why a separate components table (not JSON)

Profile types are for reporting (the muhasebeci view). Reporting "total packaging spend in Q2 across 5,000 orders" with JSON requires `jsonb_array_elements()` unnesting per row — works but slow and unindexed. Separate table = `WHERE profile_type = 'PACKAGING'` is index-fast.

### 4.8 Migration strategy for existing `ProductVariant.costPrice`

The field stays in place for v1 (vestigial, unused). After cost profiles are populated and stable, a follow-up PR either drops the column or runs a data migration creating an "Imported COGS" profile per variant from non-null values. Per `feedback_schema_only_pr_is_a_lie`, that's a separate PR with its own migration plan — not bolted onto this feature.

### 4.9 Boundary: `Expense` ≠ `CostProfile`

The existing `Expense` model is for **business overhead** (rent, salaries, ad spend). `CostProfile` is for **per-unit product economics**. They never share rows. A schema comment near both models documents the boundary; same in `apps/web/src/features/costs/README.md`.

---

## 5. Calculation & FX Pipeline

### 5.1 When snapshots happen

**Exactly one trigger: order arrival via marketplace sync.** Specifically, in the existing sync Edge Function (`siparis-sync` or equivalent):

```
Trendyol API ──▶  Edge Function `siparis-sync`
                  │
                  ▼ (single transaction)
                  1. UPSERT Order (idempotent on storeId, platformOrderId)
                  2. For each line:
                     - INSERT OrderItem if not exists
                     - If just inserted → captureCostSnapshot(orderItemId)
                     - If already exists → leave alone (write-once)
                  3. Compute Order.netProfit — write-once: only sets when
                     current value is null AND all items have snapshots
                  4. SyncLog row updated
```

### 5.2 `captureCostSnapshot(orderItemId, tx)`

```ts
async function captureCostSnapshot(orderItemId: string, tx: Prisma.Transaction) {
  const item = await tx.orderItem.findUnique({
    where: { id: orderItemId },
    include: { productVariant: true },
  });
  if (item.unitCostSnapshot !== null) {
    throw new SnapshotAlreadyCapturedError(orderItemId); // app-layer write-once guard
  }
  if (!item.productVariantId) return; // unattributed line, leave null

  const profiles = await tx.productVariantCostProfile
    .findMany({
      where: { productVariantId: item.productVariantId },
      include: { profile: true },
    })
    .then((links) => links.map((l) => l.profile).filter((p) => p.archivedAt === null));

  if (profiles.length === 0) return; // no profiles → snapshot stays null → profit stays null

  const components: SnapshotComponentInput[] = [];
  for (const p of profiles) {
    const fx = await resolveFxRateForSnapshot(p, tx);
    if (fx === null) {
      logger.warn(
        { profileId: p.id, currency: p.currency },
        'fx rate unavailable, aborting snapshot',
      );
      return; // best-effort: leave null
    }
    components.push({
      profileId: p.id,
      profileName: p.name,
      profileType: p.type,
      amount: p.amount,
      currency: p.currency,
      vatRate: p.vatRate,
      amountInTry: p.amount.mul(fx.rate),
      fxRateMode: p.fxRateMode,
      fxRateUsed: fx.rate,
      fxRateSource: fx.source,
      organizationId: item.organizationId,
    });
  }

  const sumTry = components.reduce((acc, c) => acc.add(c.amountInTry), new Decimal(0));
  await tx.orderItem.update({
    where: { id: orderItemId },
    data: { unitCostSnapshot: sumTry, snapshotCapturedAt: new Date() },
  });
  await tx.orderItemCostSnapshotComponent.createMany({ data: components });
}
```

### 5.3 `resolveFxRateForSnapshot(profile, tx)`

```ts
async function resolveFxRateForSnapshot(p: CostProfile, tx) {
  if (p.currency === 'TRY') return { rate: new Decimal(1), source: 'TRY-NATIVE' };
  if (p.fxRateMode === 'MANUAL') return { rate: p.manualFxRate, source: 'MANUAL' };
  // AUTO:
  const row = await tx.fxRate.findFirst({
    where: { currency: p.currency },
    orderBy: { rateDate: 'desc' },
  });
  if (!row) return null;
  return { rate: row.rateToTry, source: `TCMB-${row.rateDate.toISOString().slice(0, 10)}` };
}
```

### 5.4 Profit computation (write-once)

```ts
const items = await tx.orderItem.findMany({ where: { orderId } });
const allHaveSnapshot = items.every((i) => i.unitCostSnapshot !== null);
const order = await tx.order.findUnique({ where: { id: orderId } });

// Write-once: only set netProfit when it's currently null AND all data is in.
if (order.netProfit === null && allHaveSnapshot) {
  const netProfit = computeProfit(order, items); // existing formula + new term: − Σ(unitCostSnapshot × quantity)
  await tx.order.update({ where: { id: orderId }, data: { netProfit } });
}
// If order.netProfit is already non-null: do nothing. Past calculations are sealed.
// If allHaveSnapshot is false: do nothing. Wait for the missing snapshot to arrive (or stay null forever if profiles never get attached).
```

The existing `computeProfit` function gets one new subtraction term: `Σ(orderItem.unitCostSnapshot × orderItem.quantity)`. The exact existing terms (revenue, commission, shipping, fees) are preserved. Both sides of the equation are NET of VAT, consistent with `profile.amount` being net.

### 5.5 Live "current TRY" for the products page (different code path)

The products table cell does NOT read snapshots. It computes the live current TRY from active profiles each time the page loads, via raw SQL in the products list endpoint:

```sql
SELECT
  pv.id,
  COALESCE(SUM(
    CASE
      WHEN cp.currency = 'TRY' THEN cp.amount
      WHEN cp.fx_rate_mode = 'MANUAL' THEN cp.amount * cp.manual_fx_rate
      WHEN cp.fx_rate_mode = 'AUTO'   THEN cp.amount * fx.rate_to_try
    END
  ), 0)::DECIMAL(12,2) AS current_cost_try,
  COUNT(cp.id) AS profile_count
FROM product_variants pv
LEFT JOIN product_variant_cost_profiles pvcp ON pvcp.product_variant_id = pv.id
LEFT JOIN cost_profiles cp ON cp.id = pvcp.profile_id AND cp.archived_at IS NULL
LEFT JOIN LATERAL (
  SELECT rate_to_try FROM fx_rates
  WHERE currency = cp.currency
  ORDER BY rate_date DESC LIMIT 1
) fx ON cp.currency != 'TRY' AND cp.fx_rate_mode = 'AUTO'
WHERE pv.organization_id = $1
GROUP BY pv.id;
```

Implementation: raw `$queryRaw` returning `{ variantId, currentCostTry, profileCount }`, joined into the products list response.

### 5.6 TCMB cron

- **Edge Function**: `supabase/functions/fx-rates-sync/index.ts`
- **Schedule**: pg_cron, daily at 16:00 Istanbul (`0 13 * * 1-5` UTC), business days only
- **Endpoint**: `https://www.tcmb.gov.tr/kurlar/today.xml` (free, no auth)
- **Behavior**: parse XML, extract USD/TRY and EUR/TRY (`ForexBuying`), upsert into `fx_rates` with `rateDate = today`, `source = 'TCMB'`
- **Failure**: retry 3× exponential backoff (15s/45s/2m); after final failure, log error, write `SyncLog` row with `errorCode = 'FX_FETCH_FAILED'`, alert via existing pipeline
- **Recovery**: orders syncing while rates are stale fall back to most-recent cached rate; staleness >2 days logs a warning per snapshot but doesn't block

### 5.7 Idempotency & write-once enforcement (defense in depth)

1. **App layer**: `captureCostSnapshot` throws `SnapshotAlreadyCapturedError` if `unitCostSnapshot !== null`. Sync worker calls it only after a successful INSERT (not UPSERT).
2. **DB trigger**: `BEFORE UPDATE ON order_items` rejects when `unit_cost_snapshot` or `snapshot_captured_at` would change. Components table denies UPDATE outright.
3. **Test**: integration test asserts the trigger throws on attempted update. Lives at `apps/api/tests/integration/cost-snapshot-immutability.test.ts`.

### 5.8 Edge cases

| Case                                                       | Behavior                                                                                                   |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Variant with 0 profiles when order arrives                 | `unit_cost_snapshot` stays null. `Order.netProfit` stays null. Surfaced as warning.                        |
| Variant with profiles, FX rate stale (>2 days)             | Snapshot proceeds with most-recent cached rate; logged as warning.                                         |
| Variant with AUTO profile, no FX rate ever fetched         | Snapshot aborts, `unit_cost_snapshot` stays null. Logged as error.                                         |
| Profile archived between sync arrival and snapshot capture | Excluded from snapshot via `archivedAt IS NULL` filter (same as if detached).                              |
| Re-sync same order (Trendyol replay)                       | OrderItem already exists → skipped → snapshot untouched.                                                   |
| Order arrives, profiles attach later                       | Past order's snapshot stays null forever. Only future orders get the new profile. UI warns at attach time. |

---

## 6. API Surface

All routes nest under `/api/v1/organizations/:orgId/...`. Generated to typed `@pazarsync/api-client` via `@hono/zod-openapi`.

### 6.1 Profile CRUD (8)

| Method | Path                                   | Purpose                                                         |
| ------ | -------------------------------------- | --------------------------------------------------------------- |
| GET    | `/cost-profiles`                       | List; filters: `type`, `archived`, `q` (name search); paginated |
| POST   | `/cost-profiles`                       | Create — also writes version 1 in same tx                       |
| GET    | `/cost-profiles/:id`                   | Detail                                                          |
| PATCH  | `/cost-profiles/:id`                   | Update — appends new version row in same tx                     |
| POST   | `/cost-profiles/:id/archive`           | Soft archive                                                    |
| POST   | `/cost-profiles/:id/restore`           | Un-archive                                                      |
| GET    | `/cost-profiles/:id/versions`          | History timeline (DESC, paginated)                              |
| GET    | `/cost-profiles/:id/attached-variants` | "Where is this used"                                            |

### 6.2 Variant-side attachment read (1)

| Method | Path                                 | Purpose                                                |
| ------ | ------------------------------------ | ------------------------------------------------------ |
| GET    | `/variants/:variantId/cost-profiles` | Profiles attached to one variant — drives cell popover |

### 6.3 Attachment writes (3 — bulk-shaped from day one)

| Method | Path                                | Body                                                                         |
| ------ | ----------------------------------- | ---------------------------------------------------------------------------- |
| POST   | `/cost-profile-attachments/attach`  | `{ profileIds: UUID[], variantIds: UUID[] }` — Cartesian, idempotent         |
| POST   | `/cost-profile-attachments/detach`  | `{ profileIds: UUID[], variantIds: UUID[] }`                                 |
| POST   | `/cost-profile-attachments/replace` | `{ variantIds: UUID[], profileIds: UUID[] }` — per variant, replace full set |

Single-cell ops call the same endpoints with arrays of length 1. One implementation, two UIs.

### 6.4 Stats / FX (2)

| Method | Path                           | Purpose                                                         |
| ------ | ------------------------------ | --------------------------------------------------------------- |
| GET    | `/products/missing-cost-stats` | `{ count, totalVariants, byStore: [...] }` for dashboard banner |
| GET    | `/fx-rates/latest`             | `{ USD: { rate, date, source }, EUR: {...} }` for UI display    |

### 6.5 Existing route extended (1)

`GET /products` per-variant response gains:

```ts
currentCostTry: Decimal | null;
profileCount: number;
costStatus: 'OK' | 'NO_PROFILES' | 'FX_STALE' | 'FX_MISSING';
```

### 6.6 Validators

`apps/api/src/validators/cost-profile.validator.ts` — Zod 4, enums imported from `@pazarsync/db` (no string literal duplicates):

```ts
export const createCostProfileSchema = z
  .object({
    name: z.string().min(1).max(100),
    type: z.enum(CostProfileType),
    amount: z.string().refine((v) => new Decimal(v).gte(0), 'must be >= 0'),
    currency: z.enum(Currency),
    vatRate: z.number().int().min(0).max(100),
    fxRateMode: z.enum(FxRateMode),
    manualFxRate: z.string().nullable(),
    note: z.string().max(2000).nullable(),
  })
  .refine(
    (v) =>
      v.fxRateMode === 'AUTO' || (v.manualFxRate !== null && new Decimal(v.manualFxRate).gt(0)),
    { message: 'manualFxRate required when fxRateMode is MANUAL', path: ['manualFxRate'] },
  )
  .refine((v) => v.currency !== 'TRY' || v.fxRateMode === 'AUTO', {
    message: 'TRY profiles must use AUTO mode (rate is always 1)',
    path: ['fxRateMode'],
  });
```

### 6.7 Domain errors (RFC 7807)

| Class                   | HTTP | code                                  | When                                         |
| ----------------------- | ---- | ------------------------------------- | -------------------------------------------- |
| `ConflictError`         | 409  | `COST_PROFILE_NAME_TAKEN`             | Unique `(orgId, name)` violation             |
| `InvalidReferenceError` | 422  | `COST_PROFILE_VARIANT_ORG_MISMATCH`   | Cross-org attach attempt — security-critical |
| `ConflictError`         | 409  | `COST_PROFILE_ARCHIVED_CANNOT_ATTACH` | Attach to archived profile                   |
| `NotFoundError`         | 404  | `COST_PROFILE_NOT_FOUND`              | Self-evident                                 |
| `ValidationError`       | 400  | `VALIDATION_ERROR`                    | Field-level Zod errors                       |

Frontend translates `code` → `common.errors.<CODE>` via existing global `QueryCache` `onError`.

### 6.8 Cost-snapshot service (NOT exposed as a route)

`apps/api/src/services/cost-snapshot.service.ts` — `captureCostSnapshot(orderItemId, tx)` and `recomputeOrderProfit(orderId, tx)` from §5. Called only from sync workers.

### 6.9 Realtime: polling for v1

The products table cell shows live current cost. v1 uses React Query `refetchOnWindowFocus` + invalidate-on-mutation. Realtime subscription deferred (single-user editing, not collaborative; per `feedback_realtime_wire_shapes_mirror_api`, subscription wires require parallel updates).

---

## 7. Frontend Architecture

### 7.1 New feature slice

```
apps/web/src/features/costs/
├── api/                                    # 14 typed API functions
├── components/
│   ├── cost-profile-form.tsx               # shared create/edit form
│   ├── cost-profile-create-dialog.tsx
│   ├── cost-profile-table.tsx
│   ├── cost-profile-detail.tsx
│   ├── cost-profile-history-list.tsx
│   ├── cost-profile-version-diff.tsx
│   ├── cost-profile-attached-variants.tsx
│   ├── cost-profile-fx-preview.tsx
│   ├── cost-profile-type-badge.tsx
│   └── cost-profile-empty-state.tsx
├── hooks/                                  # 12 React Query hooks
├── lib/
│   ├── compute-current-cost-try.ts
│   └── format-fx-rate-source.ts
├── validation/
│   └── cost-profile.schema.ts
└── types/
    └── cost-profile.types.ts
```

### 7.2 Page routes

```
apps/web/src/app/(dashboard)/costs/
├── page.tsx                # /dashboard/costs — list page
└── [profileId]/
    └── page.tsx            # /dashboard/costs/[profileId] — detail page (3 tabs)
```

Profile detail tabs: **Detay** (form), **Geçmiş** (history + diff), **Bağlı varyantlar** (attached list).

### 7.3 Cross-feature touches

| File                                                             | Change                                       |
| ---------------------------------------------------------------- | -------------------------------------------- |
| `features/products/components/products-table.tsx`                | New `cost` column                            |
| `features/products/components/cost-cell.tsx`                     | NEW (variant row)                            |
| `features/products/components/cost-cell-popover.tsx`             | NEW                                          |
| `features/products/components/parent-row-cost-cell.tsx`          | NEW (aggregate + apply-to-all)               |
| `features/products/components/products-bulk-cost-action-bar.tsx` | NEW (FAB)                                    |
| `features/products/components/missing-cost-warning-banner.tsx`   | NEW                                          |
| `features/products/api/list-products.api.ts`                     | Response type extended                       |
| `features/dashboard/components/missing-cost-widget.tsx`          | NEW (KpiTile-composed)                       |
| `scripts/audit-feature-boundaries.config.ts`                     | `'allow'` rule for `costs` as target feature |

### 7.4 Component composition (per UI workflow cascade — no new primitives, no fork of any primitive)

| Need                 | Layer    | Component                                                                                               |
| -------------------- | -------- | ------------------------------------------------------------------------------------------------------- |
| Costs list table     | patterns | `DataTable` + `DataTableToolbar`                                                                        |
| Page chrome          | patterns | `PageHeader`                                                                                            |
| TRY value rendering  | patterns | `Currency`                                                                                              |
| Empty list           | patterns | `EmptyState`                                                                                            |
| Dashboard widget     | patterns | `KpiTile` (compose)                                                                                     |
| Profile detail tabs  | ui       | `Tabs`                                                                                                  |
| Form structure       | ui       | `Form`, `FormField`, etc.                                                                               |
| Form fields          | ui       | `Input`, `Select`, `Textarea`, `Switch`                                                                 |
| Type icon            | external | Hugeicons                                                                                               |
| Type badge chip      | ui       | `Badge`                                                                                                 |
| Cell popover         | ui       | `Popover`                                                                                               |
| Inline create        | ui       | `Dialog`                                                                                                |
| History diff modal   | ui       | `Sheet`                                                                                                 |
| Combobox typeahead   | ui       | `Command` + `Popover` (verify or pull `combobox` from shadcn registry)                                  |
| Replace confirmation | ui       | `AlertDialog`                                                                                           |
| Missing-cost banner  | ui       | `Alert` (compose)                                                                                       |
| FAB                  | unknown  | Verify in `apps/web/src/app/design/`; fallback = compose from `Button` + DataTable bulk-selection state |

Promotion candidates (defer): if `combobox-with-create` is reused, promote from `features/costs/` to `apps/web/src/components/patterns/`.

### 7.5 React Query keys

```ts
export const costsKeys = {
  all: ['costs'] as const,
  profiles: (filters?: ListFilters) => [...costsKeys.all, 'profiles', filters] as const,
  profile: (id: string) => [...costsKeys.all, 'profile', id] as const,
  profileVersions: (id: string) => [...costsKeys.profile(id), 'versions'] as const,
  profileAttachedVariants: (id: string) => [...costsKeys.profile(id), 'attached-variants'] as const,
  variantAttachments: (vid: string) => [...costsKeys.all, 'variant', vid] as const,
  fxRatesLatest: () => [...costsKeys.all, 'fx-rates', 'latest'] as const,
  missingCostStats: () => [...costsKeys.all, 'missing-stats'] as const,
};
```

### 7.6 Mutation invalidation matrix

| Mutation                             | Invalidates                                                                                                                 |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `createCostProfile`                  | `profiles()`                                                                                                                |
| `updateCostProfile(id)`              | `profile(id)`, `profileVersions(id)`, `profiles()`, `productsKeys.all`, affected `variantAttachments`                       |
| `archive/restore(id)`                | `profile(id)`, `profiles()`, `variantAttachments`                                                                           |
| `attach({ profileIds, variantIds })` | `variantAttachments(*)` per variantId, `productsKeys.all`, `missingCostStats()`, `profileAttachedVariants(*)` per profileId |
| `detach(...)`                        | Same as attach                                                                                                              |
| `replace(...)`                       | Same + invalidate all variantIds in body                                                                                    |

### 7.7 Cell popover state model

```ts
function CostCellPopover({ variantId }: { variantId: string }) {
  const attached = useVariantCostProfiles(variantId); // costs hook
  const allProfiles = useCostProfiles({ archived: false }); // costs hook
  const attach = useAttachCostProfiles();
  const detach = useDetachCostProfiles();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  // renders attached list + combobox + "+ Yeni" → CostProfileCreateDialog
}
```

The `costs` slice exposes hooks (not internal API functions) at the consumption boundary — `products` imports from `@/features/costs/hooks/...` only. Mirrors the `sync` precedent.

### 7.8 Optimistic updates

Cell popover (single-variant attach/detach) uses optimistic UI on `variantAttachments(variantId)` cache; rollback on error. Bulk FAB ops skip optimism (multi-row toast experience is fine).

### 7.9 Missing-cost surfaces

Per Q6 — two warning placements:

1. **Products page banner** (`missing-cost-warning-banner.tsx`) — `Alert`-composed. Reads `useMissingCostStats()`. CTA "Maliyetsiz ürünleri filtrele" sets `?costStatus=NO_PROFILES`.
2. **Dashboard widget** (`features/dashboard/components/missing-cost-widget.tsx`) — `KpiTile`-composed. Shows count + percent + link to filtered products view.

Both consume the same endpoint via `useMissingCostStats()`.

---

## 8. Security: Multi-tenancy & RLS

### 8.1 Multi-tenancy invariants (defense-in-depth)

| Layer      | Mechanism                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------- |
| Middleware | Hono `requireOrgMembership(:orgId)` — existing                                              |
| API        | Every query passes `organizationId = ctx.orgId`                                             |
| Service    | `attachCostProfiles()` checks `profile.orgId === variant.orgId === ctx.orgId` before INSERT |
| RLS        | Policies in `supabase/sql/cost-profiles-rls.sql` (§8.2)                                     |
| Schema     | `organizationId` denormalized + indexed on every tenant-scoped table                        |

### 8.2 RLS policies (`supabase/sql/cost-profiles-rls.sql`)

Cross-table checks go through `SECURITY DEFINER STABLE` helpers per `feedback_rls_recursion_security_definer` to avoid 42P17.

```sql
-- ── cost_profiles ─────────────────────────────────────────
CREATE POLICY cost_profiles_select ON cost_profiles
  FOR SELECT USING (organization_id = auth.org_id());
CREATE POLICY cost_profiles_insert ON cost_profiles
  FOR INSERT WITH CHECK (organization_id = auth.org_id());
CREATE POLICY cost_profiles_update ON cost_profiles
  FOR UPDATE USING (organization_id = auth.org_id())
                 WITH CHECK (organization_id = auth.org_id());
CREATE POLICY cost_profiles_no_hard_delete ON cost_profiles FOR DELETE USING (false);

-- ── cost_profile_versions (append-only) ────────────────────
CREATE POLICY versions_select ON cost_profile_versions
  FOR SELECT USING (organization_id = auth.org_id());
CREATE POLICY versions_insert ON cost_profile_versions
  FOR INSERT WITH CHECK (organization_id = auth.org_id());
CREATE POLICY versions_no_update ON cost_profile_versions FOR UPDATE USING (false);
CREATE POLICY versions_no_delete ON cost_profile_versions FOR DELETE USING (false);

-- ── product_variant_cost_profiles ──────────────────────────
CREATE OR REPLACE FUNCTION cost_profile_link_authorized(
  p_profile_id uuid, p_variant_id uuid
) RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM cost_profiles cp
    JOIN product_variants pv ON pv.organization_id = cp.organization_id
    WHERE cp.id = p_profile_id AND pv.id = p_variant_id
      AND cp.organization_id = auth.org_id() AND cp.archived_at IS NULL
  );
$$;

CREATE POLICY links_select ON product_variant_cost_profiles
  FOR SELECT USING (organization_id = auth.org_id());
CREATE POLICY links_insert ON product_variant_cost_profiles
  FOR INSERT WITH CHECK (
    organization_id = auth.org_id()
    AND cost_profile_link_authorized(profile_id, product_variant_id)
  );
CREATE POLICY links_no_update ON product_variant_cost_profiles FOR UPDATE USING (false);
CREATE POLICY links_delete ON product_variant_cost_profiles
  FOR DELETE USING (organization_id = auth.org_id());

-- ── order_item_cost_snapshot_components (write-once) ────────
CREATE POLICY components_select ON order_item_cost_snapshot_components
  FOR SELECT USING (organization_id = auth.org_id());
CREATE POLICY components_insert_service_only ON order_item_cost_snapshot_components
  FOR INSERT WITH CHECK (current_setting('request.jwt.claim.role', true) = 'service_role');
CREATE POLICY components_no_update ON order_item_cost_snapshot_components FOR UPDATE USING (false);
CREATE POLICY components_no_user_delete ON order_item_cost_snapshot_components
  FOR DELETE USING (current_setting('request.jwt.claim.role', true) = 'service_role');

-- ── fx_rates (public read, service-only write) ──────────────
CREATE POLICY fx_rates_public_read ON fx_rates FOR SELECT USING (true);
CREATE POLICY fx_rates_service_write ON fx_rates FOR ALL
  USING (current_setting('request.jwt.claim.role', true) = 'service_role');
```

### 8.3 Write-once trigger (`supabase/sql/cost-snapshot-immutable.sql`)

```sql
CREATE OR REPLACE FUNCTION reject_snapshot_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.unit_cost_snapshot IS NOT NULL AND
     NEW.unit_cost_snapshot IS DISTINCT FROM OLD.unit_cost_snapshot THEN
    RAISE EXCEPTION 'unit_cost_snapshot is write-once'
      USING ERRCODE = '42501', HINT = 'Past order calculations are immutable by design.';
  END IF;
  IF OLD.snapshot_captured_at IS NOT NULL AND
     NEW.snapshot_captured_at IS DISTINCT FROM OLD.snapshot_captured_at THEN
    RAISE EXCEPTION 'snapshot_captured_at is write-once' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER order_items_snapshot_immutable
  BEFORE UPDATE ON order_items
  FOR EACH ROW EXECUTE FUNCTION reject_snapshot_update();
```

The trigger is the load-bearing safety net: app-layer checks can be bypassed by future code (a careless `prisma.orderItem.update`), the trigger catches every path including raw SQL, migrations, and seed scripts.

### 8.4 Concurrent profile-update race protection

`(profileId, version)` UNIQUE could collide if two PATCHes race. Mitigation: `SELECT ... FOR UPDATE` on the profile row inside the transaction before reading `MAX(version)`, serializing concurrent edits.

---

## 9. Testing Strategy

### 9.1 Unit (TDD discipline)

| Path                                                                         | Coverage                             |
| ---------------------------------------------------------------------------- | ------------------------------------ |
| `apps/web/src/features/costs/lib/__tests__/compute-current-cost-try.test.ts` | TRY/AUTO/MANUAL/missing-rate cases   |
| `apps/web/src/features/costs/lib/__tests__/format-fx-rate-source.test.ts`    | All source string shapes             |
| `apps/api/src/services/__tests__/cost-snapshot.service.test.ts`              | Algorithm with mocked tx             |
| `apps/api/src/services/__tests__/resolve-fx-rate.test.ts`                    | Table-driven AUTO/MANUAL/TRY/no-rate |

### 9.2 Integration (per project policy, same PR as routes)

- Profile CRUD happy paths (8 endpoints)
- Profile name uniqueness conflict (`COST_PROFILE_NAME_TAKEN`)
- Archive prevents attach (`COST_PROFILE_ARCHIVED_CANNOT_ATTACH`)
- Attach idempotency (re-attach is no-op)
- Replace semantics (per-variant set replacement)
- Version creation on update (versions appended, fields diffed correctly)
- Write-once trigger rejection (`pgcode = '42501'`)
- Snapshot capture during simulated sync
- Backfill non-behavior: re-sync of order with existing item leaves snapshot untouched
- FX cron Edge Function with mocked TCMB XML fixture

### 9.3 Multi-tenancy isolation (`apps/api/tests/integration/tenant-isolation/cost-profiles.test.ts`)

- Org A user cannot list, get, update, archive, restore, delete Org B's profiles
- Org A cannot fetch versions for Org B's profile (404)
- Org A `attach({ profileIds: [orgB.profile], variantIds: [orgA.variant] })` → 422 `COST_PROFILE_VARIANT_ORG_MISMATCH`
- Org A `attach({ profileIds: [orgA.profile], variantIds: [orgB.variant] })` → 404 (variant not visible via RLS)
- Org A cannot read Org B's snapshot components
- Org A cannot detach Org B's link
- Cross-test: pre-seeded Supabase auth users survive `truncateAll` (per `feedback_tests_dont_wipe_seed`)

### 9.4 Frontend

- `cost-profile-form` component test (validation + FX preview reactivity)
- `cost-cell-popover` interaction test (attach/detach optimistic, create-new flow)
- `useAttachCostProfiles` hook test with MSW
- Profile-level history list rendering
- Missing-cost banner conditional render

---

## 10. Phasing (PR breakdown)

Refined into a step-by-step plan during the writing-plans phase. Approximate split:

| PR  | Scope                                                             | Approx. size | Depends on |
| --- | ----------------------------------------------------------------- | ------------ | ---------- |
| 1   | Schema + RLS + write-once trigger + migration                     | M            | —          |
| 2   | Profile CRUD backend + validators + multi-tenancy tests           | M            | 1          |
| 3   | Attach/detach/replace backend + cross-org guard + isolation tests | M            | 1, 2       |
| 4   | FX Edge Function + pg_cron + integration tests                    | S            | 1          |
| 5   | Cost-snapshot service + sync-worker integration + write-once test | M            | 1, 4       |
| 6   | Extend products list response + missing-stats endpoint            | S            | 1, 3       |
| 7   | Costs page frontend (list + create + edit + archive)              | L            | 2          |
| 8   | Profile detail page (form + history + attached-variants tabs)     | M            | 2          |
| 9   | Products table cost column + cell popover + create-from-cell      | L            | 3, 6       |
| 10  | Parent-row aggregate + bulk FAB                                   | M            | 9          |
| 11  | Missing-cost banner + dashboard widget                            | S            | 6          |

Critical path: 1 → 3 → 6 → 9 → 10. PR 4 → 5 runs in parallel with the CRUD work. PRs 7 and 8 parallelize with 9.

---

## 11. Open Issues / Risks

1. **FAB primitive verification** — Explore agent didn't find a dedicated component. Implementation: scan `apps/web/src/app/design/`; if absent, build from primitives + `useTable.getSelectedRowModel()`.
2. **`Combobox` typeahead** — verify shadcn primitive exists; if not, compose `Command` + `Popover`.
3. **Live aggregate query performance** — products list adds JOINs + lateral. With proper indexes, sub-100ms for 100-row pages. Add a materialized view if list endpoint p99 grows.
4. **TCMB XML parser** — first dependency on TCMB. Schema is stable but worth a unit test with a captured fixture XML.
5. **Concurrent profile-update race** — addressed via `SELECT FOR UPDATE` in the version-creation tx (§8.4).
6. **`Organization.currency` is `String`, not enum** — separate PR to migrate.
7. **`ProductVariant.costPrice` deprecation** — leave field unused in v1, drop in follow-up PR per `feedback_schema_only_pr_is_a_lie`.
8. **`auth.org_id()` function name** — RLS policies in §8.2 assume a function with this signature exists. Verify the actual name in `supabase/sql/` during PR 1; rename in policies if different.
9. **`Order.netProfit` write-once enforcement** — §5.4 enforces at app layer. A matching DB trigger (`reject_netprofit_update`) would mirror the snapshot-immutability pattern, but the existing sync code may already write `netProfit` in flows we're not aware of. Implementation step: audit existing writes during PR 5 before adding the trigger; if existing code only ever writes nullable→value, add the trigger; otherwise document the behavior and add the trigger in a follow-up.
10. **Organization back-relation** — `Organization` model needs `costProfiles CostProfile[]` array added when CostProfile is introduced (Prisma requires both sides for relation).

---

## 12. Out of Scope (v1)

- Order-line manual cost adjustments — strict immutability rejects them
- "Recalculate" button anywhere — same reason
- Org-wide manual FX rate setting — per-profile only in v1
- Multi-currency profit display — profit always rendered in TRY
- Per-store cost profiles — strictly org-scoped
- Hard delete of profiles — forbidden by RLS
- VAT recovery / output-VAT offsetting — separate accounting feature
- Custom currencies beyond TRY/USD/EUR — config-only later
- Intra-day FX rates — TCMB daily only
- Attachment history audit log — only `attachedAt`/`attachedBy` on link row, no per-detach event
- CSV import of cost profiles — deferred
- Cost profile templates — deferred
- Realtime subscriptions for cost cells — polling on focus is sufficient for v1

---

## 13. References

- Project memory: `feedback_no_string_literal_enum_duplicates`, `feedback_rls_recursion_security_definer`, `feedback_realtime_wire_shapes_mirror_api`, `feedback_schema_only_pr_is_a_lie`, `feedback_tests_dont_wipe_seed`, `project_sync_is_cross_feature_by_design`
- `docs/SECURITY.md` — multi-tenancy invariants
- `docs/TESTING.md` — test pattern library (multi-tenancy section)
- `docs/integrations/trendyol/` — order sync references
- `apps/api/CLAUDE.md` — error response (RFC 7807) vocabulary
- `apps/web/CLAUDE.md` — error handling pipeline + happy-dom test rule
