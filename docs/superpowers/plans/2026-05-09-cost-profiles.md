# Cost Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the cost-profiles feature — reusable typed cost objects (purchase / packaging / software / etc.), org-scoped and edit-history-tracked, attachable many-to-many to product variants, snapshotted write-once into order lines on marketplace sync, with multi-currency (TRY/USD/EUR) support that captures FX rates frozen into snapshots.

**Architecture:** 11 small additive PRs in dependency order. **PRs 1–3** lay the schema, RLS, and CRUD/attachment backend. **PR 4** is the FX cron Edge Function. **PR 5** wires the snapshot capture into the existing sync worker. **PR 6** extends the products list response and ships the missing-cost-stats endpoint. **PRs 7–8** build the Costs page and profile detail (frontend). **PR 9** adds the products-table cost cell + popover. **PR 10** ships the bulk FAB + parent-row aggregate. **PR 11** wraps with the missing-cost banner + dashboard widget. The strict immutability rule from the spec (§5.7) is enforced at three layers — app, DB trigger, RLS — and is the single most important invariant in this plan.

**Tech Stack:** Prisma 7 (`prisma-client` generator + `@prisma/adapter-pg`) on Supabase Postgres 15 · Hono 4 + `@hono/zod-openapi` 1 · Zod 4 · React 19 + Next.js 16 (App Router) + TanStack Table v8 · shadcn-ui + Tailwind v4 + Hugeicons · Vitest 4 + RTL + MSW v2 + happy-dom · Decimal.js end-to-end · Supabase Edge Functions + pg_cron

**Spec:** `docs/superpowers/specs/2026-05-09-cost-profiles-design.md` — read this first.

---

## Pre-flight (read before starting)

The plan assumes you've read these once and understand project conventions. Not repeated per-task.

| Document             | Why                                                                                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `CLAUDE.md` (root)   | TypeScript discipline, no magic values, no `any`, exhaustive switch with `never` guard, kebab-case files, no utility duplication, Decimal.js for money |
| `apps/api/CLAUDE.md` | Domain error vocabulary, `mapPrismaError`, RFC 7807, `pnpm api:sync` after Zod changes, OpenAPI per-route                                              |
| `apps/web/CLAUDE.md` | UI cascade (patterns → ui → shadcn registry → custom), Tailwind v4 token namespaces, React Query factory keys, error toast pipeline                    |
| `docs/SECURITY.md`   | Multi-tenancy invariants — every query MUST filter by `organization_id`                                                                                |
| `docs/TESTING.md`    | Hybrid strategy — TDD for pure logic, test-with-code for routes, MSW v2 + happy-dom for frontend                                                       |
| Spec §2              | The 6 confirmed product decisions that shape this plan                                                                                                 |
| Spec §5.7            | Write-once enforcement — the spec invariant we never break                                                                                             |
| Spec §10             | The 11-PR split + dependency graph                                                                                                                     |

**Branching convention:** `feat/cost-profiles-<short-name>` for each PR, branched from `main`. Never push directly to `main`; always open a PR.

**TDD rhythm for every code-producing task:** write failing test → run it → see it fail with the expected error → write minimal implementation → run it → see it pass → commit. Don't batch tests.

**Commit cadence:** every task ends with a commit. One task = one commit. Reviewers read commits sequentially.

**Test commands:**

- `pnpm --filter <pkg> test:unit` — fast, no DB
- `pnpm --filter <pkg> test:integration` — needs `supabase start && pnpm db:push`
- `pnpm typecheck` (root) — type-checks every package
- `pnpm check:all` — typecheck + lint + unit tests + format check (pre-commit gate)
- `pnpm check:full` — same + integration tests (pre-PR gate)
- `pnpm api:sync` — regenerates `@pazarsync/api-client` from backend Zod schemas (run after EVERY Zod schema change)

**Ask the user before any `git commit`** per project memory `feedback_ask_before_commit`. Each task's "Commit" step is a _prompt_, not an automatic action. Format: stage the files, show the proposed commit message, and pause until the user approves.

---

# PR 1 — Schema, RLS, write-once trigger

**Branch:** `feat/cost-profiles-schema`

**Why this PR:** Lay the foundational data model. Without this, no other PR can begin. RLS policies + write-once trigger ship in the same migration so security invariants are enforced from day one — not bolted on later.

**LOC budget:** ~600 lines (Prisma schema additions + migration SQL + RLS policies + trigger + 2 integration tests).

## Task 1.1: Add the 5 new models + 3 enums to the Prisma schema

**Files:**

- Modify: `packages/db/prisma/schema.prisma` (add `CostProfile`, `CostProfileVersion`, `ProductVariantCostProfile`, `OrderItemCostSnapshotComponent`, `FxRate` models + `CostProfileType`, `Currency`, `FxRateMode` enums; modify `Organization`, `OrderItem`, `ProductVariant`)

- [ ] **Step 1: Add the 3 enums near the top of the schema, alongside existing enums**

```prisma
enum CostProfileType {
  COGS
  PACKAGING
  SHIPPING
  SOFTWARE
  MARKETING
  OTHER
}

enum Currency {
  TRY
  USD
  EUR
}

enum FxRateMode {
  AUTO
  MANUAL
}
```

- [ ] **Step 2: Add the 5 models after the existing `Settlement*` block**

Refer to spec §4.1–§4.5 for the exact model bodies. Copy verbatim — including `@@index`, `@@unique`, and `@@map` directives.

- [ ] **Step 3: Modify `Organization` to add the back-relation**

Find the `Organization` model and add inside the `// relations` section:

```prisma
costProfiles CostProfile[]
```

- [ ] **Step 4: Modify `OrderItem` to add snapshot fields + components relation + organizationId**

```prisma
// inside OrderItem model, alongside existing fields:
organizationId         String?   @map("organization_id") @db.Uuid
unitCostSnapshot       Decimal?  @map("unit_cost_snapshot") @db.Decimal(12, 2)
snapshotCapturedAt     DateTime? @map("snapshot_captured_at")
costSnapshotComponents OrderItemCostSnapshotComponent[]

// add to existing @@index list:
@@index([organizationId, snapshotCapturedAt])
```

- [ ] **Step 5: Modify `ProductVariant` to add the link back-relation**

```prisma
// inside ProductVariant model:
costProfileLinks ProductVariantCostProfile[]
```

- [ ] **Step 6: Generate the Prisma client to validate schema**

Run: `pnpm --filter @pazarsync/db db:generate`
Expected: green output ending in "Generated Prisma Client". If it fails, the most likely cause is a missing back-relation declaration.

- [ ] **Step 7: Commit**

```bash
git add packages/db/prisma/schema.prisma
git commit -m "feat(db): cost-profile models + enums + relations"
```

## Task 1.2: Create the migration with backfill for `OrderItem.organizationId`

**Files:**

- Create: `packages/db/prisma/migrations/<timestamp>_cost_profiles/migration.sql`

- [ ] **Step 1: Generate the migration**

Run: `pnpm --filter @pazarsync/db db:migrate -- --name cost_profiles --create-only`
Expected: a new directory under `prisma/migrations/` with `migration.sql` containing the CREATE TABLE statements.

- [ ] **Step 2: Inspect and append the backfill for `order_items.organization_id`**

Open the generated `migration.sql` and append at the end (Prisma won't generate this; the column starts nullable and we backfill before relying on it):

```sql
-- Backfill order_items.organization_id from parent orders
UPDATE order_items oi
SET organization_id = o.organization_id
FROM orders o
WHERE oi.order_id = o.id AND oi.organization_id IS NULL;

-- Index already created by Prisma — but verify it exists
```

- [ ] **Step 3: Apply the migration**

Run: `supabase start && pnpm --filter @pazarsync/db db:migrate`
Expected: migration applies cleanly. If `supabase` was already running, `db:migrate` will use the existing instance.

- [ ] **Step 4: Verify with Prisma Studio**

Run: `pnpm --filter @pazarsync/db db:studio`
Expected: 5 new tables visible (`cost_profiles`, `cost_profile_versions`, `product_variant_cost_profiles`, `order_item_cost_snapshot_components`, `fx_rates`), and `order_items.organization_id` is populated for any existing rows.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/migrations/
git commit -m "feat(db): migration for cost-profile tables + order_items.organizationId backfill"
```

## Task 1.3: Write the RLS policies SQL file

**Files:**

- Create: `supabase/sql/cost-profiles-rls.sql`

- [ ] **Step 1: Write the file from spec §8.2 verbatim**

Copy the full SQL block from spec §8.2 into `supabase/sql/cost-profiles-rls.sql`. Keep the section comments; they're load-bearing for code review.

**Important:** verify the actual name of the auth helper function before applying. Run:

```bash
grep -rn "FUNCTION auth\." supabase/sql/ | head -10
```

If the existing pattern uses something other than `auth.org_id()` (e.g., `auth.jwt_org_id()` or `current_org_id()`), do a global rename in your new file before saving. Spec §11 issue #8 flags this.

- [ ] **Step 2: Apply via Supabase SQL**

Run: `psql "$DATABASE_URL" -f supabase/sql/cost-profiles-rls.sql`
Expected: every CREATE POLICY succeeds. If a policy errors with "relation does not exist", the migration from Task 1.2 didn't apply — re-run `pnpm db:migrate`.

- [ ] **Step 3: Commit**

```bash
git add supabase/sql/cost-profiles-rls.sql
git commit -m "feat(db): RLS policies for cost-profile tables"
```

## Task 1.4: Write the snapshot-immutability trigger

**Files:**

- Create: `supabase/sql/cost-snapshot-immutable.sql`

- [ ] **Step 1: Write the trigger from spec §8.3 verbatim**

Copy spec §8.3 SQL into `supabase/sql/cost-snapshot-immutable.sql`.

- [ ] **Step 2: Apply**

Run: `psql "$DATABASE_URL" -f supabase/sql/cost-snapshot-immutable.sql`
Expected: function + trigger created.

- [ ] **Step 3: Commit**

```bash
git add supabase/sql/cost-snapshot-immutable.sql
git commit -m "feat(db): write-once trigger for unit_cost_snapshot"
```

## Task 1.5: Write the integration test for the trigger

**Files:**

- Create: `apps/api/tests/integration/cost-snapshot-immutability.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { Decimal } from 'decimal.js';
import { prisma } from '../helpers/prisma';
import { seedOrgWithStoreAndOrder } from '../helpers/seed';

describe('cost snapshot immutability', () => {
  it('rejects UPDATE that changes unit_cost_snapshot once it is non-null', async () => {
    const { orderItem } = await seedOrgWithStoreAndOrder();

    // First write: null → value (allowed)
    await prisma.orderItem.update({
      where: { id: orderItem.id },
      data: { unitCostSnapshot: new Decimal('100.00'), snapshotCapturedAt: new Date() },
    });

    // Second write: value → different value (must fail)
    await expect(
      prisma.orderItem.update({
        where: { id: orderItem.id },
        data: { unitCostSnapshot: new Decimal('110.00') },
      }),
    ).rejects.toThrow(/write-once/);
  });

  it('rejects UPDATE that changes snapshot_captured_at once it is non-null', async () => {
    const { orderItem } = await seedOrgWithStoreAndOrder();
    await prisma.orderItem.update({
      where: { id: orderItem.id },
      data: { unitCostSnapshot: new Decimal('100.00'), snapshotCapturedAt: new Date('2026-01-01') },
    });

    await expect(
      prisma.orderItem.update({
        where: { id: orderItem.id },
        data: { snapshotCapturedAt: new Date('2026-02-01') },
      }),
    ).rejects.toThrow(/write-once/);
  });

  it('allows UPDATE that does NOT touch snapshot fields', async () => {
    const { orderItem } = await seedOrgWithStoreAndOrder();
    await prisma.orderItem.update({
      where: { id: orderItem.id },
      data: { unitCostSnapshot: new Decimal('100.00'), snapshotCapturedAt: new Date() },
    });

    // Updating unrelated field should succeed.
    await expect(
      prisma.orderItem.update({
        where: { id: orderItem.id },
        data: { quantity: 5 },
      }),
    ).resolves.toBeDefined();
  });
});
```

- [ ] **Step 2: Run and see it fail**

Run: `pnpm --filter api test:integration cost-snapshot-immutability`
Expected: FAIL — test references `seedOrgWithStoreAndOrder` which doesn't exist yet (or the test infrastructure is missing). If `seedOrgWithStoreAndOrder` exists already, the tests should now pass — verifying the trigger.

- [ ] **Step 3: Add the seed helper if missing**

If the helper isn't in `apps/api/tests/helpers/seed.ts`, add it. It should create: an Organization, a Store, a Product + ProductVariant, an Order with one OrderItem (no snapshot yet). Reuse existing seed primitives — don't reinvent.

- [ ] **Step 4: Run and see it pass**

Run: `pnpm --filter api test:integration cost-snapshot-immutability`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/tests/integration/cost-snapshot-immutability.test.ts apps/api/tests/helpers/seed.ts
git commit -m "test(api): write-once trigger for unit_cost_snapshot"
```

## Task 1.6: Write multi-tenancy isolation test for the schema

**Files:**

- Create: `apps/api/tests/integration/tenant-isolation/cost-profiles-schema.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { createUserClient, createTwoOrgsWithUsers, truncateAll } from '../../helpers';

describe('cost profile tables: RLS isolation', () => {
  it('Org A user cannot SELECT cost profiles belonging to Org B', async () => {
    await truncateAll();
    const { orgA, orgB } = await createTwoOrgsWithUsers();

    // Seed an Org B profile via service role (bypasses RLS)
    const { data: orgBProfile } = await orgB.serviceClient
      .from('cost_profiles')
      .insert({
        organization_id: orgB.id,
        name: 'Org B COGS',
        type: 'COGS',
        amount: '10.00',
        currency: 'TRY',
        vat_rate: 18,
        fx_rate_mode: 'AUTO',
      })
      .select()
      .single();

    // Org A user attempts to read it
    const { data: visible } = await orgA.userClient
      .from('cost_profiles')
      .select('*')
      .eq('id', orgBProfile.id);

    expect(visible).toEqual([]); // RLS hides it
  });

  it('Org A user cannot INSERT a cost profile with Org B organization_id', async () => {
    await truncateAll();
    const { orgA, orgB } = await createTwoOrgsWithUsers();

    const { error } = await orgA.userClient.from('cost_profiles').insert({
      organization_id: orgB.id, // attempting cross-org insert
      name: 'Sneaky',
      type: 'COGS',
      amount: '10.00',
      currency: 'TRY',
      vat_rate: 0,
      fx_rate_mode: 'AUTO',
    });

    expect(error).not.toBeNull();
    expect(error.code).toMatch(/42501|PGRST/); // RLS denial OR PostgREST policy block
  });
});
```

- [ ] **Step 2: Run and see it fail or pass**

Run: `pnpm --filter api test:integration cost-profiles-schema`
Expected: PASS if RLS from Task 1.3 is applied. If it fails with "permission denied for table", that's also a pass (RLS is denying as intended). If both Org A and Org B can read each other's data, RLS is missing — investigate.

- [ ] **Step 3: Commit**

```bash
git add apps/api/tests/integration/tenant-isolation/cost-profiles-schema.test.ts
git commit -m "test(api): RLS isolation for cost-profile tables"
```

## Task 1.7: Open PR 1

- [ ] **Step 1: Run the pre-PR gate**

Run: `supabase start && pnpm check:full`
Expected: green. Fix any failures inline.

- [ ] **Step 2: Open the PR**

```bash
gh pr create --title "feat(db): cost profile schema + RLS + write-once trigger" --body "$(cat <<'EOF'
## Summary
- Adds 5 new tables: cost_profiles, cost_profile_versions, product_variant_cost_profiles, order_item_cost_snapshot_components, fx_rates
- Adds 3 enums: CostProfileType, Currency, FxRateMode
- Modifies OrderItem to add organization_id (denormalized for RLS), unit_cost_snapshot, snapshot_captured_at
- Backfills order_items.organization_id from parent orders
- Ships RLS policies for all new tables (cross-table cross-org guard via SECURITY DEFINER STABLE helper)
- Ships the write-once trigger that rejects UPDATEs to unit_cost_snapshot once non-null
- Spec: docs/superpowers/specs/2026-05-09-cost-profiles-design.md

## Test plan
- [ ] pnpm check:full passes locally
- [ ] Multi-tenancy isolation test verifies Org A cannot read Org B's profiles
- [ ] Write-once trigger test verifies snapshot updates are rejected
- [ ] Manual: Prisma Studio shows 5 new tables; existing order_items rows have organization_id populated

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

# PR 2 — Profile CRUD backend

**Branch:** `feat/cost-profiles-crud`
**Depends on:** PR 1
**LOC budget:** ~900 lines (8 routes + validators + service + 8 integration tests + tenant-isolation test)

## Task 2.1: Add domain error codes

**Files:**

- Modify: `apps/api/src/lib/errors.ts` — add `COST_PROFILE_NAME_TAKEN`, `COST_PROFILE_NOT_FOUND`, `COST_PROFILE_ARCHIVED_CANNOT_ATTACH`, `COST_PROFILE_VARIANT_ORG_MISMATCH`
- Modify: error code → ProblemDetails translation (whatever the existing project pattern uses)

- [ ] **Step 1: Add the codes** Refer to spec §6.7. Add a `code` constant + map it to the right error class (`ConflictError`, `NotFoundError`, `InvalidReferenceError`).
- [ ] **Step 2: Run typecheck.** `pnpm typecheck`. Fix any compile errors.
- [ ] **Step 3: Commit.** `git commit -m "feat(api): add cost-profile error codes"`

## Task 2.2: Write the Zod validators

**Files:**

- Create: `apps/api/src/validators/cost-profile.validator.ts`

- [ ] **Step 1: Write the failing unit test**

`apps/api/src/validators/__tests__/cost-profile.validator.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { createCostProfileSchema } from '../cost-profile.validator';

describe('createCostProfileSchema', () => {
  const validBase = {
    name: 'COGS Default',
    type: 'COGS' as const,
    amount: '10.00',
    currency: 'TRY' as const,
    vatRate: 18,
    fxRateMode: 'AUTO' as const,
    manualFxRate: null,
    note: null,
  };

  it('accepts a minimal TRY profile', () => {
    expect(createCostProfileSchema.parse(validBase)).toBeDefined();
  });

  it('rejects negative amount', () => {
    expect(() => createCostProfileSchema.parse({ ...validBase, amount: '-5.00' })).toThrow();
  });

  it('rejects MANUAL mode without manualFxRate', () => {
    expect(() =>
      createCostProfileSchema.parse({
        ...validBase,
        currency: 'USD',
        fxRateMode: 'MANUAL',
        manualFxRate: null,
      }),
    ).toThrow(/manualFxRate required/);
  });

  it('rejects TRY profile in MANUAL mode', () => {
    expect(() =>
      createCostProfileSchema.parse({
        ...validBase,
        currency: 'TRY',
        fxRateMode: 'MANUAL',
        manualFxRate: '1.0',
      }),
    ).toThrow(/TRY profiles must use AUTO/);
  });

  it('accepts USD MANUAL with positive manualFxRate', () => {
    expect(
      createCostProfileSchema.parse({
        ...validBase,
        currency: 'USD',
        fxRateMode: 'MANUAL',
        manualFxRate: '35.50',
      }),
    ).toBeDefined();
  });
});
```

- [ ] **Step 2: Run and see it fail.** `pnpm --filter api test:unit cost-profile.validator`. Expected: FAIL — validator doesn't exist.

- [ ] **Step 3: Implement the validator from spec §6.6**

Write `apps/api/src/validators/cost-profile.validator.ts` exactly as in spec §6.6. Import enums from `@pazarsync/db` (NOT string literals). Also export `updateCostProfileSchema` (same as create but all fields optional via `.partial()`) and `listCostProfilesQuerySchema` for the GET filter parameters.

- [ ] **Step 4: Run and see it pass.** `pnpm --filter api test:unit cost-profile.validator`. Expected: 5 PASS.

- [ ] **Step 5: Commit.** `git commit -m "feat(api): cost-profile validators with Zod 4 refines"`

## Task 2.3: Write the cost-profile service (CRUD + version-on-update)

**Files:**

- Create: `apps/api/src/services/cost-profile.service.ts`
- Create: `apps/api/src/services/__tests__/cost-profile.service.test.ts`

- [ ] **Step 1: Write the failing tests**

Cover: `createCostProfile` writes profile + version 1 in one tx · `updateCostProfile` appends version with diff · `archiveCostProfile` sets archivedAt and writes a version row · concurrent update race protection (`SELECT FOR UPDATE`).

- [ ] **Step 2: Implement the service**

Key methods:

- `createCostProfile(orgId, input, actorId)` — Prisma transaction, INSERT profile + INSERT version 1 with `changedFields: []`
- `updateCostProfile(orgId, profileId, patch, actorId)` — `SELECT ... FOR UPDATE` on profile, compute diff, UPDATE profile, INSERT new version row
- `archiveCostProfile(orgId, profileId, actorId)` / `restoreCostProfile(...)` — variants of update
- `listCostProfiles(orgId, filters)` — paginated list with type/archived/search filters
- `getCostProfile(orgId, profileId)` / `getCostProfileVersions(orgId, profileId, page)` / `getAttachedVariants(orgId, profileId, page)` — read paths

- [ ] **Step 3: Run tests.** Expected: PASS.
- [ ] **Step 4: Commit.** `git commit -m "feat(api): cost-profile service with versioned mutations"`

## Task 2.4: Write the 8 routes

**Files (each a new route file):**

- `apps/api/src/routes/cost-profiles/list.route.ts` (GET)
- `apps/api/src/routes/cost-profiles/create.route.ts` (POST)
- `apps/api/src/routes/cost-profiles/get.route.ts` (GET :id)
- `apps/api/src/routes/cost-profiles/update.route.ts` (PATCH :id)
- `apps/api/src/routes/cost-profiles/archive.route.ts` (POST :id/archive)
- `apps/api/src/routes/cost-profiles/restore.route.ts` (POST :id/restore)
- `apps/api/src/routes/cost-profiles/versions.route.ts` (GET :id/versions)
- `apps/api/src/routes/cost-profiles/attached-variants.route.ts` (GET :id/attached-variants)
- Modify: `apps/api/src/routes/index.ts` (or wherever route registration lives) — register the 8 new routes

For each route, repeat this 5-step rhythm:

- [ ] **Step 1: Write the failing integration test** in `apps/api/tests/integration/cost-profiles/<verb>.test.ts`
- [ ] **Step 2: Run.** Expected: 404 or undefined route.
- [ ] **Step 3: Implement the route** using `@hono/zod-openapi` `createRoute` + the validator from Task 2.2 + the service from Task 2.3. Wrap Prisma calls with `mapPrismaError`. Throw domain errors (`ConflictError` for unique violation, etc.) — never build ProblemDetails by hand.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit per route** (8 commits in this task — reviewer-friendly).

After all 8 routes:

- [ ] **Step 6: Regenerate the API client.** `pnpm api:sync`. Expected: `@pazarsync/api-client` types include the new endpoints.
- [ ] **Step 7: Commit the regenerated client.** `git commit -m "chore(api-client): regenerate for cost-profile routes"`

## Task 2.5: Write the multi-tenancy isolation test

**Files:**

- Create: `apps/api/tests/integration/tenant-isolation/cost-profiles.test.ts`

- [ ] **Step 1: Write the test** Cover all 8 endpoints: Org A user receives 404 (not 403, to avoid info disclosure) when trying to access Org B's profile or its versions/attached-variants. Pre-seeded auth users must survive `truncateAll` per memory `feedback_tests_dont_wipe_seed`.
- [ ] **Step 2: Run.** Expected: PASS (RLS + middleware should already deny).
- [ ] **Step 3: Commit.** `git commit -m "test(api): multi-tenancy isolation for cost-profile routes"`

## Task 2.6: Open PR 2

- [ ] Run `pnpm check:full` and open the PR with the standard summary template.

---

# PR 3 — Attach / detach / replace backend

**Branch:** `feat/cost-profiles-attach`
**Depends on:** PR 1, PR 2
**LOC budget:** ~700 lines (3 attachment routes + 1 variant-side read + service + 4 integration tests + tenant-isolation test)

## Task 3.1: Write the attachment validators

**Files:**

- Create: `apps/api/src/validators/cost-profile-attachment.validator.ts`

```typescript
export const attachmentBodySchema = z.object({
  profileIds: z.array(z.string().uuid()).min(1).max(100),
  variantIds: z.array(z.string().uuid()).min(1).max(500),
});

export const replaceBodySchema = z.object({
  variantIds: z.array(z.string().uuid()).min(1).max(500),
  profileIds: z.array(z.string().uuid()).max(100), // empty array = clear all
});
```

- [ ] Tests for boundary cases (empty profileIds rejected for attach/detach, accepted for replace).
- [ ] Implement → run → commit.

## Task 3.2: Write the attachment service with cross-org guard

**Files:**

- Create: `apps/api/src/services/cost-profile-attachment.service.ts`

Key methods:

- `attachCostProfiles(orgId, profileIds, variantIds, actorId)` — verify all profileIds belong to orgId (single SELECT WHERE id IN (...) AND organizationId = orgId AND archivedAt IS NULL — count must equal profileIds.length, else throw `COST_PROFILE_VARIANT_ORG_MISMATCH` or `COST_PROFILE_ARCHIVED_CANNOT_ATTACH`); same check for variantIds. Then `createMany({ skipDuplicates: true })` for the Cartesian product.
- `detachCostProfiles(orgId, profileIds, variantIds)` — same guard, then `deleteMany`.
- `replaceCostProfiles(orgId, variantIds, profileIds, actorId)` — same guard, transaction: delete current links for variantIds, insert new links for the Cartesian product. Each variant ends with EXACTLY profileIds attached.

- [ ] TDD per method. Cover happy path + cross-org rejection (Org A trying to attach Org B's profile).
- [ ] Implement → run → commit.

## Task 3.3: Write the 3 attachment routes + 1 variant-side read

**Files:**

- `apps/api/src/routes/cost-profile-attachments/attach.route.ts`
- `apps/api/src/routes/cost-profile-attachments/detach.route.ts`
- `apps/api/src/routes/cost-profile-attachments/replace.route.ts`
- `apps/api/src/routes/variants/cost-profiles.route.ts` (GET)
- Modify: route registration

- [ ] TDD per route. Bulk semantics in tests: arrays of length 1 (single-cell op) and arrays of length N (bulk op) both work.
- [ ] Each route → commit.
- [ ] After all 4: `pnpm api:sync` → commit regenerated client.

## Task 3.4: Multi-tenancy isolation tests (the cross-org-guard tests)

**Files:**

- Create: `apps/api/tests/integration/tenant-isolation/cost-profile-attachments.test.ts`

Cover the 4 specific cases from spec §9.3:

- Org A `attach({ profileIds: [orgB.profile], variantIds: [orgA.variant] })` → 422 `COST_PROFILE_VARIANT_ORG_MISMATCH`
- Org A `attach({ profileIds: [orgA.profile], variantIds: [orgB.variant] })` → 404
- Org A cannot detach Org B's link
- Org A cannot read Org B's variant attachments

- [ ] Test → implement → run → commit.

## Task 3.5: Open PR 3

- [ ] Run `pnpm check:full` and open the PR.

---

# PR 4 — FX cron Edge Function

**Branch:** `feat/cost-profiles-fx-cron`
**Depends on:** PR 1
**LOC budget:** ~300 lines (Edge Function + TCMB parser + pg_cron job SQL + 1 integration test)

## Task 4.1: Write the TCMB XML parser as a pure function

**Files:**

- Create: `supabase/functions/fx-rates-sync/tcmb-parser.ts`
- Create: `supabase/functions/fx-rates-sync/_test_/tcmb-parser.test.ts`
- Create: `supabase/functions/fx-rates-sync/_test_/fixtures/tcmb-sample.xml`

The fixture should be a real captured TCMB response. Save one once via:

```bash
curl https://www.tcmb.gov.tr/kurlar/today.xml > supabase/functions/fx-rates-sync/_test_/fixtures/tcmb-sample.xml
```

- [ ] **TDD:** parser takes XML string, returns `{ USD: Decimal, EUR: Decimal, rateDate: Date }`. Use `ForexBuying` field (not `BanknoteBuying` — different rate). Reject XML without expected currencies.
- [ ] Implement → run → commit.

## Task 4.2: Write the Edge Function

**Files:**

- Create: `supabase/functions/fx-rates-sync/index.ts`

Behavior:

- Fetch `https://www.tcmb.gov.tr/kurlar/today.xml`
- Parse with the helper from 4.1
- Upsert `fx_rates` row per currency for today's date
- Retry 3× exponential backoff (15s/45s/2m) on network failure
- On final failure, write a `SyncLog` row with `errorCode = 'FX_FETCH_FAILED'`

- [ ] Implement.
- [ ] **Local test.** `supabase functions serve fx-rates-sync` then `curl http://localhost:54321/functions/v1/fx-rates-sync`. Expected: `fx_rates` table populated.
- [ ] Commit.

## Task 4.3: Schedule the cron job

**Files:**

- Create: `supabase/sql/fx-rates-cron.sql`

```sql
SELECT cron.schedule(
  'fx-rates-sync-daily',
  '0 13 * * 1-5',  -- 16:00 Istanbul, business days only
  $$
  SELECT net.http_post(
    url := 'https://<project>.supabase.co/functions/v1/fx-rates-sync',
    headers := jsonb_build_object('Authorization', 'Bearer <service-role-key>')
  );
  $$
);
```

- [ ] Apply via psql. Replace `<project>` and `<service-role-key>` from env. **Do NOT commit secrets** — use a secrets-substituted variant for the file in the repo.
- [ ] Commit (with redacted SQL using env-var placeholders).

## Task 4.4: Integration test

**Files:**

- Create: `apps/api/tests/integration/fx-rates-cron.test.ts`

Mock the TCMB endpoint with MSW v2. Call the Edge Function locally. Assert `fx_rates` rows are written.

- [ ] Test → implement → commit.

## Task 4.5: Open PR 4.

---

# PR 5 — Cost-snapshot service + sync-worker integration

**Branch:** `feat/cost-profiles-snapshot`
**Depends on:** PR 1, PR 4
**LOC budget:** ~600 lines (snapshot service + FX resolver + sync-worker edits + 4 integration tests)

## Task 5.1: Write `resolveFxRateForSnapshot`

**Files:**

- Create: `apps/api/src/services/fx-rates.service.ts`
- Create: `apps/api/src/services/__tests__/resolve-fx-rate.test.ts`

Per spec §5.3. Table-driven test: TRY → `{ rate: 1, source: 'TRY-NATIVE' }`, MANUAL → `{ rate: profile.manualFxRate, source: 'MANUAL' }`, AUTO with rate → `{ rate, source: 'TCMB-YYYY-MM-DD' }`, AUTO without rate → `null`.

- [ ] TDD → implement → commit.

## Task 5.2: Write `captureCostSnapshot`

**Files:**

- Create: `apps/api/src/services/cost-snapshot.service.ts`
- Create: `apps/api/src/services/__tests__/cost-snapshot.service.test.ts`

Per spec §5.2. Cases to cover:

- Already-captured snapshot → throws `SnapshotAlreadyCapturedError`
- No productVariantId on the order item → returns silently, snapshot stays null
- No profiles attached → returns silently, snapshot stays null
- All TRY profiles → snapshot captured with source='TRY-NATIVE'
- USD AUTO profile, FX rate available → snapshot captures rate
- USD AUTO profile, no FX rate → returns silently, snapshot stays null (best-effort)
- USD MANUAL profile → snapshot captures profile.manualFxRate

- [ ] TDD → implement → commit.

## Task 5.3: Write `recomputeOrderProfit` (write-once enforced)

**Files:**

- Create: `apps/api/src/services/profit-calculation.service.ts`

Per spec §5.4. The "write-once" rule: only set `Order.netProfit` when currently null AND all items have snapshots.

If an existing `computeProfit` function already exists in the codebase (search `apps/api/src/services/` for "profit" or "netProfit"), extend it to subtract `Σ(unitCostSnapshot × quantity)`. Don't duplicate.

- [ ] TDD → implement → commit.

## Task 5.4: Wire the snapshot capture into the existing sync worker

**Files:**

- Modify: `supabase/functions/<existing-sync-fn>/index.ts` — after each OrderItem INSERT (not UPSERT), call `captureCostSnapshot(orderItem.id, tx)`. After all items processed, call `recomputeOrderProfit(orderId, tx)`.

**Critical step:** locate the existing sync worker first. Search for `OrderItem` writes in `supabase/functions/`:

```bash
grep -rn "OrderItem\|order_items" supabase/functions/ | head -20
```

If the worker is in a different shape than expected (e.g., raw SQL inserts, batch writes), adapt the integration to call the snapshot capture at the right point — after the row exists but before the transaction commits.

- [ ] TDD with a mocked Trendyol response (use existing fixtures if available). Assert `unit_cost_snapshot` is populated for variants with profiles, null for variants without.
- [ ] Implement → commit.

## Task 5.5: Integration test for the full sync → snapshot pipeline

**Files:**

- Create: `apps/api/tests/integration/cost-snapshot-capture.test.ts`

Cover spec §5.8 edge cases (the table). Each case = its own test.

- [ ] Test → run → commit.

## Task 5.6: Open PR 5.

---

# PR 6 — Products list extension + missing-cost-stats endpoint

**Branch:** `feat/cost-profiles-products-extension`
**Depends on:** PR 1, PR 3
**LOC budget:** ~400 lines (modified products list + 1 new stats endpoint + 1 fx-rates endpoint + 3 integration tests)

## Task 6.1: Extend the products list query with the live cost aggregate

**Files:**

- Modify: `apps/api/src/routes/products/list.route.ts` (or wherever the endpoint lives) — extend the response shape with `currentCostTry`, `profileCount`, `costStatus` per spec §6.5
- Modify: `apps/api/src/services/products.service.ts` (or equivalent) — extend the SQL query per spec §5.5

Use Prisma `$queryRaw` for the join + aggregation. Return the result merged into the existing variant rows. Test with: a variant with 0 profiles, 1 TRY profile, 1 USD AUTO profile, 2 mixed profiles.

- [ ] TDD → implement → commit.
- [ ] After implementation: `pnpm api:sync` → commit regenerated client.

## Task 6.2: Write the missing-cost-stats endpoint

**Files:**

- Create: `apps/api/src/routes/products/missing-cost-stats.route.ts`

Returns `{ count, totalVariants, byStore: [{ storeId, missingCount }] }`. Aggregation: variants where `productCount = 0` from the Task 6.1 query, grouped by store.

- [ ] TDD → implement → commit.

## Task 6.3: Write the latest FX rates endpoint

**Files:**

- Create: `apps/api/src/routes/fx-rates/latest.route.ts`

Returns `{ USD: { rate, date, source }, EUR: {...} }`. Reads `fx_rates` ORDER BY rateDate DESC LIMIT 1 per currency.

- [ ] TDD → implement → commit.

## Task 6.4: Open PR 6.

---

# PR 7 — Costs page (list + create + edit + archive)

**Branch:** `feat/cost-profiles-costs-page`
**Depends on:** PR 2
**LOC budget:** ~1100 lines (feature/costs scaffold + page + 5 components + 6 hooks + 5 component/hook tests)

## Task 7.1: Add the audit-boundaries `'allow'` rule

**Files:**

- Modify: `scripts/audit-feature-boundaries.config.ts`

Add (mirroring the `sync` rule per memory `project_sync_is_cross_feature_by_design`):

```typescript
if (imp.targetFeature === 'costs') {
  return {
    severity: 'allow',
    message: `Cross-feature consumption of the "costs" feature is permitted by design (org-wide reusable cost primitives).`,
  };
}
```

- [ ] Run `pnpm audit:boundaries` to verify rule is recognized.
- [ ] Commit. `git commit -m "chore(audit): allow cross-feature consumption of costs"`

## Task 7.2: Scaffold `apps/web/src/features/costs/` per spec §7.1

Create the empty directory tree + placeholder index files. No content yet — just structure. This pre-locks the paths so subsequent tasks can `import` confidently.

- [ ] Create directories.
- [ ] Commit. `git commit -m "feat(costs): scaffold feature directory tree"`

## Task 7.3: API functions + types

**Files:**

- 14 files under `features/costs/api/` (list, get, create, update, archive, restore, versions, attached-variants, variant-cost-profiles, attach, detach, replace, fx-rates-latest, missing-cost-stats)
- `features/costs/types/cost-profile.types.ts` — re-export from `@pazarsync/api-client` + `@pazarsync/db/enums`

Each api function:

1. Calls the typed `apiClient.GET/POST/PATCH(...)`
2. Throws via `throwApiError(error, response)` if `error !== undefined`
3. Returns `data`

- [ ] Implement (no tests for thin wrappers).
- [ ] Commit. `git commit -m "feat(costs): API client wrappers + types"`

## Task 7.4: React Query hooks

**Files:**

- 12 files under `features/costs/hooks/` per spec §7.5

Use the `costsKeys` factory from spec §7.5 verbatim. Query hooks are straightforward `useQuery` wrappers. Mutation hooks follow the invalidation matrix from spec §7.6.

- [ ] **TDD per mutation hook with MSW v2** (per project policy). Each hook test asserts: mutation runs, expected cache keys are invalidated.
- [ ] Implement → commit per hook OR commit by group (mutations together).

## Task 7.5: Costs page + table

**Files:**

- Create: `apps/web/src/app/(dashboard)/costs/page.tsx`
- Create: `apps/web/src/features/costs/components/cost-profile-table.tsx`
- Create: `apps/web/src/features/costs/components/cost-profile-empty-state.tsx`
- Create: `apps/web/src/features/costs/components/cost-profile-type-badge.tsx`

Follow the products-table pattern (`features/products/components/products-table.tsx`) — same `DataTable` + `DataTableToolbar` composition. Columns: type badge, name (with note tooltip), amount (Currency component), FX summary, attached count, lastUpdated, actions menu.

- [ ] Component test for the table renders + filtering behavior.
- [ ] Implement → commit.

## Task 7.6: Cost profile form (shared between page CTA and inline create)

**Files:**

- Create: `apps/web/src/features/costs/components/cost-profile-form.tsx`
- Create: `apps/web/src/features/costs/components/cost-profile-create-dialog.tsx`
- Create: `apps/web/src/features/costs/components/cost-profile-fx-preview.tsx`
- Create: `apps/web/src/features/costs/lib/compute-current-cost-try.ts`
- Create: `apps/web/src/features/costs/lib/format-fx-rate-source.ts`

Form fields per spec §7.4 (name, type, currency, amount, vatRate, fxRateMode, manualFxRate conditional, note). The FX preview component shows live conversion math under the amount input — uses `compute-current-cost-try` lib (also TDD'd).

- [ ] **Unit tests** for `compute-current-cost-try` and `format-fx-rate-source` (TDD discipline — pure logic).
- [ ] **Component test** for form: renders, validation errors surface inline, MANUAL mode reveals manualFxRate input, MANUAL with TRY shows conditional error.
- [ ] Implement → commit per piece.

## Task 7.7: Wire archive/restore actions

**Files:**

- Modify: `cost-profile-table.tsx` — add row action menu with archive, restore, view-detail.
- Use `AlertDialog` for the archive confirmation (it's reversible but seller should think about it).

- [ ] Test → implement → commit.

## Task 7.8: Open PR 7.

---

# PR 8 — Profile detail page (3 tabs)

**Branch:** `feat/cost-profiles-detail-page`
**Depends on:** PR 2 (PR 7 in parallel)
**LOC budget:** ~700 lines (detail page + 3 tab components + history diff + 3 tests)

## Task 8.1: Detail page route + tabs structure

**Files:**

- Create: `apps/web/src/app/(dashboard)/costs/[profileId]/page.tsx`
- Create: `apps/web/src/features/costs/components/cost-profile-detail.tsx`

Use shadcn `Tabs` primitive. Three tabs: Detay (form), Geçmiş (history), Bağlı varyantlar (attached).

- [ ] Implement → commit.

## Task 8.2: History list + version diff

**Files:**

- Create: `apps/web/src/features/costs/components/cost-profile-history-list.tsx`
- Create: `apps/web/src/features/costs/components/cost-profile-version-diff.tsx`

History list: reverse-chronological timeline, each row shows version number, relative time, who, changedFields chips, "view diff" link. Diff: show before/after for each field that changed; for the first version (initial create) show all fields with "set initial" label.

- [ ] **Component test** for history list rendering with mock data.
- [ ] Implement → commit.

## Task 8.3: Attached variants tab

**Files:**

- Create: `apps/web/src/features/costs/components/cost-profile-attached-variants.tsx`

A simple list — variant title + size + color + store name + detach button. Detach uses the variant-side detach mutation (`useDetachCostProfiles({ profileIds: [profile.id], variantIds: [variant.id] })`).

- [ ] Test → implement → commit.

## Task 8.4: Edit form integration on the Detay tab

Wire `cost-profile-form` into the Detay tab as an edit form (pre-filled, calls `useUpdateCostProfile`). On successful save, the form transitions out of "dirty" state and the history tab refetches.

- [ ] Test → implement → commit.

## Task 8.5: Open PR 8.

---

# PR 9 — Products table cost cell + popover + inline create

**Branch:** `feat/cost-profiles-products-cell`
**Depends on:** PR 3, PR 6 (PR 7 helps but not strictly required if the create dialog imports from `features/costs`)
**LOC budget:** ~900 lines (cell + popover + cell-side create + products-table column + tests)

## Task 9.1: Variant row cost cell

**Files:**

- Create: `apps/web/src/features/products/components/cost-cell.tsx`
- Modify: `apps/web/src/features/products/components/products-table.tsx` — add `cost` column

Display per spec §7.9 cell rules:

- 0 profiles → "+ Maliyet ekle" placeholder
- ≥1 profile → `Currency` component for `currentCostTry` + `Badge` showing `profileCount`
- Hover tooltip lists profile names

- [ ] Component test: snapshots the three states (0 / 1 / many profiles).
- [ ] Implement → commit.

## Task 9.2: Cell popover

**Files:**

- Create: `apps/web/src/features/products/components/cost-cell-popover.tsx`

Wraps `Popover` primitive. Anchored to cost-cell trigger. Three sections per spec Q5:

- Top: attached profiles list with type icon + name + amount + remove button
- Middle: combobox to pick existing profile (typeahead, archived excluded)
- Footer: "+ Yeni maliyet oluştur" link → opens `CostProfileCreateDialog` (imported from `features/costs`)

State model from spec §7.7. Optimistic updates per spec §7.8.

**Combobox verification:** before implementing, check whether a `Combobox` primitive already exists in `apps/web/src/components/ui/`. If not, run `pnpm dlx shadcn@latest add combobox` from the registry. If neither, build from `Command + Popover` (shadcn standard composition).

- [ ] **Component test** for the popover: renders attached list, attach combobox shows non-archived profiles, "+ Yeni" opens dialog, remove button calls detach.
- [ ] Implement → commit.

## Task 9.3: Inline create from cell

**Files:**

- Create: `apps/web/src/features/products/components/cost-cell-create-bridge.tsx` (small wrapper that opens `CostProfileCreateDialog` from `features/costs` and auto-attaches on success)

Auto-attach flow: dialog `onSuccess(newProfile)` → call `useAttachCostProfiles({ profileIds: [newProfile.id], variantIds: [currentVariant.id] })` → close dialog. Both happen optimistically.

- [ ] Test → implement → commit.

## Task 9.4: Open PR 9.

---

# PR 10 — Parent-row aggregate + bulk FAB

**Branch:** `feat/cost-profiles-bulk-fab`
**Depends on:** PR 9
**LOC budget:** ~600 lines (parent cell + FAB + bulk operations modals + tests)

## Task 10.1: Verify or build the FAB primitive

- [ ] Search: `find apps/web/src/app/design -name "*action-bar*" -o -name "*floating*"`. If found, study it.
- [ ] If not found, design a small composition: a fixed-position bar at the bottom of the table viewport, visible only when `useTable.getSelectedRowModel().rows.length >= 2`. Contains 3 action buttons + selected-count chip + "Clear selection" link.

## Task 10.2: Parent (Product) row cost cell

**Files:**

- Create: `apps/web/src/features/products/components/parent-row-cost-cell.tsx`

Aggregate display per spec Q5 item 4: range ("₺120–180 across 8 variants") or "all same" indicator. Click opens a popover with "Apply this cost to all variants of this product" combobox + per-variant override list.

- [ ] Test → implement → commit.

## Task 10.3: Bulk FAB

**Files:**

- Create: `apps/web/src/features/products/components/products-bulk-cost-action-bar.tsx`

Three actions per spec Q5 item 5: "Maliyet ekle" (attach), "Maliyet kaldır" (detach), "Maliyetleri değiştir" (replace, destructive — use `AlertDialog`).

When a parent Product row is selected, the bulk action applies to ALL its child variants automatically (resolve via `useTable.getSubRows()`).

- [ ] Test interactions with mock products data.
- [ ] Implement → commit.

## Task 10.4: Open PR 10.

---

# PR 11 — Missing-cost banner + dashboard widget

**Branch:** `feat/cost-profiles-missing-warnings`
**Depends on:** PR 6
**LOC budget:** ~250 lines (2 components + 2 tests)

## Task 11.1: Products page banner

**Files:**

- Create: `apps/web/src/features/products/components/missing-cost-warning-banner.tsx`
- Modify: products page top-of-content area — render the banner above the table

Composes `Alert` primitive. Renders only when `useMissingCostStats().count > 0`. CTA button "Maliyetsiz ürünleri filtrele" appends `?costStatus=NO_PROFILES` to the URL (or sets a filter via the products list query state).

- [ ] Test → implement → commit.

## Task 11.2: Dashboard widget

**Files:**

- Create: `apps/web/src/features/dashboard/components/missing-cost-widget.tsx`
- Modify: dashboard layout — render the widget alongside existing tiles

Composes `KpiTile` pattern. Shows: count, percent of total, link to filtered products view. Hidden entirely when count is 0 (don't taunt the seller with empty-state widgets).

- [ ] Test → implement → commit.

## Task 11.3: Open PR 11.

---

# Self-Review

Done after writing the plan. Summary of inline checks:

**Spec coverage:** Every spec section maps to at least one task:

- §3 (architecture) → PR 1 schema + PR 5 sync integration
- §4 (data model) → Task 1.1, 1.2
- §5 (calculation pipeline) → Task 5.1, 5.2, 5.3, 5.4
- §6 (API surface) → PRs 2, 3, 6
- §7 (frontend) → PRs 7, 8, 9, 10, 11
- §8 (security/RLS) → Task 1.3, 1.4, 1.5, 1.6 + every multi-tenancy test in PRs 2, 3
- §9 (testing) → folded into each PR's test tasks
- §10 (phasing) → mirrored as the 11 PRs
- §11 (open issues) → flagged inline (1.3 verifies `auth.org_id()`, 5.3 audits existing profit writes, 1.1 adds Organization back-relation)
- §12 (out of scope) → not implemented (correctly omitted)

**Placeholder scan:** No "TBD", "TODO", or "implement later" in the plan. The phrase "implement → commit" recurs as a structural shorthand for "do TDD steps from the spec section referenced; commit at the end" — not a placeholder.

**Type consistency:** Method names match across tasks: `captureCostSnapshot`, `resolveFxRateForSnapshot`, `attachCostProfiles`, `detachCostProfiles`, `replaceCostProfiles`. Hook names match the React Query keys factory.

**Critical paths and parallelism:** PR 1 → 2 → 3 → 6 → 9 → 10 is the critical chain. PRs 4 → 5 parallel with PRs 2 → 3. PRs 7, 8 parallel with PR 9.

---

# Notes for the executing engineer

1. **Read the spec first.** The plan references it heavily. Spec sections in markers like §5.2 are not optional reading.
2. **TDD is non-negotiable for pure logic.** `compute-current-cost-try`, `format-fx-rate-source`, `tcmb-parser`, `resolveFxRateForSnapshot`, `captureCostSnapshot` — all written test-first.
3. **One commit per task.** Reviewers read commits sequentially. A mega-commit covering "PR 2 routes" loses fine-grained review.
4. **Run `pnpm api:sync` after EVERY Zod schema change** — there's a memory `feedback_realtime_wire_shapes_mirror_api` about wire shapes; ignore at your peril.
5. **Commit prompt before push.** Per memory `feedback_ask_before_commit`, every "Commit" step prompts the user before running `git commit`. Show the staged files + the proposed message; wait for "yes."
6. **Verify primitives before custom-building.** UI workflow cascade: `apps/web/src/components/patterns/` first, then `apps/web/src/components/ui/`, then `pnpm dlx shadcn@latest add <name>`, then custom. The `Combobox` and FAB are explicit verification points (Tasks 9.2, 10.1).
7. **Cross-feature imports:** `products` and `dashboard` import from `@/features/costs/hooks/...` only — never from internal API/lib/components. The audit-boundaries rule (Task 7.1) only allows `costs` as a target; cross-feature consumption respects feature-private boundaries.
