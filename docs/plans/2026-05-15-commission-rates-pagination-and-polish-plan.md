# Commission Rates — Pagination Refactor + Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace cursor pagination with page-based pagination across backend + API client + frontend for the commission-rates feature; switch the ruleKind tab strip to the `underline` variant; render `segmentOverrides` with the human-readable Seviye labels Trendyol's seller panel uses.

**Architecture:** Reuse the existing `TablePaginationQuerySchema` + `TableMetaSchema` + `tablePaginated()` helpers from `apps/api/src/openapi/pagination.ts` (already in the codebase for offset/page-based endpoints). Frontend swaps `useInfiniteQuery` for `useQuery`, mounts `<DataTablePagination>` from `apps/web/src/components/patterns/`, and adds a feature-local `lib/segment-labels.ts` constant for the 4-key Trendyol mapping.

**Tech Stack:** Hono 4.x + `@hono/zod-openapi`, Prisma 7, Vitest 4 + happy-dom + MSW v2, React 19 + TanStack Query v5 + TanStack Table v8, nuqs, next-intl.

**Branch:** Continue on `feature/commission-rates-frontend` (already pushed). No new branch.

**Spec:** `docs/plans/2026-05-15-commission-rates-pagination-and-polish.md`

---

## File Structure

### Modified

| Path | Responsibility after refactor |
| --- | --- |
| `apps/api/src/validators/commission-rate.validator.ts` | Query schema uses `TablePaginationQuerySchema` with perPage default 50; response schema uses `tablePaginated()`; no cursor fields |
| `apps/api/src/services/commission-rate-list.service.ts` | `skip`/`take` slicing + `prisma.$transaction([findMany, count])`; in-memory product-count sort slices the sorted array by `(page-1)*perPage` |
| `apps/api/src/routes/commission-rates/list.route.ts` | OpenAPI description drops cursor mentions; 422 description lists only `INVALID_SORT_FOR_SCOPE`; handler passes `pagination` envelope |
| `apps/api/tests/integration/routes/commission-rates-list.routes.test.ts` | Cursor tests rewritten as page tests; `meta` → `pagination`; perPage selector validation |
| `apps/web/src/features/commission-rates/query-keys.ts` | `CommissionRateListFilters` carries `page` + `perPage` |
| `apps/web/src/features/commission-rates/api/list-commission-rates.api.ts` | Args use `page` + `perPage`; response type follows regenerated `tablePaginated` shape |
| `apps/web/src/features/commission-rates/hooks/use-commission-rates.ts` | `useQuery` (single page) instead of `useInfiniteQuery` |
| `apps/web/src/features/commission-rates/hooks/use-commission-rates-filters.ts` | nuqs parsers for `page`/`perPage`; auto-reset `page=1` on non-pagination filter change |
| `apps/web/src/features/commission-rates/components/commission-rates-table.tsx` | Pagination slot receives `<DataTablePagination>` via controlled `paginationState` + `pageCount` + `rowCount`; segment tooltip uses ordered keys from segment-labels lib |
| `apps/web/src/features/commission-rates/components/commission-rates-page-client.tsx` | `<FilterTabs variant="underline">`; flatten infinite-query plumbing to single page; wire DataTable's pagination state to nuqs filters |
| `apps/web/tests/unit/hooks/use-commission-rates.test.tsx` | Rewrite cursor tests as page-based assertions |

### New

| Path | Responsibility |
| --- | --- |
| `apps/web/src/features/commission-rates/lib/segment-labels.ts` | `SEGMENT_LABEL_ORDER` (readonly tuple) + `SEGMENT_LABELS` map + `getSegmentLabel(key)` fallback helper |
| `apps/web/tests/unit/lib/commission-rates-segment-labels.test.ts` | Unit tests for the lib (mapping + fallback + ordering) |
| `apps/web/tests/component/features/commission-rates/commission-rates-table.test.tsx` | Segment tooltip ordering + label rendering |

### Deleted

| Path | Reason |
| --- | --- |
| `apps/web/src/features/commission-rates/components/commission-rates-load-more.tsx` | Replaced by `<DataTablePagination>` |
| `apps/web/tests/component/features/commission-rates/commission-rates-load-more.test.tsx` | Test for the deleted component |

---

## Task 1: Backend — replace query schema with table pagination

**Files:**
- Modify: `apps/api/src/validators/commission-rate.validator.ts`

- [ ] **Step 1.1: Update imports**

Replace the `CursorMetaSchema` import with the table-pagination helpers:

```typescript
// OLD (line 5)
import { CursorMetaSchema } from '../openapi';

// NEW
import { TableMetaSchema, TablePaginationQuerySchema, tablePaginated } from '../openapi';
```

- [ ] **Step 1.2: Replace the query schema body**

Replace the entire `listCommissionRatesQuerySchema` definition (currently lines 44–78) with the version that extends `TablePaginationQuerySchema` and overrides `perPage` default:

```typescript
export const listCommissionRatesQuerySchema = z
  .object({
    ruleKind: CommissionRuleKindSchema,
    productScope: ProductScopeSchema.default('all'),
    q: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .optional()
      .openapi({
        description:
          'Case-insensitive substring match across categoryName, parentCategoryName, ' +
          'and brandName.',
        example: 'ayakkabı',
      }),
    sort: SortSchema.default('category_name:asc'),
  })
  .merge(
    TablePaginationQuerySchema.extend({
      perPage: TablePaginationQuerySchema.shape.perPage.default(50).openapi({
        description: 'Items per page. Locked to {10, 25, 50, 100}. Default 50.',
        example: 50,
      }),
    }),
  )
  .openapi('ListCommissionRatesQuery');
```

- [ ] **Step 1.3: Replace the response schema**

Replace the response schema (currently lines 142–147) with `tablePaginated`:

```typescript
// OLD
export const ListCommissionRatesResponseSchema = z
  .object({
    data: z.array(CommissionRateListItemSchema),
    meta: CursorMetaSchema,
  })
  .openapi('ListCommissionRatesResponse');

// NEW
export const ListCommissionRatesResponseSchema = tablePaginated(CommissionRateListItemSchema).openapi(
  'ListCommissionRatesResponse',
);
```

- [ ] **Step 1.4: Re-export `TableMetaSchema` reference if needed**

No code change — just verify `TableMetaSchema` is now reachable inside `tablePaginated` (it is, by construction). The `import` from step 1.1 doesn't strictly need it for usage, but keep it so future hand-written assertions can reference it.

- [ ] **Step 1.5: Run typecheck**

Run from repo root:

```bash
pnpm --filter @pazarsync/api typecheck
```

Expected: FAIL with errors pointing at `commission-rate-list.service.ts` and `list.route.ts` (they still reference the removed `cursor` + `limit` query fields and the `meta` response envelope). This confirms the breakage surface; we fix it in Task 2 + Task 3.

---

## Task 2: Backend — refactor service to offset/page-based slicing

**Files:**
- Modify: `apps/api/src/services/commission-rate-list.service.ts`

- [ ] **Step 2.1: Drop cursor imports**

Remove from the import list at the top (line 3-8):

```typescript
// REMOVE
import {
  CursorSortMismatchError,
  InvalidCursorError,
  decodeCursor,
  encodeCursor,
} from '@pazarsync/utils';
```

- [ ] **Step 2.2: Update the public result type**

Replace `ListCommissionRatesResult` (currently lines 20–24):

```typescript
// OLD
export interface ListCommissionRatesResult {
  data: CommissionRateListItem[];
  nextCursor: string | null;
  hasMore: boolean;
}

// NEW
export interface ListCommissionRatesResult {
  data: CommissionRateListItem[];
  pagination: {
    page: number;
    perPage: number;
    total: number;
    totalPages: number;
  };
}
```

- [ ] **Step 2.3: Delete the cursor decoder**

Delete the entire `decodeAndVerifyCursor` function (currently lines 154–173). It's only called from the public entry point, which we'll rewrite next.

- [ ] **Step 2.4: Rewrite `buildPage`**

Replace the existing `buildPage` (currently lines 215–233) with a page-shaped builder:

```typescript
interface BuildPageArgs {
  rows: CommissionRateRow[];
  counts: ProductCounts;
  page: number;
  perPage: number;
  total: number;
}

function buildPage({ rows, counts, page, perPage, total }: BuildPageArgs): ListCommissionRatesResult {
  const data = rows.map((row) => toWireItem(row, lookupProductCount(row, counts)));
  const totalPages = total === 0 ? 0 : Math.ceil(total / perPage);
  return {
    data,
    pagination: { page, perPage, total, totalPages },
  };
}
```

- [ ] **Step 2.5: Rewrite the in-memory product-count sort path**

Replace `listSortedByProductCount` (currently lines 242–278) with the page-based variant:

```typescript
async function listSortedByProductCount(
  where: Prisma.MarketplaceCommissionRateWhereInput,
  counts: ProductCounts,
  filters: ListCommissionRatesFilters,
): Promise<ListCommissionRatesResult> {
  const allRows = await prisma.marketplaceCommissionRate.findMany({ where });

  const annotated = allRows
    .map((row) => ({ row, count: lookupProductCount(row, counts) }))
    .sort((a, b) => {
      if (a.count !== b.count) return b.count - a.count;
      return a.row.id < b.row.id ? -1 : a.row.id > b.row.id ? 1 : 0;
    });

  const total = annotated.length;
  const skip = (filters.page - 1) * filters.perPage;
  const window = annotated.slice(skip, skip + filters.perPage);

  const data = window.map((entry) => toWireItem(entry.row, entry.count));
  const totalPages = total === 0 ? 0 : Math.ceil(total / filters.perPage);

  return {
    data,
    pagination: { page: filters.page, perPage: filters.perPage, total, totalPages },
  };
}
```

- [ ] **Step 2.6: Rewrite the public entry point**

Replace the `listCommissionRates` function (currently lines 282–327):

```typescript
export async function listCommissionRates(
  organizationId: string,
  storeId: string,
  filters: ListCommissionRatesFilters,
): Promise<ListCommissionRatesResult> {
  const platform = await resolveStorePlatform(organizationId, storeId);

  if (filters.sort === 'product_count:desc' && filters.productScope !== 'active') {
    throw new ValidationError([
      {
        field: 'sort',
        code: 'INVALID_SORT_FOR_SCOPE',
        meta: { requiredProductScope: 'active' },
      },
    ]);
  }

  const counts = await fetchProductCounts(organizationId, storeId);

  const where: Prisma.MarketplaceCommissionRateWhereInput = {
    platform,
    ruleKind: filters.ruleKind,
    ...(filters.q !== undefined ? buildSearchClause(filters.q) : {}),
    ...(filters.productScope === 'active' ? buildActiveScopeClause(filters.ruleKind, counts) : {}),
  };

  if (filters.sort === 'product_count:desc') {
    return listSortedByProductCount(where, counts, filters);
  }

  const skip = (filters.page - 1) * filters.perPage;
  const [rows, total] = await prisma.$transaction([
    prisma.marketplaceCommissionRate.findMany({
      where,
      orderBy: buildOrderBy(filters.sort),
      skip,
      take: filters.perPage,
    }),
    prisma.marketplaceCommissionRate.count({ where }),
  ]);

  return buildPage({ rows, counts, page: filters.page, perPage: filters.perPage, total });
}
```

- [ ] **Step 2.7: Run typecheck**

```bash
pnpm --filter @pazarsync/api typecheck
```

Expected: still FAIL — `list.route.ts` is the only remaining mismatch (handler still spreads the old `nextCursor`/`hasMore` shape). Fix in Task 3.

---

## Task 3: Backend — update the route handler + OpenAPI description

**Files:**
- Modify: `apps/api/src/routes/commission-rates/list.route.ts`

- [ ] **Step 3.1: Update the OpenAPI route description**

Replace the `description` string (currently lines 30–37) with one that no longer mentions cursors:

```typescript
description:
  'Returns the imported commission tariff (categoryId × brandId × payment-term × ' +
  'segment-override) for the given store. Two rule families exist: CATEGORY (kategori-only) ' +
  'and CATEGORY_BRAND (kategori + marka). `ruleKind` is required because the two families ' +
  'have different cardinality and the productCount semantic differs. `productScope=active` ' +
  'restricts to combinations the store actually sells (approved Product with non-archived ' +
  'variant). Offset/page-based pagination — `page` is 1-indexed, `perPage` is locked to ' +
  '{10, 25, 50, 100} with a default of 50. `sort=product_count:desc` requires ' +
  'productScope=active (returns 422 INVALID_SORT_FOR_SCOPE otherwise).',
```

- [ ] **Step 3.2: Update the 422 response description**

Replace the 422 `description` (currently line 63–64):

```typescript
422: {
  content: { 'application/json': { schema: ProblemDetailsSchema } },
  description: 'Invalid query params or sort=product_count:desc without productScope=active',
},
```

- [ ] **Step 3.3: Rewrite the route handler**

Replace the handler body (currently lines 70–100). The service now returns `{ data, pagination }` directly, so the wrapper is trivial:

```typescript
app.openapi(listCommissionRatesRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, storeId } = c.req.valid('param');
  const filters = c.req.valid('query');
  const organizationId = await ensureOrgMember(userId, orgId);

  const result = await commissionRateListService.listCommissionRates(
    organizationId,
    storeId,
    {
      ruleKind: filters.ruleKind,
      productScope: filters.productScope,
      q: filters.q,
      sort: filters.sort,
      page: filters.page,
      perPage: filters.perPage,
    },
  );

  return c.json(result, 200);
});
```

- [ ] **Step 3.4: Run typecheck**

```bash
pnpm --filter @pazarsync/api typecheck
```

Expected: PASS. If errors remain in `commission-rate-list.service.ts` regarding the `filters.cursor`/`filters.limit` field reads, they were missed in Task 2 — go back and remove.

---

## Task 4: Backend — rewrite integration tests

**Files:**
- Modify: `apps/api/tests/integration/routes/commission-rates-list.routes.test.ts`

- [ ] **Step 4.1: Update the wire-shape interfaces and remove the cursor encoder import**

Replace lines 7 and 34–37:

```typescript
// REMOVE line 7
import { encodeCursor } from '@pazarsync/utils';

// REPLACE lines 34-37
interface ListResponseWire {
  data: ListItemWire[];
  pagination: { page: number; perPage: number; total: number; totalPages: number };
}
```

- [ ] **Step 4.2: Update the default-shape happy path test**

Locate the test starting at line 152 (`returns CATEGORY rows with default sort and pagination`). After the existing assertions on `body.data`, replace any `body.meta` reads with `body.pagination`. The new tail of the test should be:

```typescript
expect(body.pagination.page).toBe(1);
expect(body.pagination.perPage).toBe(50);
expect(body.pagination.total).toBeGreaterThanOrEqual(body.data.length);
expect(body.pagination.totalPages).toBeGreaterThanOrEqual(1);
```

Apply the same `meta` → `pagination` substitution to every other test that reads `body.meta.*`. Search for `body.meta` in the file and update each call site.

- [ ] **Step 4.3: Replace the cursor-pagination test with a page-pagination test**

Locate the test starting at line 334 (`paginates with cursor and returns no overlap across pages`). Replace its body with a page-based version (seed enough rows that two pages exist, request page 1 and page 2, assert no id overlap, assert `pagination.page` matches the request):

```typescript
it('paginates with page=N and returns disjoint slices across pages', async () => {
  const { user, accessToken } = await createAuthenticatedTestUser();
  const org = await createOrganization();
  await createMembership(org.id, user.id, 'OWNER');
  const store = await createStore(org.id, { platform: 'TRENDYOL' });

  // Seed 30 CATEGORY rows so perPage=10 produces 3 pages
  for (let i = 0; i < 30; i++) {
    await seedRate({
      ruleKind: 'CATEGORY',
      categoryId: 1000 + i,
      categoryName: `Cat ${String(i).padStart(3, '0')}`,
    });
  }

  const reqPage = (page: number) =>
    app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/commission-rates?ruleKind=CATEGORY&page=${page}&perPage=10`,
      { headers: bearer(accessToken) },
    );

  const r1 = await reqPage(1);
  expect(r1.status).toBe(200);
  const b1 = (await r1.json()) as ListResponseWire;
  expect(b1.data).toHaveLength(10);
  expect(b1.pagination).toEqual({ page: 1, perPage: 10, total: 30, totalPages: 3 });

  const r2 = await reqPage(2);
  const b2 = (await r2.json()) as ListResponseWire;
  expect(b2.data).toHaveLength(10);
  expect(b2.pagination.page).toBe(2);

  const r3 = await reqPage(3);
  const b3 = (await r3.json()) as ListResponseWire;
  expect(b3.data).toHaveLength(10);
  expect(b3.pagination.page).toBe(3);

  const ids = new Set<string>();
  for (const row of [...b1.data, ...b2.data, ...b3.data]) {
    expect(ids.has(row.id)).toBe(false);
    ids.add(row.id);
  }
  expect(ids.size).toBe(30);
});
```

- [ ] **Step 4.4: Delete the cursor-mismatch test**

Locate the test starting at line 374 (`rejects a cursor encoded for a different sort with 422 CURSOR_SORT_MISMATCH`). Delete the entire `it(...)` block — that error code no longer exists.

- [ ] **Step 4.5: Add the perPage validation test**

After the deleted test's location, add:

```typescript
it('rejects perPage outside the locked set (e.g. 200) with 422 VALIDATION_ERROR', async () => {
  const { user, accessToken } = await createAuthenticatedTestUser();
  const org = await createOrganization();
  await createMembership(org.id, user.id, 'OWNER');
  const store = await createStore(org.id, { platform: 'TRENDYOL' });

  const res = await app.request(
    `/v1/organizations/${org.id}/stores/${store.id}/commission-rates?ruleKind=CATEGORY&perPage=200`,
    { headers: bearer(accessToken) },
  );
  expect(res.status).toBe(422);
  const body = (await res.json()) as ProblemDetailsWire;
  expect(body.code).toBe('VALIDATION_ERROR');
});
```

- [ ] **Step 4.6: Update remaining tests that asserted on `meta.limit`**

Find any remaining `meta.limit` reads (the original cursor schema echoed the request limit) — replace with `pagination.perPage` if the test is verifying the echoed page size. If a test was just verifying `hasMore`, change that assertion to a page-comparison (`pagination.page < pagination.totalPages`).

- [ ] **Step 4.7: Run integration tests**

Requires local Supabase. Make sure it's running:

```bash
supabase start
pnpm --filter @pazarsync/db push
pnpm --filter @pazarsync/api test:integration -- commission-rates-list
```

Expected: PASS for all tests including the new page-pagination and perPage-validation cases. Fix any failures inline before moving on.

- [ ] **Step 4.8: Commit backend changes**

```bash
git add apps/api/src/validators/commission-rate.validator.ts \
        apps/api/src/services/commission-rate-list.service.ts \
        apps/api/src/routes/commission-rates/list.route.ts \
        apps/api/tests/integration/routes/commission-rates-list.routes.test.ts
git commit -m "$(cat <<'EOF'
refactor(api): switch commission-rates to page-based pagination

Drops cursor encoding + CURSOR_SORT_MISMATCH/INVALID_CURSOR errors in
favor of reusing the existing TablePaginationQuerySchema + tablePaginated
helpers from openapi/pagination.ts. perPage locked to {10, 25, 50, 100}
with a 50 default for this endpoint.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Regenerate API client + commit

**Files:**
- Auto-modified: `packages/api-client/openapi.json`
- Auto-modified: `packages/api-client/src/generated/api.d.ts` (gitignored — rebuilt from JSON)

- [ ] **Step 5.1: Run the sync script**

```bash
pnpm api:sync
```

Expected: Updates `openapi.json` with the new query/response shape; regenerates `api.d.ts`. No errors.

- [ ] **Step 5.2: Verify the regenerated types changed in the expected way**

Spot-check:

```bash
grep -A 6 '"page":' packages/api-client/openapi.json | head -20
grep -A 2 '"perPage"' packages/api-client/openapi.json | head -10
grep -A 2 'CursorMeta\|nextCursor' packages/api-client/openapi.json | head -10
```

The first two greps should show the new fields. The third should show NO references in the commission-rates path (other paths that still use cursor stay unchanged).

- [ ] **Step 5.3: Commit the regenerated spec snapshot**

```bash
git add packages/api-client/openapi.json
git commit -m "$(cat <<'EOF'
chore(api-client): regenerate spec for commission-rates page pagination

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Frontend — update query-keys + filter parsers

**Files:**
- Modify: `apps/web/src/features/commission-rates/query-keys.ts`
- Modify: `apps/web/src/features/commission-rates/hooks/use-commission-rates-filters.ts`

- [ ] **Step 6.1: Add `page` + `perPage` to the filters interface**

In `query-keys.ts`, extend `CommissionRateListFilters`:

```typescript
export interface CommissionRateListFilters {
  ruleKind: CommissionRateRuleKind;
  productScope: CommissionRateProductScope;
  q?: string;
  sort: CommissionRateSort;
  page: number;
  perPage: number;
}
```

- [ ] **Step 6.2: Add parsers + add the auto-reset wrapper to the filters hook**

Replace the body of `use-commission-rates-filters.ts` entirely (the previous version was a thin pass-through). Note: this hook now needs an explicit `setFilters` wrapper that resets `page` to 1 on any non-pagination change, mirroring the products feature.

```typescript
'use client';

import {
  parseAsInteger,
  parseAsString,
  parseAsStringEnum,
  useQueryStates,
  type Values,
} from 'nuqs';

import type {
  CommissionRateProductScope,
  CommissionRateRuleKind,
  CommissionRateSort,
} from '../query-keys';

export const COMMISSION_RATE_RULE_KINDS: readonly CommissionRateRuleKind[] = [
  'CATEGORY',
  'CATEGORY_BRAND',
];
export const COMMISSION_RATE_PRODUCT_SCOPES: readonly CommissionRateProductScope[] = [
  'all',
  'active',
];
export const COMMISSION_RATE_SORTS: readonly CommissionRateSort[] = [
  'category_name:asc',
  'base_rate:asc',
  'base_rate:desc',
  'product_count:desc',
];
export const COMMISSION_RATES_PER_PAGE_OPTIONS: readonly number[] = [10, 25, 50, 100];
export const COMMISSION_RATES_DEFAULT_PER_PAGE = 50;

export const commissionRatesFiltersParsers = {
  ruleKind: parseAsStringEnum<CommissionRateRuleKind>([
    ...COMMISSION_RATE_RULE_KINDS,
  ]).withDefault('CATEGORY'),
  productScope: parseAsStringEnum<CommissionRateProductScope>([
    ...COMMISSION_RATE_PRODUCT_SCOPES,
  ]).withDefault('all'),
  q: parseAsString.withDefault(''),
  sort: parseAsStringEnum<CommissionRateSort>([...COMMISSION_RATE_SORTS]).withDefault(
    'category_name:asc',
  ),
  page: parseAsInteger.withDefault(1),
  perPage: parseAsInteger.withDefault(COMMISSION_RATES_DEFAULT_PER_PAGE),
};

export type CommissionRatesFilters = Values<typeof commissionRatesFiltersParsers>;
type FiltersUpdater = Partial<CommissionRatesFilters>;

/**
 * URL ↔ filter state binding via nuqs. Any change that's not strictly
 * `page` / `perPage` resets `page` to 1 so the user never lands on an
 * empty page after narrowing the result set.
 */
export function useCommissionRatesFilters(): {
  filters: CommissionRatesFilters;
  setFilters: (next: FiltersUpdater) => Promise<URLSearchParams>;
} {
  const [filters, setRaw] = useQueryStates(commissionRatesFiltersParsers, { history: 'push' });

  const setFilters = async (next: FiltersUpdater): Promise<URLSearchParams> => {
    const touchesNonPaginationFilter =
      'ruleKind' in next ||
      'productScope' in next ||
      'q' in next ||
      'sort' in next ||
      'perPage' in next;
    return setRaw({
      ...next,
      ...(touchesNonPaginationFilter && next.page === undefined ? { page: 1 } : {}),
    });
  };

  return { filters, setFilters };
}
```

- [ ] **Step 6.3: Run typecheck**

```bash
pnpm --filter @pazarsync/web typecheck
```

Expected: FAIL — `use-commission-rates.ts`, `list-commission-rates.api.ts`, `commission-rates-page-client.tsx`, and tests still reference the old args shape. Fix in Tasks 7–11.

---

## Task 7: Frontend — rewrite the API wrapper

**Files:**
- Modify: `apps/web/src/features/commission-rates/api/list-commission-rates.api.ts`

- [ ] **Step 7.1: Replace the args interface and request body**

Replace the file content with:

```typescript
import type { components } from '@pazarsync/api-client';

import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

import type {
  CommissionRateProductScope,
  CommissionRateRuleKind,
  CommissionRateSort,
} from '../query-keys';

export type CommissionRateListItem = components['schemas']['CommissionRateListItem'];
export type ListCommissionRatesResponse = components['schemas']['ListCommissionRatesResponse'];

export interface ListCommissionRatesArgs {
  orgId: string;
  storeId: string;
  ruleKind: CommissionRateRuleKind;
  productScope: CommissionRateProductScope;
  q?: string;
  sort: CommissionRateSort;
  page: number;
  perPage: number;
}

export async function listCommissionRates(
  args: ListCommissionRatesArgs,
): Promise<ListCommissionRatesResponse> {
  const { orgId, storeId, ruleKind, productScope, q, sort, page, perPage } = args;
  const { data, error, response } = await apiClient.GET(
    '/v1/organizations/{orgId}/stores/{storeId}/commission-rates',
    {
      params: {
        path: { orgId, storeId },
        query: {
          ruleKind,
          productScope,
          ...(q !== undefined && q.length > 0 ? { q } : {}),
          sort,
          page,
          perPage,
        },
      },
    },
  );
  if (error !== undefined) throwApiError(error, response);
  return data;
}
```

---

## Task 8: Frontend — `useInfiniteQuery` → `useQuery`

**Files:**
- Modify: `apps/web/src/features/commission-rates/hooks/use-commission-rates.ts`

- [ ] **Step 8.1: Replace the hook entirely**

```typescript
'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import {
  listCommissionRates,
  type ListCommissionRatesArgs,
  type ListCommissionRatesResponse,
} from '../api/list-commission-rates.api';
import {
  commissionRateKeys,
  type CommissionRateListFilters,
} from '../query-keys';

/**
 * useQuery wrapper for the commission-rates list. `page` + `perPage` are
 * part of the queryKey so changing them re-fires the query (TanStack
 * Query keeps each page in its cache slot independently — cheap when the
 * user pages back and forth).
 *
 * Pass `null` to disable (no store / no org context).
 */
export function useCommissionRates(
  args: ListCommissionRatesArgs | null,
): UseQueryResult<ListCommissionRatesResponse> {
  return useQuery<ListCommissionRatesResponse>({
    queryKey:
      args !== null
        ? commissionRateKeys.list(args.orgId, args.storeId, argsToFilters(args))
        : (['commission-rates', 'list', '__disabled__'] as const),
    queryFn: () => {
      if (args === null) throw new Error('useCommissionRates called with null args');
      return listCommissionRates(args);
    },
    enabled: args !== null,
    placeholderData: (previous) => previous,
  });
}

function argsToFilters(args: ListCommissionRatesArgs): CommissionRateListFilters {
  return {
    ruleKind: args.ruleKind,
    productScope: args.productScope,
    q: args.q,
    sort: args.sort,
    page: args.page,
    perPage: args.perPage,
  };
}
```

Note `placeholderData: (previous) => previous` — keeps the previous page's rows visible during the next fetch so the table doesn't blank between page changes (better UX, matches the React Query "keep previous data" idiom).

---

## Task 9: Frontend — add segment-labels lib + unit test (TDD)

**Files:**
- Create: `apps/web/src/features/commission-rates/lib/segment-labels.ts`
- Create: `apps/web/tests/unit/lib/commission-rates-segment-labels.test.ts`

- [ ] **Step 9.1: Write the failing test first**

Create `apps/web/tests/unit/lib/commission-rates-segment-labels.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';

import {
  SEGMENT_LABEL_ORDER,
  SEGMENT_LABELS,
  getSegmentLabel,
  orderedSegmentEntries,
} from '@/features/commission-rates/lib/segment-labels';

describe('SEGMENT_LABELS', () => {
  it('maps the four Trendyol segment keys to their Seviye labels', () => {
    expect(SEGMENT_LABELS).toEqual({
      ka1: 'Seviye 5',
      ka2: 'Seviye 4',
      na1: 'Seviye 3',
      microSegment: 'Özelleşmiş Grup',
    });
  });
});

describe('SEGMENT_LABEL_ORDER', () => {
  it('lists keys in descending Seviye (5 → 3) then Özelleşmiş Grup', () => {
    expect(SEGMENT_LABEL_ORDER).toEqual(['ka1', 'ka2', 'na1', 'microSegment']);
  });
});

describe('getSegmentLabel', () => {
  it('returns the mapped label for known keys', () => {
    expect(getSegmentLabel('ka1')).toBe('Seviye 5');
    expect(getSegmentLabel('microSegment')).toBe('Özelleşmiş Grup');
  });

  it('returns the raw key for unknown segment names', () => {
    expect(getSegmentLabel('unknownTier')).toBe('unknownTier');
  });
});

describe('orderedSegmentEntries', () => {
  it('returns mapped entries in SEGMENT_LABEL_ORDER, skipping absent keys', () => {
    expect(
      orderedSegmentEntries({ ka1: '4.00', na1: '3.50' }),
    ).toEqual([
      { key: 'ka1', label: 'Seviye 5', value: '4.00' },
      { key: 'na1', label: 'Seviye 3', value: '3.50' },
    ]);
  });

  it('appends unknown keys after the known order (preserves input order among unknowns)', () => {
    expect(
      orderedSegmentEntries({ unknownB: '2.00', ka2: '5.00', unknownA: '1.00' }),
    ).toEqual([
      { key: 'ka2', label: 'Seviye 4', value: '5.00' },
      { key: 'unknownB', label: 'unknownB', value: '2.00' },
      { key: 'unknownA', label: 'unknownA', value: '1.00' },
    ]);
  });

  it('returns [] for an empty map', () => {
    expect(orderedSegmentEntries({})).toEqual([]);
  });
});
```

- [ ] **Step 9.2: Run the test to verify it fails**

```bash
pnpm --filter @pazarsync/web test commission-rates-segment-labels
```

Expected: FAIL with "Cannot find module" for the import. Confirms TDD red.

- [ ] **Step 9.3: Create the lib file**

```typescript
// apps/web/src/features/commission-rates/lib/segment-labels.ts

/**
 * Trendyol's seller panel maps internal segment override keys to "Seviye"
 * tier labels. Source of truth: the Trendyol commission tariff page in
 * the seller panel (Seviye 3 / 4 / 5 KDV Dahil Komisyon Oranı + Özelleşmiş
 * Grup KDV Dahil Komisyon Oranı). The base rate ("KDV Dahil Komisyon
 * Oranı" without a Seviye prefix) is rendered separately as the row's
 * baseRate column — not part of segmentOverrides.
 *
 * No `ka3` — Trendyol's panel only exposes Seviye 3/4/5 plus Özelleşmiş
 * Grup. If Trendyol ever adds more tiers, extend this map.
 */
export const SEGMENT_LABELS: Record<string, string> = {
  ka1: 'Seviye 5',
  ka2: 'Seviye 4',
  na1: 'Seviye 3',
  microSegment: 'Özelleşmiş Grup',
};

/**
 * Stable display order: highest tier first, special group last. The
 * tooltip walks this array and renders only the keys present in the
 * row's segmentOverrides map.
 */
export const SEGMENT_LABEL_ORDER = ['ka1', 'ka2', 'na1', 'microSegment'] as const;

export function getSegmentLabel(key: string): string {
  return SEGMENT_LABELS[key] ?? key;
}

export interface OrderedSegmentEntry {
  key: string;
  label: string;
  value: string;
}

/**
 * Project a segmentOverrides map into ordered display entries. Known keys
 * (per SEGMENT_LABEL_ORDER) come first in tier order; unknown keys append
 * afterwards in their input order so future Trendyol additions are still
 * visible even before the lib is updated.
 */
export function orderedSegmentEntries(
  overrides: Record<string, string>,
): OrderedSegmentEntry[] {
  const result: OrderedSegmentEntry[] = [];
  const seen = new Set<string>();

  for (const key of SEGMENT_LABEL_ORDER) {
    const value = overrides[key];
    if (value !== undefined) {
      result.push({ key, label: SEGMENT_LABELS[key] ?? key, value });
      seen.add(key);
    }
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (!seen.has(key)) {
      result.push({ key, label: getSegmentLabel(key), value });
    }
  }
  return result;
}
```

- [ ] **Step 9.4: Run the test to verify it passes**

```bash
pnpm --filter @pazarsync/web test commission-rates-segment-labels
```

Expected: PASS, 6 cases.

---

## Task 10: Frontend — wire DataTablePagination + use segment-labels in the table

**Files:**
- Modify: `apps/web/src/features/commission-rates/components/commission-rates-table.tsx`

- [ ] **Step 10.1: Update imports**

Add the new imports at the top of the file:

```typescript
import type { ColumnDef, PaginationState, SortingState } from '@tanstack/react-table';
import { DataTablePagination } from '@/components/patterns/data-table-pagination';
import { orderedSegmentEntries } from '../lib/segment-labels';
```

(`PaginationState` joins the existing TanStack import; `DataTablePagination` is new; the lib import is new.)

- [ ] **Step 10.2: Extend the props interface**

The component currently receives `pagination` as a `ReactNode` slot. Replace that prop with the controlled pagination state DataTable needs:

```typescript
interface CommissionRatesTableProps {
  rows: CommissionRateListItem[];
  ruleKind: CommissionRateRuleKind;
  productScope: CommissionRateProductScope;
  sort: CommissionRateSort;
  loading: boolean;
  empty?: React.ReactNode;
  toolbar?: React.ReactNode;
  // Pagination state — controlled by the page client via nuqs
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
  onPaginationChange: (next: { page: number; perPage: number }) => void;
  onSortChange: (next: {
    sort: CommissionRateSort;
    productScope: CommissionRateProductScope;
    autoSwitchedScope: boolean;
  }) => void;
}
```

- [ ] **Step 10.3: Refactor the baseRate cell to use `orderedSegmentEntries`**

Inside the `baseRateColumn` cell renderer (currently iterates `Object.keys(overrides).map(...)`), replace the override map iteration with the lib helper:

```typescript
cell: ({ row }) => {
  const overrides = row.original.segmentOverrides;
  const entries = orderedSegmentEntries(overrides);
  const value = formatter.number(Number.parseFloat(row.original.baseRate) / 100, 'percent');
  if (entries.length === 0) {
    return <span className="text-foreground text-sm tabular-nums">{value}</span>;
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="text-foreground gap-3xs inline-flex items-center text-sm tabular-nums"
          data-row-action
          tabIndex={0}
          role="button"
        >
          {value}
          <InformationCircleIcon className="size-icon-xs text-muted-foreground" />
        </span>
      </TooltipTrigger>
      <TooltipContent align="end" className="max-w-input-narrow">
        <div className="gap-3xs flex flex-col">
          <span className="text-2xs text-muted-foreground">
            {t('tooltip.segmentOverridesTitle')}
          </span>
          <ul className="gap-3xs flex flex-col">
            {entries.map((entry) => (
              <li
                key={entry.key}
                className="gap-sm text-2xs flex items-center justify-between tabular-nums"
              >
                <span className="text-muted-foreground">{entry.label}</span>
                <span className="text-foreground">
                  {formatter.number(Number.parseFloat(entry.value) / 100, 'percent')}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </TooltipContent>
    </Tooltip>
  );
},
```

Notable changes from the existing implementation:
- The `entries.length === 0` short-circuit guarantees the ⓘ icon never renders when the override map is empty (fixes the screenshot bug where every row showed the icon).
- The label is now `entry.label` (e.g. "Seviye 5") instead of `key.toUpperCase()`.
- Iteration is over `orderedSegmentEntries(overrides)` for stable ordering.

- [ ] **Step 10.4: Replace the pagination slot with DataTablePagination wiring**

At the bottom of the component (the `<DataTable>` JSX render), replace the `pagination` prop with controlled pagination state. Inside the function body, derive the TanStack-shaped state:

```typescript
const paginationState: PaginationState = React.useMemo(
  () => ({ pageIndex: page - 1, pageSize: perPage }),
  [page, perPage],
);

const handlePaginationChange = React.useCallback(
  (updater: PaginationState | ((prev: PaginationState) => PaginationState)) => {
    const next = typeof updater === 'function' ? updater(paginationState) : updater;
    onPaginationChange({ page: next.pageIndex + 1, perPage: next.pageSize });
  },
  [onPaginationChange, paginationState],
);
```

Then in the `<DataTable>` JSX:

```tsx
<DataTable<CommissionRateListItem, unknown>
  columns={columns}
  data={rows}
  loading={loading}
  empty={empty}
  toolbar={toolbar !== undefined ? () => toolbar : undefined}
  pagination={(table) => <DataTablePagination table={table} pageSizes={[10, 25, 50, 100]} />}
  sorting={sortingState}
  onSortingChange={handleSortingChange}
  paginationState={paginationState}
  onPaginationChange={handlePaginationChange}
  pageCount={totalPages}
  rowCount={total}
  getRowId={(row) => row.id}
/>
```

(The `toolbar` slot remains a ReactNode; DataTable wraps it via the existing `() => toolbar` adapter. The pagination slot now receives the TanStack `table` instance and renders `<DataTablePagination>` directly.)

- [ ] **Step 10.5: Run typecheck**

```bash
pnpm --filter @pazarsync/web typecheck
```

Expected: FAIL — `commission-rates-page-client.tsx` still passes the old props (no `page`/`perPage`/etc.) and still imports the about-to-be-deleted load-more component. Fix in Task 11.

---

## Task 11: Frontend — page client (variant="underline", drop load-more, wire pagination)

**Files:**
- Modify: `apps/web/src/features/commission-rates/components/commission-rates-page-client.tsx`

- [ ] **Step 11.1: Drop the load-more import**

Remove the import line:

```typescript
// REMOVE
import { CommissionRatesLoadMore } from './commission-rates-load-more';
```

- [ ] **Step 11.2: Replace the data extraction block**

Find the block right after `useCommissionRates(...)` that pulls rows from infinite pages. Replace it with the single-page version:

```typescript
const result = query.data;
const rows = result?.data ?? [];
const total = result?.pagination.total ?? 0;
const totalPages = result?.pagination.totalPages ?? 0;
const totalLoaded = rows.length;
const isInitialLoad = query.isLoading;
```

Delete the lines that referenced `query.data?.pages.flatMap(...)`, `query.hasNextPage`, `query.isFetchingNextPage`, `query.fetchNextPage`.

- [ ] **Step 11.3: Pass `page` + `perPage` to the hook**

In the `useCommissionRates` call, add the two new fields to the args object:

```typescript
const query = useCommissionRates(
  noStoreSelected
    ? null
    : {
        orgId,
        storeId,
        ruleKind: filters.ruleKind,
        productScope: filters.productScope,
        q: filters.q.length > 0 ? filters.q : undefined,
        sort: filters.sort,
        page: filters.page,
        perPage: filters.perPage,
      },
);
```

- [ ] **Step 11.4: Switch the tab strip to underline variant**

Find the `<FilterTabs ...>` JSX. Add `variant="underline"`:

```tsx
<FilterTabs<CommissionRateRuleKind>
  value={filters.ruleKind}
  onValueChange={handleRuleKindChange}
  variant="underline"
  options={[
    { value: 'CATEGORY', label: t('tabs.category') },
    { value: 'CATEGORY_BRAND', label: t('tabs.categoryBrand') },
  ]}
/>
```

- [ ] **Step 11.5: Wire the table's pagination props**

Replace the `<CommissionRatesTable ...>` JSX. Remove the `pagination` prop that received `<CommissionRatesLoadMore>`. Add the new controlled-pagination props:

```tsx
<CommissionRatesTable
  rows={rows}
  ruleKind={filters.ruleKind}
  productScope={filters.productScope}
  sort={filters.sort}
  loading={isInitialLoad}
  empty={emptyNode}
  toolbar={
    <CommissionRatesToolbar
      q={qInput}
      onSearchChange={setQInput}
      productScope={filters.productScope}
      onProductScopeChange={handleProductScopeChange}
    />
  }
  page={filters.page}
  perPage={filters.perPage}
  total={total}
  totalPages={totalPages}
  onPaginationChange={(next) =>
    void setFilters({ page: next.page, perPage: next.perPage })
  }
  onSortChange={handleSortChange}
/>
```

- [ ] **Step 11.6: Verify the empty-state computation still works**

The existing `isEmptyAfterLoad` derivation reads `totalLoaded === 0`. Since we kept `totalLoaded` (now derived from the single-page `data.length`), it still works. No code change here; just verify the lines below in the file:

```typescript
const isEmptyAfterLoad = !isInitialLoad && totalLoaded === 0;
```

- [ ] **Step 11.7: Run typecheck**

```bash
pnpm --filter @pazarsync/web typecheck
```

Expected: PASS. If errors remain about `CommissionRatesLoadMore`, the import wasn't removed; if errors remain about `query.hasNextPage`, the data extraction block wasn't fully replaced.

---

## Task 12: Delete the load-more component + its test

**Files:**
- Delete: `apps/web/src/features/commission-rates/components/commission-rates-load-more.tsx`
- Delete: `apps/web/tests/component/features/commission-rates/commission-rates-load-more.test.tsx`
- Modify: `apps/web/messages/tr.json` + `apps/web/messages/en.json` (drop now-unused keys)

- [ ] **Step 12.1: Delete the component file**

```bash
rm apps/web/src/features/commission-rates/components/commission-rates-load-more.tsx
```

- [ ] **Step 12.2: Delete its test**

```bash
rm apps/web/tests/component/features/commission-rates/commission-rates-load-more.test.tsx
```

- [ ] **Step 12.3: Remove the unused i18n keys**

In `apps/web/messages/tr.json`, find the `loadMore` block under `features.commissionRates.*` and delete it:

```json
"loadMore": {
  "button": "Daha fazla yükle",
  "loading": "Yükleniyor…",
  "exhausted": "Tüm sonuçlar gösteriliyor — {count} satır"
},
```

Do the same in `apps/web/messages/en.json`.

- [ ] **Step 12.4: Run typecheck + tests**

```bash
pnpm --filter @pazarsync/web typecheck
pnpm --filter @pazarsync/web test commission-rates
```

Expected: typecheck PASS, tests fail for `use-commission-rates.test.tsx` (still asserts cursor behavior). Fix in Task 13.

---

## Task 13: Rewrite the hook test for page-based pagination

**Files:**
- Modify: `apps/web/tests/unit/hooks/use-commission-rates.test.tsx`

- [ ] **Step 13.1: Replace the test body**

Replace the entire file content with the page-based version:

```typescript
import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { useCommissionRates } from '@/features/commission-rates/hooks/use-commission-rates';
import { ApiError } from '@/lib/api-error';

import { createTestQueryClient } from '../../helpers/render';
import { HttpResponse, http, server } from '../../helpers/msw';

const ORG_ID = '00000000-0000-0000-0000-000000000099';
const STORE_ID = '00000000-0000-0000-0000-000000000088';
const ENDPOINT = `http://localhost:3001/v1/organizations/${ORG_ID}/stores/${STORE_ID}/commission-rates`;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>;
}

const baseArgs = {
  orgId: ORG_ID,
  storeId: STORE_ID,
  ruleKind: 'CATEGORY' as const,
  productScope: 'all' as const,
  sort: 'category_name:asc' as const,
  page: 1,
  perPage: 50,
};

function row(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'r-1',
    ruleKind: 'CATEGORY',
    platform: 'TRENDYOL',
    categoryId: '411',
    brandId: null,
    categoryName: 'Casual Ayakkabı',
    parentCategoryName: 'Günlük Ayakkabı',
    brandName: null,
    baseRate: '5.00',
    paymentTermDays: 14,
    segmentOverrides: {},
    productCount: 0,
    fetchedAt: '2026-05-12T08:23:01.000Z',
    ...overrides,
  };
}

function fixtureResponse(
  rows: ReturnType<typeof row>[],
  pagination: Partial<{ page: number; perPage: number; total: number; totalPages: number }> = {},
) {
  return {
    data: rows,
    pagination: { page: 1, perPage: 50, total: rows.length, totalPages: 1, ...pagination },
  };
}

describe('useCommissionRates', () => {
  it('fetches page 1 by default with the page + perPage query params', async () => {
    let capturedUrl = '';
    server.use(
      http.get(ENDPOINT, ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json(fixtureResponse([row()]), { status: 200 });
      }),
    );

    const { result } = renderHook(() => useCommissionRates(baseArgs), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.data).toHaveLength(1);
    expect(result.current.data?.pagination.page).toBe(1);
    expect(capturedUrl).toContain('ruleKind=CATEGORY');
    expect(capturedUrl).toContain('productScope=all');
    expect(capturedUrl).toContain('sort=category_name%3Aasc');
    expect(capturedUrl).toContain('page=1');
    expect(capturedUrl).toContain('perPage=50');
    expect(capturedUrl).not.toContain('cursor=');
  });

  it('does not fire when args is null (enabled=false)', () => {
    const { result } = renderHook(() => useCommissionRates(null), { wrapper });
    expect(result.current.isFetching).toBe(false);
    expect(result.current.status).toBe('pending');
  });

  it('forwards page=2 to the request when the caller increments page', async () => {
    let capturedUrl = '';
    server.use(
      http.get(ENDPOINT, ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json(
          fixtureResponse([row({ id: 'r-2' })], { page: 2, total: 60, totalPages: 2 }),
          { status: 200 },
        );
      }),
    );

    const { result } = renderHook(() => useCommissionRates({ ...baseArgs, page: 2 }), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(capturedUrl).toContain('page=2');
    expect(result.current.data?.pagination.page).toBe(2);
    expect(result.current.data?.pagination.totalPages).toBe(2);
  });

  it('surfaces an ApiError on 422 INVALID_SORT_FOR_SCOPE', async () => {
    server.use(
      http.get(ENDPOINT, () =>
        HttpResponse.json(
          {
            type: 'https://api.pazarsync.com/errors/invalid-sort-for-scope',
            title: 'Invalid sort for scope',
            status: 422,
            code: 'INVALID_SORT_FOR_SCOPE',
            detail: 'product_count:desc requires productScope=active',
          },
          { status: 422 },
        ),
      ),
    );

    const { result } = renderHook(
      () => useCommissionRates({ ...baseArgs, sort: 'product_count:desc' }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiError);
    expect((result.current.error as ApiError).code).toBe('INVALID_SORT_FOR_SCOPE');
  });
});
```

- [ ] **Step 13.2: Run the test**

```bash
pnpm --filter @pazarsync/web test use-commission-rates
```

Expected: PASS, 4 cases.

---

## Task 14: Add the table component test (segment label rendering)

**Files:**
- Create: `apps/web/tests/component/features/commission-rates/commission-rates-table.test.tsx`

- [ ] **Step 14.1: Write the test**

```typescript
import { describe, expect, it, vi } from 'vitest';

import { CommissionRatesTable } from '@/features/commission-rates/components/commission-rates-table';
import type { CommissionRateListItem } from '@/features/commission-rates/api/list-commission-rates.api';

import { render, screen } from '../../../helpers/render';

function makeRow(overrides: Partial<CommissionRateListItem> = {}): CommissionRateListItem {
  return {
    id: 'r-1',
    ruleKind: 'CATEGORY',
    platform: 'TRENDYOL',
    categoryId: '411',
    brandId: null,
    categoryName: 'Casual Ayakkabı',
    parentCategoryName: 'Günlük Ayakkabı',
    brandName: null,
    baseRate: '5.00',
    paymentTermDays: 14,
    segmentOverrides: {},
    productCount: 0,
    fetchedAt: '2026-05-12T08:23:01.000Z',
    ...overrides,
  };
}

const baseProps = {
  ruleKind: 'CATEGORY' as const,
  productScope: 'all' as const,
  sort: 'category_name:asc' as const,
  loading: false,
  page: 1,
  perPage: 50,
  total: 1,
  totalPages: 1,
  onPaginationChange: vi.fn(),
  onSortChange: vi.fn(),
};

describe('CommissionRatesTable — segment tooltip', () => {
  it('renders the baseRate without an info icon when segmentOverrides is empty', () => {
    render(<CommissionRatesTable {...baseProps} rows={[makeRow({ segmentOverrides: {} })]} />);
    expect(screen.queryByRole('button', { name: /Segment override/ })).not.toBeInTheDocument();
    // The info icon is rendered inside a button-role span when overrides exist —
    // its absence is the assertion. The percent value still renders.
    expect(screen.getByText('%5,0')).toBeInTheDocument();
  });

  it('renders the info trigger when at least one override is present', () => {
    render(
      <CommissionRatesTable
        {...baseProps}
        rows={[makeRow({ segmentOverrides: { ka1: '4.00' } })]}
      />,
    );
    // The button-role span wraps the percent value + info icon together.
    const trigger = screen.getAllByRole('button').find((el) => el.textContent?.includes('%5,0'));
    expect(trigger).toBeDefined();
  });
});

describe('CommissionRatesTable — column shape by ruleKind', () => {
  it('shows the Üst Kategori column for CATEGORY', () => {
    render(
      <CommissionRatesTable
        {...baseProps}
        rows={[makeRow({ parentCategoryName: 'Günlük Ayakkabı' })]}
      />,
    );
    expect(screen.getByText('Üst Kategori')).toBeInTheDocument();
    expect(screen.queryByText('Marka')).not.toBeInTheDocument();
  });

  it('shows the Marka column for CATEGORY_BRAND', () => {
    render(
      <CommissionRatesTable
        {...baseProps}
        ruleKind="CATEGORY_BRAND"
        rows={[
          makeRow({
            ruleKind: 'CATEGORY_BRAND',
            parentCategoryName: null,
            brandName: 'Reebok',
            brandId: '16',
          }),
        ]}
      />,
    );
    expect(screen.getByText('Marka')).toBeInTheDocument();
    expect(screen.queryByText('Üst Kategori')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 14.2: Run the test**

```bash
pnpm --filter @pazarsync/web test commission-rates-table
```

Expected: PASS, 4 cases.

---

## Task 15: Full verification pass + commit

**Files:** none (verification only)

- [ ] **Step 15.1: Typecheck the whole web package**

```bash
pnpm --filter @pazarsync/web typecheck
```

Expected: PASS.

- [ ] **Step 15.2: Lint the changed files**

```bash
cd apps/web
npx eslint src/features/commission-rates 'src/app/[locale]/(dashboard)/tools/commission-rates' tests/unit/lib/commission-rates-segment-labels.test.ts tests/unit/hooks/use-commission-rates.test.tsx tests/component/features/commission-rates
cd ../..
```

Expected: exit 0, no warnings related to the changed files.

- [ ] **Step 15.3: Run all commission-rates tests**

```bash
pnpm --filter @pazarsync/web test commission-rates
```

Expected: PASS for every test file (sort-options, segment-labels, hook, toolbar, empty-state, table). Total ~25–30 cases.

- [ ] **Step 15.4: Confirm the rest of the web test suite still passes (modulo pre-existing failures)**

```bash
pnpm --filter @pazarsync/web test
```

Expected: same 11 pre-existing failures as before (cost-cell, cost-profile, parent-row-cost-cell). NO new failures.

- [ ] **Step 15.5: Manual dev-server smoke test**

A dev server is already running on `localhost:3000` (the user's). Verify:

```bash
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" --max-redirs 0 \
  "http://localhost:3000/tools/commission-rates"
```

Expected: 200 (if authenticated) or 307 to `/login?redirect=%2Ftools%2Fcommission-rates` (if not).

Then walk the manual smoke list from the spec:
1. Tabs: inactive tab now reads as muted text under the line.
2. Pagination: footer shows "1-50 / 4.346 satır · Sayfa başına [50▾] · « ‹ 1 / 87 › »"; clicking next loads page 2.
3. Sort by Ürün # in 'Tüm tarife' → toast + scope flip + sort applied; page resets to 1.
4. Hover a row with overrides → tooltip lists entries in Seviye 5 → 4 → 3 → Özelleşmiş Grup order.
5. Rows without overrides have no ⓘ icon.
6. Network requests carry `page=N&perPage=50` — no `cursor` ever.

- [ ] **Step 15.6: Commit frontend changes**

```bash
git add apps/web/src/features/commission-rates \
        apps/web/messages/tr.json apps/web/messages/en.json \
        apps/web/tests/unit/lib/commission-rates-segment-labels.test.ts \
        apps/web/tests/unit/hooks/use-commission-rates.test.tsx \
        apps/web/tests/component/features/commission-rates
git rm apps/web/src/features/commission-rates/components/commission-rates-load-more.tsx \
       apps/web/tests/component/features/commission-rates/commission-rates-load-more.test.tsx \
       2>/dev/null || true
git commit -m "$(cat <<'EOF'
feat(commission-rates): page pagination + underline tabs + Seviye labels

Frontend follow-up to the backend page-pagination refactor:
- Tab strip uses FilterTabs variant="underline" — inactive tabs read as
  muted text with a hover underline, no longer "floating in space".
- DataTablePagination footer replaces the broken "Daha fazla yükle" button.
  perPage selector locked to {10, 25, 50, 100} (default 50). Filter changes
  auto-reset page to 1.
- Segment override tooltip uses the labels Trendyol's seller panel ships:
  Seviye 5 (ka1) / Seviye 4 (ka2) / Seviye 3 (na1) / Özelleşmiş Grup
  (microSegment). The info icon now only renders on rows that actually
  have overrides — fixes the screenshot bug where it appeared on every row.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

After writing the plan, verified against the spec:

**Spec coverage:**
- Issue #1 (tab variant) → Task 11 step 11.4 (`variant="underline"`). ✓
- Issue #2 (pagination refactor) → Tasks 1–5 (backend + api-client regen), Tasks 6–11 (frontend), Tasks 12–13 (cleanup + test rewrite). ✓
- Issue #3 (segment labels) → Task 9 (lib + TDD test) + Task 10 step 10.3 (table tooltip uses ordered entries). ✓
- ⓘ icon bug fix (only render when overrides exist) → Task 10 step 10.3 (`entries.length === 0` short-circuit) + Task 14 first test case. ✓

**Placeholder scan:** No "TBD", "TODO", or "similar to" references in any step. Every code change has the literal code; every command has expected output.

**Type consistency:**
- `ListCommissionRatesResult.pagination` shape defined in Task 2 step 2.2, used in Task 2 step 2.6 + Task 3 step 3.3 + Task 4 step 4.1 (wire interface) + Task 11 step 11.2 (frontend read). All four sites use `{ page, perPage, total, totalPages }`. ✓
- `CommissionRateListFilters` carries `page` + `perPage` from Task 6 step 6.1; consumed by Task 8 (hook) and Task 7 (API wrapper); UI args in Task 11 step 11.3. ✓
- `orderedSegmentEntries` defined in Task 9 step 9.3; consumed in Task 10 step 10.3. Same return shape (`{ key, label, value }[]`). ✓
- `onPaginationChange` callback signature `(next: { page: number; perPage: number }) => void` in Task 10 step 10.2 + Task 11 step 11.5. ✓

No issues found.
