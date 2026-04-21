# Store Connection (Trendyol Phase 1) — Implementation Plan

> **For Claude:** Implement this plan task-by-task. Each task ends with a commit; do not skip the commit step. Load `superpowers:executing-plans` before starting. Pair document: `docs/plans/2026-04-21-store-connection-design.md` — read it first.

**Goal:** Ship the ten atomic commits that land store connection end-to-end: DB schema → backend adapter/service/route plumbing → rate-limit middleware → frontend feature module → onboarding page + dashboard entry points. Each commit is revertable in isolation per the rollback plan in §17 of the design doc.

**Branch:** `feat/store-connection-trendyol` off `main`.

**Commit message conventions** (derived from recent history — PRs #30, #33, #34, #36, #37):

- `feat(scope): subject` for new capability (scope = `web`, `api`, `db`)
- `chore(scope): subject` for repo plumbing without user-visible behavior (env, CI)
- `fix(scope): subject` for bug fixes
- Subject in lowercase after the colon, imperative mood, no trailing period.
- Body is optional but preferred for non-trivial commits; wrap at ~72.
- Every commit gets `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` trailer when authored with AI.

**Pre-flight checklist (do once before starting Task 1):**

- [ ] Design document reviewed & approved: `docs/plans/2026-04-21-store-connection-design.md`.
- [ ] Branch `feat/store-connection-trendyol` created off `main`, pushed upstream.
- [ ] `supabase start` running; `pnpm db:push && pnpm db:seed` green.
- [ ] `.env` populated with existing vars (`DATABASE_URL`, `DIRECT_URL`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `ENCRYPTION_KEY`, `NEXT_PUBLIC_*`).
- [ ] `pnpm check:full` green on the fresh branch — baseline.
- [ ] **Optional (for the final smoke test):** a real Trendyol sandbox API key set + IP whitelisted via Trendyol support (0850 258 58 00). Not needed for CI/unit/integration — `fetch` is mocked.

**Acceptance gate for each task:** that task's `Verify` steps pass locally (listed per-task), AND `pnpm check:all` stays green. Running `check:full` (with Supabase) before pushing is done once after Task 6 and once at the end.

---

## Task 1 — `feat(db): store connection schema + stores RLS policy`

**Why:** The service and route layers need `environment`, `externalAccountId`, `status`, and the unique constraint before they can be written. RLS on `stores` lands in the same commit so the coverage test does not go red between commits. One atomic migration, reversible as a unit.

**Files:**

- Modify: `packages/db/prisma/schema.prisma`
- Modify: `supabase/sql/rls-policies.sql`
- Modify: `apps/api/tests/integration/rls/coverage.rls.test.ts`
- Create: `apps/api/tests/integration/rls/stores.rls.test.ts`

**Step 1 — Schema changes**

Append to `packages/db/prisma/schema.prisma` in the enums section:

```prisma
enum StoreEnvironment {
  PRODUCTION
  SANDBOX
}

enum StoreStatus {
  ACTIVE
  CONNECTION_ERROR
  DISABLED
}
```

Update the `Store` model:

```prisma
model Store {
  id                 String           @id @default(uuid()) @db.Uuid
  organizationId     String           @map("organization_id") @db.Uuid
  name               String
  platform           Platform
  environment        StoreEnvironment @default(PRODUCTION)
  externalAccountId  String           @map("external_account_id")
  credentials        Json
  status             StoreStatus      @default(ACTIVE)
  isActive           Boolean          @default(true) @map("is_active")
  lastConnectedAt    DateTime?        @map("last_connected_at")
  lastSyncAt         DateTime?        @map("last_sync_at")
  createdAt          DateTime         @default(now()) @map("created_at")
  updatedAt          DateTime         @updatedAt      @map("updated_at")

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  products     Product[]
  orders       Order[]
  settlements  Settlement[]
  syncLogs     SyncLog[]

  @@unique([organizationId, platform, externalAccountId])
  @@index([organizationId])
  @@map("stores")
}
```

Run:

```bash
pnpm db:generate
pnpm db:push            # applies schema + chains db:apply-policies
```

Expected: both commands exit 0. Prisma Studio → `stores` table has the three new columns and the composite unique index.

**Step 2 — RLS policy**

Append to `supabase/sql/rls-policies.sql`:

```sql
-- stores — tenant-scoped, direct organization_id column
ALTER TABLE stores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stores_org_member_read ON stores;
CREATE POLICY stores_org_member_read ON stores
  FOR SELECT TO authenticated
  USING (is_org_member(organization_id));
-- INSERT/UPDATE/DELETE default-deny for authenticated.
-- Writes go through the API via the postgres role (Prisma service-role
-- connection), consistent with organizations + organization_members.
```

Re-run `pnpm db:push` — `db:apply-policies` picks up the new block.

**Step 3 — Coverage test**

In `apps/api/tests/integration/rls/coverage.rls.test.ts`, append `'stores'` to the `TENANT_TABLES` array.

**Step 4 — Scoped-client RLS test**

Create `apps/api/tests/integration/rls/stores.rls.test.ts`. Mirror the pattern from existing `*.rls.test.ts` files (two orgs, each with its own auth'd supabase-js client, cross-probe asserts empty).

Skeleton:

```typescript
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createOrganization, createStore } from '../../helpers/factories';
import { createAuthenticatedTestUser } from '../../helpers/auth';
import { createRlsScopedClient } from '../../helpers/rls-client';

describe('stores RLS', () => {
  beforeAll(async () => { await ensureDbReachable(); });
  beforeEach(async () => { await truncateAll(); });

  it("does not return another org's stores via PostgREST", async () => {
    const userA = await createAuthenticatedTestUser();
    const userB = await createAuthenticatedTestUser();
    const orgA = await createOrganization({ ownerId: userA.id });
    const orgB = await createOrganization({ ownerId: userB.id });
    await createStore({ organizationId: orgA.id });
    await createStore({ organizationId: orgB.id });

    const clientA = createRlsScopedClient(userA.accessToken);
    const { data } = await clientA.from('stores').select('id, organization_id');

    expect(data).toHaveLength(1);
    expect(data?.[0]?.organization_id).toBe(orgA.id);
  });
});
```

`createStore` factory may not exist yet — add the minimal version to `tests/helpers/factories.ts`:

```typescript
// tests/helpers/factories.ts (append)
export async function createStore(opts: {
  organizationId: string;
  platform?: Platform;
  environment?: StoreEnvironment;
  externalAccountId?: string;
  name?: string;
}) {
  return prisma.store.create({
    data: {
      organizationId: opts.organizationId,
      name: opts.name ?? 'Test Store',
      platform: opts.platform ?? 'TRENDYOL',
      environment: opts.environment ?? 'PRODUCTION',
      externalAccountId: opts.externalAccountId ?? `test-${randomUUID()}`,
      credentials: 'encrypted-placeholder',
      status: 'ACTIVE',
    },
  });
}
```

**Step 5 — Verify**

```bash
pnpm db:generate
pnpm --filter @pazarsync/api typecheck
pnpm --filter @pazarsync/api test:integration -- rls
```

Expected: all RLS tests green, including new `stores.rls.test.ts` and the coverage test's `TENANT_TABLES` assertion.

**Step 6 — Commit**

```bash
git add packages/db/prisma/schema.prisma supabase/sql/rls-policies.sql \
        apps/api/tests/integration/rls/stores.rls.test.ts \
        apps/api/tests/integration/rls/coverage.rls.test.ts \
        apps/api/tests/helpers/factories.ts
git commit -m "$(cat <<'EOF'
feat(db): store connection schema + stores RLS policy

Extends the Store model with columns required by the connect-store flow:

- environment (StoreEnvironment enum, default PRODUCTION) — backend D4
  gates SANDBOX in production deployments.
- externalAccountId (unencrypted, String) — Trendyol supplierId / future
  merchantId. Stored outside the encrypted credentials blob so the
  uniqueness constraint can be enforced without decrypt.
- status (StoreStatus enum, default ACTIVE) — forward hook for future
  CONNECTION_ERROR transitions from sync jobs.
- lastConnectedAt — timestamped on successful credential probe.

Composite unique (organizationId, platform, externalAccountId) enforces
the product decision that one Trendyol account connects at most once
per org.

RLS on stores: ENABLE + SELECT policy via is_org_member. The table is
newly added to coverage.rls.test.ts's TENANT_TABLES. New scoped-client
test (stores.rls.test.ts) proves cross-org reads return empty.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

**Rollback:** `git revert` the commit, then `pnpm db:push` — Prisma drops the new columns / enums / constraint automatically. Existing `stores` rows (none expected yet) lose their new-column data.

---

## Task 2 — `chore(api): trendyol env vars + sandbox gate (three-file update)`

**Why:** The adapter + route code references env vars that must exist on every environment (local, CI, staging, prod). Per the project memory rule "new env var requires three-file update," `.env.example`, `turbo.json`, and `.github/workflows/ci.yml` all land the additions in one commit so a greenfield checkout (or CI run) can't miss one. `validateRequiredEnv()` catches misconfiguration at boot.

**Files:**

- Modify: `.env.example`
- Modify: `turbo.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `apps/api/src/lib/env.ts`

**Step 1 — `.env.example`**

In the `apps/api` block, **remove** the outdated line:

```bash
TRENDYOL_BASE_URL=https://api.trendyol.com/sapigw
```

Replace with:

```bash
# ─── Trendyol integration ─────────────────────────
# Production and sandbox base URLs from docs/integrations/trendyol/3-canli-test-ortam-bilgileri.md.
# Never commit real API credentials — those live per-store in stores.credentials (encrypted).
TRENDYOL_PROD_BASE_URL=https://apigw.trendyol.com
TRENDYOL_SANDBOX_BASE_URL=https://stageapigw.trendyol.com
# User-Agent suffix per docs/integrations/trendyol/2-authorization.md.
# Header sent as "{supplierId} - {suffix}". Missing UA → 403 from Trendyol.
TRENDYOL_INTEGRATOR_UA_SUFFIX=SelfIntegration

# ─── Sandbox gate (D4) ─────────────────────────────
# Server accepts `environment: SANDBOX` on POST /v1/.../stores only when
# this is exactly "true". Production deployments MUST set it to "false"
# or omit the var entirely.
ALLOW_SANDBOX_CONNECTIONS=true
```

In the `apps/web` block, append:

```bash
# Mirrors ALLOW_SANDBOX_CONNECTIONS — hides the Sandbox environment tab
# in the connect-store UI. Cosmetic only; backend is the real gate.
NEXT_PUBLIC_ALLOW_SANDBOX_CONNECTIONS=true
```

**Step 2 — `turbo.json`**

Add the new vars to the `globalEnv` (or the equivalent per-task `env` entries if the existing file structures them that way — check current format). Open `turbo.json`, find the `globalEnv` (or `tasks.*.env`) list, append:

```
"TRENDYOL_PROD_BASE_URL",
"TRENDYOL_SANDBOX_BASE_URL",
"TRENDYOL_INTEGRATOR_UA_SUFFIX",
"ALLOW_SANDBOX_CONNECTIONS",
"NEXT_PUBLIC_ALLOW_SANDBOX_CONNECTIONS"
```

This tells Turborepo to include them in the cache key so stale builds can't mask a missing var.

**Step 3 — `.github/workflows/ci.yml`**

Find the `env:` block that seeds Supabase-local values (`DATABASE_URL`, `ENCRYPTION_KEY`, etc.) and append test values alongside:

```yaml
TRENDYOL_PROD_BASE_URL: https://apigw.trendyol.com
TRENDYOL_SANDBOX_BASE_URL: https://stageapigw.trendyol.com
TRENDYOL_INTEGRATOR_UA_SUFFIX: SelfIntegration
ALLOW_SANDBOX_CONNECTIONS: 'true'
NEXT_PUBLIC_ALLOW_SANDBOX_CONNECTIONS: 'true'
```

These are placeholder URLs for CI — real calls are mocked at the `fetch` layer in tests (we never let CI touch stageapigw).

**Step 4 — `validateRequiredEnv()`**

`apps/api/src/lib/env.ts`, extend the `required` array:

```typescript
const required = [
  'DATABASE_URL',
  'ENCRYPTION_KEY',
  'SUPABASE_URL',
  'SUPABASE_SECRET_KEY',
  'TRENDYOL_PROD_BASE_URL',
  'TRENDYOL_SANDBOX_BASE_URL',
] as const;
```

`ALLOW_SANDBOX_CONNECTIONS` is intentionally **not** required — its absence is a valid "sandbox off" signal. `TRENDYOL_INTEGRATOR_UA_SUFFIX` has a code-level default (`'SelfIntegration'`), also not required. `NEXT_PUBLIC_ALLOW_SANDBOX_CONNECTIONS` is a Next.js-land env var, not checked by the api's boot-time validator.

**Step 5 — Verify**

```bash
pnpm --filter @pazarsync/api typecheck
# Boot the api to confirm validateRequiredEnv passes with the new keys in .env:
pnpm --filter @pazarsync/api dev
# Expected: no startup errors. Ctrl+C.
```

**Step 6 — Commit**

```bash
git add .env.example turbo.json .github/workflows/ci.yml apps/api/src/lib/env.ts
git commit -m "$(cat <<'EOF'
chore(api): trendyol env vars + sandbox gate (three-file update)

Replaces the outdated TRENDYOL_BASE_URL with environment-split prod +
sandbox URLs matching the current Trendyol docs (apigw.trendyol.com
and stageapigw.trendyol.com).

Adds ALLOW_SANDBOX_CONNECTIONS + its public mirror
NEXT_PUBLIC_ALLOW_SANDBOX_CONNECTIONS — backend rejects sandbox-env
store creates unless the server flag is exactly "true" (D4 from the
design doc). The public var hides the Sandbox tab in the UI; the
server gate is the real safety mechanism.

Three-file discipline applied: .env.example, turbo.json, and
.github/workflows/ci.yml all updated in this commit. validateRequiredEnv
picks up the two required base URLs so misconfigured deploys fail at
boot, not on the first store-connect attempt.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

**Rollback:** `git revert` removes the lines. Any code that already references these vars errors at next typecheck — but Task 2 is the first consumer, so revert-in-isolation is safe.

---

## Task 3 — `feat(api): marketplace domain errors (auth/access/unreachable)`

**Why:** Three new error classes + their RFC 7807 branches. Lands **before** the Trendyol adapter (Task 4) because the adapter's vendor error mapper throws these classes — without them, Task 4 cannot compile.

**Files:**

- Modify: `apps/api/src/lib/errors.ts`
- Modify: `apps/api/src/lib/problem-details.ts`
- Modify: `apps/api/tests/unit/lib/problem-details.test.ts`

**Step 1 — Error classes (`lib/errors.ts`)**

Append:

```typescript
export class MarketplaceAuthError extends Error {
  readonly status = 422 as const;
  readonly code = 'MARKETPLACE_AUTH_FAILED' as const;
  readonly platform: string;

  constructor(platform: string, message = 'Marketplace rejected the provided credentials') {
    super(message);
    this.name = 'MarketplaceAuthError';
    this.platform = platform;
  }
}

export class MarketplaceAccessError extends Error {
  readonly status = 422 as const;
  readonly code = 'MARKETPLACE_ACCESS_DENIED' as const;
  readonly platform: string;
  readonly meta: { httpStatus: number };

  constructor(platform: string, meta: { httpStatus: number }) {
    super(`Marketplace denied access (${meta.httpStatus.toString()}) — likely environment-specific policy`);
    this.name = 'MarketplaceAccessError';
    this.platform = platform;
    this.meta = meta;
  }
}

export class MarketplaceUnreachable extends Error {
  readonly status = 503 as const;
  readonly code = 'MARKETPLACE_UNREACHABLE' as const;
  readonly platform: string;
  readonly meta: { httpStatus: number };

  constructor(platform: string, meta: { httpStatus: number }) {
    super(`Marketplace unreachable (${meta.httpStatus.toString()}) — upstream issue`);
    this.name = 'MarketplaceUnreachable';
    this.platform = platform;
    this.meta = meta;
  }
}
```

**Step 2 — Problem-details branches (`lib/problem-details.ts`)**

Add three `else if` arms:

```typescript
if (err instanceof MarketplaceAuthError) {
  return {
    status: 422,
    body: {
      type: 'https://api.pazarsync.com/errors/marketplace-auth-failed',
      title: 'Marketplace authentication failed',
      status: 422,
      code: 'MARKETPLACE_AUTH_FAILED',
      detail: err.message,
      meta: { platform: err.platform },
    },
  };
}
if (err instanceof MarketplaceAccessError) {
  return {
    status: 422,
    body: {
      type: 'https://api.pazarsync.com/errors/marketplace-access-denied',
      title: 'Marketplace access denied',
      status: 422,
      code: 'MARKETPLACE_ACCESS_DENIED',
      detail: err.message,
      meta: { platform: err.platform, ...err.meta },
    },
  };
}
if (err instanceof MarketplaceUnreachable) {
  return {
    status: 503,
    body: {
      type: 'https://api.pazarsync.com/errors/marketplace-unreachable',
      title: 'Marketplace unreachable',
      status: 503,
      code: 'MARKETPLACE_UNREACHABLE',
      detail: err.message,
      meta: { platform: err.platform, ...err.meta },
    },
  };
}
```

**Step 3 — Unit tests**

In `problem-details.test.ts`, add three cases — one per new error. Assert full body shape, status, and header absence.

**Step 4 — Verify**

```bash
pnpm --filter @pazarsync/api test:unit -- problem-details errors
```

**Step 5 — Commit**

```bash
git add apps/api/src/lib/errors.ts apps/api/src/lib/problem-details.ts \
        apps/api/tests/unit/lib/problem-details.test.ts
git commit -m "$(cat <<'EOF'
feat(api): marketplace domain errors (auth/access/unreachable)

Three new domain error classes + their problemDetailsForError branches:

- MarketplaceAuthError (422, MARKETPLACE_AUTH_FAILED) — credentials
  rejected by the marketplace.
- MarketplaceAccessError (422, MARKETPLACE_ACCESS_DENIED) — access
  blocked by environment policy (e.g. Trendyol sandbox IP whitelist).
- MarketplaceUnreachable (503, MARKETPLACE_UNREACHABLE) — upstream 5xx
  or timeout.

All three expose a platform discriminator and meta.httpStatus so ops
logs can correlate errors across marketplaces. Frontend localizes by
code only (common.errors.*) — Trendyol's raw response text never
reaches the UI.

Unit tests cover each branch with full-body shape assertions.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

**Rollback:** Revert removes three classes + three branches. Task 4's Trendyol adapter imports these (via `trendyol/errors.ts` → domain classes) — if Task 4 is not also reverted first, TypeScript surfaces the broken imports. Revert order: Task 4, then Task 3.

---

## Task 4 — `feat(api): marketplace adapter interface + Trendyol adapter`

**Why:** Establishes the `MarketplaceAdapter` shape that Hepsiburada will later implement unchanged. Lands the Trendyol client (HTTP + probe), the vendor → domain error mapper, and the adapter factory that wires them together. Unit-level `fetch` mocking — zero network in CI.

**Files:**

- Create: `apps/api/src/integrations/marketplace/types.ts`
- Create: `apps/api/src/integrations/marketplace/registry.ts`
- Create: `apps/api/src/integrations/marketplace/trendyol/types.ts`
- Create: `apps/api/src/integrations/marketplace/trendyol/errors.ts`
- Create: `apps/api/src/integrations/marketplace/trendyol/client.ts`
- Create: `apps/api/src/integrations/marketplace/trendyol/adapter.ts`
- Create: `apps/api/tests/unit/integrations/marketplace/trendyol/errors.test.ts`
- Create: `apps/api/tests/unit/integrations/marketplace/trendyol/adapter.test.ts`
- Delete: `apps/api/src/integrations/marketplace/trendyol/.gitkeep` (real files supersede it)
- Keep: `apps/api/src/integrations/marketplace/hepsiburada/.gitkeep` (dir kept for the next phase's factory drop-in)

**Step 1 — Common types (`types.ts`)**

See design §6.1. Export `MarketplaceAdapter`, `MarketplaceAdapterFactory`. Do not export a `SyncParams` type yet — that lands with the sync work. Keep the surface area minimal.

**Step 2 — Trendyol credential guard (`trendyol/types.ts`)**

See design §7.2. Export `TrendyolCredentials` interface + `isTrendyolCredentials` type guard.

**Step 3 — Vendor error mapper (`trendyol/errors.ts`)**

See design §7.4. Signature:

```typescript
export function mapTrendyolResponseToDomainError(res: Response): never;
```

Imports `MarketplaceAuthError`, `MarketplaceAccessError`, `MarketplaceUnreachable`, `RateLimitedError` from `../../../lib/errors`. Always throws — TypeScript's `never` return type enforces no fall-through.

**Step 4 — HTTP client (`trendyol/client.ts`)**

```typescript
import { mapTrendyolResponseToDomainError } from './errors';
import type { TrendyolCredentials } from './types';
import type { StoreEnvironment } from '../../../generated/prisma/client';

const TIMEOUT_MS = 10_000;

function baseUrlFor(env: StoreEnvironment): string {
  return env === 'PRODUCTION'
    ? (process.env['TRENDYOL_PROD_BASE_URL'] ?? '')
    : (process.env['TRENDYOL_SANDBOX_BASE_URL'] ?? '');
}

function buildAuthHeader(cred: TrendyolCredentials): string {
  const token = Buffer.from(`${cred.apiKey}:${cred.apiSecret}`).toString('base64');
  return `Basic ${token}`;
}

function buildUserAgent(cred: TrendyolCredentials): string {
  const suffix = process.env['TRENDYOL_INTEGRATOR_UA_SUFFIX'] ?? 'SelfIntegration';
  return `${cred.supplierId} - ${suffix}`;
}

/**
 * Cheapest credentials-proof probe: product-filter endpoint.
 * 2000 req/min budget, 200 on empty catalogs, tests auth + ownership
 * in one call.
 */
export async function probeTrendyolCredentials(
  cred: TrendyolCredentials,
  env: StoreEnvironment,
): Promise<void> {
  const base = baseUrlFor(env);
  if (base.length === 0) {
    throw new Error(`Trendyol base URL not configured for environment ${env}`);
  }
  const url = `${base}/integration/product/sellers/${cred.supplierId}/products?page=0&size=1&approved=true`;
  const res = await fetch(url, {
    headers: {
      Authorization: buildAuthHeader(cred),
      'User-Agent': buildUserAgent(cred),
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) mapTrendyolResponseToDomainError(res);
}
```

**Step 5 — Adapter (`trendyol/adapter.ts`)**

```typescript
import type { MarketplaceAdapter, MarketplaceAdapterFactory } from '../types';
import { probeTrendyolCredentials } from './client';
import { isTrendyolCredentials, type TrendyolCredentials } from './types';
import { ValidationError } from '../../../lib/errors';

function narrowCredentials(value: unknown): TrendyolCredentials {
  if (!isTrendyolCredentials(value)) {
    throw new ValidationError([
      { field: 'credentials', code: 'INVALID_CREDENTIALS_SHAPE' },
    ]);
  }
  return value;
}

export const trendyolFactory: MarketplaceAdapterFactory = {
  platform: 'TRENDYOL',
  supportedEnvironments: ['PRODUCTION', 'SANDBOX'],
  create({ environment, credentials }): MarketplaceAdapter {
    const cred = narrowCredentials(credentials);
    return {
      async testConnection() {
        await probeTrendyolCredentials(cred, environment);
        return { externalAccountId: cred.supplierId };
      },
    };
  },
};
```

**Step 6 — Registry (`registry.ts`)**

Implement per design §6.2. Export `getAdapter(platform, environment, credentials)`. Use `Partial<Record<Platform, MarketplaceAdapterFactory>>` so Hepsiburada's absence is type-safe.

**Step 7 — Unit tests**

`errors.test.ts` — one case per mapped status: 401 → `MarketplaceAuthError`, 403/503 → `MarketplaceAccessError`, 429 → `RateLimitedError` with parsed `Retry-After` (default 10 if missing), 5xx → `MarketplaceUnreachable`, generic 4xx → `MarketplaceAuthError`. Each case constructs `new Response(body, { status })` and asserts the thrown class + its `code`.

`adapter.test.ts` — three cases:

1. **Happy path:** `vi.spyOn(global, 'fetch').mockResolvedValue(new Response('[]', { status: 200 }))` → `testConnection()` resolves to `{ externalAccountId: supplierId }`.
2. **Invalid creds:** 401 mocked → `MarketplaceAuthError` with `code === 'MARKETPLACE_AUTH_FAILED'`.
3. **Bad shape:** `trendyolFactory.create({ environment: 'PRODUCTION', credentials: { foo: 'bar' } })` throws `ValidationError` with `issues[0].code === 'INVALID_CREDENTIALS_SHAPE'` BEFORE any `fetch`.

**Step 8 — Verify**

```bash
pnpm --filter @pazarsync/api typecheck
pnpm --filter @pazarsync/api test:unit -- trendyol
```

**Step 9 — Commit**

```bash
git add apps/api/src/integrations/marketplace \
        apps/api/tests/unit/integrations
# Remove the trendyol .gitkeep since real files replace it:
git rm apps/api/src/integrations/marketplace/trendyol/.gitkeep
git commit -m "$(cat <<'EOF'
feat(api): marketplace adapter interface + Trendyol adapter

Common MarketplaceAdapter contract + Trendyol implementation. Registry
is Partial<Record<Platform, Factory>> so Hepsiburada is a one-line
addition later — zero changes to Trendyol code. Route layer rejects
unregistered platforms before the registry is consulted (defense in
depth).

Trendyol probe is the product-filter endpoint (2000 req/min, 200 on
empty catalogs). User-Agent is mandatory per Trendyol docs; suffix is
env-driven so a future white-label deployment swaps it without code
changes.

Vendor errors flow through mapTrendyolResponseToDomainError into the
closed domain vocabulary shipped in the previous commit
(MarketplaceAuthError / MarketplaceAccessError / MarketplaceUnreachable).
Trendyol's raw response text never surfaces to the frontend.

Unit tests mock fetch; zero network reach from CI.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

**Rollback:** `git revert` — isolated module, no other code imports it yet (Task 6 adds the first consumer). Prior commit's error classes stay in place and remain valid on their own.

---

## Task 5 — `feat(api): rate-limit middleware (in-memory token bucket)`

**Why:** D7 — middleware ships now so Task 6 wires it cleanly, and future routes get rate-limiting without retrofitting. Minimal in-memory backing (single-pod-safe per §11 of the design doc). Unit-tested standalone.

**Files:**

- Create: `apps/api/src/middleware/rate-limit.middleware.ts`
- Create: `apps/api/tests/unit/middleware/rate-limit.middleware.test.ts`

**Step 1 — Implementation outline**

```typescript
// apps/api/src/middleware/rate-limit.middleware.ts
import { createMiddleware } from 'hono/factory';
import { RateLimitedError } from '../lib/errors';

export interface RateLimitOptions {
  max: number;
  windowSec: number;
  keyPrefix?: string;   // defaults to c.req.routePath
}

interface Bucket { count: number; windowStart: number }

const MAX_KEYS = 10_000;   // rough LRU eviction bound
const store = new Map<string, Bucket>();

export function rateLimit(opts: RateLimitOptions) {
  return createMiddleware(async (c, next) => {
    const userId = c.get('userId');
    // No user context → skip; upstream auth middleware should have rejected.
    if (typeof userId !== 'string' || userId.length === 0) {
      await next();
      return;
    }
    const prefix = opts.keyPrefix ?? c.req.routePath;
    const key = `${userId}:${prefix}`;
    const now = Date.now();

    let bucket = store.get(key);
    if (bucket === undefined || now - bucket.windowStart >= opts.windowSec * 1000) {
      bucket = { count: 0, windowStart: now };
    }
    bucket.count += 1;

    if (bucket.count > opts.max) {
      const retryAfterSeconds = Math.ceil((bucket.windowStart + opts.windowSec * 1000 - now) / 1000);
      throw new RateLimitedError(Math.max(retryAfterSeconds, 1));
    }

    store.set(key, bucket);
    if (store.size > MAX_KEYS) {
      // Cheap eviction: delete the oldest insertion.
      const oldestKey = store.keys().next().value;
      if (oldestKey !== undefined) store.delete(oldestKey);
    }
    await next();
  });
}

// Test-only: reset in-process state between tests.
export function _resetRateLimitState(): void { store.clear(); }
```

**Step 2 — Unit tests**

`rate-limit.middleware.test.ts` covers:

1. First `max` requests under one window pass; request `max+1` throws `RateLimitedError` with `retryAfterSeconds >= 1`.
2. After `windowSec` elapsed (`vi.useFakeTimers()` + advance), the counter resets.
3. Per-user isolation: user A hits the limit, user B is unaffected.
4. Per-route isolation (via `keyPrefix`).
5. No-user-context (no auth) path: middleware is a no-op (next() still called).
6. `_resetRateLimitState()` clears state between tests.

**Step 3 — Verify**

```bash
pnpm --filter @pazarsync/api test:unit -- rate-limit
```

**Step 4 — Commit**

```bash
git add apps/api/src/middleware/rate-limit.middleware.ts \
        apps/api/tests/unit/middleware/rate-limit.middleware.test.ts
git commit -m "$(cat <<'EOF'
feat(api): rate-limit middleware (in-memory token bucket)

Minimal per-user + per-route fixed-window counter. Throws
RateLimitedError on overflow — the RFC 7807 pipeline (PR #34) already
formats the 429 response with a Retry-After header, so no new code
downstream.

Known MVP limits (called out in module header):
- Single-pod only: counts are per-process. Multi-pod deploys count
  independently; overall rate = pods × max.
- Process restart resets windows. Acceptable risk at this scale.
- LRU eviction at 10k distinct keys — unbounded memory avoided.

When we scale past one pod the module's public API stays identical;
only the backing Map swaps for Postgres or Upstash Redis.

Not yet wired to any route — Task 6 applies it to POST /stores with
a tight limit and to the global auth chain with SECURITY.md §6 defaults.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

**Rollback:** Revert this commit + any commits that wire the middleware. Revert order: Task 6 before Task 5.

---

## Task 6 — `feat(api): store routes — connect/list/get/disconnect`

**Why:** The largest commit in this plan — lands the route surface that the frontend targets. Has its own integration tests + tenant-isolation test + rate-limit wiring + OpenAPI spec regen + changelog entry. Isolated into one commit because these files depend on each other; splitting produces commits that don't compile.

**Files:**

- Create: `apps/api/src/validators/store.validator.ts`
- Create: `apps/api/src/services/store.service.ts`
- Create: `apps/api/src/routes/store.routes.ts`
- Modify: `apps/api/src/app.ts` — mount store routes + default rate limit
- Create: `apps/api/tests/integration/routes/stores.routes.test.ts`
- Create: `apps/api/tests/integration/tenant-isolation/stores-isolation.test.ts`
- Modify: `packages/api-client/openapi.json` (regenerated by `pnpm api:sync`)
- Modify: `docs/api-changelog.md` — append `[Unreleased]` entries

**Step 1 — Validator (`store.validator.ts`)**

Follow design §9.1. Export `ConnectStoreInputSchema`, `StoreSchema`, `StoreListResponseSchema`, `StoreSingleResponseSchema`, plus their inferred types. `toStoreResponse(store)` helper exported from here (or `services/store.service.ts`).

Critical: `StoreSchema` must NOT include `credentials`. Define explicitly:

```typescript
export const StoreSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  platform: z.enum(['TRENDYOL', 'HEPSIBURADA']),
  environment: z.enum(['PRODUCTION', 'SANDBOX']),
  externalAccountId: z.string(),
  status: z.enum(['ACTIVE', 'CONNECTION_ERROR', 'DISABLED']),
  lastConnectedAt: z.string().datetime().nullable(),
  lastSyncAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).openapi('Store');
```

**Step 2 — Service (`store.service.ts`)**

Design §9.2 shows the `connect` outline. Round out with:

- `list(orgId)` → `toStoreResponse[]`
- `getById(orgId, storeId)` → `toStoreResponse | throws NotFoundError`
- `disconnect(orgId, storeId)` → deletes; `mapPrismaError` converts P2025 → NotFoundError

Wrap every Prisma call in `mapPrismaError` per `apps/api/CLAUDE.md` §"Prisma → domain errors".

**Step 3 — Routes (`store.routes.ts`)**

- Use `createSubApp<{ Variables: { userId: string; organizationId: string } }>()` — ensures shared Zod-default-hook.
- Every route sets `security: [{ bearerAuth: [] }]`, `headers: RateLimitHeaders` on 2xx, `429: Common429Response`, and ProblemDetails bodies on 4xx/5xx responses per `apps/api/CLAUDE.md` §"Required per route".
- `POST /organizations/:orgId/stores` mounted with `rateLimit({ max: 5, windowSec: 60 })` middleware. All other routes use the default limit applied in `app.ts` (Step 4).
- `// TODO(roles): requireRole('OWNER', 'ADMIN')` marker immediately above the handler for `POST` and `DELETE`, per design §10.3.

Outline:

```typescript
import { rateLimit } from '../middleware/rate-limit.middleware';

app.openapi(
  listStoresRoute,
  async (c) => { /* service.list */ },
);

app.use(
  '/organizations/:orgId/stores',
  rateLimit({ max: 5, windowSec: 60, keyPrefix: 'POST:stores' }),
);
app.openapi(
  connectStoreRoute,
  // TODO(roles): requireRole('OWNER', 'ADMIN')
  async (c) => { /* service.connect */ },
);
// ...
```

Mount via `app.route('/', storeRoutes)` inside `createApp()`.

**Step 4 — Default rate limit in `app.ts`**

After `authMiddleware` + before any sub-app mount, add:

```typescript
app.use('*', rateLimit({ max: 300, windowSec: 60, keyPrefix: 'global' }));
```

300 req/min per user matches SECURITY.md §6 baseline. The `POST /stores` route adds its own tighter limiter — middleware is additive.

**Step 5 — Integration tests**

`tests/integration/routes/stores.routes.test.ts` — at minimum the following cases, using `createAuthenticatedTestUser`, `bearer(...)`, MSW-style `vi.spyOn(global, 'fetch')` for Trendyol responses:

1. **Happy path** — valid Trendyol mock 200 → 201 + response body matches `StoreSchema` exactly (no `credentials` field). DB row has encrypted credentials (base64, != original JSON).
2. **SANDBOX gate ON** — `vi.stubEnv('ALLOW_SANDBOX_CONNECTIONS', 'true')` + `environment: SANDBOX` → 201.
3. **SANDBOX gate OFF** — `vi.stubEnv('ALLOW_SANDBOX_CONNECTIONS', 'false')` + `environment: SANDBOX` → 422 `SANDBOX_NOT_ALLOWED`.
4. **HB platform rejected** — body `credentials.platform: HEPSIBURADA` → 422 `PLATFORM_NOT_YET_AVAILABLE`.
5. **Invalid Trendyol creds** — fetch mock returns 401 → response is 422 `MARKETPLACE_AUTH_FAILED`. DB has no new store row.
6. **Duplicate connection** — create once (happy path), submit again with same `supplierId` → 409 `CONFLICT` with `DUPLICATE_STORE_CONNECTION` code (propagated via `mapPrismaError` P2002).
7. **Rate limit** — six rapid POSTs with same user → sixth returns 429 `RATE_LIMITED` with `Retry-After` header.
8. **GET list** — 200 with array; unauthenticated → 401.
9. **DELETE** — 204; second DELETE returns 404.
10. **No credentials in any response body** — regex check that `credentials|apiSecret|apiKey` does not appear in any test's response JSON.

`tests/integration/tenant-isolation/stores-isolation.test.ts` — pattern from existing tenant-isolation tests:

1. User A creates store in org A.
2. User B (not a member of org A) calls `GET /organizations/{orgA.id}/stores` → 403 (not 404; user is authed but not a member — `orgContextMiddleware` owns this).
3. User B calls `GET /organizations/{orgB.id}/stores/{orgA.storeId}` → 404 (existence non-disclosure — SECURITY.md §3).
4. User B calls `DELETE /organizations/{orgB.id}/stores/{orgA.storeId}` → 404; DB row untouched.

**Step 6 — Regenerate OpenAPI spec**

```bash
pnpm api:sync
```

Commit the regenerated `packages/api-client/openapi.json` snapshot. The `.d.ts` file is gitignored.

**Step 7 — Changelog**

`docs/api-changelog.md` under `[Unreleased]`:

```markdown
### Added

- `GET /v1/organizations/:orgId/stores` — list stores; no credentials in response.
- `POST /v1/organizations/:orgId/stores` — connect marketplace (Trendyol only this phase); validates credentials against the vendor before persist; rate-limited at 5 req/min per user.
- `GET /v1/organizations/:orgId/stores/:storeId` — single store.
- `DELETE /v1/organizations/:orgId/stores/:storeId` — disconnect.
- Pan-app error codes: `MARKETPLACE_AUTH_FAILED` (422), `MARKETPLACE_ACCESS_DENIED` (422), `MARKETPLACE_UNREACHABLE` (503).

### Changed

- Global per-user rate limit: 300 req/min on authenticated routes (matches SECURITY.md §6 baseline). Was uncapped.
```

**Step 8 — Verify**

```bash
pnpm --filter @pazarsync/api typecheck
pnpm --filter @pazarsync/api test:integration -- stores
pnpm --filter @pazarsync/api test:integration -- tenant-isolation
pnpm api:sync       # must exit clean; CI rejects drifted openapi.json
pnpm check:all
```

Run `pnpm check:full` once at the end of Task 6 before committing — this catches any silent integration regression.

**Step 9 — Commit**

```bash
git add apps/api/src/{validators/store.validator.ts,services/store.service.ts,routes/store.routes.ts,app.ts} \
        apps/api/tests/integration/routes/stores.routes.test.ts \
        apps/api/tests/integration/tenant-isolation/stores-isolation.test.ts \
        packages/api-client/openapi.json \
        docs/api-changelog.md
git commit -m "$(cat <<'EOF'
feat(api): store routes — connect/list/get/disconnect

Four routes under /v1/organizations/:orgId/stores:

- GET    /stores              — list; no credentials in body.
- POST   /stores              — connect + validate atomically. Probe
  against the vendor (Trendyol product endpoint) runs BEFORE encrypt
  and persist — a failed probe does not leave a half-row. Rate-limited
  at 5 req/min per user; global 300/min applies to the others.
- GET    /stores/:id          — single store (no credentials).
- DELETE /stores/:id          — hard delete, cascades orders/products.

Every handler goes through authMiddleware + orgContextMiddleware. Role
gate (OWNER/ADMIN per SECURITY.md §3) is deferred to the requireRole
middleware in the Milestone #2 backlog; inline TODO markers flag the
swap point.

Validator enforces the D4 sandbox gate, D5 HB rejection, D6 user-named
store, and D2 unique-per-org Trendyol account (DB UNIQUE surfaces as
DUPLICATE_STORE_CONNECTION via mapPrismaError).

StoreSchema has no credentials field; toStoreResponse is the single
mapper from DB row → wire format. Spec regenerated, changelog updated.

Integration coverage: happy path, HB rejection, SANDBOX gate both ways,
invalid vendor creds, duplicate connection, rate-limit overflow, plus
the mandatory multi-tenancy isolation test.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

**Rollback:** Revert this commit. Prior tasks (adapter, errors, rate-limit, schema) stay in place, compile green, but the routes are gone — frontend Task 9/10 would 404. Revert Tasks 7–10 alongside if rolling back Task 6.

---

## Task 7 — `feat(web): stores feature module (api + hooks + validation)`

**Why:** The plumbing the components (Task 8) and pages (Tasks 9–10) will call. Kept separate so hook tests (MSW) can run independently of component tests.

**Files:**

- Create: `apps/web/src/features/stores/query-keys.ts`
- Create: `apps/web/src/features/stores/api/list-stores.api.ts`
- Create: `apps/web/src/features/stores/api/connect-store.api.ts`
- Create: `apps/web/src/features/stores/api/disconnect-store.api.ts`
- Create: `apps/web/src/features/stores/hooks/use-stores.ts`
- Create: `apps/web/src/features/stores/hooks/use-connect-store.ts`
- Create: `apps/web/src/features/stores/hooks/use-disconnect-store.ts`
- Create: `apps/web/src/features/stores/validation/connect-store.schema.ts`
- Create: `apps/web/tests/unit/hooks/use-stores.test.tsx`
- Create: `apps/web/tests/unit/hooks/use-connect-store.test.tsx`
- Create: `apps/web/tests/unit/hooks/use-disconnect-store.test.tsx`

**Step 1 — Query key factory**

```typescript
// query-keys.ts
export const storeKeys = {
  all: ['stores'] as const,
  list: (orgId: string) => [...storeKeys.all, 'list', orgId] as const,
  detail: (orgId: string, id: string) => [...storeKeys.all, 'detail', orgId, id] as const,
};
```

**Step 2 — API functions**

Each `.api.ts` wraps `apiClient.{GET|POST|DELETE}('/v1/organizations/{orgId}/stores...')` and uses `throwApiError` per `apps/web/CLAUDE.md` §"Typed API Client".

**Step 3 — Hooks**

- `useStores(orgId)` — `useQuery` with factory key. Default stale time, no special retry.
- `useConnectStore(orgId)` — `useMutation`. On success: `queryClient.invalidateQueries({ queryKey: storeKeys.list(orgId) })`. No custom `onError` (global onError handles toasts; forms handle `VALIDATION_ERROR` via `form.setError`).
- `useDisconnectStore(orgId)` — `useMutation`. On success: invalidate list.

**Step 4 — Validation schema**

Client-side Zod mirror of the backend's `ConnectStoreInputSchema`. Keeps the form instant-validating. Uses the same SCREAMING_SNAKE_CASE codes as backend, so one i18n namespace (`stores.connect.errors`) serves both client and server errors via `form.setError`.

**Step 5 — Hook tests**

Each test uses MSW handlers from `tests/helpers/msw.ts` + `render` from `tests/helpers/render.tsx`. Per `apps/web/CLAUDE.md`: never mock `apiClient`; MSW intercepts at the network layer.

Minimum cases:

- `use-stores`: success (200 with array), failure (500 toasts via global handler — assert `toast.error` called with the right localized key).
- `use-connect-store`: success, `VALIDATION_ERROR` propagates `ApiError.problem.errors[]` through to the mutation error state, `MARKETPLACE_AUTH_FAILED` surfaces as ApiError with that exact code.
- `use-disconnect-store`: success invalidates the list cache (second `useStores` call refetches).

**Step 6 — Verify**

```bash
pnpm --filter web typecheck
pnpm --filter web test:unit -- stores
```

**Step 7 — Commit**

```bash
git add apps/web/src/features/stores apps/web/tests/unit/hooks/use-stores*.test.tsx \
        apps/web/tests/unit/hooks/use-connect-store.test.tsx \
        apps/web/tests/unit/hooks/use-disconnect-store.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): stores feature module (api + hooks + validation)

Adds the typed-client wrappers, React Query hooks, and client-side Zod
schema backing the connect-store UI. Query-key factory follows the
orderKeys convention; each hook invalidates list on mutation success.

API functions throw via throwApiError — VALIDATION_ERROR propagation
from backend codes to inline form errors goes through the existing
problem.errors[] walk (see use-create-organization pattern).

Client-side Zod schema mirrors the backend validator so the form
instant-validates with identical error codes — one i18n namespace
(stores.connect.errors) covers both sides.

Hook tests use MSW — never mock apiClient. Three test files, eight
cases.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

**Rollback:** Revert — no other frontend code imports yet.

---

## Task 8 — `feat(web): connect-store form + platform card + environment tabs`

**Why:** The shared form + card components used by both entry points (onboarding page, dashboard modal). Components only — no route wiring yet.

**Files:**

- Create: `apps/web/src/features/stores/components/connect-store-form.tsx`
- Create: `apps/web/src/features/stores/components/platform-card.tsx`
- Create: `apps/web/src/features/stores/components/environment-tabs.tsx`
- Modify: `apps/web/messages/tr.json` — add `stores.connect.*`, `stores.platforms.*`, `stores.platformStatus.comingSoon`
- Modify: `apps/web/messages/en.json` — same
- Modify: `apps/web/src/providers/query-provider.tsx` — extend `KNOWN_CODES` with `MARKETPLACE_AUTH_FAILED`, `MARKETPLACE_ACCESS_DENIED`, `MARKETPLACE_UNREACHABLE`
- Create: `apps/web/tests/component/features/stores/connect-store-form.test.tsx`

**Step 1 — Components**

Per `apps/web/CLAUDE.md` §"UI Development Workflow" cascade:

- `connect-store-form.tsx` — react-hook-form + Zod resolver. Uses `ui/form`, `ui/input`, `ui/label`, `ui/button`, `ui/alert`. `<form method="post" noValidate onSubmit={form.handleSubmit(onSubmit)}>` per auth form discipline. Submit disabled while `isPending`. On `VALIDATION_ERROR`, walk `error.problem.errors[]` and feed into `form.setError` (mirror `create-organization-form.tsx`).

- `platform-card.tsx` — `ui/card` + `ui/badge`. Receives `platform`, `selected`, `comingSoon`, `onClick`. When `comingSoon`, renders `<Badge>Yakında</Badge>` + `aria-disabled="true"` + no click handler.

- `environment-tabs.tsx` — `ui/tabs`. Hidden entirely when `process.env.NEXT_PUBLIC_ALLOW_SANDBOX_CONNECTIONS !== 'true'`. When hidden, parent form passes `environment: 'PRODUCTION'` as hidden field.

**Step 2 — i18n keys**

Add to both `tr.json` and `en.json`. Namespace skeleton:

```jsonc
{
  "stores": {
    "connect": {
      "title": "Mağazanı bağla",
      "subtitle": "Siparişleri ve karı hesaplamamız için satıcı hesabına bağlan.",
      "labels": {
        "name": "Mağaza adı",
        "supplierId": "Satıcı ID",
        "apiKey": "API Key",
        "apiSecret": "API Secret",
        "environment": {
          "PRODUCTION": "Canlı",
          "SANDBOX": "Test (Sandbox)"
        }
      },
      "placeholders": {
        "name": "Trendyol Mağazam"
      },
      "actions": {
        "submit": "Bağla",
        "submitting": "Doğrulanıyor...",
        "skip": "Şimdilik geç"
      },
      "errors": {
        "INVALID_NAME_TOO_SHORT": "Mağaza adı en az 2 karakter olmalı.",
        "INVALID_NAME_TOO_LONG": "Mağaza adı en fazla 80 karakter olabilir.",
        "INVALID_SUPPLIER_ID_FORMAT": "Satıcı ID yalnızca harf ve rakam içerebilir.",
        "INVALID_API_KEY_FORMAT": "API Key / Secret formatı geçersiz.",
        "SANDBOX_NOT_ALLOWED": "Sandbox ortamı bu dağıtımda kullanılamaz.",
        "PLATFORM_NOT_YET_AVAILABLE": "Bu pazar yeri henüz desteklenmiyor.",
        "DUPLICATE_STORE_CONNECTION": "Bu Trendyol hesabı zaten bağlı."
      }
    },
    "platforms": {
      "TRENDYOL": "Trendyol",
      "HEPSIBURADA": "Hepsiburada"
    },
    "platformStatus": {
      "comingSoon": "Yakında"
    }
  },
  "common": {
    "errors": {
      "MARKETPLACE_AUTH_FAILED": "Girilen bilgiler pazar yeri tarafından reddedildi. Lütfen kontrol edip tekrar dene.",
      "MARKETPLACE_ACCESS_DENIED": "Pazar yerine erişim engellendi. Sandbox ise IP yetkilendirmesi gerekebilir.",
      "MARKETPLACE_UNREACHABLE": "Pazar yerine şu anda ulaşılamıyor. Lütfen birkaç dakika sonra tekrar dene."
    }
  }
}
```

English mirror with equivalent phrasing — not user-facing in practice but kept in sync per project convention.

**Step 3 — KNOWN_CODES extension**

In `apps/web/src/providers/query-provider.tsx`, find the `KNOWN_CODES` constant and append the three new codes so the global toast doesn't fall back to `generic`.

**Step 4 — Component tests**

`connect-store-form.test.tsx`:

1. Fills name + Trendyol credentials, submits, asserts onSuccess callback fires.
2. Submits with empty name → inline "INVALID_NAME_TOO_SHORT" copy rendered.
3. Backend returns 422 `VALIDATION_ERROR` with field=`credentials.supplierId` code=`INVALID_SUPPLIER_ID_FORMAT` → inline copy appears under supplierId input.
4. Hepsiburada card is rendered with "Yakında" badge and is not clickable.
5. Environment tabs absent when `NEXT_PUBLIC_ALLOW_SANDBOX_CONNECTIONS !== 'true'` (use `vi.stubEnv`).

**Step 5 — Verify**

```bash
pnpm --filter web typecheck
pnpm --filter web test -- connect-store-form
```

**Step 6 — Commit**

```bash
git add apps/web/src/features/stores/components \
        apps/web/messages/tr.json apps/web/messages/en.json \
        apps/web/src/providers/query-provider.tsx \
        apps/web/tests/component/features/stores/connect-store-form.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): connect-store form + platform card + environment tabs

Three reusable components backing both entry points (Task 9 onboarding
page, Task 10 dashboard modal):

- ConnectStoreForm — react-hook-form + Zod resolver, VALIDATION_ERROR
  propagation via problem.errors[] → form.setError (same pattern as
  create-organization-form).
- PlatformCard — Trendyol selectable, Hepsiburada rendered with
  "Yakında" badge + aria-disabled.
- EnvironmentTabs — hidden entirely when
  NEXT_PUBLIC_ALLOW_SANDBOX_CONNECTIONS is not "true".

All composed from ui/* primitives per the UI cascade rule. No new
tokens, no forked primitives.

i18n: stores.connect.*, stores.platforms.*, stores.platformStatus.*,
plus three pan-app codes under common.errors.* (MARKETPLACE_AUTH_FAILED
/ MARKETPLACE_ACCESS_DENIED / MARKETPLACE_UNREACHABLE) also registered
in KNOWN_CODES so the global toast translates them.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

**Rollback:** Revert — Tasks 9/10 depend on these; revert them first.

---

## Task 9 — `feat(web): onboarding connect-store page + post-create-org redirect`

**Why:** Wires the first entry point (onboarding step 2). Also adjusts `CreateOrganizationForm`'s success redirect from `/dashboard` → `/onboarding/connect-store`.

**Files:**

- Create: `apps/web/src/app/[locale]/onboarding/connect-store/page.tsx` (replaces `.gitkeep`)
- Modify: `apps/web/src/features/organization/hooks/use-create-organization.ts` — line 47 currently reads `router.push('/dashboard')`; change to `router.push('/onboarding/connect-store')`
- Create: `apps/web/tests/component/features/stores/connect-store-page.test.tsx`

**Step 1 — Page**

RSC pattern mirroring `create-organization/page.tsx`. Guards:

- If zero orgs → redirect `/onboarding/create-organization`.
- If active org already has ≥1 store → redirect `/dashboard` (skip the page; user doesn't need it).
- Otherwise render `<ConnectStoreForm onSuccess={…}>` + `<SkipLink href="/dashboard">`.

On success: `router.push('/dashboard')` + sonner toast.

**Step 2 — Redirect update**

In `apps/web/src/features/organization/hooks/use-create-organization.ts`, the `onSuccess` handler currently calls `router.push('/dashboard')` (line 47 as of this plan). Change to `router.push('/onboarding/connect-store')`. Also update the JSDoc `@return` comment (line 23, "Route to /dashboard.") to match.

**Important:** the dashboard's own zero-store-state (Task 10) catches the case where the user hits skip — they still get a dashboard, just with the empty-state CTA. So this redirect change is safe: fresh users always see the connect page, returning or skipping users go to a well-designed dashboard.

**Step 3 — Component test**

Renders the page with mocked `getServerApiClient` (returns one org, zero stores). Asserts: title rendered, form present, "Şimdilik geç" link navigates to `/dashboard`.

**Step 4 — Verify**

```bash
pnpm --filter web typecheck
pnpm --filter web test -- connect-store-page
```

**Step 5 — Commit**

```bash
git add "apps/web/src/app/[locale]/onboarding/connect-store/page.tsx" \
        apps/web/src/features/organization \
        apps/web/tests/component/features/stores/connect-store-page.test.tsx
# Remove the .gitkeep:
git rm "apps/web/src/app/[locale]/onboarding/connect-store/.gitkeep"
git commit -m "$(cat <<'EOF'
feat(web): onboarding connect-store page + post-create-org redirect

Second step of the onboarding flow: fresh user creates org → lands on
/onboarding/connect-store → connects Trendyol or skips. Guards mirror
create-organization: zero orgs redirects back, already-has-a-store
skips forward to /dashboard.

"Şimdilik geç" link navigates to /dashboard without persistence. The
dashboard's own empty-state CTA (Task 10) re-offers connect on every
subsequent load until a store exists — no tombstone state needed.

Post-create-organization redirect switches from /dashboard to
/onboarding/connect-store. Returning users still reach the dashboard
via guard short-circuit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

**Rollback:** Revert. The `.gitkeep` return via revert restores the scaffold state. Task 10 doesn't depend on the onboarding page.

---

## Task 10 — `feat(web): dashboard stores empty-state + add-store modal`

**Why:** Second entry point — recurring access from the dashboard. Empty state when zero stores; OrgSwitcher gains a "+ Yeni Mağaza" item opening the shared `ConnectStoreForm` inside a modal.

**Files:**

- Create: `apps/web/src/features/stores/components/stores-empty-state.tsx`
- Create: `apps/web/src/features/stores/components/connect-store-modal.tsx`
- Modify: `apps/web/src/app/[locale]/(dashboard)/dashboard/page.tsx` — render empty state when `stores.length === 0`
- Modify: `apps/web/src/features/organization/components/org-switcher.tsx` — add "+ Yeni Mağaza" menu item
- Create: `apps/web/tests/component/features/stores/stores-empty-state.test.tsx`

**Step 1 — Empty state**

Composes `components/patterns/empty-state.tsx` with store-specific copy + primary CTA opening `<ConnectStoreModal>`. Secondary copy points at Trendyol's developer docs (external link, `rel="noopener noreferrer"`).

**Step 2 — Modal**

`ui/dialog` wrapping `<ConnectStoreForm onSuccess={close}>`. On close (outside click / escape / explicit close), resets form state. On success: `close()` + invalidate `storeKeys.all` is already handled by the hook — modal just closes.

**Step 3 — Dashboard wiring**

Use `useStores(activeOrgId).data` (or the existing active-org pattern). Render `<StoresEmptyState>` when array length === 0 — inline in the main column, same vertical rhythm as the existing empty states.

**Step 4 — OrgSwitcher item**

After the org list, a separator + a `DropdownMenuItem` "+ Yeni Mağaza" that calls `setOpen(true)` on `<ConnectStoreModal>`. Modal state managed locally in the OrgSwitcher component.

**Step 5 — Component test**

`stores-empty-state.test.tsx`:

1. Renders title + subtitle + CTA.
2. Clicking CTA opens the modal (asserts role="dialog" + form present).
3. Modal respects Esc close + backdrop close.

**Step 6 — Verify**

```bash
pnpm --filter web typecheck
pnpm --filter web test -- stores-empty-state
```

**Step 7 — Full suite**

```bash
supabase start
pnpm check:full
```

Expected: all green. Address any integration-suite regressions before committing.

**Step 8 — Commit**

```bash
git add apps/web/src/features/stores/components/stores-empty-state.tsx \
        apps/web/src/features/stores/components/connect-store-modal.tsx \
        "apps/web/src/app/[locale]/(dashboard)/dashboard/page.tsx" \
        apps/web/src/features/organization/components/org-switcher.tsx \
        apps/web/tests/component/features/stores/stores-empty-state.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): dashboard stores empty-state + add-store modal

Second entry point for connect-store: recurring dashboard access.

- StoresEmptyState composes patterns/empty-state with Trendyol-
  pointing copy + primary CTA opening the shared form inside a
  dialog.
- ConnectStoreModal is a thin ui/dialog wrapper around
  ConnectStoreForm; closes on success, relies on the hook-level
  cache invalidation.
- OrgSwitcher gains "+ Yeni Mağaza" at the bottom of the dropdown so
  users with 1+ stores can connect another without leaving the
  dashboard.

Dashboard renders the empty state inline when useStores(orgId) returns
empty — same vertical rhythm as the existing ActiveOrganizationPanel
empty state.

No new patterns/ composites yet — StoresEmptyState stays in the
feature folder until a second consumer needs the shape.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

**Rollback:** Revert — dashboard reverts to rendering without the empty state or switcher entry. Stores still connectable via `/onboarding/connect-store` (Task 9).

---

## Verification

Run after each task (fast, no DB):

```bash
pnpm check:all
```

Run once at the end of Task 6 and once before opening the PR (slow, needs Supabase):

```bash
supabase start && pnpm db:push && pnpm db:seed
pnpm check:full
```

### Manual smoke (mandatory pre-merge)

Per the design doc §14.3. Run against local Supabase + a real Trendyol sandbox account:

1. `pnpm dev` — both apps.
2. Browser → sign in as seed user (`berkinoktayai@gmail.com` / seed password).
3. Create a new organization. Expect redirect to `/onboarding/connect-store`.
4. Enter invalid Trendyol credentials → Turkish toast appears with `MARKETPLACE_AUTH_FAILED` copy (or the Zod-level code if format is wrong).
5. Enter correct Trendyol sandbox credentials (supplierId + apiKey + apiSecret; IP must be whitelisted by Trendyol support per docs/integrations/trendyol/3-canli-test-ortam-bilgileri.md). Expect 201 + toast + redirect to `/dashboard`.
6. Open Prisma Studio: inspect the `stores` row. `credentials` column is a base64 blob, not JSON. `external_account_id` matches the supplierId. `status` is `ACTIVE`, `last_connected_at` set.
7. Submit the exact same credentials again → 409 + Turkish "zaten bağlı" toast.
8. Sign out, sign back in → dashboard shows the store in OrgSwitcher / panels.
9. **Disconnect (via curl, not UI):** Phase 1 does not ship a disconnect UI — the `DELETE /stores/:id` route exists (used by tests) but no button surfaces it in the dashboard. Verify with:
   ```bash
   curl -X DELETE -H "Authorization: Bearer $TOKEN" \
     http://localhost:3001/v1/organizations/$ORG_ID/stores/$STORE_ID
   ```
   Expect 204. Refresh dashboard → empty state reappears. (A disconnect UI ships with Milestone #2 store-management.)
10. Spam `POST /stores` via curl 6 times rapidly with same token → sixth returns 429 with `Retry-After` header.

Any failed step blocks merge. Fix, retest from step 1.

## Rollback plan

Mirrors design §17. Each task is independently revertable. If a regression is caught post-merge:

| Symptom                                     | Revert commits                                                     | Additional steps                                                          |
| ------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| DB migration fails on real data             | Task 1                                                             | `pnpm db:push` with the prior schema pulled from `main`. No stores yet — zero data loss in practice. |
| Trendyol probe breaks (vendor API change)   | Task 3 only                                                        | Disable `POST /stores` at the router (route-level feature flag) as a hotfix while Task 3 is recrafted. |
| Rate-limit too tight                        | Task 5 + Task 6's `app.ts` rate-limit line                         | Store create still works because the error class + ProblemDetails mapping remain (PR #34); only the middleware throwing disappears. |
| Frontend regression                         | Tasks 7–10                                                         | Backend fully functional; manual curl to `/v1/...stores` proves the API is unaffected. |
| Critical security finding                   | **All tasks**, branch level: `git reset --hard origin/main` then `git push --force-with-lease` on the feature branch | Then follow SECURITY.md §"Incident Response". |

The design doc's §17 has the full breakdown; this table is the operational summary.

## Definition of done

Lifted verbatim from the user's brief:

- [x] Both planning docs written, approved, and archived (moved to `docs/plans/archive/` once the final PR merges)
- [ ] User can create an org → connect Trendyol → land on dashboard with store visible, **OR** skip → land on dashboard → connect later from the dashboard CTA
- [ ] Production builds (`ALLOW_SANDBOX_CONNECTIONS !== 'true'`) genuinely cannot reach the sandbox — integration test (§14.1) proves this
- [ ] All errors reach the user as Turkish i18n copy with specific codes, never raw marketplace error text — `stores.connect.errors.*` + `common.errors.MARKETPLACE_*` both land
- [ ] Credentials encrypted at rest, never returned in responses — `StoreSchema` has no `credentials` field; regex check in integration test
- [ ] Adding a second marketplace later would not require modifying Trendyol code or the core service layer — registry + factory shape proves this by construction; a follow-up PR that adds Hepsiburada touches zero Trendyol files as the verification

---

**Total:** 10 commits, 2 planning docs, ~14 new source files, ~12 new test files, one changelog entry, one OpenAPI spec regen.
