# Commission Rates frontend page — design plan

> **Status:** ready for implementation session.
> **Predecessor:** PR #176 (`d8a5c16`) shipped the backend.
> **Owner:** TBD next session.

## Context

PazarSync needs a "Komisyon Oranları" page where the seller can browse the
imported Trendyol commission tariff for their store: every category and
every category-brand combination, with filtering, search, and a metric
showing how many of the seller's own products are in each row.

The backend is fully shipped (`GET /v1/organizations/:orgId/stores/:storeId/commission-rates`)
and the `marketplace_commission_rate` table is populated with the ~135K row
TRENDYOL tariff. What's missing is the UI surface — a page under the
dashboard layout that consumes this endpoint.

This plan locks the **decisions already made by the backend contract**,
points at the **existing patterns to clone**, and surfaces the **open UX
questions** for the implementation session to resolve.

---

## Locked by the backend (do not redesign)

These are wire-level contracts. Changing them means a new backend PR.

### URL

```
GET /v1/organizations/:orgId/stores/:storeId/commission-rates
```

Store-scoped because the page renders `productCount` per row and supports
"Sattıklarım" mode that intersects with the seller's actual products.

### Query params

| Param          | Tip                                                                  | Default              | UX exposure                                       |
| -------------- | -------------------------------------------------------------------- | -------------------- | ------------------------------------------------- |
| `ruleKind`     | `CATEGORY` \| `CATEGORY_BRAND`                                       | **required**         | Tab switcher or dropdown — UI choice              |
| `productScope` | `all` \| `active`                                                    | `all`                | Toggle ("Tüm tarife" ↔ "Sattıklarım")             |
| `q`            | string ≤ 100                                                         | —                    | Search input over categoryName / parent / brand   |
| `sort`         | `category_name:asc` \| `base_rate:asc\|desc` \| `product_count:desc` | `category_name:asc`  | Column header click + URL state                   |
| `cursor`       | opaque                                                               | —                    | Hidden, paginated via "Load more" or page buttons |
| `limit`        | 1–100                                                                | 50                   | Hidden (frontend picks)                           |

Cursor encodes the sort. Changing sort mid-pagination → 422 `CURSOR_SORT_MISMATCH` —
the hook MUST reset cursor when sort changes (don't pass the stale one).

### Response item

13 fields, all required-and-stable:

```typescript
{
  id: string,
  ruleKind: 'CATEGORY' | 'CATEGORY_BRAND',
  platform: 'TRENDYOL' | 'HEPSIBURADA',
  categoryId: string,         // BigInt string
  brandId: string | null,     // null on CATEGORY
  categoryName: string,
  parentCategoryName: string | null,  // populated on CATEGORY only
  brandName: string | null,           // populated on CATEGORY_BRAND only
  baseRate: string,                   // Decimal string, e.g. "5.00"
  paymentTermDays: number,
  segmentOverrides: Record<string, string>,  // e.g. {"ka2": "4.00"}
  productCount: number,
  fetchedAt: string,                  // ISO
}
```

### Error responses

- `401 UNAUTHENTICATED` — global session-expired handler picks this up (pre-silenced)
- `403 FORBIDDEN` — caller not org member
- `404 NOT_FOUND` — store doesn't belong to this org (route to "no store selected" empty state)
- `422 VALIDATION_ERROR` — `cursor` mismatch (auto-reset cursor & retry) or `product_count:desc` without `productScope=active` (UI invariant — never send this combo)

### Constraints the UI must honor

1. `product_count:desc` sort works only when `productScope=active`. If the user clicks "sort by product count" while in "all" mode, switch to active mode first or disable the sort affordance.
2. `cursor` must be cleared when `q` or `sort` or `productScope` or `ruleKind` changes.
3. `segmentOverrides` is reference data — Trendyol doesn't expose seller segment via API, so for now show it as a tooltip or detail-row reveal, NOT as a top-level rendered chip per row. Profit calc uses `baseRate` end-to-end.

---

## Reference patterns to clone

### Whole-feature shape: `apps/web/src/features/products/`

Closest analog in the codebase — store-scoped list page with filters, search,
pagination, store-switching invalidation. Structure to mirror:

```
apps/web/src/features/commission-rates/
├── api/
│   └── list-commission-rates.api.ts    # openapi-fetch wrapper; throwApiError
├── components/
│   ├── commission-rates-page-client.tsx  # top-level client wrapper
│   ├── commission-rates-table.tsx        # DataTable + columns
│   ├── commission-rates-toolbar.tsx      # search + scope toggle + rule-kind tabs
│   └── commission-rates-empty-state.tsx
├── hooks/
│   └── use-commission-rates.ts           # useQuery wrapper
├── lib/
│   └── (filter parsers, sort helpers as needed)
└── query-keys.ts
```

### Page shell: `apps/web/src/app/[locale]/(dashboard)/products/page.tsx`

Server component that resolves `activeOrgId` + `activeStoreId` from cookies
(`apps/web/src/lib/active-store.ts`) and hands them as props to the client
component. Same pattern applies here — copy the orchestration, swap to the
commission-rates feature.

### Pattern composites to compose with (`apps/web/src/components/patterns/`)

Pre-built; do not fork. The relevant ones for this page:

- `page-header.tsx` — title + intent + actions slot
- `data-table.tsx` + `data-table-toolbar.tsx` + `data-table-pagination.tsx` — the table shell
- `filter-tabs.tsx` — for `ruleKind` tab switcher (CATEGORY ↔ CATEGORY_BRAND)
- `search-input.tsx` — for `q` input
- `filter-chip-group.tsx` — for `productScope` toggle (or `tabs` if it fits the UX better)
- `empty-state.tsx` — no-store, no-rates, no-matches
- `sync-badge.tsx` — if we render "Son güncelleme: 2 gün önce" from `fetchedAt`
- `time-ago.tsx` — relative `fetchedAt` formatting

Primitives (`apps/web/src/components/ui/`) under these as needed. Never fork a primitive.

### Active store / org resolution

`apps/web/src/lib/active-store.ts` provides `resolveActiveOrgId()` and
`resolveActiveStoreId(stores)` — call from the page server component, pass
ids as nullable props to the client component, handle null in client with
the `no-store-selected` empty state. Pattern is established; do not invent
a `useCurrentStore` hook.

### Query key factory

`apps/web/src/features/products/query-keys.ts` is the template. Copy shape:

```typescript
export const commissionRateKeys = {
  all: ['commission-rates'] as const,
  lists: (orgId: string, storeId: string) =>
    [...commissionRateKeys.all, 'list', orgId, storeId] as const,
  list: (orgId: string, storeId: string, filters: CommissionRateListFilters) =>
    [...commissionRateKeys.lists(orgId, storeId), filters] as const,
};
```

Store switcher invalidates by `commissionRateKeys.all` or by `lists(orgId, storeId)` —
follow whatever products does.

### Error handling

Global `onError` on `QueryCache` in `apps/web/src/providers/query-provider.tsx`
translates `ApiError.code` to `common.errors.<CODE>` toasts. Do NOT hand-roll
generic toasts in the hook. `meta.silent` only for hooks that own their own
UI (form-level error inline display). `UNAUTHENTICATED` and `VALIDATION_ERROR`
are pre-silenced — the page should NOT try to render a custom 422 banner
unless the `code` is something specific like `INVALID_SORT_FOR_SCOPE` (which
should never reach the wire if the UI guards correctly — see Constraints).

### i18n

All Turkish strings via `next-intl`. Namespace will be
`features.commission-rates.*`. Do not inline Turkish in components.

---

## Open design questions (resolve in session)

These are UX decisions the implementation session should make. Invoke
`/ui-ux-pro-max` to think through them — the answers shape the components.

### Q1: ruleKind tab vs single mixed list

Two `ruleKind` families have different cardinality (4346 CATEGORY rows,
130K CATEGORY_BRAND rows) and different "shape" (CATEGORY has
`parentCategoryName`, CATEGORY_BRAND has `brandName`). The backend forced
them apart by making `ruleKind` required.

- **Option A (tabs):** `<FilterTabs>` at top — "Kategoriler" / "Kategori + Marka". Each tab is a separate fetch. Cleanest semantic split, but tab switch = full reload of table.
- **Option B (dropdown selector):** Single dropdown in the toolbar. Less prominent, but consistent with how other features use `<FilterChipGroup>` for similar binary choices.

Recommendation: **A** — the two families are semantically different and the user is likely to spend time in one before switching. Tabs make the mode-switch a deliberate gesture, not an accidental dropdown click.

### Q2: productScope rendering

Toggle between `all` (everything) and `active` (only what the seller sells).
This is the headline filter — it's how the seller answers "show me only the
commissions I actually care about".

- **Option A (toggle pill):** "Tüm tarife" / "Sattıklarım" as a 2-segment
  toggle next to the search input. Click to switch.
- **Option B (checkbox):** "Sadece sattıklarım" checkbox. Single binary state.
- **Option C (saved view dropdown):** Multiple modes including future ones
  ("yüksek komisyonlu", "düşük vadeli") — overkill for v1.

Recommendation: **A** — the toggle is visually heavier and signals the
two-mode nature. A checkbox under-communicates how important this filter is.

### Q3: productCount column UX

Per row, integer ≥ 0. The number is the "trust signal" — it tells the
seller "this row matters because you have N products in this category".

- **Option A (raw number):** Just `"42"` in a numeric column with right-align.
- **Option B (badge):** Pill badge "42 ürün". Heavier visual weight.
- **Option C (sparkline cell):** Sparkline of count over time — premature for v1, no history.

Recommendation: **A or B**, decide in session. If A, add a column header
tooltip explaining what "Ürün sayısı" means. If B, only show the badge when
`productScope === 'all'` (in `active` mode every row has ≥ 1 by definition,
so the badge becomes noise).

### Q4: Sort affordance for productCount

`product_count:desc` is the only sort that requires `productScope=active`.

- **Option A (auto-switch):** Clicking the sort header on `productCount`
  while in `all` mode automatically switches to `active` and applies the sort.
  Surface a toast / inline hint explaining the switch.
- **Option B (disabled):** Sort affordance is disabled in `all` mode with
  a tooltip "Sadece 'Sattıklarım' modunda sıralanabilir".
- **Option C (no sort):** Don't expose the column header as a sort button
  at all; only sort by category_name or base_rate.

Recommendation: **A** — auto-switch with a subtle hint is the friendliest
behavior. The user wants this view; force-clicking through "active mode
first, then sort" is awkward.

### Q5: Empty states

Three distinct empty cases:

1. **No store selected** — org has 0 stores. Reuse `<EmptyState>` with
   `variant="no-store"` from the existing pattern.
2. **No commission rates for this platform** — store exists, but
   `marketplace_commission_rate` is empty for its platform. Rare (only if
   seed missed) but possible for HEPSIBURADA today. Copy: "Bu pazaryeri
   için komisyon tarifesi henüz yüklenmemiş."
3. **No matches for current filter** — search/scope yields 0 rows. Copy:
   "Filtreyle eşleşen oran bulunamadı. Aramayı temizle veya 'Tüm tarife'
   moduna geç."

### Q6: Detail / segment override reveal

Segments (`ka1`, `ka2`, `na1`, `microSegment`) are interesting but not
actionable today. Options for surfacing them:

- **Option A (none):** Don't show segment overrides at all in v1. Profit
  calc uses `baseRate`; the seller doesn't pick a segment.
- **Option B (tooltip on baseRate):** Hover the baseRate cell → tooltip
  shows "Segment override'lar: ka2 → %4". Cheap.
- **Option C (expandable row):** Click row to expand a detail panel
  showing all segment overrides + `paymentTermDays` + `fetchedAt`.

Recommendation: **B** for v1. **C** later when sellers ask "why is my
commission different than the table shows" (which they will, once they
notice segments exist in their seller panel).

### Q7: `fetchedAt` surfacing

Each row has its own `fetchedAt` from the snapshot import. All rows in
practice share the same value per batch.

- Show as a single chip on the page header: "Son güncelleme: 3 gün önce"
  (using `<TimeAgo>` from patterns) reading from the max `fetchedAt`.
- Skip per-row rendering — it would just repeat 130K times.

---

## Acceptance criteria

- [ ] Page renders at `/dashboard/commission-rates` (locale-prefixed via
      `[locale]/(dashboard)/...`).
- [ ] Server component resolves activeOrgId + activeStoreId from cookies,
      handles "no store" with `<EmptyState>`.
- [ ] Two-tab `ruleKind` switcher; switching tab resets cursor.
- [ ] productScope toggle ("Tüm tarife" ↔ "Sattıklarım"); switching resets cursor.
- [ ] Search input on `q` with debounce (~250 ms); typing resets cursor.
- [ ] DataTable with columns: category (+ parent), brand (CATEGORY_BRAND only),
      baseRate, paymentTermDays, productCount, fetchedAt (or hidden if shown in header).
- [ ] Column sort affordance on `category_name`, `base_rate`, `product_count`.
      Clicking `product_count` from `all` mode auto-switches to `active`.
- [ ] Cursor pagination with "Daha fazla yükle" button or `<DataTablePagination>`
      depending on house style — match what Products does.
- [ ] React Query hook with `commissionRateKeys` factory and global error handler.
- [ ] All Turkish strings via `next-intl`; new namespace `features.commission-rates`.
- [ ] Component tests with MSW for: list render, scope toggle, search,
      pagination, no-store empty state, no-matches empty state.
- [ ] Hook test for: query key shape, refetch on filter change, cursor reset on filter change.
- [ ] `pnpm --filter @pazarsync/web typecheck` clean
- [ ] `pnpm --filter @pazarsync/web test` clean for new files (pre-existing
      failures in `cost-cell` / `cost-profile` / `parent-row-cost-cell` /
      `sync-center` are not this PR's responsibility)
- [ ] Dev server smoke: load page, switch tabs, toggle scope, search,
      paginate, verify network calls hit the right endpoint with right params.
- [ ] No new palettes / one-off colors — extend tokens if needed via `/ui-design-system`.

---

## How to start the next session

1. Open the repo in a new Claude session.
2. Paste:

   > "Commission rates frontend sayfasını yapacağız.
   > Plan: `docs/plans/2026-05-15-commission-rates-frontend-design.md`.
   > Backend hazır (PR #176 merged), products feature'ı en yakın referans.
   > Önce `/ui-ux-pro-max` ile open design questions'ı (Q1–Q7) tartışalım,
   > sonra implementation."

3. The session reads this plan, the locked decisions stay locked,
   and the design questions get resolved before coding starts.

---

## Files to create (estimated)

```
apps/web/src/features/commission-rates/
  query-keys.ts                                   ~20 lines
  api/list-commission-rates.api.ts                ~30 lines
  hooks/use-commission-rates.ts                   ~40 lines
  components/commission-rates-page-client.tsx     ~80 lines
  components/commission-rates-table.tsx           ~120 lines
  components/commission-rates-toolbar.tsx         ~60 lines
  components/commission-rates-empty-state.tsx     ~30 lines

apps/web/src/app/[locale]/(dashboard)/commission-rates/
  page.tsx                                        ~40 lines

apps/web/src/messages/tr.json (or wherever i18n lives)
  features.commission-rates.* namespace           ~25 keys

apps/web/tests/component/features/commission-rates/
  commission-rates-page.test.tsx                  ~6–10 cases
  commission-rates-toolbar.test.tsx               ~3–5 cases

apps/web/tests/hook/
  use-commission-rates.test.tsx                   ~3–5 cases
```

Total estimate: ~500–600 lines + tests. Single PR.

---

## Out of scope (future work)

- Marketplace selector when a store is multi-platform (we're 1 store = 1 platform today)
- CSV / Excel export
- Hierarchical category tree view (parent → child → brand)
- Edit / override flow — the tariff is read-only from PazarSync's perspective; corrections happen at Trendyol's panel and re-import here
- Segment selector — Trendyol doesn't expose it; revisit when they do
