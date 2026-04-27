# Products page + Trendyol sync (v1.0 + v1.1)

**Status:** in progress · **Owner:** Berkin · **Started:** 2026-04-27

## Progress

Track each PR off `main`. Tick when merged. Each PR ships its own tests in the same merge per `docs/SECURITY.md` §9 and `docs/TESTING.md`.

### v1.0 — manual sync, listing, live progress

- [x] **PR 1 — Schema + Trendyol fetcher (foundation)** — `feature/products-sync-pr1-foundation`
  - [x] Prisma schema: split Product into Product (parent) + ProductVariant + ProductImage; OrderItem rewire; SyncLog progress fields
  - [x] RLS policies for `product_variants` and `product_images`; coverage test extended
  - [x] `org-scoped-tables.rls.test.ts` cross-org tests for new tables
  - [x] `SyncInProgressError` (409) + `problemDetailsForError` branch + unit tests
  - [x] `TrendyolProductFetcher` (async generator over `/products/approved` v2) + pure `mapper.ts`
  - [x] Unit tests for mapper and fetcher (uses real staging Postman samples; covers 401/429/502/empty/pagination/nextPageToken switchover)
  - [x] Seed script updated for the new schema
  - [x] `pnpm check:full` green (193 tests)
- [ ] **PR 2 — Sync service + manual sync route + sync-log polling endpoint**
  - [ ] `ProductSyncService.run({ store, syncLogId })` — pg advisory lock, transaction-per-page upserts, progress updates, stale-RUNNING-SyncLog cleanup, stale-variant archive sweep
  - [ ] `POST /v1/organizations/{orgId}/stores/{storeId}/products/sync` — returns 202 + syncLogId
  - [ ] `GET /v1/organizations/{orgId}/stores/{storeId}/sync-logs/{syncLogId}` — generic across SyncType
  - [ ] `storeService.requireOwnedStore(orgId, storeId)` helper
  - [ ] Multi-tenancy isolation test
  - [ ] Integration tests: happy path, 429 backoff, 401 → MARKETPLACE_AUTH_FAILED in SyncLog, concurrent sync → 409 SYNC_IN_PROGRESS
  - [ ] `pnpm api:sync` regenerated and committed
- [ ] **PR 3 — Products list + facets routes** (parallel with PR 2; both depend on PR 1)
  - [ ] `ProductsListService` with single-query include + variant filter + parent-level pagination
  - [ ] `GET /v1/organizations/{orgId}/stores/{storeId}/products` — `q | status | brandId | categoryId | page | perPage | sort`
  - [ ] `GET /v1/organizations/{orgId}/stores/{storeId}/products/facets` — `groupBy` brand + category with counts
  - [ ] `tablePaginationSchema` (1-indexed, perPage ∈ {10,25,50,100})
  - [ ] Integration tests per filter independently, pagination boundaries, sort directions
  - [ ] Multi-tenancy isolation test
  - [ ] `pnpm api:sync` regenerated and committed
- [ ] **PR 4 — Frontend feature (page, table, filter bar, URL state, i18n)**
  - [ ] `apps/web/src/features/products/` full tree
  - [ ] `DataTable` extended with optional `getRowCanExpand` + `renderSubComponent` (additive)
  - [ ] `useProductsFilters` (nuqs `useQueryStates`) + 300ms debounced search + page reset on filter change
  - [ ] Server component `page.tsx` reads `searchParams` and hydrates `initialData`
  - [ ] Single-variant flat row vs. multi-variant expandable row (price range, stock sum, dominant delivery/status)
  - [ ] `ProductsFilterBar` with `FacetSelect` chips for status / brand / category
  - [ ] `ui/pagination` + `perPage` Select wired to nuqs
  - [ ] Store guard: redirect-style empty state if `useActiveStore()` is null
  - [ ] i18n keys (`products.*`) in `tr.json` + `en.json`
  - [ ] Component tests (single/multi variant render, expand toggle, status mapping)
  - [ ] Hook test (URL ↔ state round-trip, NuqsAdapter)
  - [ ] MSW-driven test for `useProducts` happy path + 422 surfacing
- [ ] **PR 5 — SyncCenter + Realtime (live progress)** — `v1.0 ships after this merge`
  - [ ] `SyncBadge` extended with optional `progress?: { current; total }` + `onClick`
  - [ ] `components/patterns/sync-center.tsx` — Sheet with Active + Recent sections + per-type manual trigger
  - [ ] `apps/web/src/lib/supabase/realtime.ts` — channel manager with auto-reconnect
  - [ ] `useActiveSyncLogs(storeId)` — REST hydrate + Realtime overlay + 2s polling fallback
  - [ ] `supabase/sql/realtime-publications.sql` — add `sync_logs` to `supabase_realtime` publication
  - [ ] RLS audit on `sync_logs` confirmed before enabling Realtime
  - [ ] Component tests (simulated postgres_changes payloads, polling fallback when channel removed)

### v1.1 — scheduled cron

- [ ] **PR 6 — Edge Function + pg_cron**
  - [ ] `POST /v1/internal/sync-jobs/products/{storeId}` gated by `requireServiceToken` middleware
  - [ ] `supabase/functions/trendyol-product-sync/index.ts` — fans out to BFF internal endpoint with concurrency cap 5
  - [ ] `supabase/sql/cron/products-sync.sql` — every 6 h via `net.http_post`
  - [ ] `INTERNAL_SERVICE_TOKEN` env var in `.env.example`, `turbo.json`, `.github/workflows/ci.yml` + boot-time `validateRequiredEnv()`
  - [ ] Tests: edge function dispatches one HTTP call per active store, service-token middleware rejects bad tokens with 401

### Out of scope (future iterations)

- costPrice inline editing (next iteration after v1.1)
- Volume / desi field on variant + UI
- Sidebar warning filters (`?filter=no-cost`, `?filter=low-stock`, `?filter=no-desi`)
- Draft / unapproved products tab
- Product detail page (image gallery, attribute editing, sync history per product)
- Bulk actions (status change, CSV export, CSV cost upload)
- Hepsiburada parity
- Stock alerts / notifications

### Open follow-ups (separate PRs, not blocking)

- **Migration baselining gap.** `packages/db/prisma/migrations/` only contains `20260425151617_add_org_member_last_accessed_at`; the rest of the original schema (Order, Settlement, etc.) was bootstrapped via `db:push`. PR 1 also went through `db:push --accept-data-loss`. Production deploy of any of this work needs a baseline migration first. Track separately.

---

## Context

We just shipped the dashboard's tek-sidebar shell + org/store switcher (#44–#50). The next milestone is the first real product surface of the SaaS: a Products page that reads a connected Trendyol store's approved products from our DB, with server-side pagination, server-side filtering, URL-state sync, and live sync progress visible to anyone with the panel open.

This is the first feature that exercises four foundational pieces the rest of the product depends on:

- **Marketplace data sync** (Trendyol → our DB), the same pipeline orders/settlements will reuse.
- **Background scheduled jobs** (Supabase Edge Functions + pg_cron), the first cron in the project.
- **Supabase Realtime** for live UI updates from background work.
- **The DataTable showcase pattern** wired to a real, paginated, filterable, server-driven feed (it's been mock-data only until now).

**Why "sync into our DB" rather than proxy to Trendyol on every read:** the existing sidebar nav already references filters that need our-DB-only data (`/products?filter=no-cost`, `/products?filter=low-stock`); `docs/ARCHITECTURE.md` prescribes the cache pattern; and proxy-on-every-read would couple our latency to a rate-limited upstream (50 req / 10s). Sync also unlocks the upcoming cost+volume editing flow where sellers mutate our copy.

**Why parent-product-with-expandable-variants for row identity:** mirrors Trendyol's own seller-panel UI exactly, matches the staging Postman samples (one `content` with nested `variants[]`), and is the only shape that captures both shared content fields (image, title, brand, category, color) and per-SKU fields (size, stockCode, barcode, price, stock, delivery) without lossy denormalization.

## Architectural pillars

1. **Three independent backend units, each testable in isolation.**
   - `TrendyolProductFetcher` — paginates Trendyol, maps response → DTO. No DB.
   - `ProductSyncService` — orchestrates fetcher → DB upserts + SyncLog. No HTTP.
   - `ProductsListService` — paginated + filtered reads from our DB. No knowledge of Trendyol.
2. **Two trigger surfaces over the same sync service:** manual button (POST route) + scheduled (pg_cron → Supabase Edge Function → BFF internal route). Manual ships in v1.0; scheduled in v1.1.
3. **Sync runs async with live status:** 202 returned immediately + SyncLog row updated as each Trendyol page lands; browser sees progress via Supabase Realtime postgres_changes (with React Query polling fallback if the channel drops). Multi-tab consistent.
4. **Tenant isolation enforced at three layers, all required to ship.**
   - Middleware: `ensureOrgMember(userId, orgId)` + new `storeService.requireOwnedStore(orgId, storeId)`.
   - Application query: every Prisma `where` includes `organizationId` AND `storeId` (grep-able invariant).
   - RLS: policies on `products`, `product_variants`, `product_images` use the existing `is_org_member(uuid)` SECURITY DEFINER helper, with denormalized `organization_id` columns to avoid the 42P17 recursion problem.
5. **Multi-tenancy isolation tests + RLS tests are mandatory in the same PR as the feature.**

## Schema

Single fresh migration (the current `Product` model has no migration applied yet — restructuring is safe).

```prisma
model Product {                          // parent — one row per Trendyol contentId
  id                 String    @id @default(uuid()) @db.Uuid
  organizationId     String    @map("organization_id") @db.Uuid
  storeId            String    @map("store_id") @db.Uuid
  platformContentId  BigInt    @map("platform_content_id")
  productMainId      String    @map("product_main_id")
  title              String
  description        String?   @db.Text
  brandId            BigInt?   @map("brand_id")
  brandName          String?   @map("brand_name")
  categoryId         BigInt?   @map("category_id")
  categoryName       String?   @map("category_name")
  color              String?
  attributes         Json      @default("[]")
  approved           Boolean   @default(true)
  platformCreatedAt  DateTime? @map("platform_created_at")
  platformModifiedAt DateTime? @map("platform_modified_at")
  lastSyncedAt       DateTime  @default(now()) @map("last_synced_at")
  createdAt          DateTime  @default(now()) @map("created_at")
  updatedAt          DateTime  @updatedAt @map("updated_at")

  store    Store            @relation(fields: [storeId], references: [id], onDelete: Cascade)
  variants ProductVariant[]
  images   ProductImage[]

  @@unique([storeId, platformContentId])
  @@index([organizationId])
  @@index([storeId, productMainId])
  @@index([storeId, brandId])
  @@index([storeId, categoryId])
  @@map("products")
}

model ProductVariant {                   // child — one row per Trendyol variantId (SKU)
  id                    String   @id @default(uuid()) @db.Uuid
  organizationId        String   @map("organization_id") @db.Uuid
  storeId               String   @map("store_id") @db.Uuid
  productId             String   @map("product_id") @db.Uuid
  platformVariantId     BigInt   @map("platform_variant_id")
  barcode               String
  stockCode             String   @map("stock_code")
  salePrice             Decimal  @map("sale_price") @db.Decimal(12, 2)
  listPrice             Decimal  @map("list_price") @db.Decimal(12, 2)
  vatRate               Int?     @map("vat_rate")
  costPrice             Decimal? @map("cost_price") @db.Decimal(12, 2)
  quantity              Int      @default(0)
  deliveryDuration      Int?     @map("delivery_duration")
  isRushDelivery        Boolean  @default(false) @map("is_rush_delivery")
  fastDeliveryOptions   Json     @default("[]") @map("fast_delivery_options")
  productUrl            String?  @map("product_url") @db.Text
  locationBasedDelivery String?  @map("location_based_delivery")
  onSale                Boolean  @default(true) @map("on_sale")
  archived              Boolean  @default(false)
  blacklisted           Boolean  @default(false)
  locked                Boolean  @default(false)
  size                  String?
  attributes            Json     @default("[]")
  lastSyncedAt          DateTime @default(now()) @map("last_synced_at")
  createdAt             DateTime @default(now()) @map("created_at")
  updatedAt             DateTime @updatedAt @map("updated_at")

  product    Product     @relation(fields: [productId], references: [id], onDelete: Cascade)
  store      Store       @relation(fields: [storeId], references: [id], onDelete: Cascade)
  orderItems OrderItem[]

  @@unique([storeId, platformVariantId])
  @@unique([storeId, barcode])
  @@index([organizationId])
  @@index([productId])
  @@index([storeId, stockCode])
  @@index([storeId, onSale, archived])
  @@map("product_variants")
}

model ProductImage {
  id             String   @id @default(uuid()) @db.Uuid
  organizationId String   @map("organization_id") @db.Uuid
  productId      String   @map("product_id") @db.Uuid
  url            String   @db.Text
  position       Int      @default(0)
  createdAt      DateTime @default(now()) @map("created_at")

  product Product @relation(fields: [productId], references: [id], onDelete: Cascade)

  @@index([productId, position])
  @@map("product_images")
}

// Added to existing SyncLog model:
model SyncLog {
  // ... existing fields ...
  progressCurrent Int     @default(0) @map("progress_current")
  progressTotal   Int?    @map("progress_total")
  progressStage  String? @map("progress_stage")               // 'fetching' | 'mapping' | 'upserting'
  errorCode      String? @map("error_code")
}
```

**OrderItem rewire**: `productId` → `productVariantId String? @map("product_variant_id") @db.Uuid` with optional FK to ProductVariant. Nullable so order ingest doesn't fail when a variant hasn't been synced yet (resolved later by barcode soft join).

**Denormalized `organization_id`** on `product_variants` and `product_images` so RLS policies stay flat (`USING (is_org_member(organization_id))`) and avoid the 42P17 recursion that nested EXISTS-against-RLS-table policies hit.

## Backend — Trendyol fetcher

`apps/api/src/integrations/marketplace/trendyol/products.ts`

```ts
export async function* fetchApprovedProducts(opts: {
  baseUrl?: string;
  environment?: StoreEnvironment;
  credentials: TrendyolCredentials;
  signal?: AbortSignal;
}): AsyncGenerator<MappedProductsPage, void> { ... }
```

- Endpoint: `GET ${baseUrl}/integration/product/sellers/${supplierId}/products/approved`
- Headers: `Authorization: Basic base64(apiKey:apiSecret)` + mandatory `User-Agent: ${supplierId} - SelfIntegration` (Trendyol returns 403 without it)
- Paginates `size=100` (max). Switches from `page=N+1` to `nextPageToken` once Trendyol returns one (which it does past the 10k page-cap)
- 429 → exponential backoff (1s, 2s, 4s, 8s) using `Retry-After` when present, then `RateLimitedError`
- 401 → `MarketplaceAuthError` · 403/503 → `MarketplaceAccessError` · 5xx → `MarketplaceUnreachable`
- Stock comes from the same endpoint (`variant.stock.quantity`); no separate inventory call needed (verified against staging samples)

`apps/api/src/integrations/marketplace/trendyol/mapper.ts` is pure (no I/O, no DB), tested in isolation against the staging Postman samples. It handles:

- `deliveryDuration: null` is allowed
- Color appears twice in `attributes[]` (e.g. id 47 and 295 both saying `Beyaz`); mapper picks the first `Renk` and `console.warn`s if duplicates disagree
- `description` is raw HTML; stored verbatim, sanitized at render with DOMPurify
- `images[].url` is already absolute on `cdn.dsmcdn.com`; no rewrite

## Backend — Sync service (PR 2)

`apps/api/src/services/product-sync.service.ts`

```ts
export async function run(opts: { store: Store; syncLogId: string }): Promise<void> {
  // 1) acquire pg advisory lock keyed by ('PRODUCT_SYNC', storeId::bigint)
  //    pg_try_advisory_lock() — if false → throw SyncInProgressError (409)
  // 2) for await ({ batch, pageMeta } of fetchApprovedProducts(...))
  //      await prisma.$transaction(tx => upsert Product → upsert ProductVariant → replace ProductImage)
  //      await syncLogService.advance(syncLogId, processedSoFar, pageMeta.totalElements)
  // 3) mark stale variants archived=true (lastSyncedAt < runStartedAt) — preserves OrderItem FK
  // 4) syncLogService.complete(syncLogId, syncedCount, durationMs)
  // 5) advisory lock auto-released on connection close
}
```

- **Stale-RUNNING-SyncLog cleanup:** on every sync start, after acquiring the advisory lock, mark any prior SyncLog rows for this `(storeId, type='PRODUCTS')` still in `RUNNING` state and older than 10 minutes as `FAILED` with `errorCode = 'SYNC_TIMEOUT'`.
- Transaction per page (~100 items) keeps individual transactions short; partial progress survives a crash.
- Idempotent: rerunning produces identical state. Unique constraints `(storeId, platformContentId)` and `(storeId, platformVariantId)` enforce.
- `syncLogService.advance(id, current, total)` does a single UPDATE — that UPDATE is what Realtime broadcasts.

## Backend — Routes (PRs 2 + 3)

| Method + Path | Status codes | Purpose |
|---|---|---|
| POST `/v1/organizations/{orgId}/stores/{storeId}/products/sync` | 202, 401, 403, 404, 409, 429 | Start sync. Returns `{ syncLogId, status: 'RUNNING', startedAt }`. |
| GET `/v1/organizations/{orgId}/stores/{storeId}/sync-logs?active=true` | 200, 401, 403, 404 | Hydrate SyncCenter. Returns active + last 5 sync logs across all SyncTypes. |
| GET `/v1/organizations/{orgId}/stores/{storeId}/sync-logs/{syncLogId}` | 200, 401, 403, 404 | Poll a specific sync. Generic across SyncType. |
| GET `/v1/organizations/{orgId}/stores/{storeId}/products` | 200, 401, 403, 404, 422, 429 | Paginated product list. |
| GET `/v1/organizations/{orgId}/stores/{storeId}/products/facets` | 200, 401, 403, 404, 429 | Brand + category dropdowns with counts. |
| POST `/v1/internal/sync-jobs/products/{storeId}` (v1.1) | 202, 401, 404, 409 | Service-token-gated. Called by Edge Function on cron schedule. |

**Every handler runs `ensureOrgMember(userId, orgId)` then `storeService.requireOwnedStore(organizationId, storeId)` before any DB read.** `requireOwnedStore` (new helper in `apps/api/src/services/store.service.ts`) queries `WHERE id = $1 AND organization_id = $2` and throws `NotFoundError(STORE_NOT_FOUND)` on miss with no existence-disclosure leak.

**List endpoint query schema:**

```ts
z.object({
  q:          z.string().trim().min(1).max(100).optional(),
  status:     z.enum(['onSale', 'archived', 'locked', 'blacklisted']).optional(),
  brandId:    z.coerce.bigint().optional(),
  categoryId: z.coerce.bigint().optional(),
  page:       z.coerce.number().int().min(1).default(1),
  perPage:    z.coerce.number().int().refine((n) => [10, 25, 50, 100].includes(n)).default(25),
  sort:       z.enum(['-platformModifiedAt', 'platformModifiedAt', 'title', '-title']).default('-platformModifiedAt'),
})
```

- `q` → ILIKE across `Product.title`, `Product.productMainId`, `ProductVariant.barcode`, `ProductVariant.stockCode`. Plain ILIKE for v1; revisit if seller datasets exceed ~10k variants.
- `status` applied at variant level. Parent included if ≥1 variant matches; the `variants[]` in the response is filtered to matching variants.
- Pagination at the **parent** level. `total` = `prisma.product.count({ where })`.
- Single Prisma query: `findMany({ where, include: { variants: { where: statusWhere }, images: true }, take, skip, orderBy })`.

**Error codes:** `UNAUTHENTICATED`, `ORG_FORBIDDEN`, `STORE_NOT_FOUND`, `SYNC_IN_PROGRESS` (new), `VALIDATION_ERROR`, `MARKETPLACE_AUTH_FAILED`, `MARKETPLACE_RATE_LIMITED`, `MARKETPLACE_UNREACHABLE`, `MARKETPLACE_ACCESS_DENIED`. Marketplace errors already exist; only `SyncInProgressError` is new (added in PR 1).

## Frontend (PRs 4 + 5)

```
apps/web/src/features/products/
├── api/
│   ├── list-products.api.ts
│   ├── list-product-facets.api.ts
│   ├── start-product-sync.api.ts
│   ├── get-sync-log.api.ts
│   └── list-active-sync-logs.api.ts
├── hooks/
│   ├── use-products.ts
│   ├── use-product-facets.ts
│   ├── use-start-product-sync.ts
│   ├── use-products-filters.ts
│   └── use-active-sync-logs.ts
├── components/
│   ├── products-table.tsx
│   ├── products-filter-bar.tsx
│   ├── products-empty-state.tsx
│   ├── product-image-cell.tsx
│   ├── product-variant-table.tsx
│   ├── delivery-badge.tsx
│   ├── variant-status-badge.tsx
│   ├── color-attribute.tsx
│   └── facet-select.tsx
├── lib/
│   ├── format-product.ts
│   └── products-filter-parsers.ts
├── query-keys.ts
└── types.ts
```

Plus shared/extended:

- `apps/web/src/components/patterns/sync-badge.tsx` — extended with optional `progress?: { current; total }` and `onClick`. Existing usages unaffected.
- `apps/web/src/components/patterns/sync-center.tsx` — **new** cross-feature composite (Sheet + Active section + Recent section + per-type manual trigger button).
- `apps/web/src/components/patterns/data-table.tsx` — extended with optional `getRowCanExpand` + `renderSubComponent` props (additive).
- `apps/web/src/lib/supabase/realtime.ts` — **new** channel manager (auto reconnect, token-refresh-aware).
- `apps/web/src/app/[locale]/(dashboard)/products/{page,loading,error}.tsx` — **new**.
- `apps/web/messages/{tr,en}.json` — new `products.*` namespace.

### URL state contract

```ts
export const productsFiltersParsers = {
  q:          parseAsString.withDefault(''),
  status:     parseAsStringEnum(['onSale', 'archived', 'locked', 'blacklisted']).withDefault('onSale'),
  brandId:    parseAsString.withDefault(''),
  categoryId: parseAsString.withDefault(''),
  page:       parseAsInteger.withDefault(1),
  perPage:    parseAsInteger.withDefault(25),
  sort:       parseAsStringEnum(['-platformModifiedAt', 'platformModifiedAt', 'title', '-title'])
                .withDefault('-platformModifiedAt'),
};
```

Search input writes through 300ms debounce; any non-search filter change resets `page` to 1; `history: 'push'` so back/forward works. Server component reads `searchParams` and hydrates initial query — eliminates first-paint waterfall.

### Table layout

Parent row per Product. Single-variant products render flat (cells from the lone variant, no chevron). Multi-variant: cells show aggregates (price range `₺120–₺200`, stock sum, dominant delivery, dominant status with overflow chip), chevron expands to a sub-table of variants with columns `Beden | Stok Kodu | Barkod | Fiyat | Stok | Teslimat | Durum`. Aggregations live in `lib/format-product.ts`.

### SyncCenter + Realtime

`SyncBadge` in `PageHeader` is the entry point. Click → opens `SyncCenter` Sheet.

`useActiveSyncLogs(storeId)` hydrates from `GET /sync-logs?active=true` then overlays Supabase Realtime postgres_changes filtered by `store_id=eq.${storeId}`:

```ts
function useActiveSyncLogs(storeId: string) {
  const query = useQuery({
    queryKey: syncLogKeys.active(storeId),
    queryFn: () => listActiveSyncLogs(orgId, storeId),
    refetchInterval: (q) => hasRunning(q.state.data) ? 2000 : false,
  });
  useEffect(() => {
    if (!storeId) return;
    const channel = supabase.channel(`sync_logs:${storeId}`)
      .on('postgres_changes',
          { event: '*', schema: 'public', table: 'sync_logs', filter: `store_id=eq.${storeId}` },
          (payload) => queryClient.setQueryData(syncLogKeys.active(storeId), applyEvent(payload)))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [storeId]);
  return query;
}
```

RLS on `sync_logs` enforces org-only event delivery (audited in PR 5 before enabling Realtime publication). Polling at 2s while a RUNNING row exists is the fallback when the channel drops.

## v1.1 — Scheduled cron (PR 6)

`POST /v1/internal/sync-jobs/products/{storeId}` is gated by **`requireServiceToken` middleware** (compares `Authorization: Bearer ${INTERNAL_SERVICE_TOKEN}`). Bypasses user-auth, resolves `organizationId` from `Store.organizationId`. Reuses `ProductSyncService.run` exactly — single source of truth for sync logic.

`supabase/functions/trendyol-product-sync/index.ts`:

- Queries active TRENDYOL stores via supabase-js with the service-role key
- Fans out parallel `fetch()` calls (concurrency cap 5) to the BFF internal endpoint
- Logs per-store outcomes; emits structured logs for monitoring

`supabase/sql/cron/products-sync.sql`: pg_cron schedule `0 */6 * * *` calling `net.http_post` to the Edge Function.

**New env var `INTERNAL_SERVICE_TOKEN`** added to all three sources: `.env.example`, `turbo.json`, `.github/workflows/ci.yml`. Plus boot-time `validateRequiredEnv()` check.

## Existing utilities to reuse (never duplicate)

- `apiClient` from `apps/web/src/lib/api-client/browser` — typed openapi-fetch instance.
- `throwApiError` from `@/lib/api-error` — every `.api.ts` uses this.
- Global React Query `onError` handler in `apps/web/src/providers/query-provider.tsx` — translates `ApiError.code` → `common.errors.<CODE>` toast.
- `mapPrismaError` from `apps/api/src/lib/map-prisma-error.ts` — wraps Prisma calls.
- Existing inline `ensureOrgMember(userId, orgId)` pattern from `apps/api/src/routes/store.routes.ts`.
- `is_org_member(uuid)` SECURITY DEFINER function (already in SQL, used to avoid 42P17 recursion).
- `crypto.encryptCredentials` / `decryptCredentials` from `apps/api/src/lib/crypto.ts`.
- `mapTrendyolResponseToDomainError` from `apps/api/src/integrations/marketplace/trendyol/errors.ts` — already maps 401/403/429/503/5xx.
- DataTable, DataTableToolbar, EmptyState, PageHeader, SyncBadge, MarketplaceLogo, Currency from `apps/web/src/components/patterns/`.
- shadcn primitives: `input`, `select`, `popover`, `command`, `sheet`, `badge`, `button`, `checkbox`, `dropdown-menu`, `pagination`, `progress`, `sonner`, `skeleton` — all already installed.
- `nuqs` (already at v2.4); `useQueryStates` for multi-param.
- `messages/tr.json common.errors.MARKETPLACE_AUTH_FAILED` already exists.
- `tests/helpers/render.tsx` (frontend), `truncateAll`, `createAuthenticatedTestUser`, `bearer` (backend).

## Verification (manual + automated, before claiming v1.0 done)

1. **Sandbox setup:** confirm Trendyol stage IP whitelist (call Trendyol seller support; stage requires it, prod doesn't). Connect a stage seller account via `/stores` with `environment: SANDBOX`.
2. Open `/products` — empty state renders ("Henüz senkronize edilmiş ürün yok.").
3. Click SyncBadge → SyncCenter Sheet opens. Click "Şimdi senkronize et".
4. Watch the progress bar fill smoothly over 10–60s. Open a second tab on `/products` — both progress bars advance together (multi-tab via Realtime).
5. After completion, table renders with all expected columns. Multi-variant products show expand chevron; single-variant show flat row.
6. Apply each filter independently:
   - Search "keten" → only matching titles (or stockCode/barcode/productMainId) return.
   - Status `Arşivde` → only archived variants visible inside parent rows.
   - Brand and category dropdowns populate from `/products/facets` with counts.
7. Pagination: switch perPage to 50, navigate to page 2, confirm URL `?page=2&perPage=50` and table updates. Reload — same view restored.
8. Multi-tenant isolation (manual smoke + automated test): with two test orgs, request as user A → no org-B data anywhere in any response.
9. Concurrent-sync: trigger sync, immediately retrigger from another tab → second response is `409 SYNC_IN_PROGRESS`.
10. `pnpm check:full` passes (typecheck + lint + all tests + format check). CI green.

For v1.1 additionally:

11. Manually trigger the cron: `select cron.run_job('trendyol-product-sync')`. Confirm SyncLog rows appear for all active stores; confirm Realtime broadcasts the runs to any open browser session.
12. Service-token rejection: `curl -X POST /v1/internal/sync-jobs/products/{id}` with no/wrong token → 401.
