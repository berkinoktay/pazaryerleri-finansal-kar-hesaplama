# Sync Engine Architecture v2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the v1.0 fire-and-forget sync model (Promise inside a Hono request handler) with a dedicated Node worker process, durable checkpoints in Postgres, and an org-wide Realtime subscription hoisted to the dashboard shell. Designed to absorb continuous multi-module sync traffic (products, orders, settlements, messages × multiple marketplaces) without coupling sync lifetime to the API process.

**Architecture:** Five PRs in sequence:
1. Ship the org-id RLS prerequisite already in the working tree.
2. Schema additions for the new state machine (`PENDING`, `FAILED_RETRYABLE`, checkpoint columns, partial unique index for atomic dedup).
3. Code extraction (`packages/marketplace`, `packages/sync-core`) so API and worker share one codebase.
4. New `apps/sync-worker` app + API route refactor + cutover script — atomic switch.
5. Frontend: hoist `OrgSyncsProvider` to the dashboard layout, refactor SyncBadge / SyncCenter for cross-store visibility.

**Tech Stack:** Hono 4 · Prisma 7 · Supabase Realtime · Postgres 15 · Vitest 4 · React 19 · TanStack Query · TanStack Table · nuqs

**Spec:** `docs/plans/2026-04-27-sync-engine-architecture-design.md`

**Branch:** `feat/sync-worker-architecture` (off main)

---

## Working-tree precondition

When this plan starts, the working tree on `feat/sync-worker-architecture` already has 9 uncommitted files from the org-id denormalization work done during the brainstorming session:

```
M apps/api/src/routes/product.routes.ts
M apps/api/src/services/sync-log.service.ts
M apps/api/tests/integration/rls/settlements-synclogs.rls.test.ts
M apps/api/tests/integration/routes/product.routes.test.ts
M apps/api/tests/integration/routes/sync-logs-list.routes.test.ts
M apps/api/tests/integration/services/product-sync.service.test.ts
M apps/api/tests/integration/tenant-isolation/products-sync.test.ts
M packages/db/prisma/schema.prisma
M supabase/sql/rls-policies.sql
```

These are the foundation of PR 1 — the Realtime postgres_changes subscription on `sync_logs` cannot evaluate RLS reliably until `organization_id` is denormalized onto the row and the policy is `is_org_member(organization_id)` directly. Local DB has the schema applied + Prisma client regenerated; integration tests pass (verified end-of-session: 131/131 integration, 113/113 unit, 198/198 web).

---

## PR 1 — Foundation: `organizationId` on `sync_logs` for Realtime-friendly RLS

**Why this PR is first:** The whole architecture relies on Supabase Realtime postgres_changes correctly evaluating RLS for `sync_logs`. The current cross-table `EXISTS (SELECT FROM stores …)` policy works for REST (Prisma bypasses RLS as superuser) but crashes the Realtime subscription evaluator with "Unable to subscribe to changes with given parameters". Denormalizing `organization_id` onto `sync_logs` and rewriting the policy to a flat `is_org_member(organization_id)` is the smallest change that unblocks Realtime and matches the pattern already used on `products` / `product_variants` / `product_images`.

### Files

- Modify: `packages/db/prisma/schema.prisma` (lines 350–368: SyncLog model adds `organizationId` column, FK to `Organization`, new index; Organization model adds reverse relation)
- Modify: `apps/api/src/services/sync-log.service.ts` (`start()` and `acquireSlot()` take `organizationId`)
- Modify: `apps/api/src/routes/product.routes.ts` (line 99: pass `organizationId` to `acquireSlot`)
- Modify: `supabase/sql/rls-policies.sql` (`sync_logs_org_member_read` policy → flat `is_org_member(organization_id)`)
- Modify: 5 test files (`prisma.syncLog.create({ ... organizationId: ... })` at every call site)

### Tasks

- [ ] **Step 1: Verify the working tree is in the expected state.**

```bash
git status --short
```

Expected: 9 modified files matching the precondition list above. If anything else is modified or files are missing, stash to a separate ref and start over.

- [ ] **Step 2: Verify schema is in sync with local DB.**

```bash
cd packages/db
npx prisma db push
```

Expected: `🚀 Your database is now in sync with your Prisma schema.` (no diff). Confirms the working-tree schema and the local DB match.

- [ ] **Step 3: Run all test suites to confirm green baseline.**

```bash
cd apps/api && pnpm test:unit && pnpm test:integration
cd ../web && pnpm test
```

Expected: 131 api integration + 113 api unit + 198 web tests pass.

- [ ] **Step 4: Stage, commit, push, open PR.**

```bash
git add packages/db/prisma/schema.prisma \
        apps/api/src/services/sync-log.service.ts \
        apps/api/src/routes/product.routes.ts \
        apps/api/tests/integration/rls/settlements-synclogs.rls.test.ts \
        apps/api/tests/integration/routes/product.routes.test.ts \
        apps/api/tests/integration/routes/sync-logs-list.routes.test.ts \
        apps/api/tests/integration/services/product-sync.service.test.ts \
        apps/api/tests/integration/tenant-isolation/products-sync.test.ts \
        supabase/sql/rls-policies.sql

git commit -m "$(cat <<'EOF'
feat(sync): denormalize organization_id on sync_logs for Realtime RLS

Replaces the cross-table EXISTS RLS policy on sync_logs with a flat
is_org_member(organization_id) check. The cross-table walk works for
REST (Prisma bypasses RLS as superuser) but Supabase Realtime's
postgres_changes evaluator can't reliably handle it — subscriptions
crashed with "Unable to subscribe to changes with given parameters".

Mirrors the same pattern already used on products / product_variants /
product_images. organizationId is stamped at insert time by
syncLogService.acquireSlot, kept in sync with store_id by construction.

Foundation for the upcoming sync engine architecture v2 (see
docs/plans/2026-04-27-sync-engine-architecture-design.md).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"

git push -u origin feat/sync-worker-architecture
```

- [ ] **Step 5: Open the PR.**

```bash
gh pr create --title "feat(sync): denormalize organization_id on sync_logs for Realtime RLS" --body "$(cat <<'EOF'
## Summary
- Adds `organization_id` column + FK to `sync_logs`; populates at insert time via `acquireSlot(orgId, storeId, syncType)`.
- Rewrites `sync_logs_org_member_read` RLS policy to flat `is_org_member(organization_id)` — same pattern as products / variants / images.
- Required prerequisite for the v2 sync engine architecture (PRs 2–5 follow on this branch).

## Why
Realtime postgres_changes on `sync_logs` was failing with "Unable to subscribe to changes with given parameters" because the cross-table EXISTS RLS policy crashes the Supabase Realtime evaluator. Denormalization mirrors the existing pattern and unblocks Realtime.

## Test plan
- [x] `pnpm --filter @pazarsync/api test:unit` (113 pass)
- [x] `pnpm --filter @pazarsync/api test:integration` (131 pass)
- [x] `pnpm --filter web test` (198 pass)
- [ ] Manual: trigger a sync, confirm Supabase Realtime channel reaches `SUBSCRIBED` and stays open (no `Unable to subscribe …` system message in WS frames).
- [ ] Manual: cross-org isolation — log in as user A, confirm sync_logs Realtime channel never delivers events for org B's stores.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 6: Wait for CI green, merge.**

```bash
gh pr checks --watch
gh pr merge --squash --delete-branch=false
```

Don't delete the branch yet — PRs 2–5 stack on it.

- [ ] **Step 7: Sync local branch to merged main.**

```bash
git checkout main
git pull
git checkout feat/sync-worker-architecture
git rebase main
```

Resolve any conflicts. (None expected — this branch only added the spec doc and the PR-1 commit.)

---

## PR 2 — Schema additions for the new state machine

**Why:** Lock in the data layer before any code uses it. Adds the new states (`PENDING`, `FAILED_RETRYABLE`), the new checkpoint columns (`claimedAt`, `claimedBy`, `lastTickAt`, `pageCursor`, `attemptCount`, `nextAttemptAt`), and the partial unique index that makes "one active sync per `(storeId, syncType)`" atomic. RLS unchanged — new columns are internal.

### Files

- Modify: `packages/db/prisma/schema.prisma` (`SyncStatus` enum + `SyncLog` model)
- Modify: `supabase/sql/rls-policies.sql` (no policy change; we add a comment about the new internal columns being covered by the existing policy via row-level access)
- Create: `apps/api/tests/integration/services/sync-log.dedup.test.ts` (verifies the partial unique index does its job)

### Tasks

- [ ] **Step 1: Extend `SyncStatus` enum in Prisma schema.**

Modify `packages/db/prisma/schema.prisma`:

```prisma
enum SyncStatus {
  PENDING
  RUNNING
  COMPLETED
  FAILED
  FAILED_RETRYABLE
}
```

- [ ] **Step 2: Add the new columns to `SyncLog`.**

Modify `packages/db/prisma/schema.prisma` `SyncLog` model:

```prisma
model SyncLog {
  id               String     @id @default(uuid()) @db.Uuid
  organizationId   String     @map("organization_id") @db.Uuid
  storeId          String     @map("store_id") @db.Uuid
  syncType         SyncType   @map("sync_type")
  status           SyncStatus
  startedAt        DateTime   @map("started_at")
  completedAt      DateTime?  @map("completed_at")
  recordsProcessed Int        @default(0) @map("records_processed")
  progressCurrent  Int        @default(0) @map("progress_current")
  progressTotal    Int?       @map("progress_total")
  progressStage    String?    @map("progress_stage")
  errorCode        String?    @map("error_code")
  errorMessage     String?    @map("error_message")
  // ─── New columns (PR 2) ────────────────────────────────────
  claimedAt        DateTime?  @map("claimed_at")
  claimedBy        String?    @map("claimed_by")
  lastTickAt       DateTime?  @map("last_tick_at")
  pageCursor       Json?      @map("page_cursor")
  attemptCount     Int        @default(0) @map("attempt_count")
  nextAttemptAt    DateTime?  @map("next_attempt_at")

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  store        Store        @relation(fields: [storeId], references: [id], onDelete: Cascade)

  @@index([organizationId])
  @@index([storeId, startedAt])
  @@index([status, nextAttemptAt])
  @@map("sync_logs")
}
```

- [ ] **Step 3: Push schema to local DB and regenerate client.**

```bash
cd packages/db
npx prisma db push
pnpm generate
```

Expected: `🚀 Your database is now in sync with your Prisma schema.`

- [ ] **Step 4: Add the partial unique index via raw SQL.**

Prisma 7 doesn't model partial unique indexes in `schema.prisma` cleanly. Add it as a raw SQL statement applied via `apply-policies`. Modify `supabase/sql/rls-policies.sql` — append at end:

```sql
-- ─── sync_logs active-slot uniqueness ────────────────────────
-- Atomically guarantees one active sync per (store_id, sync_type).
-- Concurrent enqueue requests → one INSERT wins, the other gets
-- 23505 unique-violation, mapped to SyncInProgressError(409). The
-- "active" predicate covers PENDING / RUNNING / FAILED_RETRYABLE
-- states; terminal states (COMPLETED, FAILED) are not constrained.
CREATE UNIQUE INDEX IF NOT EXISTS sync_logs_active_slot_uniq
  ON sync_logs (store_id, sync_type)
  WHERE status IN ('PENDING', 'RUNNING', 'FAILED_RETRYABLE');
```

- [ ] **Step 5: Apply the policies SQL.**

```bash
cd packages/db
pnpm apply-policies
```

Expected: `✓ Applied … rls-policies.sql` etc.

- [ ] **Step 6: Verify the partial unique index exists.**

```bash
npx tsx --env-file-if-exists=../../.env -e "
import { Client } from 'pg';
async function main() {
  const c = new Client({ connectionString: process.env['DIRECT_URL'] ?? process.env['DATABASE_URL'] });
  await c.connect();
  const r = await c.query(\"SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'sync_logs' AND indexname = 'sync_logs_active_slot_uniq'\");
  console.log(JSON.stringify(r.rows, null, 2));
  await c.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
"
```

Expected: one row with `indexdef` containing `WHERE status IN ('PENDING', 'RUNNING', 'FAILED_RETRYABLE')`.

- [ ] **Step 7: Write a failing test for atomic dedup.**

Create `apps/api/tests/integration/services/sync-log.dedup.test.ts`:

```ts
import { prisma } from '@pazarsync/db';
import { Prisma } from '../../../generated/prisma/client';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createMembership, createOrganization, createStore, createUserProfile } from '../../helpers/factories';

describe('sync_logs partial unique index', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('rejects a second active row for the same (storeId, syncType)', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    await prisma.syncLog.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        syncType: 'PRODUCTS',
        status: 'PENDING',
        startedAt: new Date(),
      },
    });

    await expect(
      prisma.syncLog.create({
        data: {
          organizationId: org.id,
          storeId: store.id,
          syncType: 'PRODUCTS',
          status: 'PENDING',
          startedAt: new Date(),
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('allows a new active row after the previous one is COMPLETED', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    const first = await prisma.syncLog.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        syncType: 'PRODUCTS',
        status: 'PENDING',
        startedAt: new Date(),
      },
    });
    await prisma.syncLog.update({
      where: { id: first.id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });

    // Second active row should now succeed because the first is terminal.
    await expect(
      prisma.syncLog.create({
        data: {
          organizationId: org.id,
          storeId: store.id,
          syncType: 'PRODUCTS',
          status: 'PENDING',
          startedAt: new Date(),
        },
      }),
    ).resolves.toMatchObject({ status: 'PENDING' });
  });

  it('allows different syncTypes for the same store concurrently', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);

    await prisma.syncLog.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        syncType: 'PRODUCTS',
        status: 'RUNNING',
        startedAt: new Date(),
      },
    });

    // ORDERS sync for the same store should not collide with PRODUCTS.
    await expect(
      prisma.syncLog.create({
        data: {
          organizationId: org.id,
          storeId: store.id,
          syncType: 'ORDERS',
          status: 'PENDING',
          startedAt: new Date(),
        },
      }),
    ).resolves.toMatchObject({ syncType: 'ORDERS' });
  });
});
```

Note: relies on `Prisma` import from generated client and existing factory helpers. If `createStore` doesn't yet exist in `tests/helpers/factories.ts`, search for `createTestStore` (which does) and use that — the test file's exact factory call should match what the helper exports.

- [ ] **Step 8: Run the test to confirm it passes.**

```bash
cd apps/api
pnpm vitest run tests/integration/services/sync-log.dedup.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 9: Run all api tests to confirm no regression.**

```bash
pnpm test:unit && pnpm test:integration
```

Expected: 113 unit + 134 integration (3 new) pass.

- [ ] **Step 10: Commit, push, open PR.**

```bash
git add packages/db/prisma/schema.prisma supabase/sql/rls-policies.sql apps/api/tests/integration/services/sync-log.dedup.test.ts
git commit -m "$(cat <<'EOF'
feat(sync): add new SyncLog states + partial unique index for atomic dedup

Schema for the v2 sync engine architecture:
- SyncStatus enum gains PENDING and FAILED_RETRYABLE
- New columns on sync_logs: claimedAt, claimedBy, lastTickAt,
  pageCursor (jsonb), attemptCount, nextAttemptAt
- Partial unique index sync_logs_active_slot_uniq on (storeId, syncType)
  WHERE status IN ('PENDING','RUNNING','FAILED_RETRYABLE') — Postgres
  atomically guarantees one active sync per slot

No code changes — service layer + workers will land in subsequent PRs.
The new states are not yet produced; existing flows continue to use
RUNNING / COMPLETED / FAILED.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push
gh pr create --title "feat(sync): SyncLog state-machine + atomic dedup index" --body "$(cat <<'EOF'
## Summary
Schema-only PR for sync engine v2 (see docs/plans/2026-04-27-sync-engine-architecture-design.md).
- Adds PENDING + FAILED_RETRYABLE to SyncStatus
- Adds checkpoint/lifecycle columns: claimedAt, claimedBy, lastTickAt, pageCursor, attemptCount, nextAttemptAt
- Adds partial unique index sync_logs_active_slot_uniq

No service or route code references these yet — that's PRs 3–5.

## Test plan
- [x] Unit: 113 pass
- [x] Integration: 134 pass (3 new in sync-log.dedup.test.ts)
- [x] Manual: verified partial unique index exists with correct predicate via pg_indexes

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 11: Wait for CI green, merge, sync local.**

```bash
gh pr checks --watch
gh pr merge --squash --delete-branch=false
git checkout main && git pull && git checkout feat/sync-worker-architecture && git rebase main
```

---

## PR 3 — Code extraction: `packages/marketplace` + `packages/sync-core`

**Why:** Both API and worker need the marketplace adapters and the SyncLog lifecycle helpers. Cross-app imports (`apps/sync-worker` reaching into `apps/api/src/`) violate the boundary discipline this whole architectural shift is about. Extract once, then add modules cleanly.

### Files

- Create: `packages/marketplace/package.json`
- Create: `packages/marketplace/src/index.ts`
- Create: `packages/marketplace/tsconfig.json`
- Move: `apps/api/src/integrations/marketplace/**` → `packages/marketplace/src/`
- Create: `packages/sync-core/package.json`
- Create: `packages/sync-core/src/index.ts`
- Create: `packages/sync-core/tsconfig.json`
- Move: `apps/api/src/services/sync-log.service.ts` → `packages/sync-core/src/sync-log.service.ts`
- Move: `apps/api/src/lib/errors.ts` (split: domain errors → `packages/sync-core/src/errors.ts`; API-internal errors stay in apps/api)
- Move: `apps/api/src/lib/crypto.ts` → `packages/sync-core/src/crypto.ts`
- Move: `apps/api/src/lib/map-prisma-error.ts` → `packages/sync-core/src/map-prisma-error.ts`
- Modify: every file in `apps/api` that imports from the moved paths (~30 files; `grep -r` to enumerate)
- Modify: `pnpm-workspace.yaml` (no change; `packages/*` already covered)
- Modify: `tsconfig.base.json` (path aliases for new packages)

### Tasks

- [ ] **Step 1: Scaffold `packages/marketplace`.**

```bash
mkdir -p packages/marketplace/src
```

Create `packages/marketplace/package.json`:

```json
{
  "name": "@pazarsync/marketplace",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./trendyol": "./src/trendyol/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@pazarsync/db": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^6"
  }
}
```

Create `packages/marketplace/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "noEmit": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 2: Move marketplace files.**

```bash
git mv apps/api/src/integrations/marketplace packages/marketplace/src/
```

- [ ] **Step 3: Create the `packages/marketplace/src/index.ts` re-export surface.**

```ts
// packages/marketplace/src/index.ts
export * from './marketplace/types';
export * from './marketplace/registry';
export { mapTrendyolResponseToDomainError } from './marketplace/trendyol/errors';
export type {
  TrendyolCredentials,
  TrendyolApprovedProductsResponse,
  MappedProduct,
} from './marketplace/trendyol/types';
export { mapTrendyolApprovedResponse } from './marketplace/trendyol/mapper';
export { fetchApprovedProducts } from './marketplace/trendyol/products';
export { probeTrendyolCredentials } from './marketplace/trendyol/client';
export { trendyolFactory } from './marketplace/trendyol/adapter';
export { isTrendyolCredentials } from './marketplace/trendyol/types';
```

After the move, files now live at `packages/marketplace/src/marketplace/...` (one level too deep). Flatten:

```bash
cd packages/marketplace/src
mv marketplace/* .
rmdir marketplace
```

Update the index.ts paths to drop the extra `marketplace/`:

```ts
export * from './types';
export * from './registry';
export { mapTrendyolResponseToDomainError } from './trendyol/errors';
// … etc — adjust all paths to remove the leading `marketplace/`
```

- [ ] **Step 4: Scaffold `packages/sync-core`.**

```bash
mkdir -p packages/sync-core/src
```

Create `packages/sync-core/package.json`:

```json
{
  "name": "@pazarsync/sync-core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test:unit": "vitest run --config vitest.config.ts"
  },
  "dependencies": {
    "@pazarsync/db": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^6",
    "vitest": "^4"
  }
}
```

Create `packages/sync-core/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "noEmit": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 5: Move sync-core files.**

```bash
git mv apps/api/src/services/sync-log.service.ts packages/sync-core/src/sync-log.service.ts
git mv apps/api/src/lib/crypto.ts packages/sync-core/src/crypto.ts
git mv apps/api/src/lib/map-prisma-error.ts packages/sync-core/src/map-prisma-error.ts
```

For `errors.ts`: keep it in `apps/api/src/lib/` (most error classes are HTTP-domain — UnauthorizedError, ForbiddenError, NotFoundError, ConflictError, ValidationError). Extract only the sync-specific subset:

```ts
// packages/sync-core/src/errors.ts
export class SyncInProgressError extends Error {
  readonly code = 'SYNC_IN_PROGRESS' as const;
  readonly meta: { syncType: string; storeId: string };
  constructor(meta: { syncType: string; storeId: string }) {
    super(`A sync of type ${meta.syncType} is already running for store ${meta.storeId}`);
    this.meta = meta;
  }
}

export class MarketplaceUnreachable extends Error {
  readonly code = 'MARKETPLACE_UNREACHABLE' as const;
  readonly meta: { platform: string; httpStatus: number };
  constructor(platform: string, meta: { httpStatus: number }) {
    super(`Marketplace unreachable (${meta.httpStatus}) — upstream issue`);
    this.meta = { platform, ...meta };
  }
}

export class MarketplaceAuthError extends Error {
  readonly code = 'MARKETPLACE_AUTH_FAILED' as const;
  readonly meta: { platform: string };
  constructor(platform: string) {
    super(`Marketplace authentication failed for ${platform}`);
    this.meta = { platform };
  }
}

export class MarketplaceAccessError extends Error {
  readonly code = 'MARKETPLACE_ACCESS_DENIED' as const;
  readonly meta: { platform: string; httpStatus: number };
  constructor(platform: string, meta: { httpStatus: number }) {
    super(`Marketplace access denied for ${platform} (${meta.httpStatus})`);
    this.meta = { platform, ...meta };
  }
}

export class RateLimitedError extends Error {
  readonly code = 'RATE_LIMITED' as const;
  readonly retryAfterSeconds: number;
  constructor(retryAfterSeconds: number, message: string) {
    super(message);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
```

Then in `apps/api/src/lib/errors.ts`, delete the duplicates and re-export:

```ts
// apps/api/src/lib/errors.ts
export {
  SyncInProgressError,
  MarketplaceUnreachable,
  MarketplaceAuthError,
  MarketplaceAccessError,
  RateLimitedError,
} from '@pazarsync/sync-core';
// keep UnauthorizedError, ForbiddenError, NotFoundError, ConflictError,
// ValidationError, InvalidReferenceError defined here as before
```

- [ ] **Step 6: Create `packages/sync-core/src/index.ts`.**

```ts
// packages/sync-core/src/index.ts
export * as syncLogService from './sync-log.service';
export * from './errors';
export { encryptCredentials, decryptCredentials } from './crypto';
export { mapPrismaError } from './map-prisma-error';
```

- [ ] **Step 7: Update path aliases in `tsconfig.base.json`.**

Modify `tsconfig.base.json` (search for the `paths` block). Add (no change if already covered by workspace resolution):

```json
{
  "compilerOptions": {
    "paths": {
      "@pazarsync/marketplace": ["./packages/marketplace/src/index.ts"],
      "@pazarsync/marketplace/*": ["./packages/marketplace/src/*"],
      "@pazarsync/sync-core": ["./packages/sync-core/src/index.ts"]
    }
  }
}
```

(Skip if pnpm workspaces resolution + Vitest's `node_modules` symlinks already handle it — verify with the typecheck in Step 9.)

- [ ] **Step 8: Update every import in `apps/api`.**

```bash
cd apps/api
grep -rln "from '\.\./.*integrations/marketplace" src/ tests/ | head -30
grep -rln "from '\.\./.*services/sync-log\.service'" src/ tests/ | head -30
grep -rln "from '\.\./.*lib/crypto'" src/ tests/ | head -30
grep -rln "from '\.\./.*lib/map-prisma-error'" src/ tests/ | head -30
```

For each file, replace relative imports with package imports:

- `from '../../integrations/marketplace/trendyol/products'` → `from '@pazarsync/marketplace'`
- `from '../services/sync-log.service'` → `import { syncLogService } from '@pazarsync/sync-core'`
- `from '../lib/crypto'` → `from '@pazarsync/sync-core'`
- `from '../lib/map-prisma-error'` → `from '@pazarsync/sync-core'`
- `from '../lib/errors'` for the moved error classes → leaves the existing import as-is, since `apps/api/src/lib/errors.ts` re-exports them

The `syncLogService` import shape changes from `import * as syncLogService from '...'` to `import { syncLogService } from '@pazarsync/sync-core'` — matches the namespace re-export from sync-core's index.

- [ ] **Step 9: Typecheck everything.**

```bash
pnpm install   # link new packages into node_modules
pnpm -r typecheck
```

Expected: clean across all packages. Fix any straggler imports.

- [ ] **Step 10: Run all tests.**

```bash
pnpm -r test:unit
pnpm --filter @pazarsync/api test:integration
pnpm --filter web test
```

Expected: same numbers as PR 2 baseline (113 + 134 + 198) — this PR is mechanical refactor only.

- [ ] **Step 11: Commit, push, open PR.**

```bash
git add -A
git commit -m "$(cat <<'EOF'
refactor(sync): extract marketplace + sync-core into shared packages

Extracts code that both apps/api (enqueue + connect-probe) and the
incoming apps/sync-worker (chunk processing) need:

- packages/marketplace/ — Trendyol/Hepsiburada adapters, mappers, types
- packages/sync-core/ — sync-log service, sync-specific error classes,
  crypto helpers, mapPrismaError

Pure refactor — no behavior change. apps/api imports updated
throughout. apps/api/src/lib/errors.ts re-exports the moved sync
errors so existing call sites stay unchanged.

Foundation for the worker app (PR 4) which needs to share these
modules without cross-app imports.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push
gh pr create --title "refactor(sync): extract marketplace + sync-core packages" --body "$(cat <<'EOF'
## Summary
Mechanical extraction so api + (forthcoming) sync-worker can share code without cross-app imports.

- New: packages/marketplace/ (Trendyol adapter / mappers / types)
- New: packages/sync-core/ (sync-log service / sync errors / crypto / mapPrismaError)
- apps/api imports updated throughout

No behavior change.

## Test plan
- [x] pnpm -r typecheck
- [x] pnpm -r test:unit
- [x] pnpm --filter @pazarsync/api test:integration
- [x] pnpm --filter web test

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 12: Wait for CI green, merge, rebase.**

```bash
gh pr checks --watch
gh pr merge --squash --delete-branch=false
git checkout main && git pull && git checkout feat/sync-worker-architecture && git rebase main
```

---

## PR 4 — Worker app + API cutover (atomic switch)

**Why:** Worker without API cutover = idle worker (no PENDING rows). API cutover without worker = stuck PENDING rows. They must ship together. This is the largest PR — split into commits within the PR for review hygiene, but ship as one merge.

### Files

**Create — `apps/sync-worker/`:**
- `apps/sync-worker/package.json`
- `apps/sync-worker/tsconfig.json`
- `apps/sync-worker/Dockerfile` (for deployment)
- `apps/sync-worker/src/index.ts` (entry point)
- `apps/sync-worker/src/loop.ts` (claim → dispatch → tick)
- `apps/sync-worker/src/dispatcher.ts` (module routing)
- `apps/sync-worker/src/handlers/products.ts` (port from existing service)
- `apps/sync-worker/src/handlers/types.ts` (`ModuleHandler`, `ChunkResult`)
- `apps/sync-worker/src/watchdog.ts` (stale-claim sweep)
- `apps/sync-worker/src/shutdown.ts` (SIGTERM handling)
- `apps/sync-worker/tests/unit/loop.test.ts`
- `apps/sync-worker/tests/unit/dispatcher.test.ts`
- `apps/sync-worker/tests/unit/watchdog.test.ts`
- `apps/sync-worker/tests/integration/products-handler.test.ts`
- `apps/sync-worker/tests/integration/end-to-end.test.ts` (full enqueue → claim → process → complete)

**Create — `packages/sync-core/src/`:**
- `packages/sync-core/src/claim.ts` (the SQL claim helper, used by both worker and watchdog)
- `packages/sync-core/src/checkpoint.ts` (Zod parsers per cursor kind)

**Modify:**
- `apps/api/src/routes/product.routes.ts` (drop `runInBackground`, INSERT PENDING, handle P2002)
- `apps/api/src/services/sync-log.service.ts` (delete old `acquireSlot` race-resolve code; rename `start()` semantics)
- `apps/api/tests/integration/routes/product.routes.test.ts` (assert PENDING + 409 path)

**Create — cutover:**
- `packages/db/scripts/cutover-stale-running.ts` (one-shot script)

### Tasks

#### 4a. `packages/sync-core/src/claim.ts` (the claim SQL helper)

- [ ] **Step 1: Write the failing test first.**

Create `packages/sync-core/src/claim.test.ts`:

```ts
import { prisma } from '@pazarsync/db';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { tryClaimNext } from './claim';

// Reuses apps/api test helpers — wire that up in vitest.config.ts later.
import { createMembership, createOrganization, createStore, createUserProfile } from '../../../apps/api/tests/helpers/factories';
import { ensureDbReachable, truncateAll } from '../../../apps/api/tests/helpers/db';

describe('tryClaimNext', () => {
  beforeAll(async () => { await ensureDbReachable(); });
  beforeEach(async () => { await truncateAll(); });

  it('returns null when no PENDING rows exist', async () => {
    const result = await tryClaimNext('worker-test-1');
    expect(result).toBeNull();
  });

  it('claims a PENDING row and transitions it to RUNNING with worker id', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);
    const log = await prisma.syncLog.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        syncType: 'PRODUCTS',
        status: 'PENDING',
        startedAt: new Date(),
      },
    });

    const claimed = await tryClaimNext('worker-test-1');
    expect(claimed).not.toBeNull();
    expect(claimed?.id).toBe(log.id);
    expect(claimed?.status).toBe('RUNNING');
    expect(claimed?.claimedBy).toBe('worker-test-1');
    expect(claimed?.claimedAt).not.toBeNull();
    expect(claimed?.lastTickAt).not.toBeNull();
    expect(claimed?.attemptCount).toBe(1);
  });

  it('claims a FAILED_RETRYABLE row when nextAttemptAt has passed', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);
    const log = await prisma.syncLog.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        syncType: 'PRODUCTS',
        status: 'FAILED_RETRYABLE',
        startedAt: new Date(),
        attemptCount: 2,
        nextAttemptAt: new Date(Date.now() - 1000),
      },
    });

    const claimed = await tryClaimNext('worker-test-2');
    expect(claimed?.id).toBe(log.id);
    expect(claimed?.status).toBe('RUNNING');
    expect(claimed?.attemptCount).toBe(3);
  });

  it('skips FAILED_RETRYABLE rows whose nextAttemptAt is in the future', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await createStore(org.id);
    await prisma.syncLog.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        syncType: 'PRODUCTS',
        status: 'FAILED_RETRYABLE',
        startedAt: new Date(),
        attemptCount: 2,
        nextAttemptAt: new Date(Date.now() + 60_000),
      },
    });

    const claimed = await tryClaimNext('worker-test-3');
    expect(claimed).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test, confirm it fails.**

```bash
cd packages/sync-core
pnpm vitest run src/claim.test.ts
```

Expected: FAIL — `tryClaimNext is not a function` (file doesn't exist).

- [ ] **Step 3: Write the minimal implementation.**

Create `packages/sync-core/src/claim.ts`:

```ts
import { prisma } from '@pazarsync/db';
import type { SyncLog } from '@pazarsync/db';

/**
 * Atomically claim the next available sync_logs row for a worker.
 * Returns null if nothing is claimable.
 *
 * Concurrency: SELECT … FOR UPDATE SKIP LOCKED — multiple workers can
 * call this simultaneously; whoever loses the race on a row sees null
 * and tries again on the next poll tick.
 *
 * Claimable rows:
 *   - status = 'PENDING'
 *   - status = 'FAILED_RETRYABLE' AND nextAttemptAt <= now()
 *
 * On success the row transitions to RUNNING with claimedAt/claimedBy
 * stamped and attemptCount incremented.
 */
export async function tryClaimNext(workerId: string): Promise<SyncLog | null> {
  const rows = await prisma.$queryRaw<SyncLog[]>`
    UPDATE sync_logs SET
      status = 'RUNNING',
      claimed_at = now(),
      claimed_by = ${workerId},
      last_tick_at = now(),
      attempt_count = attempt_count + 1
    WHERE id = (
      SELECT id FROM sync_logs
       WHERE (status = 'PENDING')
          OR (status = 'FAILED_RETRYABLE' AND next_attempt_at <= now())
       ORDER BY started_at
       FOR UPDATE SKIP LOCKED
       LIMIT 1
    )
    RETURNING *
  `;
  return rows[0] ?? null;
}
```

Note: $queryRaw returns snake_case columns. If the SyncLog Prisma type uses camelCase, an explicit projection or post-hoc remap is needed. If tests fail on field-name mismatch, switch to `prisma.syncLog.findUnique` after the UPDATE — but that's two round-trips. Preferred approach: use Prisma's `$transaction` with an interactive transaction so Prisma maps the result. If your Prisma version supports `prisma.syncLog.update` with `WHERE id IN (subquery)`, prefer that.

Cleaner alternative (uses Prisma's native types):

```ts
import { prisma } from '@pazarsync/db';
import type { SyncLog } from '@pazarsync/db';

export async function tryClaimNext(workerId: string): Promise<SyncLog | null> {
  // Two-step: select a candidate id, then update by id. SKIP LOCKED on
  // the select still gives multi-worker safety; the UPDATE … RETURNING
  // gives us the typed row Prisma expects.
  return prisma.$transaction(async (tx) => {
    const candidates = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM sync_logs
       WHERE (status = 'PENDING')
          OR (status = 'FAILED_RETRYABLE' AND next_attempt_at <= now())
       ORDER BY started_at
       FOR UPDATE SKIP LOCKED
       LIMIT 1
    `;
    const id = candidates[0]?.id;
    if (id === undefined) return null;
    return tx.syncLog.update({
      where: { id },
      data: {
        status: 'RUNNING',
        claimedAt: new Date(),
        claimedBy: workerId,
        lastTickAt: new Date(),
        attemptCount: { increment: 1 },
      },
    });
  });
}
```

- [ ] **Step 4: Run the test, confirm it passes.**

```bash
pnpm vitest run src/claim.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit.**

```bash
git add packages/sync-core/src/claim.ts packages/sync-core/src/claim.test.ts
git commit -m "feat(sync-core): add tryClaimNext SKIP LOCKED claim helper"
```

#### 4b. `packages/sync-core/src/checkpoint.ts` (cursor parsers)

- [ ] **Step 6: Define the cursor schema and parsers.**

Create `packages/sync-core/src/checkpoint.ts`:

```ts
import { z } from 'zod';

/** Cursor shape for page-index pagination (Trendyol fallback). */
export const PageIndexCursorSchema = z.object({
  kind: z.literal('page'),
  n: z.number().int().min(0),
});
export type PageIndexCursor = z.infer<typeof PageIndexCursorSchema>;

/** Cursor shape for opaque-token pagination (Trendyol nextPageToken). */
export const PageTokenCursorSchema = z.object({
  kind: z.literal('token'),
  token: z.string().min(1),
});
export type PageTokenCursor = z.infer<typeof PageTokenCursorSchema>;

/** Trendyol products module's cursor (one of the two shapes). */
export const ProductsCursorSchema = z.discriminatedUnion('kind', [
  PageIndexCursorSchema,
  PageTokenCursorSchema,
]);
export type ProductsCursor = z.infer<typeof ProductsCursorSchema>;

/**
 * Parse a SyncLog.pageCursor (jsonb, possibly null) for the products
 * module. Returns null when the row has no cursor yet (fresh sync).
 * Throws ZodError if the column holds malformed data — that's a sync
 * the worker should mark FAILED ('CORRUPT_CHECKPOINT').
 */
export function parseProductsCursor(raw: unknown): ProductsCursor | null {
  if (raw === null || raw === undefined) return null;
  return ProductsCursorSchema.parse(raw);
}
```

Add `zod` as a dependency in `packages/sync-core/package.json`:

```json
"dependencies": {
  "@pazarsync/db": "workspace:*",
  "zod": "^4"
}
```

- [ ] **Step 7: Commit.**

```bash
git add packages/sync-core/src/checkpoint.ts packages/sync-core/package.json
git commit -m "feat(sync-core): add Zod-typed cursor parsers per module"
```

#### 4c. `apps/sync-worker` skeleton

- [ ] **Step 8: Scaffold the worker app.**

```bash
mkdir -p apps/sync-worker/src/handlers apps/sync-worker/tests/unit apps/sync-worker/tests/integration
```

Create `apps/sync-worker/package.json`:

```json
{
  "name": "@pazarsync/sync-worker",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "scripts": {
    "start": "tsx src/index.ts",
    "dev": "tsx watch src/index.ts",
    "typecheck": "tsc --noEmit",
    "test:unit": "vitest run tests/unit",
    "test:integration": "vitest run tests/integration"
  },
  "dependencies": {
    "@pazarsync/db": "workspace:*",
    "@pazarsync/marketplace": "workspace:*",
    "@pazarsync/sync-core": "workspace:*"
  },
  "devDependencies": {
    "tsx": "^4.19.0",
    "typescript": "^6",
    "vitest": "^4"
  }
}
```

Create `apps/sync-worker/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": ".",
    "outDir": "dist",
    "noEmit": true
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

Create `apps/sync-worker/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    fileParallelism: false, // integration tests share one DB
    globals: false,
    environment: 'node',
  },
});
```

- [ ] **Step 9: Implement `apps/sync-worker/src/handlers/types.ts`.**

```ts
// apps/sync-worker/src/handlers/types.ts
import type { SyncLog } from '@pazarsync/db';

export type ChunkResult =
  | {
      kind: 'continue';
      cursor: unknown;
      progress: number;
      total: number | null;
      stage: string;
    }
  | {
      kind: 'done';
      finalCount: number;
    };

export interface ModuleHandler {
  processChunk(input: {
    syncLog: SyncLog;
    cursor: unknown | null;
  }): Promise<ChunkResult>;
}
```

- [ ] **Step 10: Write a failing test for the dispatcher.**

Create `apps/sync-worker/tests/unit/dispatcher.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { dispatch } from '../../src/dispatcher';
import type { SyncLog } from '@pazarsync/db';

describe('dispatcher', () => {
  it('routes PRODUCTS sync logs to the products handler', async () => {
    const syncLog = { syncType: 'PRODUCTS', id: 'log-1' } as unknown as SyncLog;
    const handler = { processChunk: vi.fn().mockResolvedValue({ kind: 'done', finalCount: 0 }) };
    const fakeRegistry = { PRODUCTS: handler } as never;
    const result = await dispatch(fakeRegistry, syncLog);
    expect(handler.processChunk).toHaveBeenCalledWith({ syncLog, cursor: null });
    expect(result.kind).toBe('done');
  });

  it('throws on an unregistered syncType', async () => {
    const syncLog = { syncType: 'ORDERS', id: 'log-2' } as unknown as SyncLog;
    await expect(dispatch({} as never, syncLog)).rejects.toThrow(/no handler/i);
  });
});
```

- [ ] **Step 11: Implement the dispatcher.**

Create `apps/sync-worker/src/dispatcher.ts`:

```ts
import type { SyncLog, SyncType } from '@pazarsync/db';
import { parseProductsCursor } from '@pazarsync/sync-core';

import type { ChunkResult, ModuleHandler } from './handlers/types';

export type Registry = Partial<Record<SyncType, ModuleHandler>>;

/**
 * Decode the SyncLog.pageCursor for the syncType, then hand off to
 * the registered module handler. Throws if no handler is registered
 * for the SyncLog's type.
 */
export async function dispatch(
  registry: Registry,
  syncLog: SyncLog,
): Promise<ChunkResult> {
  const handler = registry[syncLog.syncType];
  if (handler === undefined) {
    throw new Error(`No handler registered for syncType=${syncLog.syncType}`);
  }
  const cursor = decodeCursor(syncLog);
  return handler.processChunk({ syncLog, cursor });
}

function decodeCursor(syncLog: SyncLog): unknown | null {
  switch (syncLog.syncType) {
    case 'PRODUCTS':
      return parseProductsCursor(syncLog.pageCursor);
    case 'ORDERS':
    case 'SETTLEMENTS':
      return syncLog.pageCursor; // future: dedicated parsers per module
    default: {
      const _exhaustive: never = syncLog.syncType;
      throw new Error(`Unknown syncType: ${_exhaustive}`);
    }
  }
}
```

- [ ] **Step 12: Run the dispatcher test.**

```bash
cd apps/sync-worker
pnpm vitest run tests/unit/dispatcher.test.ts
```

Expected: 2 tests pass.

- [ ] **Step 13: Commit.**

```bash
git add apps/sync-worker/
git commit -m "feat(sync-worker): scaffold app + dispatcher with module routing"
```

#### 4d. The products handler (port from existing `productSyncService.run`)

- [ ] **Step 14: Write a failing integration test for the products handler.**

Create `apps/sync-worker/tests/integration/products-handler.test.ts`:

```ts
import { prisma } from '@pazarsync/db';
import { encryptCredentials } from '@pazarsync/sync-core';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Reuse api test helpers; sync-worker shares the same local DB.
import { ensureDbReachable, truncateAll } from '../../../apps/api/tests/helpers/db';
import { createMembership, createOrganization, createUserProfile } from '../../../apps/api/tests/helpers/factories';

import { processProductsChunk } from '../../src/handlers/products';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('processProductsChunk', () => {
  beforeAll(async () => { await ensureDbReachable(); });
  beforeEach(async () => { await truncateAll(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('processes one Trendyol page: upserts products, returns cursor for next page', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await prisma.store.create({
      data: {
        organizationId: org.id,
        name: 'TestStore',
        platform: 'TRENDYOL',
        environment: 'PRODUCTION',
        externalAccountId: '2738',
        credentials: encryptCredentials({ supplierId: '2738', apiKey: 'k', apiSecret: 's' }),
      },
    });
    const syncLog = await prisma.syncLog.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        syncType: 'PRODUCTS',
        status: 'RUNNING',
        startedAt: new Date(),
        claimedAt: new Date(),
        claimedBy: 'worker-test',
        lastTickAt: new Date(),
        attemptCount: 1,
      },
    });

    // Mock Trendyol response: 1 page of 1 content with 1 variant, more pages remaining.
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({
        totalElements: 200,
        totalPages: 2,
        page: 0,
        size: 100,
        content: [
          {
            contentId: 1001,
            productMainId: 'pm-1',
            brand: { id: 100, name: 'TestBrand' },
            category: { id: 200, name: 'TestCategory' },
            creationDate: 1777246115403,
            lastModifiedDate: 1777246115403,
            title: 'Test Product',
            attributes: [],
            variants: [
              {
                variantId: 10010,
                supplierId: 2738,
                barcode: 'bc-1',
                stockCode: 'sk-1',
                attributes: [],
                onSale: true,
                deliveryOptions: { deliveryDuration: 1, isRushDelivery: false, fastDeliveryOptions: [] },
                stock: { quantity: 5, lastModifiedDate: 0 },
                price: { salePrice: 100, listPrice: 100 },
                vatRate: 20,
                locked: false,
                archived: false,
                blacklisted: false,
              },
            ],
          },
        ],
      }),
    );

    const result = await processProductsChunk({ syncLog, cursor: null });

    expect(result.kind).toBe('continue');
    if (result.kind === 'continue') {
      expect(result.progress).toBe(1);
      expect(result.total).toBe(200);
      expect(result.stage).toBe('upserting');
      expect(result.cursor).toEqual({ kind: 'page', n: 1 });
    }

    const products = await prisma.product.findMany({ where: { storeId: store.id } });
    expect(products).toHaveLength(1);
  });

  it('returns kind=done when totalElements is reached', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await prisma.store.create({
      data: {
        organizationId: org.id,
        name: 'TestStore',
        platform: 'TRENDYOL',
        environment: 'PRODUCTION',
        externalAccountId: '2738',
        credentials: encryptCredentials({ supplierId: '2738', apiKey: 'k', apiSecret: 's' }),
      },
    });
    const syncLog = await prisma.syncLog.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        syncType: 'PRODUCTS',
        status: 'RUNNING',
        startedAt: new Date(),
        claimedAt: new Date(),
        claimedBy: 'worker-test',
        lastTickAt: new Date(),
        attemptCount: 1,
        progressCurrent: 100,
        progressTotal: 100,
      },
    });

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({
        totalElements: 100,
        totalPages: 1,
        page: 1,
        size: 100,
        content: [], // empty page → done
      }),
    );

    const result = await processProductsChunk({
      syncLog,
      cursor: { kind: 'page', n: 1 },
    });
    expect(result.kind).toBe('done');
  });
});
```

- [ ] **Step 15: Implement the products handler.**

Create `apps/sync-worker/src/handlers/products.ts`:

```ts
import { prisma } from '@pazarsync/db';
import type { SyncLog, Store } from '@pazarsync/db';
import {
  fetchApprovedProducts,
  isTrendyolCredentials,
  type MappedProduct,
} from '@pazarsync/marketplace';
import {
  decryptCredentials,
  parseProductsCursor,
  type ProductsCursor,
} from '@pazarsync/sync-core';

import type { ChunkResult, ModuleHandler } from './types';

const PAGE_SIZE = 100;

/**
 * Process exactly one Trendyol /products/approved page for a sync.
 * Returns a continue-with-cursor result if more pages remain, or
 * done if the catalog is exhausted.
 */
export async function processProductsChunk(input: {
  syncLog: SyncLog;
  cursor: unknown | null;
}): Promise<ChunkResult> {
  const { syncLog } = input;
  const cursor = parseProductsCursor(input.cursor);
  const store = await prisma.store.findUniqueOrThrow({ where: { id: syncLog.storeId } });
  const credentials = decryptStoreCredentials(store);

  // Drive the existing async-generator one step. We don't loop the
  // generator inside the handler — that's the worker's responsibility.
  const generator = fetchApprovedProducts({
    environment: store.environment,
    credentials,
    initialCursor: cursor,
  });
  const { value, done } = await generator.next();

  if (done === true || value === undefined) {
    return { kind: 'done', finalCount: syncLog.progressCurrent };
  }

  const { batch, pageMeta } = value;

  if (batch.length === 0) {
    return { kind: 'done', finalCount: syncLog.progressCurrent };
  }

  await upsertBatch(store, batch);

  const newProgress = syncLog.progressCurrent + batch.length;

  // Compute next cursor.
  let nextCursor: ProductsCursor;
  if (pageMeta.nextPageToken !== null && pageMeta.nextPageToken !== undefined) {
    nextCursor = { kind: 'token', token: pageMeta.nextPageToken };
  } else {
    const currentN = cursor === null ? 0 : (cursor.kind === 'page' ? cursor.n : 0);
    nextCursor = { kind: 'page', n: currentN + 1 };
  }

  // Done detection: total reached, or empty page (handled above).
  if (newProgress >= pageMeta.totalElements) {
    return { kind: 'done', finalCount: newProgress };
  }

  return {
    kind: 'continue',
    cursor: nextCursor,
    progress: newProgress,
    total: pageMeta.totalElements,
    stage: 'upserting',
  };
}

export const productsHandler: ModuleHandler = { processChunk: processProductsChunk };

function decryptStoreCredentials(store: Store) {
  const decrypted = decryptCredentials(store.credentials as string);
  if (!isTrendyolCredentials(decrypted)) {
    throw new Error('Invalid Trendyol credentials shape on store');
  }
  return decrypted;
}

async function upsertBatch(store: Store, batch: MappedProduct[]): Promise<void> {
  // (Port from apps/api/src/services/product-sync.service.ts upsertBatch — same logic;
  //  per-content try/catch, transaction per content, image replace semantics.)
  // ─── COPY FULL upsertBatch BODY HERE ───
  // See apps/api/src/services/product-sync.service.ts:93-225 for the existing implementation.
  for (const mapped of batch) {
    try {
      await prisma.$transaction(async (tx) => {
        const product = await tx.product.upsert({
          where: { storeId_platformContentId: { storeId: store.id, platformContentId: mapped.platformContentId } },
          create: {
            organizationId: store.organizationId,
            storeId: store.id,
            platformContentId: mapped.platformContentId,
            productMainId: mapped.productMainId,
            title: mapped.title,
            description: mapped.description,
            brandId: mapped.brandId,
            brandName: mapped.brandName,
            categoryId: mapped.categoryId,
            categoryName: mapped.categoryName,
            color: mapped.color,
            attributes: mapped.attributes as never,
            platformCreatedAt: mapped.platformCreatedAt,
            platformModifiedAt: mapped.platformModifiedAt,
            lastSyncedAt: new Date(),
          },
          update: {
            productMainId: mapped.productMainId,
            title: mapped.title,
            description: mapped.description,
            brandId: mapped.brandId,
            brandName: mapped.brandName,
            categoryId: mapped.categoryId,
            categoryName: mapped.categoryName,
            color: mapped.color,
            attributes: mapped.attributes as never,
            platformCreatedAt: mapped.platformCreatedAt,
            platformModifiedAt: mapped.platformModifiedAt,
            lastSyncedAt: new Date(),
          },
        });

        for (const variant of mapped.variants) {
          await tx.productVariant.upsert({
            where: { storeId_platformVariantId: { storeId: store.id, platformVariantId: variant.platformVariantId } },
            create: {
              organizationId: store.organizationId,
              storeId: store.id,
              productId: product.id,
              platformVariantId: variant.platformVariantId,
              barcode: variant.barcode,
              stockCode: variant.stockCode,
              salePrice: variant.salePrice,
              listPrice: variant.listPrice,
              vatRate: variant.vatRate,
              quantity: variant.quantity,
              deliveryDuration: variant.deliveryDuration,
              isRushDelivery: variant.isRushDelivery,
              fastDeliveryOptions: variant.fastDeliveryOptions as never,
              productUrl: variant.productUrl,
              locationBasedDelivery: variant.locationBasedDelivery,
              onSale: variant.onSale,
              archived: variant.archived,
              blacklisted: variant.blacklisted,
              locked: variant.locked,
              size: variant.size,
              attributes: variant.attributes as never,
              lastSyncedAt: new Date(),
            },
            update: {
              barcode: variant.barcode,
              stockCode: variant.stockCode,
              salePrice: variant.salePrice,
              listPrice: variant.listPrice,
              vatRate: variant.vatRate,
              quantity: variant.quantity,
              deliveryDuration: variant.deliveryDuration,
              isRushDelivery: variant.isRushDelivery,
              fastDeliveryOptions: variant.fastDeliveryOptions as never,
              productUrl: variant.productUrl,
              locationBasedDelivery: variant.locationBasedDelivery,
              onSale: variant.onSale,
              archived: variant.archived,
              blacklisted: variant.blacklisted,
              locked: variant.locked,
              size: variant.size,
              attributes: variant.attributes as never,
              lastSyncedAt: new Date(),
            },
          });
        }

        await tx.productImage.deleteMany({ where: { productId: product.id } });
        if (mapped.images.length > 0) {
          await tx.productImage.createMany({
            data: mapped.images.map((img) => ({
              organizationId: store.organizationId,
              productId: product.id,
              url: img.url,
              position: img.position,
            })),
          });
        }
      });
    } catch (err) {
      console.error('[product-sync] content-upsert failed', {
        storeId: store.id,
        platformContentId: mapped.platformContentId.toString(),
        productMainId: mapped.productMainId,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
```

- [ ] **Step 16: Update `fetchApprovedProducts` to accept an `initialCursor`.**

Modify `packages/marketplace/src/trendyol/products.ts`:

```ts
// At the top of FetchApprovedProductsOpts:
export interface FetchApprovedProductsOpts {
  baseUrl?: string;
  environment?: StoreEnvironment;
  credentials: TrendyolCredentials;
  signal?: AbortSignal;
  /** Resume from a previously-saved cursor (null = start at page 0). */
  initialCursor?: { kind: 'page'; n: number } | { kind: 'token'; token: string } | null;
}

// In the generator body, replace `let page = 0` initialization with:
let page = opts.initialCursor?.kind === 'page' ? opts.initialCursor.n : 0;
let pendingToken: string | undefined =
  opts.initialCursor?.kind === 'token' ? opts.initialCursor.token : undefined;
```

- [ ] **Step 17: Run the products handler test.**

```bash
cd apps/sync-worker
pnpm vitest run tests/integration/products-handler.test.ts
```

Expected: 2 tests pass.

- [ ] **Step 18: Commit.**

```bash
git add apps/sync-worker/src/handlers/products.ts apps/sync-worker/src/handlers/types.ts \
        apps/sync-worker/tests/integration/products-handler.test.ts \
        packages/marketplace/src/trendyol/products.ts
git commit -m "feat(sync-worker): port products handler — one chunk per Trendyol page"
```

#### 4e. The worker loop

- [ ] **Step 19: Write a failing test for the worker loop (mocked claim + handler).**

Create `apps/sync-worker/tests/unit/loop.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { SyncLog } from '@pazarsync/db';

describe('runSyncToCompletion', () => {
  it('drives the handler until kind=done, ticking after each chunk', async () => {
    const fakeSyncLog = { id: 'log-1', syncType: 'PRODUCTS', progressCurrent: 0, pageCursor: null } as unknown as SyncLog;
    const tickMock = vi.fn();
    const completeMock = vi.fn();

    const handler = {
      processChunk: vi.fn()
        .mockResolvedValueOnce({ kind: 'continue', cursor: { kind: 'page', n: 1 }, progress: 100, total: 200, stage: 'upserting' })
        .mockResolvedValueOnce({ kind: 'continue', cursor: { kind: 'page', n: 2 }, progress: 200, total: 200, stage: 'upserting' })
        .mockResolvedValueOnce({ kind: 'done', finalCount: 200 }),
    };

    vi.doMock('@pazarsync/sync-core', () => ({
      syncLogService: {
        tick: tickMock,
        complete: completeMock,
        releaseToPending: vi.fn(),
      },
    }));

    const { runSyncToCompletion } = await import('../../src/loop');
    await runSyncToCompletion(fakeSyncLog, { PRODUCTS: handler } as never, () => false);

    expect(handler.processChunk).toHaveBeenCalledTimes(3);
    expect(tickMock).toHaveBeenCalledTimes(2); // ticks only on continue, not on done
    expect(completeMock).toHaveBeenCalledWith('log-1', 200);
  });

  it('stops between chunks when shuttingDown returns true and releases the row', async () => {
    const fakeSyncLog = { id: 'log-2', syncType: 'PRODUCTS', progressCurrent: 0, pageCursor: null } as unknown as SyncLog;
    const releaseMock = vi.fn();

    const handler = {
      processChunk: vi.fn().mockResolvedValue({ kind: 'continue', cursor: { kind: 'page', n: 1 }, progress: 100, total: 999, stage: 'upserting' }),
    };

    vi.doMock('@pazarsync/sync-core', () => ({
      syncLogService: { tick: vi.fn(), complete: vi.fn(), releaseToPending: releaseMock },
    }));

    const { runSyncToCompletion } = await import('../../src/loop');
    let shutdownTriggered = false;
    await runSyncToCompletion(fakeSyncLog, { PRODUCTS: handler } as never, () => {
      const was = shutdownTriggered;
      shutdownTriggered = true; // first call returns false, second returns true
      return was;
    });

    expect(releaseMock).toHaveBeenCalledWith('log-2');
  });
});
```

- [ ] **Step 20: Implement the worker loop.**

Create `apps/sync-worker/src/loop.ts`:

```ts
import type { SyncLog } from '@pazarsync/db';
import { syncLogService } from '@pazarsync/sync-core';

import { dispatch, type Registry } from './dispatcher';

/**
 * Drive a claimed SyncLog through chunks until done or shutdown.
 * Throws on chunk error — the outer claim loop catches and decides
 * FAILED vs FAILED_RETRYABLE.
 */
export async function runSyncToCompletion(
  syncLog: SyncLog,
  registry: Registry,
  shuttingDown: () => boolean,
): Promise<void> {
  let workingLog: SyncLog = syncLog;

  while (!shuttingDown()) {
    const result = await dispatch(registry, workingLog);

    if (result.kind === 'done') {
      await syncLogService.complete(workingLog.id, result.finalCount);
      return;
    }

    await syncLogService.tick(workingLog.id, {
      cursor: result.cursor,
      progress: result.progress,
      total: result.total,
      stage: result.stage,
    });

    workingLog = {
      ...workingLog,
      progressCurrent: result.progress,
      progressTotal: result.total,
      pageCursor: result.cursor as never, // jsonb
    };
  }

  // Graceful shutdown path: hand the row back to PENDING.
  await syncLogService.releaseToPending(workingLog.id);
}
```

- [ ] **Step 21: Add the new sync-log lifecycle helpers (`tick`, `releaseToPending`).**

Modify `packages/sync-core/src/sync-log.service.ts` — add:

```ts
export interface TickInput {
  cursor: unknown;
  progress: number;
  total: number | null;
  stage: string;
}

export async function tick(syncLogId: string, input: TickInput): Promise<void> {
  await prisma.syncLog.update({
    where: { id: syncLogId },
    data: {
      lastTickAt: new Date(),
      pageCursor: input.cursor as never,
      progressCurrent: input.progress,
      progressTotal: input.total,
      progressStage: input.stage,
    },
  });
}

export async function releaseToPending(syncLogId: string): Promise<void> {
  await prisma.syncLog.update({
    where: { id: syncLogId },
    data: {
      status: 'PENDING',
      claimedAt: null,
      claimedBy: null,
    },
  });
}

export async function markRetryable(
  syncLogId: string,
  attemptCount: number,
  errorCode: string,
  errorMessage: string,
): Promise<void> {
  // Exponential backoff: 30s × 2^attemptCount, capped at 30 minutes.
  const backoffMs = Math.min(30_000 * Math.pow(2, attemptCount - 1), 30 * 60_000);
  await prisma.syncLog.update({
    where: { id: syncLogId },
    data: {
      status: 'FAILED_RETRYABLE',
      errorCode,
      errorMessage,
      nextAttemptAt: new Date(Date.now() + backoffMs),
      claimedAt: null,
      claimedBy: null,
    },
  });
}
```

- [ ] **Step 22: Run the loop test.**

```bash
cd apps/sync-worker
pnpm vitest run tests/unit/loop.test.ts
```

Expected: 2 tests pass.

- [ ] **Step 23: Commit.**

```bash
git add apps/sync-worker/src/loop.ts apps/sync-worker/tests/unit/loop.test.ts \
        packages/sync-core/src/sync-log.service.ts
git commit -m "feat(sync-worker): worker loop drives chunks → tick → done | release on shutdown"
```

#### 4f. The watchdog

- [ ] **Step 24: Write a failing watchdog test.**

Create `apps/sync-worker/tests/integration/watchdog.test.ts`:

```ts
import { prisma } from '@pazarsync/db';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ensureDbReachable, truncateAll } from '../../../apps/api/tests/helpers/db';
import { createMembership, createOrganization, createUserProfile } from '../../../apps/api/tests/helpers/factories';
import { sweepStaleClaims } from '../../src/watchdog';

describe('sweepStaleClaims', () => {
  beforeAll(async () => { await ensureDbReachable(); });
  beforeEach(async () => { await truncateAll(); });

  it('requeues a RUNNING row whose lastTickAt is older than the threshold', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await prisma.store.create({
      data: {
        organizationId: org.id,
        name: 'Test',
        platform: 'TRENDYOL',
        environment: 'PRODUCTION',
        externalAccountId: 'x',
        credentials: 'opaque',
      },
    });

    const stale = await prisma.syncLog.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        syncType: 'PRODUCTS',
        status: 'RUNNING',
        startedAt: new Date(Date.now() - 5 * 60_000),
        claimedAt: new Date(Date.now() - 5 * 60_000),
        claimedBy: 'worker-dead',
        lastTickAt: new Date(Date.now() - 2 * 60_000), // 2 min ago, threshold 90s
        attemptCount: 1,
      },
    });

    const reaped = await sweepStaleClaims();
    expect(reaped).toBe(1);

    const reaped_row = await prisma.syncLog.findUniqueOrThrow({ where: { id: stale.id } });
    expect(reaped_row.status).toBe('PENDING');
    expect(reaped_row.claimedAt).toBeNull();
    expect(reaped_row.claimedBy).toBeNull();
  });

  it('does not touch fresh RUNNING rows', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id);
    const store = await prisma.store.create({
      data: {
        organizationId: org.id,
        name: 'Test',
        platform: 'TRENDYOL',
        environment: 'PRODUCTION',
        externalAccountId: 'x',
        credentials: 'opaque',
      },
    });

    const fresh = await prisma.syncLog.create({
      data: {
        organizationId: org.id,
        storeId: store.id,
        syncType: 'PRODUCTS',
        status: 'RUNNING',
        startedAt: new Date(),
        claimedAt: new Date(),
        claimedBy: 'worker-alive',
        lastTickAt: new Date(),
        attemptCount: 1,
      },
    });

    expect(await sweepStaleClaims()).toBe(0);

    const unchanged = await prisma.syncLog.findUniqueOrThrow({ where: { id: fresh.id } });
    expect(unchanged.status).toBe('RUNNING');
  });
});
```

- [ ] **Step 25: Implement the watchdog.**

Create `apps/sync-worker/src/watchdog.ts`:

```ts
import { prisma } from '@pazarsync/db';

const STALE_THRESHOLD_SECONDS = 90;

/**
 * Mark RUNNING rows with stale heartbeats as PENDING so a peer
 * worker (or post-restart self) can reclaim them. Idempotent —
 * safe to run from every worker every 30 s.
 *
 * Returns the number of rows reaped.
 */
export async function sweepStaleClaims(): Promise<number> {
  const result = await prisma.$executeRaw`
    UPDATE sync_logs SET
      status = 'PENDING',
      claimed_at = NULL,
      claimed_by = NULL
    WHERE status = 'RUNNING'
      AND last_tick_at < now() - interval '${STALE_THRESHOLD_SECONDS} seconds'
  `;
  return Number(result);
}
```

- [ ] **Step 26: Run the watchdog test.**

```bash
pnpm vitest run tests/integration/watchdog.test.ts
```

Expected: 2 tests pass.

- [ ] **Step 27: Commit.**

```bash
git add apps/sync-worker/src/watchdog.ts apps/sync-worker/tests/integration/watchdog.test.ts
git commit -m "feat(sync-worker): watchdog sweeps stale RUNNING rows back to PENDING"
```

#### 4g. Worker entry point + shutdown handling

- [ ] **Step 28: Implement the entry point.**

Create `apps/sync-worker/src/index.ts`:

```ts
import { randomBytes } from 'node:crypto';

import { syncLogService, markRetryable } from '@pazarsync/sync-core';
import { tryClaimNext } from '@pazarsync/sync-core';

import { dispatch, type Registry } from './dispatcher';
import { productsHandler } from './handlers/products';
import { runSyncToCompletion } from './loop';
import { sweepStaleClaims } from './watchdog';

const WORKER_ID = `worker-${randomBytes(4).toString('hex')}`;
const POLL_BACKOFF_INITIAL_MS = 100;
const POLL_BACKOFF_MAX_MS = 5_000;
const WATCHDOG_INTERVAL_MS = 30_000;
const MAX_ATTEMPTS = 5;

const REGISTRY: Registry = {
  PRODUCTS: productsHandler,
  // ORDERS, SETTLEMENTS, MESSAGES will register here as they land.
};

let shuttingDown = false;
function isShuttingDown(): boolean { return shuttingDown; }

async function main(): Promise<void> {
  console.log(`[${WORKER_ID}] sync-worker starting`);

  process.on('SIGTERM', () => { shuttingDown = true; console.log(`[${WORKER_ID}] SIGTERM received`); });
  process.on('SIGINT',  () => { shuttingDown = true; console.log(`[${WORKER_ID}] SIGINT received`); });

  const watchdogTimer = setInterval(() => {
    sweepStaleClaims().catch((err) => console.error(`[${WORKER_ID}] watchdog error`, err));
  }, WATCHDOG_INTERVAL_MS);

  let backoff = POLL_BACKOFF_INITIAL_MS;

  while (!shuttingDown) {
    try {
      const claimed = await tryClaimNext(WORKER_ID);
      if (claimed === null) {
        await sleep(backoff);
        backoff = Math.min(backoff * 1.5, POLL_BACKOFF_MAX_MS);
        continue;
      }
      backoff = POLL_BACKOFF_INITIAL_MS;
      console.log(`[${WORKER_ID}] claimed sync_log ${claimed.id} (${claimed.syncType})`);

      try {
        await runSyncToCompletion(claimed, REGISTRY, isShuttingDown);
      } catch (err) {
        await handleRunError(claimed.id, claimed.attemptCount, err);
      }
    } catch (loopErr) {
      console.error(`[${WORKER_ID}] outer loop error`, loopErr);
      await sleep(POLL_BACKOFF_MAX_MS); // back off on systemic failure
    }
  }

  clearInterval(watchdogTimer);
  console.log(`[${WORKER_ID}] sync-worker stopped`);
}

async function handleRunError(
  syncLogId: string,
  attemptCount: number,
  err: unknown,
): Promise<void> {
  const code = errorCodeOf(err);
  const message = errorMessageOf(err);

  // Permanent failures — don't retry.
  if (code === 'MARKETPLACE_AUTH_FAILED' || code === 'MARKETPLACE_ACCESS_DENIED' || code === 'CORRUPT_CHECKPOINT') {
    await syncLogService.fail(syncLogId, code, message);
    return;
  }

  if (attemptCount >= MAX_ATTEMPTS) {
    await syncLogService.fail(syncLogId, code, `${message} (max retries reached)`);
    return;
  }

  // Transient — schedule retry with exponential backoff.
  await markRetryable(syncLogId, attemptCount, code, message);
}

function errorCodeOf(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'code' in err && typeof (err as { code: unknown }).code === 'string') {
    return (err as { code: string }).code;
  }
  return 'INTERNAL_ERROR';
}

function errorMessageOf(err: unknown): string {
  return err instanceof Error ? err.message : 'Unknown error';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((fatal) => {
  console.error('[sync-worker] fatal error', fatal);
  process.exit(1);
});
```

- [ ] **Step 29: Re-export `tryClaimNext` from `packages/sync-core/src/index.ts`.**

Modify `packages/sync-core/src/index.ts`:

```ts
export * as syncLogService from './sync-log.service';
export { markRetryable } from './sync-log.service';
export * from './errors';
export * from './checkpoint';
export { encryptCredentials, decryptCredentials } from './crypto';
export { mapPrismaError } from './map-prisma-error';
export { tryClaimNext } from './claim';
```

- [ ] **Step 30: Smoke-test the worker process.**

In one terminal:

```bash
cd apps/sync-worker
pnpm dev
```

Expected: `[worker-xxxxxxxx] sync-worker starting`. Stays running, no errors.

In another terminal — manually insert a PENDING row using the local Supabase:

```bash
cd packages/db
npx tsx --env-file-if-exists=../../.env -e "
import { prisma } from '@pazarsync/db';
async function main() {
  // Use a real org+store from your local DB
  const store = await prisma.store.findFirstOrThrow();
  const log = await prisma.syncLog.create({
    data: {
      organizationId: store.organizationId,
      storeId: store.id,
      syncType: 'PRODUCTS',
      status: 'PENDING',
      startedAt: new Date(),
    },
  });
  console.log('inserted PENDING', log.id);
}
main();
"
```

Watch the worker terminal. Expected output:

```
[worker-xxxxxxxx] claimed sync_log <uuid> (PRODUCTS)
```

Followed by chunk processing or a Trendyol-stage error (depending on credentials).

- [ ] **Step 31: Commit.**

```bash
git add apps/sync-worker/src/index.ts packages/sync-core/src/index.ts
git commit -m "feat(sync-worker): entry point with claim loop, watchdog, SIGTERM-safe shutdown"
```

#### 4h. API route refactor (drop runInBackground, INSERT PENDING)

- [ ] **Step 32: Update `acquireSlot` in sync-core.**

Modify `packages/sync-core/src/sync-log.service.ts` — replace the `acquireSlot` body:

```ts
import { Prisma } from '@pazarsync/db';
import { SyncInProgressError } from './errors';

export async function acquireSlot(
  organizationId: string,
  storeId: string,
  syncType: SyncType,
): Promise<SyncLog> {
  // Cleanup is no longer needed at acquire time — the worker's
  // watchdog handles stale rows. acquireSlot becomes a pure INSERT.
  try {
    return await prisma.syncLog.create({
      data: {
        organizationId,
        storeId,
        syncType,
        status: 'PENDING',
        startedAt: new Date(),
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      // Find the existing active row and surface its id in the 409 meta
      // so the UI can navigate to the live run.
      const existing = await prisma.syncLog.findFirst({
        where: {
          storeId,
          syncType,
          status: { in: ['PENDING', 'RUNNING', 'FAILED_RETRYABLE'] },
        },
        select: { id: true },
      });
      throw new SyncInProgressError({
        syncType,
        storeId,
        existingSyncLogId: existing?.id,
      });
    }
    throw err;
  }
}
```

Update `SyncInProgressError` in `packages/sync-core/src/errors.ts` to include `existingSyncLogId`:

```ts
export class SyncInProgressError extends Error {
  readonly code = 'SYNC_IN_PROGRESS' as const;
  readonly meta: { syncType: string; storeId: string; existingSyncLogId?: string };
  constructor(meta: { syncType: string; storeId: string; existingSyncLogId?: string }) {
    super(`A sync of type ${meta.syncType} is already running for store ${meta.storeId}`);
    this.meta = meta;
  }
}
```

Delete the `start`, `cleanupStaleRunning`, and old race-resolve logic from sync-log.service.ts. Keep `advance`, `complete`, `fail`, `listActiveAndRecent`, `getById`, plus the new `tick`, `releaseToPending`, `markRetryable` from earlier in this PR.

- [ ] **Step 33: Update the API route.**

Modify `apps/api/src/routes/product.routes.ts` — handler at line 93:

```ts
app.openapi(startSyncRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId, storeId } = c.req.valid('param');
  const organizationId = await ensureOrgMember(userId, orgId);
  const store = await storeService.requireOwnedStore(organizationId, storeId);

  const log = await syncLogService.acquireSlot(organizationId, store.id, 'PRODUCTS');

  // No more runInBackground — the worker process picks this up via its
  // claim loop (typically within ~1 second). The 202 response carries
  // status: 'PENDING' so the UI shows "Kuyrukta" until Realtime delivers
  // the RUNNING transition from the worker.
  return c.json(
    {
      syncLogId: log.id,
      status: 'PENDING' as const,
      enqueuedAt: log.startedAt.toISOString(),
    },
    202,
  );
});
```

Delete the `import { runInBackground }` and `import productSyncService` lines. Delete `apps/api/src/lib/run-in-background.ts` and `apps/api/src/services/product-sync.service.ts`.

- [ ] **Step 34: Update the OpenAPI response schema for the route.**

Modify the route definition's response shape — change `status: z.literal('RUNNING')` and `startedAt` to `status: z.literal('PENDING')` and `enqueuedAt`. Search for the `startSyncRoute` definition in `product.routes.ts` and update the response schema accordingly.

- [ ] **Step 35: Update the route test.**

Modify `apps/api/tests/integration/routes/product.routes.test.ts` — find the "returns 202 with syncLogId" test:

```ts
it('returns 202 with syncLogId for a valid request and inserts a PENDING SyncLog row', async () => {
  const { user, orgId, storeId } = await setupOrgWithStore();

  const res = await app.request(`/v1/organizations/${orgId}/stores/${storeId}/products/sync`, {
    method: 'POST',
    headers: { Authorization: bearer(user.accessToken) },
  });

  expect(res.status).toBe(202);
  const body = (await res.json()) as { syncLogId: string; status: string; enqueuedAt: string };
  expect(body.status).toBe('PENDING');

  const logRow = await prisma.syncLog.findUniqueOrThrow({ where: { id: body.syncLogId } });
  expect(logRow.status).toBe('PENDING');
  expect(logRow.storeId).toBe(storeId);
});
```

Update the 409 test to expect `existingSyncLogId` in meta:

```ts
it('returns 409 SYNC_IN_PROGRESS when a sync is already PENDING for the store', async () => {
  const { user, orgId, storeId } = await setupOrgWithStore();
  const existing = await prisma.syncLog.create({
    data: {
      organizationId: orgId,
      storeId,
      syncType: 'PRODUCTS',
      status: 'PENDING',
      startedAt: new Date(),
    },
  });

  const res = await app.request(`/v1/organizations/${orgId}/stores/${storeId}/products/sync`, {
    method: 'POST',
    headers: { Authorization: bearer(user.accessToken) },
  });

  expect(res.status).toBe(409);
  const body = (await res.json()) as { code: string; meta?: { existingSyncLogId?: string } };
  expect(body.code).toBe('SYNC_IN_PROGRESS');
  expect(body.meta?.existingSyncLogId).toBe(existing.id);
});
```

Remove the `mockTrendyolFetch` setup from the 202 test — there's no fire-and-forget anymore; the handler just inserts and returns.

- [ ] **Step 36: Regenerate the OpenAPI client.**

```bash
pnpm api:sync
```

Expected: `packages/api-client/openapi.json` updated with the new response shape.

- [ ] **Step 37: Run the api tests.**

```bash
cd apps/api
pnpm test:unit && pnpm test:integration
```

Expected: all pass. Some test files may need updates for the deleted `productSyncService` — its tests move to `apps/sync-worker/tests/integration/products-handler.test.ts` (already created in 4d).

- [ ] **Step 38: Delete the now-orphaned tests.**

```bash
git rm apps/api/tests/integration/services/product-sync.service.test.ts
```

The behaviors it tested are covered by `apps/sync-worker/tests/integration/products-handler.test.ts` + `apps/sync-worker/tests/unit/loop.test.ts`.

- [ ] **Step 39: Commit.**

```bash
git add apps/api/src/routes/product.routes.ts apps/api/tests/integration/routes/product.routes.test.ts \
        packages/sync-core/src/sync-log.service.ts packages/sync-core/src/errors.ts \
        packages/api-client/openapi.json
git rm apps/api/src/lib/run-in-background.ts apps/api/src/services/product-sync.service.ts \
       apps/api/tests/integration/services/product-sync.service.test.ts
git commit -m "$(cat <<'EOF'
refactor(api): drop runInBackground; sync trigger now writes PENDING

POST /products/sync becomes a thin enqueue: ensureOrgMember +
requireOwnedStore + INSERT PENDING + return 202. The worker process
claims the row within ~1s. Concurrent triggers race on the partial
unique index — winner gets 202, loser gets 409 with existingSyncLogId.

Removes:
- runInBackground helper (no longer needed; nothing runs in the API process)
- productSyncService (moved to apps/sync-worker/handlers/products)
- The race-resolve code in acquireSlot (replaced by atomic unique index)

OpenAPI response field renamed from `startedAt` to `enqueuedAt` and
status enum from `RUNNING` to `PENDING` for accuracy.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

#### 4i. Cutover script

- [ ] **Step 40: Write the one-shot cutover script.**

Create `packages/db/scripts/cutover-stale-running.ts`:

```ts
// One-shot cutover script: marks any sync_logs row left in RUNNING by
// the v1 fire-and-forget path as FAILED with errorCode
// 'MIGRATION_INTERRUPTED'. Run once after the v2 worker is deployed
// and the API route refactor is live.
//
// Idempotent: only marks rows whose claimedAt IS NULL (i.e., they
// pre-date the worker, which always sets claimedAt). v2 RUNNING rows
// are untouched.

import { Client } from 'pg';

const url = process.env['DIRECT_URL'] ?? process.env['DATABASE_URL'];
if (url === undefined || url.length === 0) {
  console.error('DATABASE_URL or DIRECT_URL required');
  process.exit(1);
}

const client = new Client({ connectionString: url });
await client.connect();
try {
  const result = await client.query(`
    UPDATE sync_logs SET
      status = 'FAILED',
      completed_at = now(),
      error_code = 'MIGRATION_INTERRUPTED',
      error_message = 'Run was orphaned by the v1 → v2 sync engine migration. Please retrigger.'
    WHERE status = 'RUNNING' AND claimed_at IS NULL
    RETURNING id
  `);
  console.log(`Cutover complete — ${result.rowCount} row(s) marked MIGRATION_INTERRUPTED`);
} finally {
  await client.end();
}
```

- [ ] **Step 41: Add a script entry to package.json.**

Modify `packages/db/package.json`:

```json
"scripts": {
  // ... existing scripts
  "cutover:v2": "tsx --env-file-if-exists=../../.env scripts/cutover-stale-running.ts"
}
```

- [ ] **Step 42: Add a Dockerfile for the worker.**

Create `apps/sync-worker/Dockerfile`:

```dockerfile
FROM node:20-alpine AS base
RUN npm install -g pnpm@10.33

FROM base AS build
WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/db ./packages/db
COPY packages/marketplace ./packages/marketplace
COPY packages/sync-core ./packages/sync-core
COPY apps/sync-worker ./apps/sync-worker
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @pazarsync/db generate

FROM base AS runtime
WORKDIR /app
COPY --from=build /app /app
WORKDIR /app/apps/sync-worker
CMD ["pnpm", "start"]
```

- [ ] **Step 43: Commit cutover + Dockerfile.**

```bash
git add packages/db/scripts/cutover-stale-running.ts packages/db/package.json apps/sync-worker/Dockerfile
git commit -m "chore(sync): cutover script + Dockerfile for sync-worker"
```

- [ ] **Step 44: Push and open PR.**

```bash
git push
gh pr create --title "feat(sync): worker app + API cutover (v2 atomic switch)" --body "$(cat <<'EOF'
## Summary
The atomic switch from v1 (fire-and-forget Promise inside Hono) to v2 (dedicated worker, durable checkpoints).

- New: `apps/sync-worker` Node app with claim loop, dispatcher, products handler, watchdog, SIGTERM handling
- New: `tryClaimNext` SKIP LOCKED helper in `@pazarsync/sync-core`
- New: cutover script `pnpm --filter @pazarsync/db cutover:v2`
- Refactor: `POST /products/sync` writes PENDING + returns 202; no in-process Promise
- Refactor: `acquireSlot` is a pure INSERT, atomic dedup via unique index → 409 with `existingSyncLogId`
- Removed: `runInBackground`, `productSyncService` (moved to worker handler)

## Test plan
- [x] Unit (api): pass
- [x] Integration (api): pass — including new dedup tests
- [x] Unit (sync-worker): pass — dispatcher + loop
- [x] Integration (sync-worker): pass — products-handler, watchdog, end-to-end
- [x] Manual: dev API + dev worker; click "Senkronize Et"; observe SyncLog: PENDING → RUNNING (within 1s) → progress ticks → COMPLETED

## Cutover
Run `pnpm --filter @pazarsync/db cutover:v2` once after deploy to mark any orphaned v1 RUNNING rows as `FAILED ('MIGRATION_INTERRUPTED')`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 45: Wait for CI green, merge, rebase.**

```bash
gh pr checks --watch
gh pr merge --squash --delete-branch=false
git checkout main && git pull && git checkout feat/sync-worker-architecture && git rebase main
```

---

## PR 5 — Frontend hoist (org-wide subscription in dashboard layout)

**Why:** Now that the worker emits Realtime events for the whole org reliably, the frontend has to consume them at a single org-wide mount point so any user on any dashboard route sees syncs from any store.

### Files

**Create:**
- `apps/web/src/features/sync/providers/org-syncs-provider.tsx`
- `apps/web/src/features/sync/hooks/use-org-syncs.ts`
- `apps/web/src/features/sync/hooks/use-store-syncs.ts`
- `apps/web/src/features/sync/api/list-org-sync-logs.api.ts`
- `apps/web/src/features/sync/query-keys.ts`
- `apps/web/src/lib/supabase/realtime.ts` — add `subscribeToOrgSyncs` (alongside existing `subscribeToSyncLogs` initially; delete the latter at the end)
- `apps/web/tests/unit/features/sync/use-org-syncs.test.tsx`
- `apps/web/tests/unit/features/sync/use-store-syncs.test.tsx`

**Modify:**
- `apps/api/src/routes/sync-log.routes.ts` (or wherever sync-logs routes live) — new `GET /v1/organizations/{orgId}/sync-logs?active=true`
- `apps/web/src/app/[locale]/(dashboard)/layout.tsx` — mount `<OrgSyncsProvider>`
- `apps/web/src/components/patterns/sync-badge.tsx` — accept N active syncs prop
- `apps/web/src/components/patterns/sync-center.tsx` — group by store when multi-store
- `apps/web/src/features/products/components/products-page-client.tsx` — replace `useActiveSyncLogs` with `useStoreSyncs`

**Delete:**
- `apps/web/src/features/products/hooks/use-active-sync-logs.ts`
- `apps/web/tests/unit/hooks/use-active-sync-logs.test.tsx`

### Tasks

#### 5a. Backend: org-scoped sync-logs endpoint

- [ ] **Step 1: Write a failing route test.**

Create or extend `apps/api/tests/integration/routes/sync-logs-list.routes.test.ts`:

```ts
describe('GET /v1/organizations/:orgId/sync-logs (org-scoped)', () => {
  beforeAll(async () => { await ensureDbReachable(); });
  beforeEach(async () => { await truncateAll(); });

  it('returns active + recent syncs across every store in the org', async () => {
    const { user, orgId, storeId: storeAId } = await setupOrgWithStore();
    const storeB = await prisma.store.create({
      data: {
        organizationId: orgId,
        name: 'Store B',
        platform: 'TRENDYOL',
        environment: 'PRODUCTION',
        externalAccountId: 'xb',
        credentials: 'opaque',
      },
    });

    await prisma.syncLog.create({
      data: { organizationId: orgId, storeId: storeAId, syncType: 'PRODUCTS', status: 'RUNNING', startedAt: new Date() },
    });
    await prisma.syncLog.create({
      data: { organizationId: orgId, storeId: storeB.id, syncType: 'ORDERS', status: 'RUNNING', startedAt: new Date() },
    });

    const res = await app.request(`/v1/organizations/${orgId}/sync-logs?active=true`, {
      headers: { Authorization: bearer(user.accessToken) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ storeId: string; status: string }> };
    expect(body.data).toHaveLength(2);
    const storeIds = body.data.map((r) => r.storeId).sort();
    expect(storeIds).toEqual([storeAId, storeB.id].sort());
  });

  it('does not leak syncs from a different org', async () => {
    const { user, orgId } = await setupOrgWithStore();
    const otherOrg = await createOrganization();
    const otherStore = await prisma.store.create({
      data: {
        organizationId: otherOrg.id,
        name: 'Other',
        platform: 'TRENDYOL',
        environment: 'PRODUCTION',
        externalAccountId: 'xx',
        credentials: 'opaque',
      },
    });
    await prisma.syncLog.create({
      data: { organizationId: otherOrg.id, storeId: otherStore.id, syncType: 'PRODUCTS', status: 'RUNNING', startedAt: new Date() },
    });

    const res = await app.request(`/v1/organizations/${orgId}/sync-logs?active=true`, {
      headers: { Authorization: bearer(user.accessToken) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data).toEqual([]);
  });
});
```

- [ ] **Step 2: Implement the route.**

Find the existing sync-logs routes file (likely `apps/api/src/routes/sync-log.routes.ts` or similar). Add the org-scoped route alongside the existing store-scoped one. The handler:

```ts
app.openapi(listOrgSyncLogsRoute, async (c) => {
  const userId = c.get('userId');
  const { orgId } = c.req.valid('param');
  const { active } = c.req.valid('query');
  const organizationId = await ensureOrgMember(userId, orgId);

  const logs = await syncLogService.listOrgActiveAndRecent(organizationId, { activeOnly: active === true });
  return c.json({ data: logs });
});
```

Add `listOrgActiveAndRecent` to `packages/sync-core/src/sync-log.service.ts`:

```ts
export async function listOrgActiveAndRecent(
  organizationId: string,
  opts: { activeOnly: boolean; recentLimit?: number } = { activeOnly: false },
): Promise<SyncLog[]> {
  const recentLimit = opts.recentLimit ?? 5;
  const [active, recent] = await Promise.all([
    prisma.syncLog.findMany({
      where: { organizationId, status: { in: ['PENDING', 'RUNNING', 'FAILED_RETRYABLE'] } },
      orderBy: { startedAt: 'desc' },
    }),
    opts.activeOnly
      ? Promise.resolve([])
      : prisma.syncLog.findMany({
          where: { organizationId, status: { in: ['COMPLETED', 'FAILED'] } },
          orderBy: { startedAt: 'desc' },
          take: recentLimit,
        }),
  ]);
  return [...active, ...recent];
}
```

- [ ] **Step 3: Run the route test.**

```bash
pnpm --filter @pazarsync/api test:integration tests/integration/routes/sync-logs-list.routes.test.ts
```

Expected: 2 new tests pass.

- [ ] **Step 4: Regenerate OpenAPI client.**

```bash
pnpm api:sync
```

- [ ] **Step 5: Commit.**

```bash
git add apps/api/src/routes packages/sync-core/src/sync-log.service.ts packages/api-client/openapi.json apps/api/tests/integration/routes/sync-logs-list.routes.test.ts
git commit -m "feat(api): GET /v1/organizations/:orgId/sync-logs — org-scoped active+recent"
```

#### 5b. Frontend: subscribeToOrgSyncs

- [ ] **Step 6: Add the org-filtered subscriber.**

Modify `apps/web/src/lib/supabase/realtime.ts` — add alongside `subscribeToSyncLogs`:

```ts
/**
 * Org-wide variant of subscribeToSyncLogs. Filters by organization_id
 * so a single channel surfaces every sync across every store the user
 * can see. RLS gates which rows arrive.
 */
export function subscribeToOrgSyncs(
  orgId: string,
  options: SubscribeToSyncLogsOptions,
): () => void {
  const supabase = createClient();
  let channel: RealtimeChannel | null = null;
  let unsubscribed = false;

  const reportHealth = (next: RealtimeHealth): void => {
    if (options.onHealthChange !== undefined) options.onHealthChange(next);
  };

  const buildChannel = (): RealtimeChannel => {
    reportHealth('connecting');
    return supabase
      .channel(`sync_logs:org:${orgId}`)
      .on<SyncLogsRowWire>(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'sync_logs',
          filter: `organization_id=eq.${orgId}`,
        },
        (payload) => {
          const eventType = payload.eventType;
          if (eventType === 'DELETE') {
            const oldRow = payload.old as Partial<SyncLogsRowWire>;
            if (oldRow.id === undefined) return;
            options.onEvent({ eventType: 'DELETE', id: oldRow.id, row: null });
            return;
          }
          const newRow = payload.new as SyncLogsRowWire;
          options.onEvent({
            eventType,
            id: newRow.id,
            row: snakeToCamel(newRow),
          });
        },
      )
      .subscribe((status) => {
        if (unsubscribed) return;
        if (status === 'SUBSCRIBED') reportHealth('healthy');
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          reportHealth('errored');
        }
      });
  };

  const teardown = async (): Promise<void> => {
    if (channel === null) return;
    const c = channel;
    channel = null;
    await supabase.removeChannel(c);
  };

  const handleVisibility = (): void => {
    if (typeof document === 'undefined') return;
    if (document.visibilityState === 'hidden') {
      reportHealth('paused');
      void teardown();
    } else if (channel === null) {
      channel = buildChannel();
    }
  };

  channel = buildChannel();
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', handleVisibility);
  }

  return () => {
    unsubscribed = true;
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', handleVisibility);
    }
    void teardown();
  };
}
```

#### 5c. OrgSyncsProvider + hooks

- [ ] **Step 7: Define query keys.**

Create `apps/web/src/features/sync/query-keys.ts`:

```ts
export const orgSyncKeys = {
  all: ['org-syncs'] as const,
  list: (orgId: string) => [...orgSyncKeys.all, orgId] as const,
};
```

- [ ] **Step 8: Define the api client function.**

Create `apps/web/src/features/sync/api/list-org-sync-logs.api.ts`:

```ts
import type { components } from '@pazarsync/api-client';
import { apiClient } from '@/lib/api-client/browser';
import { throwApiError } from '@/lib/api-error';

export type SyncLog = components['schemas']['SyncLog'];

export async function listOrgSyncLogs(orgId: string): Promise<SyncLog[]> {
  const { data, error, response } = await apiClient.GET('/v1/organizations/{orgId}/sync-logs', {
    params: { path: { orgId }, query: { active: false } }, // get active + recent
  });
  if (error !== undefined) throwApiError(error, response);
  return data.data;
}
```

- [ ] **Step 9: Implement the provider.**

Create `apps/web/src/features/sync/providers/org-syncs-provider.tsx`:

```tsx
'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as React from 'react';

import { subscribeToOrgSyncs, type RealtimeHealth, type SyncLogRealtimeEvent } from '@/lib/supabase/realtime';

import { listOrgSyncLogs, type SyncLog } from '../api/list-org-sync-logs.api';
import { orgSyncKeys } from '../query-keys';

interface OrgSyncsContext {
  activeSyncs: SyncLog[];
  recentSyncs: SyncLog[];
  isLoading: boolean;
}

const ctx = React.createContext<OrgSyncsContext | null>(null);

export function OrgSyncsProvider({ orgId, children }: { orgId: string | null; children: React.ReactNode }): React.ReactElement {
  const queryClient = useQueryClient();
  const enabled = typeof orgId === 'string' && orgId.length > 0;
  const realtimeHealthRef = React.useRef<RealtimeHealth>('connecting');

  const query = useQuery<SyncLog[]>({
    queryKey: enabled && orgId !== null ? orgSyncKeys.list(orgId) : ['org-syncs', '__disabled__'],
    queryFn: () => {
      if (orgId === null) throw new Error('OrgSyncsProvider without orgId');
      return listOrgSyncLogs(orgId);
    },
    enabled,
    refetchInterval: (q) => {
      if (realtimeHealthRef.current === 'healthy') return false;
      const data = q.state.data;
      if (data === undefined) return false;
      const hasActive = data.some((log) =>
        log.status === 'RUNNING' || log.status === 'PENDING' || log.status === 'FAILED_RETRYABLE',
      );
      return hasActive ? 10_000 : false;
    },
  });

  React.useEffect(() => {
    if (!enabled || orgId === null) return;
    const queryKey = orgSyncKeys.list(orgId);
    return subscribeToOrgSyncs(orgId, {
      onEvent: (event: SyncLogRealtimeEvent) => {
        queryClient.setQueryData<SyncLog[] | undefined>(queryKey, (existing) => applyEvent(existing ?? [], event));
      },
      onHealthChange: (next) => {
        const wasOutage = realtimeHealthRef.current === 'errored' || realtimeHealthRef.current === 'paused';
        realtimeHealthRef.current = next;
        if (next === 'healthy' && wasOutage) {
          void queryClient.invalidateQueries({ queryKey });
        }
      },
    });
  }, [enabled, orgId, queryClient]);

  const value = React.useMemo<OrgSyncsContext>(() => {
    const all = query.data ?? [];
    return {
      activeSyncs: all.filter((s) => s.status === 'RUNNING' || s.status === 'PENDING' || s.status === 'FAILED_RETRYABLE'),
      recentSyncs: all.filter((s) => s.status === 'COMPLETED' || s.status === 'FAILED'),
      isLoading: query.isLoading,
    };
  }, [query.data, query.isLoading]);

  return <ctx.Provider value={value}>{children}</ctx.Provider>;
}

export function useOrgSyncs(): OrgSyncsContext {
  const value = React.useContext(ctx);
  if (value === null) {
    throw new Error('useOrgSyncs must be used inside OrgSyncsProvider');
  }
  return value;
}

// (applyEvent: same shape/logic as the deleted use-active-sync-logs.ts applyEvent.
// Insert/Update overlay onto the cache; Delete removes by id; cap recents at 5.)
function applyEvent(existing: SyncLog[], event: SyncLogRealtimeEvent): SyncLog[] {
  const filtered = existing.filter((log) => log.id !== event.id);
  if (event.eventType === 'DELETE' || event.row === null) return filtered;
  const incoming: SyncLog = {
    id: event.row.id,
    organizationId: event.row.organizationId,
    storeId: event.row.storeId,
    syncType: event.row.syncType,
    status: event.row.status,
    startedAt: event.row.startedAt,
    completedAt: event.row.completedAt,
    recordsProcessed: event.row.recordsProcessed,
    progressCurrent: event.row.progressCurrent,
    progressTotal: event.row.progressTotal,
    progressStage: event.row.progressStage,
    errorCode: event.row.errorCode,
    errorMessage: event.row.errorMessage,
  } as SyncLog;
  const next = [...filtered, incoming];
  next.sort((a, b) => {
    const aActive = a.status === 'RUNNING' || a.status === 'PENDING' || a.status === 'FAILED_RETRYABLE';
    const bActive = b.status === 'RUNNING' || b.status === 'PENDING' || b.status === 'FAILED_RETRYABLE';
    if (aActive !== bActive) return aActive ? -1 : 1;
    return Date.parse(b.startedAt) - Date.parse(a.startedAt);
  });
  const activeCount = next.findIndex((log) => !(log.status === 'RUNNING' || log.status === 'PENDING' || log.status === 'FAILED_RETRYABLE'));
  if (activeCount === -1) return next;
  return next.slice(0, activeCount + 5);
}
```

Note: the `subscribeToOrgSyncs` event payload needs `organizationId` in the wire shape. Add it to `SyncLogsRowWire` and `SyncLogRealtimeShape` in `realtime.ts` (it's already in the DB column from PR 1).

- [ ] **Step 10: Implement `useStoreSyncs` (derived view).**

Create `apps/web/src/features/sync/hooks/use-store-syncs.ts`:

```ts
'use client';

import { useMemo } from 'react';

import { useOrgSyncs } from '../providers/org-syncs-provider';
import type { SyncLog } from '../api/list-org-sync-logs.api';

interface UseStoreSyncsResult {
  activeSyncs: SyncLog[];
  recentSyncs: SyncLog[];
}

/** Derived view: filters useOrgSyncs() output by storeId. No additional channel or REST call. */
export function useStoreSyncs(storeId: string | null): UseStoreSyncsResult {
  const { activeSyncs, recentSyncs } = useOrgSyncs();
  return useMemo(() => {
    if (storeId === null) return { activeSyncs: [], recentSyncs: [] };
    return {
      activeSyncs: activeSyncs.filter((s) => s.storeId === storeId),
      recentSyncs: recentSyncs.filter((s) => s.storeId === storeId),
    };
  }, [storeId, activeSyncs, recentSyncs]);
}
```

- [ ] **Step 11: Mount the provider in the dashboard layout.**

Modify `apps/web/src/app/[locale]/(dashboard)/layout.tsx` — wrap children:

```tsx
import { OrgSyncsProvider } from '@/features/sync/providers/org-syncs-provider';
// ... existing imports

export default async function DashboardLayout({ children, params }: ...) {
  // existing logic to resolve orgId from session/cookie
  const orgId = await resolveActiveOrgId();
  return (
    <DashboardShell>
      <OrgSyncsProvider orgId={orgId}>
        {children}
      </OrgSyncsProvider>
    </DashboardShell>
  );
}
```

(Adjust to the actual layout structure — find the correct mount point that wraps every dashboard route.)

#### 5d. SyncBadge multi-sync state

- [ ] **Step 12: Extend SyncBadge to handle N active syncs.**

Modify `apps/web/src/components/patterns/sync-badge.tsx`:

```tsx
interface SyncBadgeProps {
  /** Number of active syncs across all stores. */
  activeCount: number;
  /** Aggregate progress for single-active case. Ignored if activeCount !== 1. */
  progress?: { current: number; total: number | null };
  onClick?: () => void;
}

export function SyncBadge({ activeCount, progress, onClick }: SyncBadgeProps): React.ReactElement | null {
  if (activeCount === 0) return null;
  if (activeCount === 1) {
    // existing single-sync rendering with progress
    return <SingleSyncBadge progress={progress} onClick={onClick} />;
  }
  // multi-sync: stacked icon + count
  return (
    <Button variant="ghost" size="sm" onClick={onClick} className="gap-xs">
      <SyncStackedIcon />
      <Badge variant="info" className="px-2xs">{activeCount}</Badge>
    </Button>
  );
}
```

#### 5e. SyncCenter cross-store grouping

- [ ] **Step 13: Group SyncCenter rows by store when multi-store.**

Modify `apps/web/src/components/patterns/sync-center.tsx` — within the rendering of active syncs, group by storeId. Single-store case renders as today (no grouping chrome). Multi-store case renders a store header (name + marketplace logo) for each group.

#### 5f. Migrate products-page-client + delete old hook

- [ ] **Step 14: Replace `useActiveSyncLogs` with `useStoreSyncs`.**

Modify `apps/web/src/features/products/components/products-page-client.tsx` — find the `const syncLogsQuery = useActiveSyncLogs(orgId, storeId)` call and replace with:

```ts
const { activeSyncs, recentSyncs } = useStoreSyncs(storeId);
```

Update consumers of `syncLogsQuery.data` to use `[...activeSyncs, ...recentSyncs]` instead.

- [ ] **Step 15: Delete the old hook + test.**

```bash
git rm apps/web/src/features/products/hooks/use-active-sync-logs.ts
git rm apps/web/tests/unit/hooks/use-active-sync-logs.test.tsx
```

#### 5g. New hook tests

- [ ] **Step 16: Write tests for `useOrgSyncs` (Realtime overlay, polling gate, recovery).**

Create `apps/web/tests/unit/features/sync/use-org-syncs.test.tsx`:

```tsx
// Mirrors the structure of the deleted use-active-sync-logs.test.tsx
// but for the org-scoped subscription. Tests:
//  - hydrates from REST then merges Realtime UPDATE/INSERT/DELETE
//  - does not poll while Realtime is healthy
//  - triggers refetch when channel transitions errored→healthy
//  - cleans up subscription on unmount
//
// Use vi.mock('@/lib/supabase/realtime', () => ({ subscribeToOrgSyncs: ... }))
// to drive the channel imperatively, identical to the pattern in the
// deleted file but pointed at the new export.
```

(Implementation detail: copy the structure from the deleted `use-active-sync-logs.test.tsx`, change the mocked function name from `subscribeToSyncLogs` to `subscribeToOrgSyncs`, and adjust the rendered hook to `useOrgSyncs` via `<OrgSyncsProvider>` wrapper.)

- [ ] **Step 17: Write a test for `useStoreSyncs` (derivation correctness).**

Create `apps/web/tests/unit/features/sync/use-store-syncs.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';

// Test that useStoreSyncs filters useOrgSyncs() output by storeId.
// Provide a fake OrgSyncsProvider wrapper that supplies known data.
```

- [ ] **Step 18: Run all web tests.**

```bash
cd apps/web
pnpm test
```

Expected: all pass; new tests pass; old `use-active-sync-logs.test.tsx` is gone.

#### 5h. Manual smoke test + ship

- [ ] **Step 19: Manual smoke test.**

Start API + worker + web. In one browser tab, log in as User A and navigate to `/dashboard`. In a second browser tab (different profile or incognito), log in as User B (same org, member role) and navigate to `/products`. From User B's tab, click "Senkronize Et". Expected:

- User B's SyncCenter shows the sync starting (PENDING → RUNNING within ~1 s).
- User A's `SyncBadge` (in the dashboard header) lights up at the same time, even though User A is not on `/products`.
- User A clicking the badge opens SyncCenter showing the active sync from Store-X-of-Org-A.
- Refresh User B's tab — sync continues uninterrupted.

- [ ] **Step 20: Commit, push, open PR.**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(sync): hoist org-wide sync subscription to dashboard layout

Single Realtime channel per user filtered by organization_id. Surfaces
every sync across every store in the org to anyone active anywhere in
the dashboard, satisfying the v2 requirement that "any active org
member sees the sync start and progress live."

- New: OrgSyncsProvider mounted in (dashboard)/layout.tsx
- New: useOrgSyncs() — context hook, RUNNING/PENDING/FAILED_RETRYABLE active set
- New: useStoreSyncs(storeId) — derived view (no extra channel)
- New: GET /v1/organizations/:orgId/sync-logs — org-scoped endpoint
- New: subscribeToOrgSyncs() — filter by organization_id=eq.<id>
- Extended: SyncBadge accepts active count (single-sync or stacked)
- Extended: SyncCenter groups by store when multi-store

Removes:
- useActiveSyncLogs (replaced by useStoreSyncs derived view)
- subscribeToSyncLogs (replaced by subscribeToOrgSyncs)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push
gh pr create --title "feat(sync): org-wide subscription hoist + cross-store SyncBadge/SyncCenter" --body "..."
```

- [ ] **Step 21: Wait for CI green, merge.**

```bash
gh pr checks --watch
gh pr merge --squash --delete-branch
```

After this PR merges, `feat/sync-worker-architecture` is fully shipped — delete the branch as the final action of the architectural shift.

---

## Self-review notes

- **Spec coverage**: every section of the design doc maps to PR 1–5. The cutover script in §11 of the spec is task 4i. The deferred items (cancel, pgmq promotion, pg_notify, multi-instance Hono coordination) stay deferred — confirmed during brainstorming.
- **Type consistency**: `tryClaimNext`, `tick`, `releaseToPending`, `markRetryable`, `acquireSlot`, `dispatch`, `processChunk`, `ChunkResult`, `ModuleHandler` — all defined in PR 4 with consistent signatures across tasks.
- **Cross-task assumptions**: `parseProductsCursor` defined in 4b, used by 4c and 4d. `subscribeToOrgSyncs` defined in 5b, consumed in 5c.
- **Test coverage parity**: every new module (claim, watchdog, dispatcher, loop, products handler, route) has at least one test in the PR that introduces it.

## Execution handoff

Plan complete and saved to `docs/plans/2026-04-27-sync-engine-architecture-implementation.md`. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration. Best for a plan this size (45+ steps).
2. **Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
