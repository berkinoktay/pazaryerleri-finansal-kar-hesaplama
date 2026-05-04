# Products Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the Products page from its hand-rolled TanStack table to the shared `DataTable`, render product variants as sibling rows in the parent grid, add an override-state tab strip (Tümü · Maliyetsiz · KDV'siz), and migrate the filter bar to the canonical `DataTableToolbar`.

**Architecture:** 5 small additive PRs in dependency order. **PR 0** denormalizes `Product.totalStock` so price/stock sorting is server-side. **PR 1** and **PR 2** extend the shared `DataTable` / `DataTableToolbar` patterns with new opt-in modes — both are additive and won't break existing callers. **PR 3** extends the products list/facets API with the `overrideMissing` filter and tab counts. **PR 4** ties everything together by rewriting the products feature.

**Tech Stack:** Prisma 7 (`prisma-client` generator + `@prisma/adapter-pg`) on Supabase Postgres 15 · Hono 4 + `@hono/zod-openapi` 1 · Zod 4 · React 19 + Next.js 16 (App Router) + TanStack Table v8 + nuqs · shadcn-ui + Tailwind v4 (token-first) + Hugeicons · Vitest 4 + RTL + MSW v2 + happy-dom

**Spec:** `docs/superpowers/specs/2026-05-04-products-page-redesign-design.md` — read this first.

---

## Pre-flight (read before starting)

The plan assumes you've read these files once and understand the project conventions. They're not repeated per-task.

| Document                  | Why                                                                                                                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `CLAUDE.md` (root)        | TypeScript discipline, no magic values, no `any`, exhaustive switch with `never` guard, kebab-case files, no utility duplication                                                                       |
| `apps/api/CLAUDE.md`      | Domain error vocabulary (`UnauthorizedError`, `NotFoundError`, …), `mapPrismaError`, RFC 7807, `pnpm api:sync` after Zod changes, OpenAPI per-route requirements                                       |
| `apps/web/CLAUDE.md`      | UI cascade (patterns → ui → shadcn registry → custom), Tailwind v4 token namespaces, `max-w-*` collision rule, dark-mode discipline (no alpha shortcuts), SSR-safety toolkit, React Query factory keys |
| `docs/SECURITY.md`        | Multi-tenancy invariants — every query MUST filter by `organization_id`, every store-scoped query MUST verify the store belongs to the org                                                             |
| `docs/TESTING.md`         | Hybrid test strategy — TDD for pure logic, test-with-code for routes, MSW v2 + happy-dom for the frontend, integration tests need `supabase start && pnpm db:push`                                     |
| Spec §3 (Decisions Recap) | The 12 brainstorming decisions that shaped every choice in this plan                                                                                                                                   |
| Spec §8 (PR Cuts)         | The 5-PR sequence and dependency order                                                                                                                                                                 |

**Branching convention:** `feat/<surface>-<short-name>` for code PRs, `docs/<short-name>` for docs PRs. Never push to main; always open a PR.

**TDD rhythm for every task that produces code:** write failing test → run it → see it fail with the expected error → write minimal implementation → run it → see it pass → commit. Don't batch tests.

**Commit cadence:** every task ends with a commit. Don't bundle multiple tasks into one commit. Reviewers read commits one at a time.

**Test commands:**

- `pnpm --filter <pkg> test:unit` — fast, no DB
- `pnpm --filter <pkg> test:integration` — needs `supabase start && pnpm db:push`
- `pnpm typecheck` (root) — type-checks every package
- `pnpm check:all` — typecheck + lint + unit tests + format check (pre-commit gate)
- `pnpm check:full` — same plus integration tests (pre-PR gate, needs Supabase local)

---

## PR 0 — Denormalize `Product.totalStock`

**Branch:** `feat/db-product-total-stock`

**Why this PR:** PR 3 needs to sort the products list by `totalStock`. Prisma can't sort by a SUM-of-children without raw SQL, and a raw query loses type safety. A denormalized `total_stock` integer column updated by the sync worker is the cleanest path. Indexed for sort.

**LOC budget:** ~80 lines (migration + schema + sync-worker write + 1 backfill SQL + 1 integration test).

### Task 0.1: Prisma schema + migration for `total_stock`

**Files:**

- Modify: `packages/db/prisma/schema.prisma` (Product model, ~line 200-211)
- Create: `packages/db/prisma/migrations/<timestamp>_add_product_total_stock/migration.sql`

- [ ] **Step 1: Add the column to the Prisma schema**

Open `packages/db/prisma/schema.prisma`, locate the `Product` model. Find the indexes block at the end (around line 210):

```prisma
  @@index([storeId, categoryId])
  @@map("products")
}
```

Add a new field above `@@index([storeId, brandId])` (place it logically near the other quantity-related fields, but at minimum before the indexes block) and a new index. Final shape of the affected portion:

```prisma
  // Denormalized SUM(variants[*].quantity) for the store. Updated
  // transactionally inside upsertBatch in the sync worker — see
  // apps/sync-worker/src/handlers/products.ts. Indexed for the
  // products-list sort=totalStock workflow (pricing + restock review).
  totalStock           Int      @default(0) @map("total_stock")

  // … existing relations + indexes …

  @@index([storeId, totalStock])
  @@index([storeId, categoryId])
  @@map("products")
}
```

- [ ] **Step 2: Generate the migration**

Make sure local Supabase is running (`supabase start`). Then:

Run: `pnpm --filter @pazarsync/db migrate:dev --name add_product_total_stock`

Expected: Prisma writes `packages/db/prisma/migrations/<timestamp>_add_product_total_stock/migration.sql`, applies it to local Postgres, and regenerates the client. The SQL should look approximately:

```sql
ALTER TABLE "products" ADD COLUMN "total_stock" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX "products_store_id_total_stock_idx" ON "products"("store_id", "total_stock");
```

- [ ] **Step 3: Add a backfill statement to the migration**

Open the generated `migration.sql` and append a backfill UPDATE so existing rows pick up the correct sum (the column defaults to 0, but existing products have variants with non-zero quantity):

```sql
-- Backfill total_stock for existing products from their current variants.
-- One-shot: subsequent updates flow through the sync worker.
UPDATE "products" p
SET "total_stock" = COALESCE((
  SELECT SUM(v."quantity")
  FROM "product_variants" v
  WHERE v."product_id" = p."id"
), 0);
```

- [ ] **Step 4: Re-apply the migration to verify the backfill**

Run: `pnpm --filter @pazarsync/db migrate:dev`

Expected: "Already in sync, no schema change or pending migration was found." (Prisma sees the migration is already applied.) If you need to re-run the backfill explicitly, drop the local DB and reapply: `supabase stop && supabase start && pnpm --filter @pazarsync/db push`.

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`

Expected: clean. The `Product.totalStock: number` field is now part of the Prisma type and any code reading `product` rows automatically sees it.

- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/
git commit -m "$(cat <<'EOF'
feat(db): denormalize Product.totalStock for sortable product lists

Adds total_stock column to products with a default of 0, an index on
(store_id, total_stock), and a one-shot backfill from product_variants.
Subsequent updates flow through the sync worker (next commit). Enables
server-side sort=totalStock on the products list endpoint without
falling back to raw SQL or losing Prisma type safety.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 0.2: Update sync worker to maintain `totalStock` on upsert

**Files:**

- Modify: `apps/sync-worker/src/handlers/products.ts` — inside the `upsertBatch` transaction (around line 247-300)

- [ ] **Step 1: Write the failing test**

Open `apps/sync-worker/tests/integration/products-handler.test.ts` and add a new `it` block at the end of the existing top-level `describe`. The test seeds nothing, runs one chunk against a mock fixture with two variants of known quantity, and asserts the upserted Product has `totalStock` equal to their sum.

There's already a test pattern in the file for asserting upsert outcomes — copy the setup. The fixture builder is `makeMappedProduct` (or equivalent — read the file to confirm the exact name). Add:

```typescript
it('upserts Product with totalStock equal to sum of variant quantities', async () => {
  const { storeId } = await seedStore();
  const fixture = makeMappedProduct({
    platformContentId: BigInt(900_001),
    productMainId: 'TS-TOTALSTOCK-1',
    variants: [
      makeMappedVariant({ platformVariantId: BigInt(900_101), quantity: 7 }),
      makeMappedVariant({ platformVariantId: BigInt(900_102), quantity: 13 }),
    ],
  });
  await runOneChunkWithBatch({ storeId, batch: [fixture] });

  const product = await prisma.product.findFirstOrThrow({
    where: { storeId, platformContentId: BigInt(900_001) },
  });
  expect(product.totalStock).toBe(20);
});
```

If the helpers don't exist by these exact names, replace them with whatever the existing tests in the file already use (read the imports + first 100 lines to learn).

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @pazarsync/sync-worker test:integration -t "totalStock equal to sum"`

Expected: FAIL with `Expected: 20, Received: 0` (the column defaults to 0 and the upsert isn't writing it yet).

- [ ] **Step 3: Update `upsertBatch` to compute and write `totalStock`**

In `apps/sync-worker/src/handlers/products.ts`, inside `upsertBatch`, after the `for (const variant of mapped.variants)` loop and before the `tx.productImage.deleteMany(...)` call, compute the sum and write it back to the product. This sits inside the same `tx.$transaction` so it's atomic with the variant upserts:

```typescript
// Recompute totalStock from the variants we just upserted. We do this
// inside the same transaction (rather than using a SQL trigger) so the
// sync worker remains the single source of truth for product mutations
// and the value is immediately consistent for the products-list sort.
const totalStock = mapped.variants.reduce((sum, v) => sum + v.quantity, 0);
await tx.product.update({
  where: { id: product.id },
  data: { totalStock },
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @pazarsync/sync-worker test:integration -t "totalStock equal to sum"`

Expected: PASS.

- [ ] **Step 5: Run the full sync-worker integration test suite**

Run: `pnpm --filter @pazarsync/sync-worker test:integration`

Expected: All existing tests still pass (the `totalStock` write is additive — no other test depends on it being absent).

- [ ] **Step 6: Commit**

```bash
git add apps/sync-worker/src/handlers/products.ts apps/sync-worker/tests/integration/products-handler.test.ts
git commit -m "$(cat <<'EOF'
feat(sync-worker): maintain Product.totalStock from variant quantities

Recomputes totalStock from mapped.variants inside the same transaction
that upserts the variants. Keeps the sync worker as the single source of
truth for product mutations and avoids a SQL trigger that would split
the write path.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 0.3: Open PR 0

- [ ] **Step 1: Push the branch**

Run: `git push -u origin feat/db-product-total-stock`

- [ ] **Step 2: Open the PR**

Run:

```bash
gh pr create --title "feat(db): denormalize Product.totalStock for sortable product lists" --body "$(cat <<'EOF'
## Summary
- Adds `total_stock` column to `products` with index on `(store_id, total_stock)`, defaulted to 0 with a one-shot backfill from `product_variants`.
- Sync worker recomputes the sum from variant quantities inside the same upsert transaction.

Foundation for PR 3 in the products-page redesign series — enables `sort=totalStock` on the products list endpoint without raw SQL.

Spec: `docs/superpowers/specs/2026-05-04-products-page-redesign-design.md` §5.2.

## Test plan
- [x] `pnpm --filter @pazarsync/sync-worker test:integration` passes
- [x] `pnpm --filter @pazarsync/db typecheck` passes
- [x] Local backfill verified: `SELECT id, total_stock FROM products LIMIT 5` matches `SELECT product_id, SUM(quantity) FROM product_variants GROUP BY product_id`
- [ ] CI passes

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Wait for review + merge before starting PR 1**

PR 1 doesn't depend on PR 0 in code, but PR 3 does. Get this merged first to keep the dependency chain straight.

---

## PR 1 — `DataTable` `getSubRows` mode

**Branch:** `feat/design-system-data-table-subrows`

**Why this PR:** The shared `DataTable` today renders `renderSubComponent` inside a single `colSpan` cell. That doesn't grid-align — it's the wrong primitive for variant rows. TanStack Table v8 has native `subRows` support that renders sub-rows as siblings in the same `<tbody>`, picking up the same column definitions. Adding it to `DataTable` as an opt-in is additive — every existing caller that doesn't pass `getSubRows` is unaffected.

**LOC budget:** ~200 (table + tokens CSS + showcase page + showcase i18n + 1 component test).

### Task 1.1: Add `getSubRows` prop + `data-depth` attribute to `DataTable`

**Files:**

- Modify: `apps/web/src/components/patterns/data-table.tsx` (existing pattern)

- [ ] **Step 1: Write the failing test**

Create `apps/web/tests/component/data-table-subrows.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { type ColumnDef } from '@tanstack/react-table';

import { DataTable } from '@/components/patterns/data-table';

import { render, screen, within } from '../helpers/render';

interface Row {
  id: string;
  label: string;
  children?: Row[];
}

const COLUMNS: ColumnDef<Row>[] = [
  {
    id: 'expand',
    cell: ({ row }) =>
      row.getCanExpand() ? (
        <button onClick={row.getToggleExpandedHandler()}>{row.getIsExpanded() ? '▾' : '▸'}</button>
      ) : null,
  },
  { id: 'label', header: 'Label', cell: ({ row }) => row.original.label },
];

const DATA: Row[] = [
  {
    id: 'p1',
    label: 'Parent 1',
    children: [
      { id: 'p1.c1', label: 'Child 1.1' },
      { id: 'p1.c2', label: 'Child 1.2' },
    ],
  },
  { id: 'p2', label: 'Parent 2' },
];

describe('DataTable with getSubRows', () => {
  it('renders sub-rows as sibling rows in the same grid when expanded', async () => {
    const { user } = render(
      <DataTable
        columns={COLUMNS}
        data={DATA}
        getRowId={(row) => row.id}
        getSubRows={(row) => row.children}
        getRowCanExpand={(row) => (row.children?.length ?? 0) > 0}
      />,
    );
    // Children not visible until parent is expanded
    expect(screen.queryByText('Child 1.1')).toBeNull();
    await user.click(screen.getByRole('button', { name: '▸' }));
    expect(screen.getByText('Child 1.1')).toBeInTheDocument();
    expect(screen.getByText('Child 1.2')).toBeInTheDocument();
    // Sub-rows tagged with data-depth="1" so feature CSS can style them
    const childRow = screen.getByText('Child 1.1').closest('tr');
    expect(childRow?.getAttribute('data-depth')).toBe('1');
    // Parent row has no data-depth (depth 0)
    const parentRow = screen.getByText('Parent 1').closest('tr');
    expect(parentRow?.getAttribute('data-depth')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter web test:unit -t "renders sub-rows as sibling rows"`

Expected: FAIL — `getSubRows` is not a recognized prop on `DataTable`.

- [ ] **Step 3: Add the prop to `DataTableProps`**

In `apps/web/src/components/patterns/data-table.tsx`, add to the `DataTableProps` interface (near the other expansion props around line 60-72):

```tsx
  /**
   * Project a parent row's children to render as sibling sub-rows in
   * the same grid (TanStack v8 native subRows machinery). When
   * supplied, sub-rows pick up the parent's column definitions
   * verbatim — column widths align, every cell is rendered against the
   * same `columns[]`. Combine with `row.depth` in your column cell
   * renderers to branch parent vs child rendering, and with
   * `row.getIsExpanded()` (gated by the chevron in your expand column)
   * to toggle visibility.
   *
   * Mutually exclusive in spirit with `renderSubComponent`: the two
   * patterns target different visual treatments (sibling rows vs
   * panel inside a colspan cell). Don't combine them on the same
   * table.
   */
  getSubRows?: (row: TData) => TData[] | undefined;
```

- [ ] **Step 4: Wire the prop into TanStack + propagate `data-depth`**

In the same file, add `getSubRows` to the destructured props (near line 169-191), pass it into `useReactTable` (near line 249-285), and add `data-depth={row.depth || undefined}` to the rendered `TableRow` (near line 379-389).

```tsx
// 1) destructure (add after `renderSubComponent,`):
  getSubRows,

// 2) pass into useReactTable (add to the config object):
    getSubRows,

// 3) on the TableRow:
    <TableRow
      data-state={row.getIsSelected() ? 'selected' : undefined}
      data-depth={row.depth || undefined}        // NEW
      role={onRowClick ? 'button' : undefined}
      // … rest unchanged …
    >
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter web test:unit -t "renders sub-rows as sibling rows"`

Expected: PASS.

- [ ] **Step 6: Run the existing `DataTable` test suite to confirm no regressions**

Run: `pnpm --filter web test:unit -t "data-table"`

Expected: All existing data-table-\* tests pass. The change is additive (new optional prop, new optional attribute on rows that have depth > 0).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/patterns/data-table.tsx apps/web/tests/component/data-table-subrows.test.tsx
git commit -m "$(cat <<'EOF'
feat(design-system): DataTable getSubRows mode for grid-aligned sub-rows

Adds optional getSubRows prop that wires through TanStack v8's native
subRows machinery — sub-rows render as siblings in the same <tbody>,
picking up the parent's column defs (column widths align). TableRow
now carries data-depth on rows where row.depth > 0 so feature CSS can
style sub-rows distinctly without forking the primitive.

Additive: every existing caller stays byte-identical (no getSubRows,
no data-depth, no behavioural change).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 1.2: Add tokenized depth styling

**Files:**

- Modify: `apps/web/src/app/tokens/colors.css` (or create `apps/web/src/app/tokens/data-table.css` and import it from `globals.css`)

This is the ONLY place the depth-based row tinting lives. Feature code never writes `bg-muted` directly on a sub-row — the primitive's `data-depth="1"` attribute drives the style automatically.

- [ ] **Step 1: Decide location**

Check `apps/web/src/app/globals.css` to see what tokens files are imported. If a generic place exists for component-scoped CSS (e.g. `apps/web/src/app/tokens/components.css`), use it. Otherwise add a new file:

Run: `ls apps/web/src/app/`

If `tokens/components.css` does not exist, create it:

`apps/web/src/app/tokens/components.css`:

```css
/* DataTable depth-based row styling — driven by patterns/data-table.tsx
   when getSubRows is supplied. Feature code does not author these styles
   directly; setting data-depth on the row is the entire contract. */

table tr[data-depth='1'] {
  background-color: var(--muted);
}

table tr[data-depth='1'] > td:first-child {
  padding-left: var(--space-xl);
}
```

- [ ] **Step 2: Wire the new file into globals.css**

Open `apps/web/src/app/globals.css`, find the `@import` block for tokens (or wherever `colors.css`/`spacing.css` are pulled in), and add:

```css
@import './tokens/components.css';
```

- [ ] **Step 3: Verify in the showcase**

This step has no test — the visual is the test. Continue to Task 1.3 to add the showcase page.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/tokens/components.css apps/web/src/app/globals.css
git commit -m "$(cat <<'EOF'
feat(design-system): depth-based DataTable row tint via data-depth attr

Single home for the sub-row visual treatment so feature code never
hand-rolls bg-muted on a TableRow. Reads --muted + --space-xl tokens
that already pair correctly across light + dark mode (no new alpha,
no new tokens needed).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 1.3: Add the showcase page

**Files:**

- Create: `apps/web/src/app/[locale]/(showcase)/design/patterns/data-table-subrows-showcase.tsx`
- Modify: `apps/web/src/app/[locale]/(showcase)/design/patterns/page.tsx` (add import + insertion in the patterns gallery)

The showcase mirrors the pattern in `data-table-expandable-rows-showcase.tsx`. Read that file first to see the established structure (mock data, columns, narration paragraph at the bottom).

- [ ] **Step 1: Create the showcase**

Write a focused demo using the same products-with-variants pattern the real page will use, but with placeholder data so this file is self-contained.

`apps/web/src/app/[locale]/(showcase)/design/patterns/data-table-subrows-showcase.tsx`:

```tsx
'use client';

import { type ColumnDef } from '@tanstack/react-table';
import { ArrowDown01Icon, ArrowRight01Icon } from 'hugeicons-react';
import * as React from 'react';

import { DataTable } from '@/components/patterns/data-table';
import { Badge } from '@/components/ui/badge';

interface SkuRow {
  id: string;
  kind: 'parent' | 'variant';
  label: string;
  sku?: string;
  stock: number;
  status: 'live' | 'paused';
  children?: SkuRow[];
}

const DATA: SkuRow[] = [
  {
    id: 'p1',
    kind: 'parent',
    label: 'Keten gömlek',
    stock: 42,
    status: 'live',
    children: [
      {
        id: 'p1.s',
        kind: 'variant',
        label: 'S · Beyaz',
        sku: 'KGM-S-BYZ',
        stock: 14,
        status: 'live',
      },
      {
        id: 'p1.m',
        kind: 'variant',
        label: 'M · Beyaz',
        sku: 'KGM-M-BYZ',
        stock: 21,
        status: 'live',
      },
      {
        id: 'p1.l',
        kind: 'variant',
        label: 'L · Beyaz',
        sku: 'KGM-L-BYZ',
        stock: 7,
        status: 'paused',
      },
    ],
  },
  {
    id: 'p2',
    kind: 'parent',
    label: 'Tek varyantlı kalem',
    sku: 'KAL-001',
    stock: 99,
    status: 'live',
  },
];

const COLUMNS: ColumnDef<SkuRow>[] = [
  {
    id: 'expand',
    enableSorting: false,
    cell: ({ row }) => {
      if (row.depth > 0) {
        return (
          <span aria-hidden className="text-muted-foreground">
            └
          </span>
        );
      }
      if (!row.getCanExpand()) {
        return <span aria-hidden className="size-icon-sm inline-block" />;
      }
      const expanded = row.getIsExpanded();
      return (
        <button
          type="button"
          onClick={row.getToggleExpandedHandler()}
          aria-label={expanded ? 'Kapat' : 'Aç'}
          aria-expanded={expanded}
          className="text-muted-foreground hover:text-foreground p-3xs duration-fast hover:bg-background focus-visible:ring-ring inline-flex items-center justify-center rounded-sm transition-colors focus-visible:ring-2 focus-visible:outline-none"
        >
          {expanded ? (
            <ArrowDown01Icon className="size-icon-sm" />
          ) : (
            <ArrowRight01Icon className="size-icon-sm" />
          )}
        </button>
      );
    },
  },
  {
    id: 'label',
    header: 'Ürün',
    cell: ({ row }) => (
      <span className={row.depth > 0 ? 'text-muted-foreground' : 'text-foreground font-medium'}>
        {row.original.label}
      </span>
    ),
  },
  {
    id: 'sku',
    header: 'SKU',
    cell: ({ row }) =>
      row.original.sku !== undefined ? (
        <span className="font-mono text-xs">{row.original.sku}</span>
      ) : (
        <span className="text-muted-foreground text-xs">
          {row.original.children?.length ?? 0} varyant
        </span>
      ),
  },
  {
    id: 'stock',
    header: 'Stok',
    meta: { numeric: true },
    cell: ({ row }) => <span className="tabular-nums">{row.original.stock}</span>,
  },
  {
    id: 'status',
    header: 'Durum',
    cell: ({ row }) => (
      <Badge tone={row.original.status === 'live' ? 'success' : 'warning'}>
        {row.original.status === 'live' ? 'Yayında' : 'Pasif'}
      </Badge>
    ),
  },
];

export function DataTableSubrowsShowcase(): React.ReactElement {
  return (
    <div className="gap-3xs flex flex-col">
      <DataTable
        columns={COLUMNS}
        data={DATA}
        getRowId={(row) => row.id}
        getRowCanExpand={(row) => (row.children?.length ?? 0) > 0}
        getSubRows={(row) => row.children}
      />
      <span className="text-2xs text-muted-foreground">
        `getSubRows` her satır için varyant listesini döner — TanStack alt satırları aynı
        grid&apos;te sibling olarak render eder, parent&apos;ın column tanımlarını birebir uygular.
        Sub-row&apos;lar `data-depth=&quot;1&quot;` taşır; feature CSS&apos;i
        `tokens/components.css` üzerinden tek kaynaktan stilliyor (muted bg + leading cell indent).
        Tek varyantlı parent için chevron render edilmez ama aynı genişlikte boş tutucu gelir,
        sütunlar dikey hizada kalır.
      </span>
    </div>
  );
}
```

- [ ] **Step 2: Wire it into the patterns gallery**

Open `apps/web/src/app/[locale]/(showcase)/design/patterns/page.tsx`. Add the import alongside the existing showcases, and insert the new entry into the gallery list. The exact format depends on the existing structure — read the file and follow the same pattern (typically a `{ id, name, description, render: <Component /> }` array).

Run: `cat "apps/web/src/app/[locale]/(showcase)/design/patterns/page.tsx" | head -80`

Then add an entry mirroring the existing `DataTableExpandableRowsShowcase` registration. Search for `DataTableExpandableRowsShowcase` and add yours immediately after.

- [ ] **Step 3: Visual smoke**

Run: `pnpm dev --filter web`

Open `http://localhost:3000/design/patterns` (or wherever the showcase routes live — check the URL structure if the locale prefix is required). Find the new "DataTable subrows" entry. Verify:

- Click the chevron on "Keten gömlek" → 3 sub-rows appear in the same grid, columns align with the parent.
- Sub-rows have a muted background tint and a leading-cell indent.
- "Tek varyantlı kalem" has no chevron and renders flat.
- Toggle dark mode (theme switcher in the showcase header). Sub-row tint reads correctly — no muddy alpha.

If anything fails, fix and re-verify before moving on.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/[locale]/(showcase)/design/patterns/data-table-subrows-showcase.tsx" "apps/web/src/app/[locale]/(showcase)/design/patterns/page.tsx"
git commit -m "$(cat <<'EOF'
docs(design-system): showcase for DataTable getSubRows mode

Live demo of grid-aligned sub-rows under expandable parents, with the
tree connector + muted tint pattern that the real products page will
adopt in PR 4. Mirrors the existing data-table-expandable-rows
showcase structure.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 1.4: Open PR 1

- [ ] **Step 1: Run the full pre-PR check**

Run: `pnpm check:full` (needs `supabase start` first)

Expected: typecheck + lint + all tests + format check pass.

- [ ] **Step 2: Push the branch**

Run: `git push -u origin feat/design-system-data-table-subrows`

- [ ] **Step 3: Open the PR**

```bash
gh pr create --title "feat(design-system): DataTable getSubRows for grid-aligned sub-rows" --body "$(cat <<'EOF'
## Summary
- Adds `getSubRows` prop to `DataTable` — wires through TanStack v8's native sub-row machinery so child rows render as siblings of their parent in the same grid (column widths align with parent).
- Adds `data-depth` attribute to `<TableRow>` driven by `row.depth`. Feature CSS reads it from `tokens/components.css` to apply muted-bg tint + leading-cell indent on sub-rows.
- New showcase page `data-table-subrows-showcase.tsx` and entry in the patterns gallery.

Additive: every existing `DataTable` caller stays byte-identical (no `getSubRows` → no `data-depth` on any row, no behavioural change).

Foundation for PR 4 in the products-page redesign series.

Spec: `docs/superpowers/specs/2026-05-04-products-page-redesign-design.md` §6.3.

## Test plan
- [x] New `data-table-subrows.test.tsx` asserts sub-row visibility, `data-depth=1` tagging, and absent `data-depth` on parents
- [x] All existing `data-table-*.test.tsx` tests still pass
- [x] Visual smoke: showcase renders correctly in light + dark mode at /design/patterns
- [ ] CI passes

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## PR 2 — `DataTableToolbar` controlled-search mode

**Branch:** `feat/design-system-data-table-toolbar-controlled-search`

**Why this PR:** The canonical `DataTableToolbar` couples its search input to a TanStack column filter (`table.getColumn(searchColumn).setFilterValue`). The products page is server-paginated with URL-driven `q` state via nuqs — search isn't a column filter, it's a page-level param. PR 4 needs a controlled-search alternative. Additive enhancement.

**LOC budget:** ~100 (toolbar prop additions + new test file).

### Task 2.1: Add `searchValue` + `onSearchChange` props to `DataTableToolbar`

**Files:**

- Modify: `apps/web/src/components/patterns/data-table-toolbar.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/tests/component/data-table-toolbar.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { type ColumnDef, useReactTable, getCoreRowModel } from '@tanstack/react-table';
import * as React from 'react';

import { DataTableToolbar } from '@/components/patterns/data-table-toolbar';

import { render, screen } from '../helpers/render';

interface Row {
  id: string;
  name: string;
}
const COLUMNS: ColumnDef<Row>[] = [
  { id: 'name', header: 'Name', cell: ({ row }) => row.original.name },
];
const DATA: Row[] = [{ id: '1', name: 'Foo' }];

function Harness({
  searchValue,
  onSearchChange,
}: {
  searchValue: string;
  onSearchChange: (s: string) => void;
}) {
  const table = useReactTable({ data: DATA, columns: COLUMNS, getCoreRowModel: getCoreRowModel() });
  return (
    <DataTableToolbar
      table={table}
      searchValue={searchValue}
      onSearchChange={onSearchChange}
      searchPlaceholder="Ara…"
    />
  );
}

describe('DataTableToolbar controlled-search mode', () => {
  it('renders the search input with the provided value', () => {
    render(<Harness searchValue="hello" onSearchChange={() => {}} />);
    expect(screen.getByPlaceholderText('Ara…')).toHaveValue('hello');
  });

  it('calls onSearchChange on input', async () => {
    const onSearchChange = vi.fn();
    const { user } = render(<Harness searchValue="" onSearchChange={onSearchChange} />);
    await user.type(screen.getByPlaceholderText('Ara…'), 'a');
    expect(onSearchChange).toHaveBeenCalledWith('a');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter web test:unit -t "DataTableToolbar controlled-search"`

Expected: FAIL — without `searchColumn`, today's toolbar renders nothing for the search slot, so `getByPlaceholderText` throws.

- [ ] **Step 3: Add the props + render branch**

Open `apps/web/src/components/patterns/data-table-toolbar.tsx`. In `DataTableToolbarProps`, add:

```tsx
  /**
   * Controlled-search alternative to `searchColumn`. Bind the search
   * input to a page-level value/onChange pair instead of a TanStack
   * column filter. Use for server-paginated pages where search is a
   * query param, not a column filter.
   *
   * Mutually exclusive with `searchColumn` — pass exactly one. If both
   * are supplied, `searchColumn` wins (development-mode warning).
   */
  searchValue?: string;
  onSearchChange?: (next: string) => void;
```

In the destructured props add `searchValue, onSearchChange,`. Then update the search-input render block. Today it reads roughly:

```tsx
{searchColumn ? (
  <div className="max-w-input relative flex-1">
    <Search01Icon ... />
    <Input
      value={searchValue}                                       // computed from column filter above
      onChange={(event) => table.getColumn(searchColumn)?.setFilterValue(event.target.value)}
      placeholder={searchPlaceholder ?? t('searchPlaceholder')}
      ...
    />
  </div>
) : null}
```

Refactor to handle both modes. Replace the `searchColumn` branch and the local `searchValue` computation with this:

```tsx
const isColumnSearch = searchColumn !== undefined;
const isControlledSearch =
  !isColumnSearch && searchValue !== undefined && onSearchChange !== undefined;

const inputValue = isColumnSearch
  ? ((table.getColumn(searchColumn)?.getFilterValue() as string | undefined) ?? '')
  : (searchValue ?? '');

const handleSearchInput = (next: string): void => {
  if (isColumnSearch) {
    table.getColumn(searchColumn)?.setFilterValue(next);
  } else if (isControlledSearch) {
    onSearchChange(next);
  }
};

// Dev-mode warning if both supplied
if (process.env['NODE_ENV'] !== 'production' && isColumnSearch && searchValue !== undefined) {
  console.warn(
    '[DataTableToolbar] both `searchColumn` and `searchValue` were supplied. ' +
      'searchColumn wins; onSearchChange will not fire.',
  );
}

// Render block:
{
  isColumnSearch || isControlledSearch ? (
    <div className="max-w-input relative flex-1">
      <Search01Icon className="left-sm size-icon-sm text-muted-foreground pointer-events-none absolute top-1/2 -translate-y-1/2" />
      <Input
        value={inputValue}
        onChange={(event) => handleSearchInput(event.target.value)}
        placeholder={searchPlaceholder ?? t('searchPlaceholder')}
        className="pl-2xl"
      />
    </div>
  ) : null;
}
```

(Match the exact JSX of the existing block — pull `className`, accessibility props, etc. from the current implementation.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter web test:unit -t "DataTableToolbar controlled-search"`

Expected: PASS.

- [ ] **Step 5: Run the existing toolbar usages**

Run: `pnpm --filter web test:unit`

Expected: All existing component tests pass. The change is additive.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/patterns/data-table-toolbar.tsx apps/web/tests/component/data-table-toolbar.test.tsx
git commit -m "$(cat <<'EOF'
feat(design-system): DataTableToolbar controlled-search mode

Adds searchValue + onSearchChange prop pair as an alternative to
searchColumn. Use for server-paginated pages where search is a page-
level URL query param, not a TanStack column filter.

Mutually exclusive with searchColumn (dev-mode warning if both are
supplied — searchColumn wins for backwards compatibility). All existing
callers stay byte-identical.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 2.2: Update the showcase to demo controlled-search mode

**Files:**

- Modify: `apps/web/src/app/[locale]/(showcase)/design/patterns/data-table-server-mode-showcase.tsx` (server-mode is the natural home — it already demonstrates a page-level state shell)

- [ ] **Step 1: Read the existing showcase**

Run: `cat "apps/web/src/app/[locale]/(showcase)/design/patterns/data-table-server-mode-showcase.tsx" | head -120`

Identify where the toolbar is rendered. If the showcase uses `searchColumn` today, swap one of its tables (or add a new variant) to use `searchValue` + `onSearchChange` against a `useState<string>('')` cell. Add a paragraph below explaining when to pick which mode.

- [ ] **Step 2: Visual smoke**

Run: `pnpm dev --filter web`

Open `/design/patterns`. Find the server-mode showcase. Type in the controlled-search input — value updates, debouncing is the consumer's responsibility (the showcase narration should call this out).

- [ ] **Step 3: Commit**

```bash
git add "apps/web/src/app/[locale]/(showcase)/design/patterns/data-table-server-mode-showcase.tsx"
git commit -m "$(cat <<'EOF'
docs(design-system): showcase DataTableToolbar controlled-search mode

Demonstrates the searchValue + onSearchChange pair for server-paginated
pages. Narration calls out that debouncing is the caller's responsibility.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 2.3: Open PR 2

- [ ] **Step 1: Pre-PR check**

Run: `pnpm check:all`

Expected: typecheck + lint + unit tests + format check pass.

- [ ] **Step 2: Push and open PR**

Run: `git push -u origin feat/design-system-data-table-toolbar-controlled-search`

```bash
gh pr create --title "feat(design-system): DataTableToolbar controlled-search mode" --body "$(cat <<'EOF'
## Summary
- Adds `searchValue` + `onSearchChange` props to `DataTableToolbar` as an alternative to `searchColumn`. Use for server-paginated pages where search is a URL query param, not a TanStack column filter.
- Mutually exclusive with `searchColumn` (dev-mode warning, `searchColumn` wins).
- Showcase updated to demonstrate the new mode.

Additive — all existing callers byte-identical.

Spec: `docs/superpowers/specs/2026-05-04-products-page-redesign-design.md` §6.4.

## Test plan
- [x] New `data-table-toolbar.test.tsx` asserts both render-with-value and onChange propagation
- [x] Existing toolbar consumers (Orders, Settlements showcases, etc.) still pass
- [x] Visual smoke: server-mode showcase types into the controlled input
- [ ] CI passes

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## PR 3 — Backend `overrideMissing` filter + override counts

**Branch:** `feat/api-products-override-state`

**Why this PR:** Extends the products list endpoint with an `overrideMissing` query param (`'cost' | 'vat'`) and the products facets endpoint with `overrideCounts`. Adds `salePrice` and `totalStock` (both directions) to the sort vocabulary. Backend-only PR.

**LOC budget:** ~300 (validator + service + tests + OpenAPI sync + changelog).

**Depends on:** PR 0 (totalStock column).

### Task 3.1: Extend `ListProductsQuerySchema` with `overrideMissing` and new sorts

**Files:**

- Modify: `apps/api/src/validators/product.validator.ts`

- [ ] **Step 1: Add the enum and extend the schema**

Open `apps/api/src/validators/product.validator.ts`. Above `PRODUCT_LIST_SORTS`, add:

```ts
export const PRODUCT_OVERRIDE_MISSING = ['cost', 'vat'] as const;
export type ProductOverrideMissing = (typeof PRODUCT_OVERRIDE_MISSING)[number];
```

Replace `PRODUCT_LIST_SORTS` with:

```ts
export const PRODUCT_LIST_SORTS = [
  '-platformModifiedAt',
  'platformModifiedAt',
  'title',
  '-title',
  'salePrice',
  '-salePrice',
  'totalStock',
  '-totalStock',
] as const;
```

In `ListProductsQuerySchema`, add the field after `categoryId`:

```ts
  overrideMissing: z
    .enum(PRODUCT_OVERRIDE_MISSING)
    .optional()
    .openapi({
      description:
        'Variant-level filter: "cost" → variants with NULL costPrice; "vat" → variants with NULL vatRate. ' +
        'Composes with the status filter via AND. Parent included if ≥1 variant matches; response variants[] ' +
        'is filtered to matching variants (consistent with status semantics).',
      example: 'cost',
    }),
```

The existing `sort` field already references `PRODUCT_LIST_SORTS` so widening the enum is enough — no other change needed there.

- [ ] **Step 2: Extend `ProductFacetsResponseSchema` with `overrideCounts`**

Find `ProductFacetsResponseSchema` (near the bottom of the file). Add `overrideCounts` to the object:

```ts
export const ProductFacetsResponseSchema = z
  .object({
    brands: z.array(FacetEntrySchema),
    categories: z.array(FacetEntrySchema),
    overrideCounts: z
      .object({
        missingCost: z.number().int().nonnegative(),
        missingVat: z.number().int().nonnegative(),
        total: z.number().int().nonnegative(),
      })
      .openapi({
        description:
          'Counts of products with ≥1 variant missing the corresponding override field. Used to populate ' +
          'the override-state tab badges. Computed against the unfiltered store-scoped set (does not respect ' +
          'the current q/brand/category/status filters — tabs reset to the full set when activated).',
      }),
  })
  .openapi('ProductFacetsResponse');
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @pazarsync/api typecheck`

Expected: clean. The service file still compiles because `overrideMissing` is optional in the query, and the new facet field is required so `products-list.service.ts::facets` will fail to compile until task 3.3 runs — that's fine, we'll fix it in the next task. (Note: if it breaks the typecheck before task 3.3 lands in the same PR series, that's okay because we're on a branch — just stage the validator and move directly to task 3.2/3.3 to keep the branch compilable at the commit boundary. Or commit only after all three tasks land. Choose the latter for clarity.)

Hold the commit until task 3.3 lands so the branch stays buildable at every commit.

### Task 3.2: Extend `products-list.service.ts::list` for the new filter and sort

**Files:**

- Modify: `apps/api/src/services/products-list.service.ts`

- [ ] **Step 1: Add the `variantOverrideMissingWhere` builder**

In the same file, near `variantStatusWhere`, add:

```ts
function variantOverrideMissingWhere(
  missing: ProductOverrideMissing,
): Prisma.ProductVariantWhereInput {
  switch (missing) {
    case 'cost':
      return { costPrice: null };
    case 'vat':
      return { vatRate: null };
  }
}
```

Add `ProductOverrideMissing` to the imports at the top of the file:

```ts
import type {
  ListProductsQuery,
  ProductListSort,
  ProductOverrideMissing,
  ProductVariantStatus,
} from '../validators/product.validator';
```

- [ ] **Step 2: Compose status + overrideMissing on the variants clause**

Replace the existing `variantWhere` block (around line 74-75) with:

```ts
// Variant-level filters compose with AND. Today: status (onSale/archived/…)
// and overrideMissing (cost/vat). The parent is included if ≥1 variant
// matches; the response variants[] is filtered to matching variants.
const variantConditions: Prisma.ProductVariantWhereInput[] = [];
if (filters.status !== undefined) {
  variantConditions.push(variantStatusWhere(filters.status));
}
if (filters.overrideMissing !== undefined) {
  variantConditions.push(variantOverrideMissingWhere(filters.overrideMissing));
}
const variantWhere: Prisma.ProductVariantWhereInput | undefined =
  variantConditions.length === 0
    ? undefined
    : variantConditions.length === 1
      ? variantConditions[0]
      : { AND: variantConditions };
```

The rest of `list` (the `productWhere`, the `findMany` with `variants: { where: variantWhere }`, the count, the response shape) reads `variantWhere` and works unchanged.

- [ ] **Step 3: Add the new sort branches to `buildOrderBy`**

```ts
function buildOrderBy(sort: ProductListSort): Prisma.ProductOrderByWithRelationInput {
  switch (sort) {
    case '-platformModifiedAt':
      return { platformModifiedAt: 'desc' };
    case 'platformModifiedAt':
      return { platformModifiedAt: 'asc' };
    case 'title':
      return { title: 'asc' };
    case '-title':
      return { title: 'desc' };
    case 'salePrice':
      return { variants: { _count: 'asc' } }; // placeholder — see below
    case '-salePrice':
      return { variants: { _count: 'desc' } };
    case 'totalStock':
      return { totalStock: 'asc' };
    case '-totalStock':
      return { totalStock: 'desc' };
  }
}
```

`salePrice` is tricky — Prisma doesn't natively sort a parent by an aggregate over child decimal columns. Options:

- **Option A (chosen for v1):** sort by the _first_ variant's salePrice (deterministic via `variants: { orderBy: { … }, take: 1 }`). Limited but truthful for single-variant products.
- **Option B:** denormalize `Product.minSalePrice` and `Product.maxSalePrice` (mirrors the totalStock pattern). Cleaner; defer to a follow-up.
- **Option C:** Prisma raw query with `MIN(salePrice)` GROUP BY product. Loses type safety.

For this PR, ship Option A — it's correct for single-variant products (the majority), and multi-variant ordering by "the variant Prisma's relation iterator picks" is consistent if not perfect. Document the limitation in the validator's `.openapi()` description for the `sort` field. Replace the placeholder branches above with:

```ts
    case 'salePrice':
    case '-salePrice':
      // Prisma can't natively MAX over a decimal child relation without
      // raw SQL or a denormalized column. Until we ship Product.minSalePrice
      // (follow-up), sort by platformModifiedAt as a deterministic fallback
      // when the user picks salePrice. Surfaced as a known limitation in
      // the validator's openapi description.
      return { platformModifiedAt: sort.startsWith('-') ? 'desc' : 'asc' };
```

Then update the `.openapi()` description on `sort` in `ListProductsQuerySchema` to call this out:

```ts
  sort: z.enum(PRODUCT_LIST_SORTS).default('-platformModifiedAt').openapi({
    description:
      'Sort key. Prefix with `-` for descending. Default: most-recently-modified first. ' +
      'KNOWN LIMITATION: salePrice / -salePrice currently fall back to platformModifiedAt because ' +
      'Prisma cannot natively MAX over a decimal child relation without raw SQL or a denormalized ' +
      'column. A future PR will denormalize Product.minSalePrice / maxSalePrice and replace this fallback.',
    example: '-platformModifiedAt',
  }),
```

This is honest about the gap and keeps PR 3 small. Document the follow-up in the spec's open-questions section if you decide to ship the denorm next; otherwise it stays a deliberate Option-C-scope item.

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @pazarsync/api typecheck`

Expected: still failing because `facets` doesn't return `overrideCounts` yet. Move to task 3.3.

### Task 3.3: Extend `products-list.service.ts::facets` with `overrideCounts`

**Files:**

- Modify: `apps/api/src/services/products-list.service.ts`

- [ ] **Step 1: Update `facets` to compute the three new counts**

Replace the existing `facets` function with:

```ts
export async function facets(opts: {
  organizationId: string;
  storeId: string;
}): Promise<FacetsResponse> {
  const { organizationId, storeId } = opts;

  const [brandRows, categoryRows, missingCost, missingVat, total] = await Promise.all([
    prisma.product.groupBy({
      by: ['brandId', 'brandName'],
      where: { organizationId, storeId, brandId: { not: null }, brandName: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { brandId: 'desc' } },
    }),
    prisma.product.groupBy({
      by: ['categoryId', 'categoryName'],
      where: {
        organizationId,
        storeId,
        categoryId: { not: null },
        categoryName: { not: null },
      },
      _count: { _all: true },
      orderBy: { _count: { categoryId: 'desc' } },
    }),
    prisma.product.count({
      where: { organizationId, storeId, variants: { some: { costPrice: null } } },
    }),
    prisma.product.count({
      where: { organizationId, storeId, variants: { some: { vatRate: null } } },
    }),
    prisma.product.count({ where: { organizationId, storeId } }),
  ]);

  return {
    brands: brandRows
      .filter(
        (r): r is typeof r & { brandId: bigint; brandName: string } =>
          r.brandId !== null && r.brandName !== null,
      )
      .map((r) => ({
        id: r.brandId.toString(),
        name: r.brandName,
        count: r._count._all,
      })),
    categories: categoryRows
      .filter(
        (r): r is typeof r & { categoryId: bigint; categoryName: string } =>
          r.categoryId !== null && r.categoryName !== null,
      )
      .map((r) => ({
        id: r.categoryId.toString(),
        name: r.categoryName,
        count: r._count._all,
      })),
    overrideCounts: { missingCost, missingVat, total },
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @pazarsync/api typecheck`

Expected: clean.

- [ ] **Step 3: Regenerate the API client snapshot**

Run from repo root: `pnpm api:sync`

Expected: `packages/api-client/openapi.json` and `packages/api-client/src/generated/api.d.ts` get rewritten to include `overrideMissing`, the wider sort enum, and `overrideCounts`. Verify the diff:

Run: `git diff packages/api-client/openapi.json | head -80`

You should see new properties + enum values. If `git diff` shows no change, run `pnpm api:sync` again — sometimes the dump script needs a fresh build.

### Task 3.4: Integration tests for the new filter, sort, and counts

**Files:**

- Modify: `apps/api/tests/integration/routes/products-list.routes.test.ts` (extend with new `it` blocks)
- Create: `apps/api/tests/integration/routes/products-facets.routes.test.ts`
- Create: `apps/api/tests/integration/tenant-isolation/products-override.test.ts`

- [ ] **Step 1: Extend `products-list.routes.test.ts` with the filter + sort tests**

Open the file. Below the existing tests, add a new `describe` block:

```ts
describe('GET /v1/.../products — overrideMissing filter', () => {
  it('returns only products with ≥1 variant having NULL costPrice when overrideMissing=cost', async () => {
    const fixtures = await setupOrgWithStoreAndFixtures();
    await seedProduct(fixtures.orgId, fixtures.storeId, {
      platformContentId: 1001,
      productMainId: 'P-WITHCOST',
      title: 'Has cost',
      variants: [{ platformVariantId: 1101, barcode: 'B1', stockCode: 'S1' }],
    });
    // Above seeds a variant whose costPrice defaults to null, so we
    // need to set it explicitly to make this product NOT match.
    await prisma.productVariant.updateMany({
      where: { stockCode: 'S1' },
      data: { costPrice: '50.00' },
    });
    await seedProduct(fixtures.orgId, fixtures.storeId, {
      platformContentId: 1002,
      productMainId: 'P-NOCOST',
      title: 'Missing cost',
      variants: [{ platformVariantId: 1102, barcode: 'B2', stockCode: 'S2' }],
    });

    const res = await app.request(
      `/v1/organizations/${fixtures.orgId}/stores/${fixtures.storeId}/products?overrideMissing=cost`,
      { headers: bearer(fixtures.user.accessToken) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = body.data.map((p: { productMainId: string }) => p.productMainId);
    expect(ids).toContain('P-NOCOST');
    expect(ids).not.toContain('P-WITHCOST');
  });

  it('returns only products with ≥1 variant having NULL vatRate when overrideMissing=vat', async () => {
    const fixtures = await setupOrgWithStoreAndFixtures();
    await seedProduct(fixtures.orgId, fixtures.storeId, {
      platformContentId: 2001,
      productMainId: 'P-WITHVAT',
      title: 'Has vat',
      variants: [{ platformVariantId: 2101, barcode: 'B3', stockCode: 'S3' }],
    });
    await prisma.productVariant.updateMany({
      where: { stockCode: 'S3' },
      data: { vatRate: 18 },
    });
    await seedProduct(fixtures.orgId, fixtures.storeId, {
      platformContentId: 2002,
      productMainId: 'P-NOVAT',
      title: 'Missing vat',
      variants: [{ platformVariantId: 2102, barcode: 'B4', stockCode: 'S4' }],
    });

    const res = await app.request(
      `/v1/organizations/${fixtures.orgId}/stores/${fixtures.storeId}/products?overrideMissing=vat`,
      { headers: bearer(fixtures.user.accessToken) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = body.data.map((p: { productMainId: string }) => p.productMainId);
    expect(ids).toContain('P-NOVAT');
    expect(ids).not.toContain('P-WITHVAT');
  });

  it('AND-composes overrideMissing=cost with status=onSale (variant must satisfy both)', async () => {
    const fixtures = await setupOrgWithStoreAndFixtures();
    // P-A: archived variant missing cost → excluded by status=onSale
    await seedProduct(fixtures.orgId, fixtures.storeId, {
      platformContentId: 3001,
      productMainId: 'P-A',
      title: 'A',
      variants: [
        { platformVariantId: 3101, barcode: 'BA', stockCode: 'SA', archived: true, onSale: false },
      ],
    });
    // P-B: onSale variant with cost → excluded by overrideMissing=cost
    await seedProduct(fixtures.orgId, fixtures.storeId, {
      platformContentId: 3002,
      productMainId: 'P-B',
      title: 'B',
      variants: [{ platformVariantId: 3102, barcode: 'BB', stockCode: 'SB' }],
    });
    await prisma.productVariant.updateMany({
      where: { stockCode: 'SB' },
      data: { costPrice: '99.00' },
    });
    // P-C: onSale variant missing cost → matches both
    await seedProduct(fixtures.orgId, fixtures.storeId, {
      platformContentId: 3003,
      productMainId: 'P-C',
      title: 'C',
      variants: [{ platformVariantId: 3103, barcode: 'BC', stockCode: 'SC' }],
    });

    const res = await app.request(
      `/v1/organizations/${fixtures.orgId}/stores/${fixtures.storeId}/products?overrideMissing=cost&status=onSale`,
      { headers: bearer(fixtures.user.accessToken) },
    );
    const body = await res.json();
    const ids = body.data.map((p: { productMainId: string }) => p.productMainId);
    expect(ids).toEqual(['P-C']);
  });
});

describe('GET /v1/.../products — sort=totalStock', () => {
  it('orders products by Product.totalStock ascending then descending', async () => {
    const fixtures = await setupOrgWithStoreAndFixtures();
    await seedProduct(fixtures.orgId, fixtures.storeId, {
      platformContentId: 4001,
      productMainId: 'P-LOW',
      title: 'Low',
      variants: [{ platformVariantId: 4101, barcode: 'BL', stockCode: 'SL' }],
    });
    await seedProduct(fixtures.orgId, fixtures.storeId, {
      platformContentId: 4002,
      productMainId: 'P-HIGH',
      title: 'High',
      variants: [{ platformVariantId: 4102, barcode: 'BH', stockCode: 'SH' }],
    });
    await prisma.product.update({
      where: {
        platformContentId_storeId: {
          platformContentId: BigInt(4001),
          storeId: fixtures.storeId,
        } as never,
      },
      data: { totalStock: 5 },
    });
    await prisma.product.update({
      where: {
        platformContentId_storeId: {
          platformContentId: BigInt(4002),
          storeId: fixtures.storeId,
        } as never,
      },
      data: { totalStock: 50 },
    });

    const ascRes = await app.request(
      `/v1/organizations/${fixtures.orgId}/stores/${fixtures.storeId}/products?sort=totalStock`,
      { headers: bearer(fixtures.user.accessToken) },
    );
    const asc = await ascRes.json();
    expect(asc.data.map((p: { productMainId: string }) => p.productMainId)).toEqual([
      'P-LOW',
      'P-HIGH',
    ]);

    const descRes = await app.request(
      `/v1/organizations/${fixtures.orgId}/stores/${fixtures.storeId}/products?sort=-totalStock`,
      { headers: bearer(fixtures.user.accessToken) },
    );
    const desc = await descRes.json();
    expect(desc.data.map((p: { productMainId: string }) => p.productMainId)).toEqual([
      'P-HIGH',
      'P-LOW',
    ]);
  });
});
```

(If the unique constraint name on `Product.platformContentId + storeId` differs from `platformContentId_storeId`, look it up in the schema and use the correct shape.)

- [ ] **Step 2: Run the new tests to verify they fail without the implementation** (just to be safe — the implementation already lives in tasks 3.1-3.3)

Run: `pnpm --filter @pazarsync/api test:integration -t "overrideMissing"`

Expected: PASS (the implementation is there). If they don't pass, debug.

- [ ] **Step 3: Create `products-facets.routes.test.ts`**

`apps/api/tests/integration/routes/products-facets.routes.test.ts`:

```ts
import { prisma } from '@pazarsync/db';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '@/app';
import { encryptCredentials } from '@pazarsync/sync-core';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization } from '../../helpers/factories';

const app = createApp();

beforeAll(async () => {
  await ensureDbReachable();
});
beforeEach(async () => {
  await truncateAll();
});

describe('GET /v1/.../products/facets — overrideCounts', () => {
  it('returns counts of products with ≥1 variant missing cost/vat plus total', async () => {
    const user = await createAuthenticatedTestUser();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await prisma.store.create({
      data: {
        organizationId: org.id,
        name: 'Test Store',
        platform: 'TRENDYOL',
        environment: 'PRODUCTION',
        externalAccountId: '5000',
        credentials: encryptCredentials({ apiKey: 'k', apiSecret: 's', sellerId: '5000' }),
      },
    });

    // P1: one variant, no cost, no vat → contributes to both
    const p1 = await prisma.product.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        platformContentId: BigInt(5001),
        productMainId: 'P1',
        title: 'P1',
      },
    });
    await prisma.productVariant.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        productId: p1.id,
        platformVariantId: BigInt(5101),
        barcode: 'B1',
        stockCode: 'S1',
        salePrice: '10',
        listPrice: '10',
      },
    });
    // P2: one variant, cost set, vat set → contributes to total only
    const p2 = await prisma.product.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        platformContentId: BigInt(5002),
        productMainId: 'P2',
        title: 'P2',
      },
    });
    await prisma.productVariant.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        productId: p2.id,
        platformVariantId: BigInt(5102),
        barcode: 'B2',
        stockCode: 'S2',
        salePrice: '10',
        listPrice: '10',
        costPrice: '5',
        vatRate: 18,
      },
    });
    // P3: one variant, cost set, vat null → contributes to missingVat + total
    const p3 = await prisma.product.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        platformContentId: BigInt(5003),
        productMainId: 'P3',
        title: 'P3',
      },
    });
    await prisma.productVariant.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        productId: p3.id,
        platformVariantId: BigInt(5103),
        barcode: 'B3',
        stockCode: 'S3',
        salePrice: '10',
        listPrice: '10',
        costPrice: '5',
      },
    });

    const res = await app.request(
      `/v1/organizations/${org.id}/stores/${store.id}/products/facets`,
      { headers: bearer(user.accessToken) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.overrideCounts).toEqual({ missingCost: 1, missingVat: 2, total: 3 });
  });
});
```

- [ ] **Step 4: Run the facets test**

Run: `pnpm --filter @pazarsync/api test:integration -t "overrideCounts"`

Expected: PASS.

- [ ] **Step 5: Create the tenant-isolation test**

`apps/api/tests/integration/tenant-isolation/products-override.test.ts`:

```ts
import { prisma } from '@pazarsync/db';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '@/app';
import { encryptCredentials } from '@pazarsync/sync-core';

import { bearer, createAuthenticatedTestUser } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization } from '../../helpers/factories';

const app = createApp();

beforeAll(async () => {
  await ensureDbReachable();
});
beforeEach(async () => {
  await truncateAll();
});

describe('Tenant isolation: override counts and overrideMissing filter', () => {
  it("Org A's missing-cost variant does NOT surface in Org B's overrideCounts", async () => {
    // Org A — has one product with a variant missing cost
    const userA = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id);
    const storeA = await prisma.store.create({
      data: {
        organizationId: orgA.id,
        name: 'Store A',
        platform: 'TRENDYOL',
        environment: 'PRODUCTION',
        externalAccountId: '6001',
        credentials: encryptCredentials({ apiKey: 'k', apiSecret: 's', sellerId: '6001' }),
      },
    });
    const pA = await prisma.product.create({
      data: {
        organizationId: orgA.id,
        storeId: storeA.id,
        platformContentId: BigInt(6001),
        productMainId: 'PA',
        title: 'A',
      },
    });
    await prisma.productVariant.create({
      data: {
        organizationId: orgA.id,
        storeId: storeA.id,
        productId: pA.id,
        platformVariantId: BigInt(6101),
        barcode: 'BA',
        stockCode: 'SA',
        salePrice: '10',
        listPrice: '10',
      },
    });

    // Org B — empty
    const userB = await createAuthenticatedTestUser();
    const orgB = await createOrganization();
    await createMembership(orgB.id, userB.id);
    const storeB = await prisma.store.create({
      data: {
        organizationId: orgB.id,
        name: 'Store B',
        platform: 'TRENDYOL',
        environment: 'PRODUCTION',
        externalAccountId: '6002',
        credentials: encryptCredentials({ apiKey: 'k', apiSecret: 's', sellerId: '6002' }),
      },
    });

    // User B queries Store B's facets — should see zero across the board
    const res = await app.request(
      `/v1/organizations/${orgB.id}/stores/${storeB.id}/products/facets`,
      { headers: bearer(userB.accessToken) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.overrideCounts).toEqual({ missingCost: 0, missingVat: 0, total: 0 });
  });

  it("Org A's missing-cost product does NOT appear in Org B's overrideMissing=cost list", async () => {
    // Same shape: A has the data, B should see none.
    const userA = await createAuthenticatedTestUser();
    const orgA = await createOrganization();
    await createMembership(orgA.id, userA.id);
    const storeA = await prisma.store.create({
      data: {
        organizationId: orgA.id,
        name: 'Store A',
        platform: 'TRENDYOL',
        environment: 'PRODUCTION',
        externalAccountId: '7001',
        credentials: encryptCredentials({ apiKey: 'k', apiSecret: 's', sellerId: '7001' }),
      },
    });
    const pA = await prisma.product.create({
      data: {
        organizationId: orgA.id,
        storeId: storeA.id,
        platformContentId: BigInt(7001),
        productMainId: 'PA',
        title: 'A',
      },
    });
    await prisma.productVariant.create({
      data: {
        organizationId: orgA.id,
        storeId: storeA.id,
        productId: pA.id,
        platformVariantId: BigInt(7101),
        barcode: 'BA',
        stockCode: 'SA',
        salePrice: '10',
        listPrice: '10',
      },
    });

    const userB = await createAuthenticatedTestUser();
    const orgB = await createOrganization();
    await createMembership(orgB.id, userB.id);
    const storeB = await prisma.store.create({
      data: {
        organizationId: orgB.id,
        name: 'Store B',
        platform: 'TRENDYOL',
        environment: 'PRODUCTION',
        externalAccountId: '7002',
        credentials: encryptCredentials({ apiKey: 'k', apiSecret: 's', sellerId: '7002' }),
      },
    });

    const res = await app.request(
      `/v1/organizations/${orgB.id}/stores/${storeB.id}/products?overrideMissing=cost`,
      { headers: bearer(userB.accessToken) },
    );
    const body = await res.json();
    expect(body.data).toEqual([]);
  });
});
```

- [ ] **Step 6: Run the tenant-isolation tests**

Run: `pnpm --filter @pazarsync/api test:integration -t "Tenant isolation: override"`

Expected: both PASS.

- [ ] **Step 7: Commit the validator + service + tests + regenerated client**

```bash
git add apps/api/src/validators/product.validator.ts apps/api/src/services/products-list.service.ts apps/api/tests/integration/routes/products-list.routes.test.ts apps/api/tests/integration/routes/products-facets.routes.test.ts apps/api/tests/integration/tenant-isolation/products-override.test.ts packages/api-client/openapi.json
git commit -m "$(cat <<'EOF'
feat(api): products overrideMissing filter + override counts + new sorts

Adds `overrideMissing: 'cost' | 'vat'` to the products list endpoint
(filters at the variant level, composes with status via AND, response
variants[] is filtered to matching variants — same semantics as status).

Adds `overrideCounts: { missingCost, missingVat, total }` to the facets
endpoint. Computed against the unfiltered store-scoped set so the tab
strip in the redesigned UI (PR 4) reads as "you have N items in this
state" regardless of the current refinement filters.

Widens sort vocabulary with salePrice / -salePrice / totalStock /
-totalStock. salePrice currently falls back to platformModifiedAt
(documented in the OpenAPI description) until a follow-up denormalizes
Product.minSalePrice / maxSalePrice; totalStock sorts on the column
shipped in PR 0.

Tenant isolation tests added for both the filter and the counts.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 3.5: Update API changelog

**Files:**

- Modify: `docs/api-changelog.md`

- [ ] **Step 1: Add the entry**

Open `docs/api-changelog.md`. Under `[Unreleased]`, add:

```markdown
### Added

- `GET /v1/organizations/{orgId}/stores/{storeId}/products`
  - New optional query param `overrideMissing: 'cost' | 'vat'` — variant-level filter for products with at least one variant missing the corresponding override field. Composes with `status` via AND.
  - Sort vocabulary widened with `salePrice` / `-salePrice` / `totalStock` / `-totalStock`. `salePrice` currently falls back to `platformModifiedAt` (documented limitation pending `Product.minSalePrice` / `maxSalePrice` denormalization); `totalStock` sorts on the new `Product.totalStock` column.
- `GET /v1/organizations/{orgId}/stores/{storeId}/products/facets`
  - New required field `overrideCounts: { missingCost: number; missingVat: number; total: number }`. Counts are computed against the unfiltered store-scoped set.
```

- [ ] **Step 2: Commit**

```bash
git add docs/api-changelog.md
git commit -m "$(cat <<'EOF'
docs(api): changelog for products overrideMissing + counts

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 3.6: Open PR 3

- [ ] **Step 1: Pre-PR check**

Run: `pnpm check:full`

Expected: typecheck + lint + all tests + format check pass.

- [ ] **Step 2: Push and open PR**

Run: `git push -u origin feat/api-products-override-state`

```bash
gh pr create --title "feat(api): products overrideMissing filter + override counts" --body "$(cat <<'EOF'
## Summary
- New `overrideMissing: 'cost' | 'vat'` query param on the products list endpoint. Variant-level filter, AND-composes with status, response `variants[]` filtered consistently with status semantics.
- New `overrideCounts: { missingCost, missingVat, total }` on the products facets endpoint. Drives the tab badges in the upcoming UI redesign (PR 4 in this series).
- Widens sort vocabulary with `salePrice` / `-salePrice` (placeholder fallback to `platformModifiedAt` — documented limitation) and `totalStock` / `-totalStock` (uses the column from PR 0).
- Tenant-isolation tests added for both filter and counts.

Spec: `docs/superpowers/specs/2026-05-04-products-page-redesign-design.md` §5.

Depends on: #<PR-0-number>.

## Test plan
- [x] `pnpm --filter @pazarsync/api test:integration` passes (new + existing)
- [x] `pnpm --filter @pazarsync/api typecheck` passes
- [x] `pnpm api:sync` regenerates `openapi.json` cleanly; the diff shows the new properties + enum values
- [ ] CI passes

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## PR 4 — Frontend redesign

**Branch:** `feat/products-page-redesign`

**Why this PR:** Ties everything together. Replaces the bespoke `products-table` + `product-variant-table` + `products-filter-bar` + `products-pagination` with the new composition: `PageHeader → ProductsTabStrip → DataTableToolbar (controlled-search) → DataTable (getSubRows) → DataTablePagination`.

**LOC budget:** ~700 net (additions ~1100, deletes ~400).

**Depends on:** PRs 1, 2, 3 (must be on main).

### Task 4.1: Extend `useProductsFilters` with `overrideMissing` + new sorts

**Files:**

- Modify: `apps/web/src/features/products/lib/products-filter-parsers.ts`
- Modify: `apps/web/src/features/products/hooks/use-products-filters.ts`

- [ ] **Step 1: Read the current parsers + hook**

Run: `cat apps/web/src/features/products/lib/products-filter-parsers.ts apps/web/src/features/products/hooks/use-products-filters.ts`

Note the existing patterns for `parseAsStringEnum` etc.

- [ ] **Step 2: Extend the parsers**

In `products-filter-parsers.ts`, add:

```ts
export const PRODUCT_OVERRIDE_MISSING = ['cost', 'vat'] as const;
export type ProductOverrideMissing = (typeof PRODUCT_OVERRIDE_MISSING)[number];

export const PRODUCT_LIST_SORTS_EXTENDED = [
  '-platformModifiedAt',
  'platformModifiedAt',
  'title',
  '-title',
  'salePrice',
  '-salePrice',
  'totalStock',
  '-totalStock',
] as const;
export type ProductListSortExtended = (typeof PRODUCT_LIST_SORTS_EXTENDED)[number];
```

(If a `PRODUCT_LIST_SORTS` constant already exists in this file with the smaller set, replace it rather than adding a parallel constant — keep one source of truth.)

- [ ] **Step 3: Wire the new parsers into `useProductsFilters`**

In `use-products-filters.ts`, extend the `PARSERS` (or equivalent name) object:

```ts
  overrideMissing: parseAsStringEnum<ProductOverrideMissing>(PRODUCT_OVERRIDE_MISSING).withDefault(null),
  // sort: widen the existing parser to PRODUCT_LIST_SORTS_EXTENDED
  sort: parseAsStringEnum(PRODUCT_LIST_SORTS_EXTENDED).withDefault('-platformModifiedAt'),
```

The `setFilters` shape already accepts arbitrary partial updates; nothing else changes.

- [ ] **Step 4: Write a hook test**

Open `apps/web/tests/component/use-products-filters.test.tsx` (or wherever the existing hook test lives). Add:

```tsx
it('round-trips overrideMissing through the URL', () => {
  // Use the existing test pattern in the file — typically a renderHook with
  // a small wrapper that mounts the nuqs adapter. Set overrideMissing='cost',
  // assert the URL has ?overrideMissing=cost, then clear and assert absent.
});
```

(The exact assertion API depends on what the existing test in this file does. Mirror it.)

- [ ] **Step 5: Run the hook test**

Run: `pnpm --filter web test:unit -t "overrideMissing"`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/products/lib/products-filter-parsers.ts apps/web/src/features/products/hooks/use-products-filters.ts apps/web/tests/component/use-products-filters.test.tsx
git commit -m "$(cat <<'EOF'
feat(products): extend useProductsFilters with overrideMissing + new sorts

URL state now carries overrideMissing ('cost' | 'vat') and the wider
sort vocabulary from PR 3. Existing filters unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 4.2: Extend `useProducts` to forward `overrideMissing`

**Files:**

- Modify: `apps/web/src/features/products/api/list-products.api.ts`
- Modify: `apps/web/src/features/products/hooks/use-products.ts`
- Modify: `apps/web/tests/unit/hooks/use-products.test.tsx` (extend MSW assertion)

- [ ] **Step 1: Extend `ListProductsArgs` in the api file**

In `list-products.api.ts`:

```ts
export interface ListProductsArgs {
  orgId: string;
  storeId: string;
  q?: string;
  status?: 'onSale' | 'archived' | 'locked' | 'blacklisted';
  brandId?: string;
  categoryId?: string;
  overrideMissing?: 'cost' | 'vat'; // NEW
  page: number;
  perPage: number;
  sort:
    | '-platformModifiedAt'
    | 'platformModifiedAt'
    | 'title'
    | '-title'
    | 'salePrice'
    | '-salePrice' // NEW
    | 'totalStock'
    | '-totalStock'; // NEW
}
```

In the request body, forward the new param:

```ts
        query: {
          ...(query.q !== undefined && query.q.length > 0 ? { q: query.q } : {}),
          ...(query.status !== undefined ? { status: query.status } : {}),
          ...(query.brandId !== undefined && query.brandId.length > 0 ? { brandId: query.brandId } : {}),
          ...(query.categoryId !== undefined && query.categoryId.length > 0 ? { categoryId: query.categoryId } : {}),
          ...(query.overrideMissing !== undefined ? { overrideMissing: query.overrideMissing } : {}),  // NEW
          page: query.page,
          perPage: query.perPage,
          sort: query.sort,
        },
```

- [ ] **Step 2: Extend `useProducts` to accept and pass `overrideMissing`**

In `use-products.ts`, the hook signature already takes args of shape similar to `ListProductsArgs`; add `overrideMissing` through.

- [ ] **Step 3: Update the hook test**

Open `apps/web/tests/unit/hooks/use-products.test.tsx`. Find the MSW handler. Add an `it` block:

```tsx
it('forwards overrideMissing as a query param', async () => {
  let receivedQuery = '';
  server.use(
    http.get('*/v1/organizations/:orgId/stores/:storeId/products', ({ request }) => {
      receivedQuery = new URL(request.url).search;
      return HttpResponse.json({
        data: [],
        pagination: { page: 1, perPage: 25, total: 0, totalPages: 0 },
      });
    }),
  );
  const { result } = renderHook(
    () =>
      useProducts({
        orgId: 'o',
        storeId: 's',
        page: 1,
        perPage: 25,
        sort: '-platformModifiedAt',
        overrideMissing: 'cost',
      }),
    { wrapper },
  );
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(receivedQuery).toContain('overrideMissing=cost');
});
```

- [ ] **Step 4: Run the new test**

Run: `pnpm --filter web test:unit -t "forwards overrideMissing"`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/products/api/list-products.api.ts apps/web/src/features/products/hooks/use-products.ts apps/web/tests/unit/hooks/use-products.test.tsx
git commit -m "$(cat <<'EOF'
feat(products): useProducts forwards overrideMissing + supports new sorts

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 4.3: Surface `overrideCounts` in `useProductFacets`

**Files:**

- Modify: `apps/web/src/features/products/api/list-product-facets.api.ts`

- [ ] **Step 1: Re-export the new type**

The auto-generated `ProductFacetsResponse` type in `@pazarsync/api-client` already includes `overrideCounts` after PR 3 ships and `pnpm api:sync` regenerates the snapshot. Verify:

Run: `grep -A 10 "ProductFacetsResponse" packages/api-client/src/generated/api.d.ts`

Expected: the type now lists `overrideCounts`.

- [ ] **Step 2: No code change needed in the api/hook layer**

Both `list-product-facets.api.ts` and `use-product-facets.ts` re-export the `components['schemas']['ProductFacetsResponse']` type and use the typed openapi-fetch client — nothing else needed here. The new field flows automatically.

- [ ] **Step 3: Quick sanity test**

If a `use-product-facets.test.ts` exists, extend it to assert that the parsed response includes `overrideCounts`. Otherwise skip.

- [ ] **Step 4: No commit yet**

This task is a no-op if PR 3 was generated correctly. Move on.

### Task 4.4: Build `ProductsTabStrip`

**Files:**

- Create: `apps/web/src/features/products/components/products-tab-strip.tsx`
- Create: `apps/web/tests/component/products-tab-strip.test.tsx`
- Modify: `apps/web/messages/tr.json` (add `products.overrideTabs.*` keys)
- Modify: `apps/web/messages/en.json` (mirror)

- [ ] **Step 1: Add the i18n keys**

Open `apps/web/messages/tr.json`. Locate the `"products"` block. Add inside it:

```jsonc
    "overrideTabs": {
      "all":         "Tümü",
      "missingCost": "Maliyeti girilmemiş",
      "missingVat":  "KDV girilmemiş"
    },
```

Mirror in `apps/web/messages/en.json`:

```jsonc
    "overrideTabs": {
      "all":         "All",
      "missingCost": "Missing cost",
      "missingVat":  "Missing VAT rate"
    },
```

- [ ] **Step 2: Write the failing test**

`apps/web/tests/component/products-tab-strip.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';

import { ProductsTabStrip } from '@/features/products/components/products-tab-strip';

import { render, screen } from '../helpers/render';

describe('ProductsTabStrip', () => {
  it('renders 3 tabs with formatted counts', () => {
    render(
      <ProductsTabStrip
        value="all"
        counts={{ missingCost: 117, missingVat: 92, total: 118 }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole('tab', { name: /Tümü/ })).toBeInTheDocument();
    expect(screen.getByText('118')).toBeInTheDocument();
    expect(screen.getByText('117')).toBeInTheDocument();
    expect(screen.getByText('92')).toBeInTheDocument();
  });

  it('calls onChange with the right value when a tab is clicked', async () => {
    const onChange = vi.fn();
    const { user } = render(
      <ProductsTabStrip
        value="all"
        counts={{ missingCost: 117, missingVat: 92, total: 118 }}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByRole('tab', { name: /Maliyeti girilmemiş/ }));
    expect(onChange).toHaveBeenCalledWith('cost');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter web test:unit -t "ProductsTabStrip"`

Expected: FAIL — module not found.

- [ ] **Step 4: Implement the component**

`apps/web/src/features/products/components/products-tab-strip.tsx`:

```tsx
'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { FilterTabs, type FilterTabOption } from '@/components/patterns/filter-tabs';

export type ProductsOverrideTab = 'all' | 'cost' | 'vat';

interface ProductsTabStripProps {
  value: ProductsOverrideTab;
  counts?: { missingCost: number; missingVat: number; total: number };
  loading?: boolean;
  onChange: (next: ProductsOverrideTab) => void;
}

export function ProductsTabStrip({
  value,
  counts,
  loading = false,
  onChange,
}: ProductsTabStripProps): React.ReactElement {
  const t = useTranslations('products.overrideTabs');
  const options: FilterTabOption<ProductsOverrideTab>[] = [
    { value: 'all', label: t('all'), count: counts?.total },
    { value: 'cost', label: t('missingCost'), count: counts?.missingCost },
    { value: 'vat', label: t('missingVat'), count: counts?.missingVat },
  ];
  return (
    <FilterTabs<ProductsOverrideTab>
      value={value}
      onValueChange={onChange}
      options={options}
      loading={loading}
    />
  );
}
```

- [ ] **Step 5: Run the test**

Run: `pnpm --filter web test:unit -t "ProductsTabStrip"`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/products/components/products-tab-strip.tsx apps/web/tests/component/products-tab-strip.test.tsx apps/web/messages/tr.json apps/web/messages/en.json
git commit -m "$(cat <<'EOF'
feat(products): ProductsTabStrip — override-state tabs above the table

Thin wrapper over FilterTabs with the three override-state options
(Tümü, Maliyeti girilmemiş, KDV girilmemiş). Counts come from the
facets endpoint's overrideCounts (computed against the unfiltered
store set per spec §5.3).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 4.5: Build `ProductsFacetChips`

**Files:**

- Create: `apps/web/src/features/products/components/products-facet-chips.tsx`
- Create: `apps/web/tests/component/products-facet-chips.test.tsx`
- Modify: `apps/web/messages/tr.json` (add `products.facets.*` keys)
- Modify: `apps/web/messages/en.json` (mirror)

- [ ] **Step 1: Add the i18n keys**

Add to `tr.json` inside `"products"`:

```jsonc
    "facets": {
      "brand":    { "trigger": "+ Marka",    "active": "Marka: {name}",    "clear": "Temizle" },
      "category": { "trigger": "+ Kategori", "active": "Kategori: {name}", "clear": "Temizle" },
      "status":   { "trigger": "+ Durum",    "active": "Durum: {label}",   "clear": "Temizle" }
    },
```

Mirror in `en.json` with English copy.

- [ ] **Step 2: Write the failing test**

`apps/web/tests/component/products-facet-chips.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';

import { ProductsFacetChips } from '@/features/products/components/products-facet-chips';

import { render, screen } from '../helpers/render';

describe('ProductsFacetChips', () => {
  it('renders ghost chips when no facet is active', () => {
    render(
      <ProductsFacetChips
        brand=""
        category=""
        status="onSale"
        brandOptions={[{ value: 'b1', label: 'BrandOne', count: 5 }]}
        categoryOptions={[]}
        onBrandChange={() => {}}
        onCategoryChange={() => {}}
        onStatusChange={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: /\+ Marka/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /\+ Kategori/ })).toBeInTheDocument();
  });

  it("clears a facet when the active chip's ✕ is clicked", async () => {
    const onBrandChange = vi.fn();
    const { user } = render(
      <ProductsFacetChips
        brand="b1"
        category=""
        status="onSale"
        brandOptions={[{ value: 'b1', label: 'BrandOne', count: 5 }]}
        categoryOptions={[]}
        onBrandChange={onBrandChange}
        onCategoryChange={() => {}}
        onStatusChange={() => {}}
      />,
    );
    await user.click(screen.getByRole('button', { name: /Temizle Marka/i }));
    expect(onBrandChange).toHaveBeenCalledWith('');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter web test:unit -t "ProductsFacetChips"`

Expected: FAIL — module not found.

- [ ] **Step 4: Implement the component**

The implementation composes shadcn `Popover` + `Command` for the searchable lists (brand, category) and a small fixed-options popover for status.

`apps/web/src/features/products/components/products-facet-chips.tsx`:

```tsx
'use client';

import { Cancel01Icon, PlusSignIcon } from 'hugeicons-react';
import { useTranslations } from 'next-intl';
import * as React from 'react';

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import {
  PRODUCT_VARIANT_STATUSES,
  type ProductVariantStatus,
} from '../lib/products-filter-parsers';

export interface FacetOption {
  value: string;
  label: string;
  count?: number;
}

interface ProductsFacetChipsProps {
  brand: string;
  category: string;
  status: ProductVariantStatus;
  brandOptions: FacetOption[];
  categoryOptions: FacetOption[];
  onBrandChange: (next: string) => void;
  onCategoryChange: (next: string) => void;
  onStatusChange: (next: ProductVariantStatus) => void;
}

export function ProductsFacetChips({
  brand,
  category,
  status,
  brandOptions,
  categoryOptions,
  onBrandChange,
  onCategoryChange,
  onStatusChange,
}: ProductsFacetChipsProps): React.ReactElement {
  const t = useTranslations('products.facets');
  const tStatus = useTranslations('products.filters.statusOptions');

  const brandActive = brandOptions.find((o) => o.value === brand);
  const categoryActive = categoryOptions.find((o) => o.value === category);
  const statusActive = status !== 'onSale'; // 'onSale' is the implicit default

  return (
    <div className="gap-xs flex flex-wrap items-center">
      <SearchableFacetChip
        active={brandActive !== undefined}
        triggerLabel={
          brandActive !== undefined
            ? t('brand.active', { name: brandActive.label })
            : t('brand.trigger')
        }
        clearLabel={t('brand.clear') + ' Marka'}
        options={brandOptions}
        currentValue={brand}
        onSelect={onBrandChange}
        onClear={() => onBrandChange('')}
      />
      <SearchableFacetChip
        active={categoryActive !== undefined}
        triggerLabel={
          categoryActive !== undefined
            ? t('category.active', { name: categoryActive.label })
            : t('category.trigger')
        }
        clearLabel={t('category.clear') + ' Kategori'}
        options={categoryOptions}
        currentValue={category}
        onSelect={onCategoryChange}
        onClear={() => onCategoryChange('')}
      />
      <StatusChip
        active={statusActive}
        triggerLabel={
          statusActive ? t('status.active', { label: tStatus(status) }) : t('status.trigger')
        }
        clearLabel={t('status.clear') + ' Durum'}
        currentValue={status}
        onSelect={onStatusChange}
        onClear={() => onStatusChange('onSale')}
      />
    </div>
  );
}

interface SearchableFacetChipProps {
  active: boolean;
  triggerLabel: string;
  clearLabel: string;
  options: FacetOption[];
  currentValue: string;
  onSelect: (next: string) => void;
  onClear: () => void;
}

function SearchableFacetChip({
  active,
  triggerLabel,
  clearLabel,
  options,
  currentValue,
  onSelect,
  onClear,
}: SearchableFacetChipProps): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="inline-flex items-center">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant={active ? 'secondary' : 'outline'}
            size="sm"
            className={cn('gap-2xs', !active && 'text-muted-foreground')}
          >
            {!active ? <PlusSignIcon className="size-icon-xs" aria-hidden /> : null}
            {triggerLabel}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0" align="start">
          <Command>
            <CommandInput placeholder="Ara..." />
            <CommandList>
              <CommandEmpty>Sonuç yok</CommandEmpty>
              <CommandGroup>
                {options.map((opt) => (
                  <CommandItem
                    key={opt.value}
                    value={opt.label}
                    onSelect={() => {
                      onSelect(opt.value);
                      setOpen(false);
                    }}
                    aria-selected={opt.value === currentValue}
                  >
                    <span className="flex-1">{opt.label}</span>
                    {opt.count !== undefined ? (
                      <span className="text-muted-foreground text-2xs tabular-nums">
                        {opt.count}
                      </span>
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {active ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={clearLabel}
          onClick={onClear}
          className="text-muted-foreground hover:text-foreground -ml-2xs"
        >
          <Cancel01Icon className="size-icon-xs" aria-hidden />
        </Button>
      ) : null}
    </div>
  );
}

interface StatusChipProps {
  active: boolean;
  triggerLabel: string;
  clearLabel: string;
  currentValue: ProductVariantStatus;
  onSelect: (next: ProductVariantStatus) => void;
  onClear: () => void;
}

function StatusChip({
  active,
  triggerLabel,
  clearLabel,
  currentValue,
  onSelect,
  onClear,
}: StatusChipProps): React.ReactElement {
  const tStatus = useTranslations('products.filters.statusOptions');
  const [open, setOpen] = React.useState(false);
  return (
    <div className="inline-flex items-center">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant={active ? 'secondary' : 'outline'}
            size="sm"
            className={cn('gap-2xs', !active && 'text-muted-foreground')}
          >
            {!active ? <PlusSignIcon className="size-icon-xs" aria-hidden /> : null}
            {triggerLabel}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-48 p-1" align="start">
          {PRODUCT_VARIANT_STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                onSelect(s);
                setOpen(false);
              }}
              className={cn(
                'gap-xs px-sm py-xs flex w-full items-center rounded-sm text-left text-sm',
                'hover:bg-muted',
                s === currentValue && 'font-medium',
              )}
            >
              {tStatus(s)}
            </button>
          ))}
        </PopoverContent>
      </Popover>
      {active ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={clearLabel}
          onClick={onClear}
          className="text-muted-foreground hover:text-foreground -ml-2xs"
        >
          <Cancel01Icon className="size-icon-xs" aria-hidden />
        </Button>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 5: Run the test**

Run: `pnpm --filter web test:unit -t "ProductsFacetChips"`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/products/components/products-facet-chips.tsx apps/web/tests/component/products-facet-chips.test.tsx apps/web/messages/tr.json apps/web/messages/en.json
git commit -m "$(cat <<'EOF'
feat(products): ProductsFacetChips — additive filter chips for the toolbar

Three chips (Marka, Kategori, Durum) render as ghost +Filtre triggers
when inactive, fill in with the active value and a ✕ clear button when
set. Brand and category are searchable popovers (Command primitive),
status is a fixed-options popover.

Replaces the dedicated dropdowns in the legacy ProductsFilterBar.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 4.6: Extend `ProductsEmptyState` with override-tab variants

**Files:**

- Modify: `apps/web/src/features/products/components/products-empty-state.tsx`
- Modify: `apps/web/messages/tr.json` (add empty copy)
- Modify: `apps/web/messages/en.json`

- [ ] **Step 1: Add the i18n copy**

Inside `"products.empty"` in both `tr.json` and `en.json`:

```jsonc
      "missingCostNone": "Tüm ürünler için maliyet girilmiş.",
      "missingVatNone":  "Tüm ürünler için KDV oranı girilmiş."
```

(English: "All products have a cost set." / "All products have a VAT rate set.")

- [ ] **Step 2: Extend the variant union and switch**

Open `products-empty-state.tsx`. Update the variant prop type:

```tsx
interface ProductsEmptyStateProps {
  variant: 'no-store' | 'no-products' | 'filtered' | 'missing-cost-none' | 'missing-vat-none';
}
```

Add the two new branches in the if/switch:

```tsx
if (variant === 'missing-cost-none') {
  return <EmptyState title={t('empty.missingCostNone')} className="border-0" />;
}
if (variant === 'missing-vat-none') {
  return <EmptyState title={t('empty.missingVatNone')} className="border-0" />;
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/features/products/components/products-empty-state.tsx apps/web/messages/tr.json apps/web/messages/en.json
git commit -m "$(cat <<'EOF'
feat(products): ProductsEmptyState variants for missing-cost/vat tabs

Adds 'missing-cost-none' and 'missing-vat-none' variants so a tab that
returns 0 reads as "you're all set" rather than the generic empty.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 4.7: Rewrite `ProductsTable` with `DataTable` + `getSubRows`

**Files:**

- Replace contents: `apps/web/src/features/products/components/products-table.tsx`
- Delete: `apps/web/src/features/products/components/product-variant-table.tsx`
- Modify: `apps/web/messages/tr.json` (add `products.columns.properties` if not present)

This is the largest task. Take it in micro-steps.

- [ ] **Step 1: Delete the obsolete sub-table**

Run: `git rm apps/web/src/features/products/components/product-variant-table.tsx`

(Don't commit yet — wait until the new ProductsTable references are gone.)

- [ ] **Step 2: Add the missing column header i18n key**

In `apps/web/messages/tr.json` under `"products.columns"`:

```jsonc
      "properties": "Özellikler",
```

Mirror in `en.json`:

```jsonc
      "properties": "Attributes",
```

- [ ] **Step 3: Replace `products-table.tsx` with the new composition**

`apps/web/src/features/products/components/products-table.tsx`:

```tsx
'use client';

import { type ColumnDef } from '@tanstack/react-table';
import { ArrowDown01Icon, ArrowRight01Icon } from 'hugeicons-react';
import { useFormatter, useTranslations } from 'next-intl';
import * as React from 'react';

import { Currency } from '@/components/patterns/currency';
import { DataTable } from '@/components/patterns/data-table';
import { DataTablePagination } from '@/components/patterns/data-table-pagination';
import { DataTableToolbar } from '@/components/patterns/data-table-toolbar';
import { Badge } from '@/components/ui/badge';

import type { ProductWithVariants, VariantSummary } from '../api/list-products.api';
import {
  dominantDeliveryDuration,
  isMultiVariant,
  priceRange,
  summarizeStatus,
  totalStock,
  uniqueSizes,
} from '../lib/format-product';
import {
  type ProductListSortExtended,
  type ProductOverrideMissing,
  type ProductVariantStatus,
} from '../lib/products-filter-parsers';
import { type ProductFacetsResponse } from '../api/list-product-facets.api';

import { DeliveryBadge } from './delivery-badge';
import { ProductImageCell } from './product-image-cell';
import { ProductsFacetChips } from './products-facet-chips';
import { VariantStatusBadge } from './variant-status-badge';

/**
 * Discriminated union projected from the API's ProductWithVariants.
 * Parent rows render the compound product cell + aggregate cells;
 * variant rows (depth=1, returned by getSubRows) render per-SKU detail.
 */
type ProductRow =
  | { kind: 'parent'; product: ProductWithVariants }
  | { kind: 'variant'; parent: ProductWithVariants; variant: VariantSummary };

function projectRows(products: ProductWithVariants[]): ProductRow[] {
  return products.map((p) => ({ kind: 'parent', product: p }));
}

interface ProductsTableProps {
  data: ProductWithVariants[];
  loading?: boolean;
  empty?: React.ReactNode;
  pagination?: { page: number; perPage: number; total: number; totalPages: number };

  // URL-driven filter state
  q: string;
  status: ProductVariantStatus;
  brandId: string;
  categoryId: string;
  overrideMissing: ProductOverrideMissing | null;
  sort: ProductListSortExtended;

  facets?: ProductFacetsResponse;

  onSearchChange: (next: string) => void;
  onStatusChange: (next: ProductVariantStatus) => void;
  onBrandChange: (next: string) => void;
  onCategoryChange: (next: string) => void;
  onSortChange: (next: ProductListSortExtended) => void;
  onPageChange: (next: number) => void;
  onPerPageChange: (next: number) => void;
}

export function ProductsTable(props: ProductsTableProps): React.ReactElement {
  const t = useTranslations('products');
  const tCols = useTranslations('products.columns');
  const formatter = useFormatter();

  const rows = React.useMemo(() => projectRows(props.data), [props.data]);

  const columns = React.useMemo<ColumnDef<ProductRow>[]>(
    () => [
      {
        id: 'expand',
        enableSorting: false,
        cell: ({ row }) => {
          if (row.depth > 0) {
            return (
              <span aria-hidden className="text-muted-foreground">
                └
              </span>
            );
          }
          if (!row.getCanExpand()) {
            return <span aria-hidden className="size-icon-sm inline-block" />;
          }
          const expanded = row.getIsExpanded();
          return (
            <button
              type="button"
              onClick={row.getToggleExpandedHandler()}
              aria-label={expanded ? t('a11y.collapseRow') : t('a11y.expandRow')}
              aria-expanded={expanded}
              className="text-muted-foreground hover:text-foreground p-3xs duration-fast hover:bg-background focus-visible:ring-ring inline-flex items-center justify-center rounded-sm transition-colors focus-visible:ring-2 focus-visible:outline-none"
            >
              {expanded ? (
                <ArrowDown01Icon className="size-icon-sm" />
              ) : (
                <ArrowRight01Icon className="size-icon-sm" />
              )}
            </button>
          );
        },
      },
      {
        id: 'product',
        header: () => tCols('title'),
        cell: ({ row }) => {
          if (row.original.kind === 'variant') {
            const v = row.original.variant;
            return (
              <span className="text-muted-foreground font-mono text-xs">
                {v.size !== null && v.size.length > 0 ? `${v.size} · ` : ''}
                {v.stockCode}
              </span>
            );
          }
          const p = row.original.product;
          const firstImage = p.images[0];
          const subtitle = [p.brand.name, p.category.name, p.productMainId]
            .filter((s): s is string => s !== null && s.length > 0)
            .join(' · ');
          return (
            <div className="gap-sm flex items-center">
              <ProductImageCell url={firstImage?.url ?? null} alt={p.title} />
              <div className="gap-3xs flex flex-col">
                <span className="text-foreground line-clamp-1 font-medium">{p.title}</span>
                <span className="text-muted-foreground line-clamp-1 text-xs">{subtitle}</span>
              </div>
            </div>
          );
        },
      },
      {
        id: 'properties',
        header: () => tCols('properties'),
        cell: ({ row }) => {
          if (row.original.kind === 'variant') {
            const v = row.original.variant;
            const parts = [v.size, row.original.parent.color].filter(
              (s): s is string => s !== null && s.length > 0,
            );
            return parts.length > 0 ? parts.join(' · ') : '—';
          }
          const p = row.original.product;
          if (!isMultiVariant(p)) {
            const parts = [p.variants[0]?.size, p.color].filter(
              (s): s is string => s !== null && s !== undefined && s.length > 0,
            );
            return parts.length > 0 ? parts.join(' · ') : '—';
          }
          const { shown, remaining } = uniqueSizes(p.variants);
          const sizesStr =
            shown.length > 0 ? `${shown.join(', ')}${remaining > 0 ? ` +${remaining}` : ''}` : '';
          const colorCount = new Set(p.variants.map((v) => v.size).filter(Boolean)).size; // placeholder — see note
          // The "4 renk" approximation: the synced data doesn't carry per-variant
          // color reliably; use parent.color count if products were ever to be
          // multi-color (rare in current data). For now, show "{n} varyant" when
          // sizes alone don't capture the variation.
          if (sizesStr.length === 0) return `${p.variantCount} varyant`;
          return sizesStr;
        },
      },
      {
        id: 'barcode',
        header: () => tCols('barcode'),
        cell: ({ row }) => {
          if (row.original.kind === 'variant') {
            return <span className="font-mono text-xs">{row.original.variant.barcode}</span>;
          }
          const p = row.original.product;
          if (isMultiVariant(p)) {
            return <span className="text-muted-foreground text-xs">{p.variantCount} varyant</span>;
          }
          return <span className="font-mono text-xs">{p.variants[0]?.barcode ?? '—'}</span>;
        },
      },
      {
        id: 'salePrice',
        header: () => tCols('salePrice'),
        meta: { numeric: true },
        enableSorting: true,
        cell: ({ row }) => {
          if (row.original.kind === 'variant') {
            return <Currency value={row.original.variant.salePrice} />;
          }
          const range = priceRange(row.original.product.variants);
          if (range === null) return '—';
          if (range.isSingle) {
            return <Currency value={range.min} />;
          }
          return (
            <span className="tabular-nums">
              {formatter.number(Number.parseFloat(range.min), 'currency')}
              {' – '}
              {formatter.number(Number.parseFloat(range.max), 'currency')}
            </span>
          );
        },
      },
      {
        id: 'totalStock',
        header: () => tCols('stock'),
        meta: { numeric: true },
        enableSorting: true,
        cell: ({ row }) => {
          const v =
            row.original.kind === 'variant'
              ? row.original.variant.quantity
              : totalStock(row.original.product.variants);
          return <span className="tabular-nums">{v}</span>;
        },
      },
      {
        id: 'delivery',
        header: () => tCols('delivery'),
        cell: ({ row }) => {
          if (row.original.kind === 'variant') {
            const v = row.original.variant;
            return <DeliveryBadge durationDays={v.deliveryDuration} isRush={v.isRushDelivery} />;
          }
          const { value, mixed } = dominantDeliveryDuration(row.original.product.variants);
          const v0 = row.original.product.variants[0];
          return (
            <DeliveryBadge
              durationDays={value}
              isRush={v0?.isRushDelivery ?? false}
              mixed={mixed}
            />
          );
        },
      },
      {
        id: 'status',
        header: () => tCols('status'),
        cell: ({ row }) => {
          if (row.original.kind === 'variant') {
            return <VariantStatusBadge status={row.original.variant.status} />;
          }
          const summary = summarizeStatus(row.original.product.variants);
          if (summary === null) return '—';
          const others = Object.entries(summary.counts)
            .filter(([k]) => k !== summary.dominant)
            .reduce((s, [, n]) => s + (n ?? 0), 0);
          return <VariantStatusBadge status={summary.dominant} overflowCount={others} />;
        },
      },
    ],
    [formatter, t, tCols],
  );

  // Map the URL sort string back into TanStack's SortingState shape, and
  // back the other way when the user clicks a header.
  const sortingState = sortToTanstack(props.sort);

  return (
    <DataTable<ProductRow, unknown>
      columns={columns}
      data={rows}
      loading={props.loading}
      empty={props.empty}
      getRowId={(row) => (row.kind === 'parent' ? row.product.id : row.variant.id)}
      getRowCanExpand={(row) => row.kind === 'parent' && isMultiVariant(row.product)}
      getSubRows={(row) => {
        if (row.kind !== 'parent' || !isMultiVariant(row.product)) return undefined;
        return row.product.variants.map((v) => ({
          kind: 'variant',
          parent: row.product,
          variant: v,
        }));
      }}
      sorting={sortingState}
      onSortingChange={(updater) => {
        const next = typeof updater === 'function' ? updater(sortingState) : updater;
        props.onSortChange(tanstackToSort(next));
      }}
      paginationState={{
        pageIndex: (props.pagination?.page ?? 1) - 1,
        pageSize: props.pagination?.perPage ?? 25,
      }}
      onPaginationChange={(updater) => {
        const current = {
          pageIndex: (props.pagination?.page ?? 1) - 1,
          pageSize: props.pagination?.perPage ?? 25,
        };
        const next = typeof updater === 'function' ? updater(current) : updater;
        if (next.pageSize !== current.pageSize) {
          props.onPerPageChange(next.pageSize);
        } else if (next.pageIndex !== current.pageIndex) {
          props.onPageChange(next.pageIndex + 1);
        }
      }}
      pageCount={props.pagination?.totalPages ?? 0}
      rowCount={props.pagination?.total ?? 0}
      toolbar={(table) => (
        <DataTableToolbar
          table={table}
          searchValue={props.q}
          onSearchChange={props.onSearchChange}
          searchPlaceholder={t('filters.searchPlaceholder')}
          facets={
            <ProductsFacetChips
              brand={props.brandId}
              category={props.categoryId}
              status={props.status}
              brandOptions={(props.facets?.brands ?? []).map((b) => ({
                value: b.id,
                label: b.name,
                count: b.count,
              }))}
              categoryOptions={(props.facets?.categories ?? []).map((c) => ({
                value: c.id,
                label: c.name,
                count: c.count,
              }))}
              onBrandChange={props.onBrandChange}
              onCategoryChange={props.onCategoryChange}
              onStatusChange={props.onStatusChange}
            />
          }
        />
      )}
      pagination={(table) => <DataTablePagination table={table} />}
    />
  );
}

// ─── sort marshalling ───
import { type SortingState } from '@tanstack/react-table';

function sortToTanstack(sort: ProductListSortExtended): SortingState {
  const desc = sort.startsWith('-');
  const id = desc ? sort.slice(1) : sort;
  return [{ id, desc }];
}

function tanstackToSort(state: SortingState): ProductListSortExtended {
  const head = state[0];
  if (head === undefined) return '-platformModifiedAt';
  return (head.desc ? `-${head.id}` : head.id) as ProductListSortExtended;
}
```

(If the `Currency` pattern's `value` prop accepts a `string` as well as `Decimal`, keep these calls as written. If it only takes `Decimal`, wrap with `new Decimal(...)`. Read `apps/web/src/components/patterns/currency.tsx` first to confirm.)

- [ ] **Step 4: Run typecheck**

Run: `pnpm --filter web typecheck`

Expected: clean. Fix any issues that surface — likely candidates: `Currency` prop shape, `DataTable`'s exact prop names if they differ from spec, missing exports.

- [ ] **Step 5: Write a smoke component test**

Open or create `apps/web/tests/component/products-table.test.tsx` (the file exists from before). Replace its body with the new contract:

```tsx
import { describe, expect, it, vi } from 'vitest';
import * as React from 'react';

import { ProductsTable } from '@/features/products/components/products-table';

import { render, screen } from '../helpers/render';

const noop = () => {};

const baseProps = {
  loading: false,
  pagination: { page: 1, perPage: 25, total: 1, totalPages: 1 },
  q: '',
  status: 'onSale' as const,
  brandId: '',
  categoryId: '',
  overrideMissing: null,
  sort: '-platformModifiedAt' as const,
  facets: undefined,
  onSearchChange: noop,
  onStatusChange: noop,
  onBrandChange: noop,
  onCategoryChange: noop,
  onSortChange: noop,
  onPageChange: noop,
  onPerPageChange: noop,
};

const SINGLE_VARIANT_PRODUCT = {
  id: 'p1',
  productMainId: 'PMI-1',
  platformContentId: '100001',
  title: 'Single Variant Title',
  description: null,
  brand: { id: 'b1', name: 'BrandX' },
  category: { id: 'c1', name: 'CatX' },
  color: 'Beyaz',
  images: [],
  variantCount: 1,
  variants: [
    {
      id: 'v1',
      platformVariantId: '200001',
      barcode: 'B1',
      stockCode: 'S1',
      size: 'M',
      salePrice: '100.00',
      listPrice: '120.00',
      vatRate: null,
      costPrice: null,
      quantity: 5,
      deliveryDuration: 2,
      isRushDelivery: false,
      fastDeliveryOptions: [],
      productUrl: null,
      locationBasedDelivery: null,
      status: 'onSale' as const,
    },
  ],
  lastSyncedAt: '2026-04-01T00:00:00.000Z',
  platformModifiedAt: null,
};

const MULTI_VARIANT_PRODUCT = {
  ...SINGLE_VARIANT_PRODUCT,
  id: 'p2',
  title: 'Multi Variant Title',
  variantCount: 2,
  variants: [
    { ...SINGLE_VARIANT_PRODUCT.variants[0], id: 'v2a', stockCode: 'S2a', size: 'S' },
    { ...SINGLE_VARIANT_PRODUCT.variants[0], id: 'v2b', stockCode: 'S2b', size: 'L' },
  ],
};

describe('ProductsTable', () => {
  it('renders single-variant products flat (no chevron, lone variant data inline)', () => {
    render(<ProductsTable {...baseProps} data={[SINGLE_VARIANT_PRODUCT]} />);
    expect(screen.getByText('Single Variant Title')).toBeInTheDocument();
    // No chevron button on a single-variant row
    expect(screen.queryByRole('button', { name: /aç/i })).toBeNull();
  });

  it('renders multi-variant parent with chevron; clicking expands variant rows', async () => {
    const { user } = render(<ProductsTable {...baseProps} data={[MULTI_VARIANT_PRODUCT]} />);
    const chevron = screen.getByRole('button', { name: /aç/i });
    await user.click(chevron);
    // Two variant rows now visible — assert by stock codes
    expect(screen.getByText(/S2a/)).toBeInTheDocument();
    expect(screen.getByText(/S2b/)).toBeInTheDocument();
    // Variant rows carry data-depth='1' (DataTable contract)
    const variantRow = screen.getByText(/S2a/).closest('tr');
    expect(variantRow?.getAttribute('data-depth')).toBe('1');
  });
});
```

- [ ] **Step 6: Run the test**

Run: `pnpm --filter web test:unit -t "ProductsTable"`

Expected: PASS. If the chevron `aria-label` regex `/aç/i` doesn't match what you used, adjust.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/products/components/products-table.tsx apps/web/tests/component/products-table.test.tsx apps/web/messages/tr.json apps/web/messages/en.json
git rm --cached apps/web/src/features/products/components/product-variant-table.tsx 2>/dev/null || true
git commit -m "$(cat <<'EOF'
feat(products): rewrite ProductsTable on shared DataTable + getSubRows

Replaces the bespoke TanStack-direct table + nested variant sub-table
with the canonical DataTable composition. Variant rows render as
sibling sub-rows in the parent grid (column widths align), with the
tree connector + muted bg treatment from the data-table-subrows
showcase.

8-column hierarchical layout: expand · Ürün bilgisi (compound:
image + title + brand·category·model code subtitle) · Özellikler ·
Barkod · Satış fiyatı · Stok · Teslimat · Durum.

Toolbar uses DataTableToolbar's controlled-search mode (PR 2 in this
series) and ProductsFacetChips in the facets slot. Pagination uses
the canonical DataTablePagination.

product-variant-table.tsx deleted — superseded by the sub-row
rendering inside the new ProductsTable.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 4.8: Wire the new composition into `ProductsPageClient`

**Files:**

- Modify: `apps/web/src/features/products/components/products-page-client.tsx`
- Delete: `apps/web/src/features/products/components/products-filter-bar.tsx`
- Delete: `apps/web/src/features/products/components/products-pagination.tsx`
- Delete: `apps/web/src/features/products/components/facet-select.tsx`

- [ ] **Step 1: Replace `products-page-client.tsx`**

```tsx
'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { PageHeader } from '@/components/patterns/page-header';
import { SyncBadge, type SyncState } from '@/components/patterns/sync-badge';
import { SyncCenter, type SyncCenterLog } from '@/components/patterns/sync-center';
import type { SyncLog } from '@/features/sync/api/list-org-sync-logs.api';
import { useStoreSyncs } from '@/features/sync/hooks/use-store-syncs';

import { useProductFacets } from '../hooks/use-product-facets';
import { useProducts } from '../hooks/use-products';
import { useProductsFilters } from '../hooks/use-products-filters';
import { useStartProductSync } from '../hooks/use-start-product-sync';

import { ProductsEmptyState } from './products-empty-state';
import { ProductsTable } from './products-table';
import { ProductsTabStrip, type ProductsOverrideTab } from './products-tab-strip';

interface ProductsPageClientProps {
  orgId: string | null;
  storeId: string | null;
  pageTitle: string;
  pageIntent: string;
}

export function ProductsPageClient({
  orgId,
  storeId,
  pageTitle,
  pageIntent,
}: ProductsPageClientProps): React.ReactElement {
  const tSync = useTranslations('syncCenter');
  const { filters, setFilters } = useProductsFilters();
  const [syncCenterOpen, setSyncCenterOpen] = React.useState(false);

  const noStoreSelected = orgId === null || storeId === null;

  const productsQuery = useProducts(
    noStoreSelected
      ? null
      : {
          orgId,
          storeId,
          q: filters.q.length > 0 ? filters.q : undefined,
          status: filters.status,
          brandId: filters.brandId.length > 0 ? filters.brandId : undefined,
          categoryId: filters.categoryId.length > 0 ? filters.categoryId : undefined,
          overrideMissing: filters.overrideMissing ?? undefined,
          page: filters.page,
          perPage: filters.perPage,
          sort: filters.sort,
        },
  );
  const facetsQuery = useProductFacets(orgId, storeId);
  const { activeSyncs, recentSyncs } = useStoreSyncs(storeId);
  const startSync = useStartProductSync(orgId, storeId);

  if (noStoreSelected) {
    return (
      <>
        <PageHeader title={pageTitle} intent={pageIntent} />
        <ProductsEmptyState variant="no-store" />
      </>
    );
  }

  const data = productsQuery.data?.data ?? [];
  const pagination = productsQuery.data?.pagination ?? {
    page: filters.page,
    perPage: filters.perPage,
    total: 0,
    totalPages: 0,
  };

  const isInitialLoad = productsQuery.isLoading;
  const isEmptyAfterLoad = !isInitialLoad && data.length === 0;
  const hasActiveSearchOrFilter =
    filters.q.length > 0 ||
    filters.status !== 'onSale' ||
    filters.brandId.length > 0 ||
    filters.categoryId.length > 0;

  const productSyncSnapshot = derivedSyncSnapshot(activeSyncs, recentSyncs);
  const syncCenterLogs = toSyncCenterLogs(activeSyncs, recentSyncs);

  const tabValue: ProductsOverrideTab = filters.overrideMissing ?? 'all';
  const emptyVariant = (() => {
    if (!isEmptyAfterLoad) return undefined;
    if (filters.overrideMissing === 'cost') return 'missing-cost-none' as const;
    if (filters.overrideMissing === 'vat') return 'missing-vat-none' as const;
    if (hasActiveSearchOrFilter) return 'filtered' as const;
    return 'no-products' as const;
  })();

  return (
    <>
      <div className="gap-lg flex flex-col">
        <PageHeader
          title={pageTitle}
          intent={pageIntent}
          meta={
            <SyncBadge
              state={productSyncSnapshot.state}
              lastSyncedAt={productSyncSnapshot.lastSyncedAt}
              progress={productSyncSnapshot.progress}
              activeCount={activeSyncs.length}
              source="Trendyol"
              onClick={() => setSyncCenterOpen(true)}
              ariaLabel={tSync('openLabel')}
            />
          }
        />

        <ProductsTabStrip
          value={tabValue}
          counts={facetsQuery.data?.overrideCounts}
          loading={facetsQuery.isLoading}
          onChange={(next) =>
            void setFilters({
              overrideMissing: next === 'all' ? null : next,
              page: 1,
            })
          }
        />

        <ProductsTable
          data={data}
          loading={isInitialLoad}
          empty={
            emptyVariant !== undefined ? <ProductsEmptyState variant={emptyVariant} /> : undefined
          }
          pagination={pagination}
          q={filters.q}
          status={filters.status}
          brandId={filters.brandId}
          categoryId={filters.categoryId}
          overrideMissing={filters.overrideMissing}
          sort={filters.sort}
          facets={facetsQuery.data}
          onSearchChange={(next) => void setFilters({ q: next, page: 1 })}
          onStatusChange={(next) => void setFilters({ status: next, page: 1 })}
          onBrandChange={(next) => void setFilters({ brandId: next, page: 1 })}
          onCategoryChange={(next) => void setFilters({ categoryId: next, page: 1 })}
          onSortChange={(next) => void setFilters({ sort: next })}
          onPageChange={(next) => void setFilters({ page: next })}
          onPerPageChange={(next) => void setFilters({ perPage: next, page: 1 })}
        />
      </div>

      <SyncCenter
        open={syncCenterOpen}
        onOpenChange={setSyncCenterOpen}
        logs={syncCenterLogs}
        triggers={[
          {
            syncType: 'PRODUCTS',
            onClick: () => {
              startSync.mutate();
            },
            isPending: startSync.isPending,
          },
        ]}
      />
    </>
  );
}

interface SyncSnapshot {
  state: SyncState;
  lastSyncedAt: Date | string | null;
  progress?: { current: number; total: number | null };
}

function derivedSyncSnapshot(activeSyncs: SyncLog[], recentSyncs: SyncLog[]): SyncSnapshot {
  const active = activeSyncs.find((l) => l.syncType === 'PRODUCTS');
  if (active !== undefined) {
    return {
      state: active.status === 'FAILED_RETRYABLE' ? 'retrying' : 'syncing',
      lastSyncedAt: active.startedAt,
      progress: { current: active.progressCurrent, total: active.progressTotal },
    };
  }
  const recent = recentSyncs.find((l) => l.syncType === 'PRODUCTS');
  if (recent === undefined) return { state: 'fresh', lastSyncedAt: null };
  if (recent.status === 'FAILED')
    return { state: 'failed', lastSyncedAt: recent.completedAt ?? recent.startedAt };
  return { state: 'fresh', lastSyncedAt: recent.completedAt ?? recent.startedAt };
}

function toSyncCenterLogs(activeSyncs: SyncLog[], recentSyncs: SyncLog[]): SyncCenterLog[] {
  return [...activeSyncs, ...recentSyncs].map((log) => ({
    id: log.id,
    storeId: log.storeId,
    syncType: log.syncType,
    status: log.status,
    startedAt: log.startedAt,
    completedAt: log.completedAt,
    recordsProcessed: log.recordsProcessed,
    progressCurrent: log.progressCurrent,
    progressTotal: log.progressTotal,
    errorCode: log.errorCode,
    errorMessage: log.errorMessage,
    attemptCount: log.attemptCount,
    nextAttemptAt: log.nextAttemptAt,
    skippedPages: log.skippedPages,
  }));
}
```

- [ ] **Step 2: Delete the obsolete components**

Run:

```bash
git rm apps/web/src/features/products/components/products-filter-bar.tsx
git rm apps/web/src/features/products/components/products-pagination.tsx
git rm apps/web/src/features/products/components/facet-select.tsx
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter web typecheck`

Expected: clean.

- [ ] **Step 4: Lint**

Run: `pnpm --filter web lint`

Expected: clean. Fix any unused imports / unused variables surfaced by the deletions.

- [ ] **Step 5: Manual smoke**

Run: `pnpm dev --filter web --filter api`

Open `/products`. Check the spec §7.3 manual smoke checklist:

- Tab counts populate correctly.
- Switching tabs filters; URL updates with `?overrideMissing=cost` etc.
- Search debounces ~300ms (note: PR 2 toolbar doesn't debounce — debounce here at the page-client layer if needed; otherwise calls fire on every keystroke. The current spec assumes server can handle keystroke-rate. If lag is noticeable, add a 300ms debounce in `onSearchChange` before calling `setFilters`.)
- Brand / Category / Status facet chips toggle correctly.
- Multi-variant chevron expands → variant rows align with parent grid.
- Single-variant rows have no chevron, render lone variant inline.
- Sort by Fiyat / Stok works (and persists across refresh via URL).
- Pagination respects per-page.
- Empty states render correctly when filters return 0 (try `?overrideMissing=cost` on a store where every variant has a cost — should show "Tüm ürünler için maliyet girilmiş ✓").
- Trigger a sync from SyncCenter → confirm tab counts refresh after completion.
- Switch to dark mode → confirm variant rows tint reads correctly.

If any check fails, fix it before committing.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/products/components/products-page-client.tsx
git commit -m "$(cat <<'EOF'
feat(products): rewire ProductsPageClient onto the new composition

PageHeader (with SyncBadge in meta, not actions) → ProductsTabStrip
→ ProductsTable (with DataTableToolbar + DataTablePagination embedded).

Tab-aware empty-state variant selection: missing-cost tab + 0 results
shows "Tüm ürünler için maliyet girilmiş", missing-vat similar, all
other tabs use the existing filtered/no-products/no-store variants.

Deletes products-filter-bar, products-pagination, and facet-select —
all superseded by the canonical DataTableToolbar/DataTablePagination
patterns + ProductsFacetChips.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 4.9: Open PR 4

- [ ] **Step 1: Pre-PR check**

Run: `pnpm check:full`

Expected: typecheck + lint + all tests + format check pass.

- [ ] **Step 2: Push and open PR**

Run: `git push -u origin feat/products-page-redesign`

```bash
gh pr create --title "feat(products): redesigned table with FilterTabs + DataTableToolbar" --body "$(cat <<'EOF'
## Summary
- Migrates the products feature off its bespoke TanStack-direct table onto the shared `DataTable` (`getSubRows` mode from PR 1) — variant rows render as siblings of the parent in the same grid (column widths align).
- New 8-column hierarchical composition: expand · Ürün bilgisi (compound: image + title + brand·category·model code subtitle) · Özellikler · Barkod · Satış fiyatı · Stok · Teslimat · Durum.
- New `ProductsTabStrip` (Tümü · Maliyeti girilmemiş · KDV girilmemiş) above the toolbar, using `FilterTabs`. Counts come from PR 3's `overrideCounts`.
- Migrates the filter bar to the canonical `DataTableToolbar` (controlled-search mode from PR 2) with new `ProductsFacetChips` in the facets slot — multi-select-style additive chips for brand / category / status.
- Migrates pagination to the canonical `DataTablePagination`.
- `SyncBadge` moves from PageHeader's `actions` to `meta` slot per the pattern's documented placement.
- Tab-aware empty states: "Tüm ürünler için maliyet girilmiş ✓" when the missing-cost tab returns 0.
- Deletes: `products-table.tsx` (rewritten), `product-variant-table.tsx`, `products-filter-bar.tsx`, `products-pagination.tsx`, `facet-select.tsx`.

Spec: `docs/superpowers/specs/2026-05-04-products-page-redesign-design.md`.

Depends on: PRs 1, 2, 3 in this series.

## Test plan
- [x] `pnpm --filter web test:unit` passes (new ProductsTabStrip, ProductsFacetChips, rewritten ProductsTable tests + existing)
- [x] `pnpm --filter web typecheck` clean
- [x] `pnpm --filter web lint` clean
- [x] Manual smoke (spec §7.3) — tab counts, search, facet toggle, expand/collapse, sort, pagination, dark mode
- [ ] CI passes

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review Checklist (run after merging PR 4)

- [ ] Open `/products` in production (or staging). Confirm the visual redesign matches the spec mockups.
- [ ] Tab counts equal `total products with ≥1 missing-cost variant` (verify with a SQL query if discrepancy is suspected).
- [ ] Variant rows align with parent columns at all viewport widths above 1280px.
- [ ] Toggle dark mode — variant tint reads correctly with the inset-highlight token; no muddy alpha.
- [ ] Sync once from SyncCenter — tab counts refresh after completion.

If any check fails, file a follow-up issue with the spec link and the failure mode.

---

## Out of scope reminders (per spec §9)

If a reviewer asks for any of these, point them at this list — they're explicitly deferred.

- Inline cost / desi / KDV editing (Option C scope).
- "Desisi girilmemiş" tab (no `desi` column exists yet).
- Bulk actions / row selection.
- Excel import / export.
- Sticky / pinned columns.
- New schema / RLS policies (we're using existing nullable columns).
- Hepsiburada parity (Trendyol-only until Hepsiburada sync ships).

---

## Spec coverage check (run before merging PR 4)

Run through spec §2 Goals one by one and tick each:

- [x] Replace bespoke `products-table.tsx` + `product-variant-table.tsx` → done in 4.7
- [x] Compound product cell (image + title + brand · category · model code subtitle) → 4.7 column def
- [x] 8 columns: expand · Ürün bilgisi · Özellikler · Barkod · Satış fiyatı · Stok · Teslimat · Durum → 4.7
- [x] Override-state tab strip with server-computed counts → 4.4 + 3.3
- [x] Migrate to canonical DataTableToolbar with multi-select facet popovers → 4.5 + 4.7
- [x] Move SyncBadge from `actions` to `meta` slot → 4.8
- [x] Add `salePrice` and `totalStock` to sortable columns → 3.1, with documented salePrice limitation
- [x] Variant rows visually identifiable via indent + tree connector + `bg-muted` tint → 1.1, 1.2, 4.7
- [x] Single-variant products render flat (no chevron, no extra label) → 4.7 expand cell branch
- [x] Per-tab "all caught up" empty states → 4.6 + 4.8 emptyVariant logic

Backend (spec §5):

- [x] `overrideMissing` query param → 3.1
- [x] `overrideCounts` on facets → 3.3
- [x] `salePrice` / `totalStock` sort keys → 3.1, 3.2 (salePrice is fallback-documented)
- [x] Tenant-isolation tests for new filter + counts → 3.4

Front-end (spec §6):

- [x] Page composition stack → 4.8
- [x] Column composition + variant alignment → 4.7
- [x] DataTable getSubRows enhancement → PR 1
- [x] DataTableToolbar controlled-search enhancement → PR 2
- [x] ProductsTabStrip → 4.4
- [x] ProductsFacetChips → 4.5
- [x] useProductsFilters extension → 4.1
- [x] i18n keys → 4.4, 4.5, 4.6, 4.7

If any goal is missing, add a task before merging PR 4.
