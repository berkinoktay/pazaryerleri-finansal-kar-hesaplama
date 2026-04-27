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
- [x] **PR 2 — Sync service + manual sync route + sync-log polling endpoint** — `feature/products-sync-pr2-sync-service`, merged via #53 (squash) on 2026-04-27
  - [x] `ProductSyncService.run({ store, syncLogId })` — replaced pg advisory lock with SyncLog-row + race-detection slot acquisition (Prisma's connection pool makes session-scoped advisory locks awkward — see commit body of `feat(api): ProductSyncService …`); transaction-per-content upserts; progress updates; stale-RUNNING-SyncLog cleanup; stale-variant archive sweep
  - [x] `POST /v1/organizations/{orgId}/stores/{storeId}/products/sync` — returns 202 + syncLogId
  - [x] `GET /v1/organizations/{orgId}/stores/{storeId}/sync-logs/{syncLogId}` — generic across SyncType
  - [x] `storeService.requireOwnedStore(orgId, storeId)` helper
  - [x] `runInBackground` util + `ensureOrgMember` extracted to `lib/`
  - [x] Multi-tenancy isolation test (three path arrangements)
  - [x] Integration tests: happy path, idempotent rerun, stale-variant archival, 401 → MARKETPLACE_AUTH_FAILED in SyncLog, concurrent sync → 409 SYNC_IN_PROGRESS, stale RUNNING reaped as SYNC_TIMEOUT
  - [x] `pnpm api:sync` regenerated and committed
- [ ] **PR 3 — Products list + facets routes** (depends on PR 1; in progress)
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

## Decision log

Each architectural choice with the alternatives that were considered and the user-confirmed direction. Captured here so a fresh reader (or a fresh agent in a new session) can see _why_ each path was chosen, not just _what_ shipped. Decisions are listed in the order they were made during brainstorming.

### D1 — Data strategy: cache in our DB vs proxy through to Trendyol

**Question:** how should the Products page get its data?

**Considered:**

- **Proxy to Trendyol live.** Backend forwards filter+page params to Trendyol's `/products/approved`. No DB writes, ships fastest, always fresh. Trade-offs: ~300–800 ms upstream latency stacks on every page; bound to Trendyol's filter set; can't filter by `costPrice` / desi (those exist only in our DB); awkward around the 10k page×size cap; the existing sidebar nav (`?filter=no-cost`, `?filter=low-stock`) becomes unsupportable.
- **Sync into DB, read locally** _(chosen, recommended in brainstorm)_. Background sync upserts into Product/ProductVariant/ProductImage; all reads from our DB. Aligns with `docs/ARCHITECTURE.md` (pg_cron-backed cache); unlocks the existing nav links; fast indexed reads; freshness shown via `SyncBadge`. ~2-3× more code than proxy.
- **Sync first, proxy fallback.** Same as cache plus a "Refresh now" button that does on-demand sync. Most polished, most code.

**Decision:** sync-into-DB. The sidebar nav already references our-DB-only filters, so the alternatives would either defer those filters indefinitely or require maintaining two read paths.

### D2 — Row identity: parent + expandable variants vs flat per-variant rows

**Question:** what is one row in the Products table?

**Considered:**

- **Parent product, expandable to variants** _(chosen, recommended)_. Mirrors Trendyol's seller-panel UI exactly. One row per `contentId` / `productMainId`. Multi-variant products show a `3 Varyant` chip + expand chevron; single-variant products render flat (no chevron). Color shows on parent (content-level shared attribute), size shows on each variant child. Schema: `Product` (parent) + `ProductVariant` (child).
- **Flat per-variant rows.** Each Trendyol variant = one row. Parent fields (title, brand, category, image, productMainId) repeated per row. Multi-variant products render as N rows. Simpler implementation, but the same product appears across multiple table rows visually.
- **Parent rows with side-sheet variant detail.** Main table shows aggregated parent rows; clicking a row opens a right-side sheet listing the variants. Cleanest main-table density but requires two views to see SKU-level data.

**Decision:** parent + expandable. Confirmed against the user's two staging Postman screenshots (single-variant "dfsf"; multi-variant "Beyaz Keten Gömlek 17189" with L/S/M sizes). Captures both shared content and per-SKU fields without lossy denormalization.

### D3 — Sync trigger: manual-only vs manual + scheduled cron

**Question:** how should sync run?

**Considered:**

- **Manual button only, defer cron.** Ship a "Sync now" button in v1.0; add scheduled cron in a follow-up. No new infra (no pg_cron, no Edge Function). Estimated ~700 LOC; faster ship.
- **Manual + scheduled cron** _(chosen)_. Both in scope. Adds: edge-function code + cron job SQL + edge-function deployment + scheduled-sync auth (service-role token). Heavier v1 ship but matches the architecture vision in `docs/ARCHITECTURE.md` and sets the pattern that orders/settlements syncs will reuse.
- **Sync triggered on every page load.** No button, just check `lastSyncAt` and refresh if stale. Slow first paint, multi-tab spam, rate-limit risk under reload.

**Decision:** manual + scheduled. User explicitly chose the "full architecture" option. Shipped as v1.0 (PRs 1–5: manual sync + UI) and v1.1 (PR 6: cron + edge function) so the two halves can be reviewed and shipped independently while sharing the same `ProductSyncService.run` core.

### D4 — Filter set scope for v1

**Question:** what's the v1 filter set? (everything else slides to a follow-up PR)

**Considered:**

- **Search + status only** (smallest v1).
- **Search + status + brand + category** _(chosen, recommended)_. Adds brand/category dropdowns alongside search and status. Brand/category lists computed via cheap `groupBy` queries on synced data. Server-side params: `?q=…&status=onSale&brandId=123&categoryId=456&page=0&size=25`. Facets fetched once on page load via `GET /products/facets`.
- **All Trendyol-side filters.** Adds delivery type, price range, date range, and the variant-level statuses (archived, blacklisted, locked, hasViolation). 3× toolbar code; full Trendyol-panel parity.
- **Recommended set + sidebar warnings** (`?filter=no-cost`, `?filter=low-stock`). Wires existing nav links to behavior. Needs costPrice editing + low-stock threshold config + desi field on variant.

**Decision:** the recommended four filters (search + status + brand + category). costPrice / desi / low-stock filters are explicitly deferred to follow-ups, since the user said costPrice + volume editing comes after this iteration ships.

### D5 — Progress feed mechanism: polling vs Supabase Realtime

**Question:** how should sync progress reach the browser?

**Considered:**

- **Supabase Realtime + polling fallback** _(chosen, recommended)_. Browser subscribes to `postgres_changes` on `sync_logs` filtered by `store_id=eq.{storeId}`. RLS gates visibility (only the org's syncs come through). React Query still does the initial hydrate via REST and serves as a fallback if the WebSocket drops. Background syncs from cron broadcast to anyone with the panel open. ~50 ms perceived lag, multi-tab consistent.
- **Polling only** (simpler ship). React Query polls `GET /sync-logs?active=true` every 2 s while panel is open, every 10 s otherwise. Zero new infra. ~1–2 s lag.
- **Status-only** (no progress bar). Chip pulses while RUNNING, no count. Smallest footprint but no "how much longer" affordance — doesn't satisfy the user's "track from within the panel" goal.

**Decision:** Realtime + polling fallback. The codebase already uses Supabase, the multi-tab consistency wins are real, and the polling fallback keeps the experience robust if the WebSocket drops. Adds: supabase-js Realtime client wiring, RLS audit on `sync_logs` (already needed regardless), channel lifecycle in the SyncCenter component.

### D6 — Async vs synchronous sync trigger

**Considered:** the manual sync route could either block the HTTP request until sync completes, or return immediately with a `syncLogId` for the client to poll/subscribe.

- Synchronous would work for stores with a few hundred variants. With ~1k+ variants the full pull approaches 30–90 s, exceeding most browser/proxy timeouts.
- **Async** _(chosen)_. POST returns 202 immediately; `ProductSyncService.run` continues in the background of the Hono process; client polls `GET /sync-logs/{id}` (or, with D5, subscribes via Realtime). Same shape works for the scheduled cron path — Edge Function POSTs to the BFF internal endpoint, BFF runs the same async service.

**Decision:** async with polling/Realtime status. Single sync service, two trigger surfaces (manual route, internal cron-triggered route), one client-side state machine.

### D7 — Dev DB sync strategy for PR 1

**When asked:** while running `pnpm db:push`, 5 stale rows in `products` blocked the schema push (the rows used `platform_product_id` / `barcode` / `cost_price` columns that the new shape removes/moves).

**Considered:**

- **Truncate only the affected tables** _(chosen, recommended)_. `TRUNCATE products + order_items + orders CASCADE`. Preserves `auth.users` (memory note: never wipe seed users) and orgs/stores/user_profiles. Smallest data loss.
- **Force reset** (`prisma db push --force-reset`). Drops the entire public schema and recreates from the new Prisma schema. Wipes ALL public tables but preserves `auth.users`.
- **Skip DB sync — code-only progress.** Defers integration tests until DB is synced.

**Decision:** truncate. Then `pnpm db:push --accept-data-loss` (the new unique constraint `(storeId, platformContentId)` triggers Prisma's data-loss warning even though the table is empty — flag is safe under that condition).

### D8 — Migration history baseline

**Discovered during PR 1:** `packages/db/prisma/migrations/` only contains `20260425151617_add_org_member_last_accessed_at`; the rest of the schema (Product/Order/OrderItem/Settlement/SyncLog/etc.) was bootstrapped via `db:push` historically. PR 1 also went through `db:push --accept-data-loss`.

**Decision:** flagged as a separate follow-up under "Open follow-ups" in the Progress section. Production deploy of any of this work needs a baseline migration first; doing the baseline inline would expand PR 1 indefinitely.

### D9 — Stock quantity in the same response (no separate inventory endpoint)

**Initial assumption** (from a docs-extraction agent): `/products/approved` returns no stock — a separate inventory endpoint must be called per page to merge in `quantity`.

**Verified against the user's two staging Postman samples:** every variant in the response carries `stock: { quantity: <number>, lastModifiedDate: 0|<ms> }`. Stock is in the response.

**Decision:** drop the separate inventory endpoint plan. The fetcher pulls a single endpoint per page; the mapper reads `variant.stock.quantity` directly into `ProductVariant.quantity`. Removed `inventoryLastSyncedAt` from the schema (would have been added otherwise).

### D10 — Color is content-level (parent), not variant-level (child)

**Verified against the user's staging samples:** color appears in the **content-level** `attributes[]` (`Renk: Beyaz` for sample A, `Renk: Mavi` for sample B). Variant-level `attributes[]` carries size only (`Beden: 210 cm`, `Beden: 115`).

**Quirk surfaced by the samples:** color appears **twice** in content `attributes[]` — once with `attributeId: 47` (no `attributeValueId`), once with `attributeId: 295` (with `attributeValueId`). Both entries say the same thing in real data, but the duplication is structural.

**Decision:** `color: String?` lives on `Product` (parent), not `ProductVariant`. Mapper picks the first `attributeName === 'Renk'` entry and `console.warn`s if duplicates disagree. Raw `attributes[]` Json is preserved on both Product and ProductVariant for forward-compat (sample B carries Cinsiyet / Kol / Yaş Grubu at content level too — keeping the array means we don't lose attributes that we don't model yet).

### D11 — Existing error vocab covers most marketplace cases

**Initial plan:** add a new `MarketplaceUnavailableError` (502) for Trendyol 5xx.

**Discovered while reading the codebase:** `apps/api/src/lib/errors.ts` already has `MarketplaceUnreachable` (503), `MarketplaceAccessError` (422 — for missing User-Agent / missing IP whitelist), and `MarketplaceAuthError` (422). Plus `mapTrendyolResponseToDomainError` already maps 401/403/429/503/5xx to the right ones.

**Decision:** reuse the existing error classes and the existing mapper. Only `SyncInProgressError` (409 + meta `{ syncType, storeId }`) is genuinely new — added in PR 1 alongside its `problemDetailsForError` branch and unit tests, per the same-PR rule in `apps/api/CLAUDE.md`.

### D12 — Frontend convention: file shape mirrors `features/stores/`

**Considered:** is the new `features/products/` folder its own shape, or does it mirror an existing feature?

**Decision:** mirror `features/stores/` exactly:

```
features/<name>/
├── api/         (one .api.ts per request, all using throwApiError)
├── hooks/       (React Query wrappers, query keys from query-keys.ts)
├── components/  (feature-local composites)
├── lib/         (pure utilities, formatting, parsers)
├── query-keys.ts  (factory pattern: featureKeys.list(orgId), .detail(...))
└── types.ts     (re-exports from @pazarsync/api-client)
```

Cross-feature composites get promoted to `apps/web/src/components/patterns/` from the start, not later. `SyncCenter` is the first such promotion (orders/settlements syncs will reuse it).

## Verified against staging

Two Postman responses captured by the user from the Trendyol stage environment (April 2026), used as ground truth for the mapper.

### Sample A — single-variant "dfsf"

```jsonc
{
  "contentId": 1122684425,
  "productMainId": "sdfsdfs",
  "brand": { "id": 2032, "name": "Modline" },
  "category": { "id": 2122, "name": "Dolap ve Gardrop" },
  "title": "dfsf",
  "description": "dfsdfd",
  "creationDate": 1777246115403,
  "lastModifiedDate": 1777246115403,
  "images": [{ "url": "https://cdn.dsmcdn.com/mediacenter-stage8/.../1_org_zoom.jpg" }],
  "attributes": [
    { "attributeId": 47,  "attributeName": "Renk", "attributeValue": "Beyaz" },
    { "attributeId": 295, "attributeName": "Renk", "attributeValueId": 2882, "attributeValue": "Beyaz" }
  ],
  "variants": [
    {
      "variantId": 1565552107, "supplierId": 2738,
      "barcode": "1231231231", "stockCode": "122",
      "attributes": [{ "attributeId": 293, "attributeName": "Beden", "attributeValueId": 18346, "attributeValue": "210 cm" }],
      "onSale": true,
      "deliveryOptions": { "deliveryDuration": null, "isRushDelivery": false, "fastDeliveryOptions": [] },
      "stock": { "quantity": 12312, "lastModifiedDate": 0 },
      "price": { "salePrice": 131231, "listPrice": 131231 },
      "vatRate": 10, "locked": false, "archived": false, "blacklisted": false,
      "locationBasedDelivery": "DISABLED"
      /* … plus seller dates, lockReason: null, archivedDate: null, docNeeded, hasViolation … */
    }
  ]
}
```

### Sample B — single-variant "Test-Corevent-001"

```jsonc
{
  "contentId": 1122684363,
  "productMainId": "SKU-1777147597554-2SAVM",
  "brand": { "id": 3226, "name": "BZN Gömlek" },
  "category": { "id": 597, "name": "Gömlek" },
  "title": "Test-Corevent-001",
  "description": "<div id=\"rich-content-wrapper\">\n <p>Test-Corevent-001</p>\n</div>",
  "images": [/* 3 absolute cdn.dsmcdn.com URLs */],
  "attributes": [
    { "attributeId": 47,  "attributeName": "Renk",     "attributeValue": "Mavi" },
    { "attributeId": 295, "attributeName": "Renk",     "attributeValueId": 2888, "attributeValue": "Mavi" },
    { "attributeId": 296, "attributeName": "Cinsiyet", "attributeValueId": 2873, "attributeValue": "Erkek" },
    { "attributeId": 12,  "attributeName": "Kol",      "attributeValueId": 69,   "attributeValue": "Uzun Kol" },
    { "attributeId": 294, "attributeName": "Yaş Grubu","attributeValueId": 2877, "attributeValue": "Çocuk" }
  ],
  "variants": [
    {
      "variantId": 1565552027, "supplierId": 2738,
      "barcode": "Test-Corevent-001", "stockCode": "Test-Corevent-001",
      "attributes": [{ "attributeId": 293, "attributeName": "Beden", "attributeValueId": 19569, "attributeValue": "115" }],
      "onSale": true,
      "deliveryOptions": { "deliveryDuration": 2, "isRushDelivery": false, "fastDeliveryOptions": [] },
      "stock": { "quantity": 12, "lastModifiedDate": 0 },
      "price": { "salePrice": 123, "listPrice": 1233 },
      "vatRate": 20, "locked": false, "archived": false, "blacklisted": false,
      "locationBasedDelivery": "DISABLED"
    }
  ]
}
```

### What these samples confirmed

1. **Color is content-level** (not variant-level). → `color: String?` on `Product`. (See D10.)
2. **Color often duplicates** in `attributes[]` with the same value across two `attributeId`s (47 and 295). Mapper picks the first `Renk` entry and warns on disagreement.
3. **Stock is in the same response** (`variant.stock.quantity`). → no separate inventory endpoint. (See D9.)
4. **`deliveryDuration` can be `null`** (sample A has it). Mapper keeps the field as `Int?`; UI badge falls back to "Standart".
5. **Image URLs are already absolute** on `cdn.dsmcdn.com` — no rewrite.
6. **`description` carries raw HTML** (`<div id="rich-content-wrapper">…`). Stored verbatim, sanitized at render with DOMPurify.
7. **Content-level `attributes[]` carries more than color** (sample B has Cinsiyet, Kol, Yaş Grubu) — kept in `Product.attributes` Json column for forward-compat.
8. **`locationBasedDelivery`** is a documented enum-like string at variant level (`"DISABLED"` observed; `"ENABLED"` plausible) — kept as `String?` for forward-compat without modeling the enum.

These details are hard-coded as fixtures in `apps/api/tests/unit/integrations/marketplace/trendyol/mapper.test.ts` so any future change to the mapper has a real-data check.

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

## Appendix A — End-to-end data flow

```
                    ┌──────────────────────────────┐
                    │   apigw.trendyol.com         │
                    │   /products/approved (v2)    │
                    └──────────────┬───────────────┘
                                   │ Basic auth + User-Agent
                                   │ rate-limit aware (50/10s)
                                   ▼
        ┌──────────────────────────────────────────────────┐
        │  Hono BFF: TrendyolProductFetcher                │
        │  • paginates (size=100, page x size ≤ 10k →      │
        │    nextPageToken)                                │
        │  • maps Trendyol shape → MappedProduct DTO       │
        │  • stock comes from same response (D9)           │
        └──────────────────────┬───────────────────────────┘
                               ▼
        ┌──────────────────────────────────────────────────┐
        │  ProductSyncService.run(orgId, storeId)          │
        │  • acquires advisory-lock on (storeId, 'PRODUCTS')│
        │  • upserts Product (parent)                      │
        │  • upserts ProductVariant (children)             │
        │  • replaces ProductImage rows                    │
        │  • soft-marks stale variants archived=true       │
        │  • writes SyncLog row (RUNNING → COMPLETED)      │
        │  • cleans stale RUNNING rows >10min before start │
        └─────┬───────────────────────────────────┬────────┘
              │ called by                         │ called by
              │                                   │
   ┌──────────▼─────────────┐        ┌────────────▼───────────┐
   │ POST /…/products/sync  │        │ Supabase Edge Function │
   │ (manual button)        │        │ trendyol-product-sync  │
   │ → 202 + syncLogId      │        │ + pg_cron every 6h     │
   └──────────┬─────────────┘        │ → POST /v1/internal/…  │
              │                      └────────────────────────┘
              ▼
   ┌───────────────────────────────────────────────┐
   │ Postgres: products + product_variants         │
   │           + product_images + sync_logs        │
   │ RLS: is_org_member(organization_id)           │
   └──────────────────────┬────────────────────────┘
                          │
            ┌─────────────┴───────────────┐
            ▼                             ▼
   ┌────────────────────┐    ┌───────────────────────────┐
   │ GET /…/products    │    │ Supabase Realtime         │
   │ (filtered, paged)  │    │ postgres_changes on       │
   └─────────┬──────────┘    │ sync_logs (store_id-     │
             │               │ scoped)                   │
             │               └───────────┬───────────────┘
             ▼                           ▼
   ┌────────────────────────────────────────────────────┐
   │ Next.js /[locale]/(dashboard)/products/page.tsx    │
   │ • DataTable with row-expand for variants           │
   │ • DataTableToolbar with 4 filter facets            │
   │ • nuqs binds toolbar ↔ URL ↔ React Query queryKey  │
   │ • SyncCenter shows live progress + history         │
   └────────────────────────────────────────────────────┘
```

## Appendix B — Table layout sketches

### Parent rows (multi-variant collapsed, single-variant flat)

```
│ ▸ │ 🖼 Beyaz Keten Gömlek 17189  • VS2517189 • 3 Varyant • Beyaz │ ₺120 – ₺200 │ 42 │ Karışık │ 2 satışta · 1 arşiv │
│   │ 🖼 dfsf                       • sdfsdfs   • single      • Beyaz │ ₺131 231    │ 12 312 │ Standart │ Satışta │
                  ↑ no chevron when getRowCanExpand returns false
```

### Expanded — sub-table of variants

```
│ ▾ │ 🖼 Beyaz Keten Gömlek 17189 …                                                           │
│   │   ┌──────────────────────────────────────────────────────────────────────────────────┐ │
│   │   │ Beden  │ Stok Kodu        │ Barkod           │ Fiyat │ Stok │ Teslimat   │ Durum │ │
│   │   │ L      │ 7887800432124    │ 7887800432124    │ ₺200  │  14  │ Bugün      │ Sat'ta│ │
│   │   │ S      │ 7887800432148    │ 7887800432148    │ ₺200  │  19  │ Bugün      │ Sat'ta│ │
│   │   │ M      │ 7887800432131    │ 7887800432131    │ ₺120  │   9  │ Yarın      │ Arşiv │ │
│   │   └──────────────────────────────────────────────────────────────────────────────────┘ │
```

### SyncCenter sheet

```
PageHeader
┌──────────────────────────────────────────────────────────────────┐
│ Ürünler                          [● Senkronize • 234/1,200 19%]  │ ← clickable chip (extended SyncBadge)
└──────────────────────────────────────────────────────────────────┘
                                                          │ click
                                                          ▼
                                                   ┌────────────────┐
                                                   │ Senkronizasyon │  Sheet
                                                   ├────────────────┤
                                                   │ Çalışıyor      │
                                                   │ ▰▰▰▰▰▱▱▱ 19%  │
                                                   │ Ürünler        │
                                                   │ 234 / 1,200    │
                                                   │ ~45 sn          │
                                                   ├────────────────┤
                                                   │ Geçmiş         │
                                                   │ ✓ 12dk önce    │
                                                   │   Ürünler 1.2k │
                                                   │ ✓ 6sa önce     │
                                                   │   Ürünler 1.2k │
                                                   │ ✗ 12sa önce    │
                                                   │   Pazaryeri ek │
                                                   ├────────────────┤
                                                   │ [Şimdi senk.]  │
                                                   └────────────────┘
```

### Toolbar (PR 4)

```
[🔍 Ara: ad / stok kodu / barkod / model kodu …]   [Durum ▾]   [Marka ▾]   [Kategori ▾]
                                                                                          [Sütunlar ▾] [⬇ Dışa aktar]
```

URL ↔ state binding example: `/products?q=keten&status=onSale&brandId=3226&categoryId=597&page=2&perPage=50`.

## Appendix C — PR phasing diagram

```
       v1.0 (manual sync, listing, live progress)                v1.1 (scheduled cron)
       ┌─────────────────────────────────────────────────┐       ┌─────────────────────┐
PR 1 ──┤                                                 │       │                     │
       │ ── PR 2 ──┐                                     │       │                     │
       │           ├── PR 4 ─── PR 5                     │       │                     │
       │ ── PR 3 ──┘                                     │       │ ── PR 6             │
       └─────────────────────────────────────────────────┘       └─────────────────────┘
```

- **PR 1** ships first (foundation).
- **PR 2** and **PR 3** can run in parallel after PR 1 (one writes the sync route, the other the list route; both depend on the schema).
- **PR 4** depends on PR 3 (frontend reads the list endpoint).
- **PR 5** depends on PR 2 + PR 4 (Realtime overlay on the existing UI).
- **v1.0 ships after PR 5.**
- **PR 6** depends on PR 2 (reuses the sync service via the internal endpoint).
- **v1.1 ships after PR 6.**
