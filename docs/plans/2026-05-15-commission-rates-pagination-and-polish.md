# Commission Rates — Pagination Refactor + Polish

> **Predecessor:** `docs/plans/2026-05-15-commission-rates-frontend-design.md` (shipped on `feature/commission-rates-frontend`).
> **Status:** ready for implementation.
> **Branch:** continues on `feature/commission-rates-frontend`.

## Context

The first cut of the Komisyon Oranları page shipped with three rough edges:

1. **Tab visual rot.** `<FilterTabs>` defaults to a pill variant whose chrome is stripped (`bg-transparent border-none`). The active tab gets a pill (bg-card + shadow), inactive tabs render as bare text "floating in space" — the user flagged it visually. The page is data-dense reference material and needs a grounded, restrained switcher.
2. **"Daha fazla yükle" is broken.** Clicking the button does nothing in the rendered page. Diagnosis was deprioritized in favor of a UX direction change: switch from cursor pagination to traditional page-based pagination. This matches the rest of the codebase (products feature parity), gives users page-jump affordance, and is more legible for a 4346-row CATEGORY list / 130K-row CATEGORY_BRAND list where users may want to jump deep into the alphabet.
3. **Segment override labels are raw token strings.** Tooltip currently shows `ka1: 4.00`. Trendyol's seller panel uses human labels: "Seviye 5 KDV Dahil Komisyon Oranı" etc. The mapping (locked by user, verified against the Trendyol panel screenshot):

   | DB key (Prisma) | Display label  | Trendyol panel column                          |
   | --------------- | -------------- | ---------------------------------------------- |
   | `ka1`           | Seviye 5       | Seviye 5 KDV Dahil Komisyon Oranı              |
   | `ka2`           | Seviye 4       | Seviye 4 KDV Dahil Komisyon Oranı              |
   | `na1`           | Seviye 3       | Seviye 3 KDV Dahil Komisyon Oranı              |
   | `microSegment`  | Özelleşmiş Grup | Özelleşmiş Grup KDV Dahil Komisyon Oranı       |

   **No `ka3`** — Trendyol's panel only has Seviye 3/4/5 plus Özelleşmiş Grup. The early "5'li seviye" guess in conversation was wrong.

All three issues live on the same branch. Backend touch is required for #2; #1 and #3 are frontend-only.

## Locked decisions

| Issue | Decision |
| --- | --- |
| **#1 — Tabs** | Pass `variant="underline"` to `<FilterTabs>` in `commission-rates-page-client.tsx`. Active tab gets `border-primary` underline; inactive tabs render as muted text with a hover underline. Matches Linear / Stripe binary mode switch. Single-line change at the component call site; no fork of FilterTabs or the underlying Tabs primitive. |
| **#2 — Pagination** | Replace cursor pagination with offset/page-based pagination across backend, API contract, frontend hook, and UI. Reuse the existing `TablePaginationQuerySchema` + `TableMetaSchema` + `tablePaginated()` from `apps/api/src/openapi/pagination.ts` — they already exist as the "explicit opt-in offset model" and lock perPage to `[10, 25, 50, 100]`. Default `perPage` for this endpoint: 50 (override via `.default(50)` on the schema; the shared default is 25). `<DataTablePagination>` defaults to the same `pageSizes` array, so the UI and backend agree on the selector. |
| **#3 — Segments** | Add a feature-local `lib/segment-labels.ts` with the 4-key Record above. Table's `baseRate` tooltip renders entries in fixed order (Seviye 5 → 4 → 3 → Özelleşmiş Grup), formatted as "Seviye 5: %4,00". Unknown keys (defensive) render raw. Tooltip ⓘ icon shows ONLY when `Object.keys(segmentOverrides).length > 0` (verify current behavior — screenshot suggests the icon currently shows on every row, possibly a bug in the cell-conditional check). |

## Implementation surface

### Backend (`apps/api/`)

| File | Change |
| --- | --- |
| `src/validators/commission-rate.validator.ts` (query) | Drop `cursor` + `limit` query params. Extend `TablePaginationQuerySchema` from `src/openapi/pagination.ts`, then `.extend({ perPage: ... })` to override the default to 50 (perPage value set stays locked to `[10, 25, 50, 100]`). Drop the `INVALID_CURSOR` and `CURSOR_SORT_MISMATCH` codes from the route's 422 response declarations. Keep `INVALID_SORT_FOR_SCOPE`. |
| `src/validators/commission-rate.validator.ts` (response) | `paginated(CommissionRateListItemSchema)` → `tablePaginated(CommissionRateListItemSchema)`. Wire shape changes from `meta: CursorMeta` → `pagination: TableMeta`. The schema name in OpenAPI changes from `ListCommissionRatesResponse` (cursor-shaped) — verify the existing schema name registers cleanly with the new shape, or re-register with a fresh name if `@hono/zod-openapi` complains. |
| `src/services/commission-rate-list.service.ts` | Replace cursor decode logic with `skip = (page - 1) * perPage`, `take = perPage`. Two queries: `prisma.marketplaceCommissionRate.findMany({ where, orderBy, skip, take })` + `prisma.marketplaceCommissionRate.count({ where })`. Run them via `Promise.all`. The `productScope=active` filter still composes the same JOIN to product rows; just under offset pagination. Wrap both with `mapPrismaError` on the catch path per backend CLAUDE.md. The `product_count:desc` sort path that builds an in-memory product-count map stays; only the slicing changes from cursor-walk to `slice(skip, skip+take)`. |
| `src/routes/commission-rates/list.route.ts` | Update OpenAPI response schema reference. Drop the `CURSOR_SORT_MISMATCH` and `INVALID_CURSOR` error response declarations. Keep 422 for `INVALID_SORT_FOR_SCOPE` only. |
| `tests/integration/routes/commission-rates-list.routes.test.ts` | Delete cursor-mismatch tests and any `INVALID_CURSOR` assertions. Replace with: page=1 default response shape (`pagination.page === 1`), page=2 returns next slice, page beyond totalPages returns empty `data` + correct `total`/`totalPages`, perPage=200 → 422 VALIDATION_ERROR (locked to `[10, 25, 50, 100]`), perPage=50 is the route's own default (not the shared 25). `INVALID_SORT_FOR_SCOPE` invariant still triggers on `sort=product_count:desc` + `productScope=all`. Multi-tenancy isolation test (cross-org leak) stays as-is — it's not pagination-shaped. |
| `tests/integration/services/commission-rate-list.service.test.ts` (if exists) | Swap cursor assertions for offset assertions. |
| `packages/api-client` | Regenerate via `pnpm api:sync` after backend changes are committed. The generated `paths['/v1/.../commission-rates']` types update automatically; frontend typecheck will surface any drift. |

### Frontend (`apps/web/`)

| File | Change |
| --- | --- |
| `src/features/commission-rates/query-keys.ts` | Add `page: number` and `perPage: number` to `CommissionRateListFilters`. |
| `src/features/commission-rates/api/list-commission-rates.api.ts` | Drop `cursor` + `limit` from `ListCommissionRatesArgs`. Add `page` + `perPage`. Update `ListCommissionRatesResponse` type — the regenerated `components['schemas']['ListCommissionRatesResponse']` will carry the new pagination shape. |
| `src/features/commission-rates/hooks/use-commission-rates.ts` | `useInfiniteQuery` → `useQuery`. Drop `initialPageParam`, `getNextPageParam`, `COMMISSION_RATES_PAGE_LIMIT` export. Returns the standard `UseQueryResult<ListCommissionRatesResponse>`. |
| `src/features/commission-rates/hooks/use-commission-rates-filters.ts` | Add nuqs parsers: `page: parseAsInteger.withDefault(1)`, `perPage: parseAsInteger.withDefault(50)`. Wrap `setFilters` to auto-reset `page` to 1 on any non-pagination filter change (q / sort / productScope / ruleKind / perPage). Mirror the `products` helper's `touchesNonPaginationFilter` check. |
| `src/features/commission-rates/components/commission-rates-load-more.tsx` | **DELETE**. |
| `src/features/commission-rates/components/commission-rates-table.tsx` | Pagination slot receives `<DataTablePagination>` instead of `<CommissionRatesLoadMore>`. Connect via the `paginationState` + `onPaginationChange` + `pageCount` + `rowCount` controlled props on DataTable (TanStack manual pagination mode). |
| `src/features/commission-rates/components/commission-rates-page-client.tsx` | Three changes: (a) `<FilterTabs variant="underline" ...>` for issue #1; (b) drop `useInfiniteQuery` ceremony — flatten to single-page `query.data?.data ?? []`; (c) wire pagination state from `filters.page` / `filters.perPage` into the table, with handlers that call `setFilters({ page, perPage })`. The search debounce useEffect stays as-is. |
| `src/features/commission-rates/lib/segment-labels.ts` | **NEW**. Exports `SEGMENT_LABEL_ORDER: readonly ['ka1', 'ka2', 'na1', 'microSegment']` and `SEGMENT_LABELS: Record<string, string>` with the 4-key map above. Plus `getSegmentLabel(key: string): string` that returns the mapped label or the raw key (fallback for unknown). |
| `src/features/commission-rates/components/commission-rates-table.tsx` (segment tooltip) | Import the helper. Walk `SEGMENT_LABEL_ORDER` and render only the keys present in `segmentOverrides`. Display: "Seviye 5: %4,00" using `formatter.number(value/100, 'percent')`. Verify the ⓘ icon is gated on `Object.keys(segmentOverrides).length > 0` — if the screenshot shows it on every row, fix that check. |
| `messages/tr.json` + `messages/en.json` | Keep segment labels inline in `lib/segment-labels.ts` as constants (NOT in i18n). Rationale: "Seviye 5" is the data label Trendyol uses in its seller panel — the same string the English-locale user expects, not UI copy. If we ever localize, we add the key set then. The existing `tooltip.segmentOverridesTitle` translation stays in i18n. |

### Tests

| File | Change |
| --- | --- |
| `apps/web/tests/unit/hooks/use-commission-rates.test.tsx` | Rewrite. Drop `fetchNextPage` test, drop cursor test. Add: page=1 default request shape, page=2 forwards correct `page` + `perPage`, perPage change resets to page 1 at the hook layer (or page-client layer — depending on where the reset lives), totals/pageCount surface correctly. |
| `apps/web/tests/component/features/commission-rates/commission-rates-load-more.test.tsx` | **DELETE**. |
| `apps/web/tests/component/features/commission-rates/commission-rates-pagination.test.tsx` (new, optional) | Cover the page-change → URL update wiring. Optional because TanStack's `<DataTablePagination>` is already tested in `tests/component/data-table-pagination.test.tsx`. |
| `apps/web/tests/component/features/commission-rates/commission-rates-table.test.tsx` (new) | Segment tooltip ordering + label rendering: given a row with `{ka1: '4.00', na1: '3.50'}`, tooltip shows "Seviye 5: %4,00" first then "Seviye 3: %3,50". |
| `apps/web/tests/unit/lib/commission-rates-sort-options.test.ts` | Unchanged. |

### Out of scope

- Tab strip restyling beyond the variant swap (no new tokens, no new pattern composite).
- Segment selector / segment-aware profit calc — Trendyol doesn't expose the seller's own segment via API.
- Marketplace dropdown for multi-platform stores.
- CSV export.
- Other tools page placeholders (commission-calculator, plus-commission-rates, product-pricing) — separate decisions.

## Verification

```bash
# Backend
pnpm --filter @pazarsync/api typecheck
pnpm --filter @pazarsync/api test
supabase start && pnpm --filter @pazarsync/api test:integration

# Regenerate API client types
pnpm api:sync

# Frontend
pnpm --filter @pazarsync/web typecheck
pnpm --filter @pazarsync/web lint
pnpm --filter @pazarsync/web test commission-rates

# Full gate
pnpm check:all
```

Manual smoke on the dev server (localhost:3000):

1. Navigate to `/tools/commission-rates`.
2. Tabs: inactive tab now reads as muted text with a hover underline; active tab has the primary underline. No "floating in space" feeling.
3. Pagination: footer shows "1-50 / 4.346 satır · Sayfa başına [50▾] · « ‹ 1 / 87 › »". Click next → page=2 in URL, rows update. Change perPage to 25 → URL updates, page resets to 1.
4. Sort by Ürün # in "Tüm tarife" mode → toast appears, scope flips to active, sort applies, page resets to 1.
5. Hover a baseRate cell with overrides → tooltip shows "Seviye 5: %X,X / Seviye 4: %X,X / Seviye 3: %X,X / Özelleşmiş Grup: %X,X" in that order. Rows without overrides have no ⓘ icon.
6. Network tab: requests carry `?ruleKind=CATEGORY&productScope=all&sort=category_name:asc&page=2&perPage=50`. No `cursor` param ever sent.

## Plan file scope

Total: ~250–300 lines of code change across backend + frontend + tests, plus the API client regen (mechanical). Single PR on `feature/commission-rates-frontend` continuing the existing work.
