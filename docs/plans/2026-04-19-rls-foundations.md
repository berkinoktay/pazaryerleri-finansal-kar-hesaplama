# RLS Foundations Implementation Plan

> **For Claude:** Implement this plan task-by-task. Each task ends with a commit; do not skip the commit step. Load the `superpowers:executing-plans` skill before starting.

**Goal:** Add Row-Level Security policies to every tenant-scoped table, establish a test pattern that proves policies actually enforce (token-scoped Supabase JS client, not service-role Prisma), and lock this into a repeatable workflow so every future table lands with its RLS task in the same PR.

**Architecture:**

```
Defense-in-depth (three layers):
  Layer 1: authMiddleware + orgContextMiddleware      (feat/auth-middleware — done)
  Layer 2: RLS policies on PostgreSQL rows            (this plan)
  Layer 3: Schema constraints (FKs, unique indexes)   (already in place)
```

Policies live in `supabase/sql/rls-policies.sql` (one file, organized by table — the stub already exists). A new `pnpm db:apply-policies` script applies them via `psql`. `pnpm db:push` chains schema push + apply-policies so developers never drift.

**Phase A (this plan)** — `SELECT` policies for `authenticated` role; INSERT/UPDATE/DELETE use Postgres's default-deny when no policy exists. Every policy is paired with an integration test that goes through Supabase JS client + user JWT (PostgREST exercises RLS there; Prisma via service-role bypasses RLS and therefore cannot prove policies work).

**Phase B (deferred to a future plan)** — per-request scoped Prisma so backend queries also hit RLS. Requires transaction wrapping and changes every service call signature. Deferred because (a) we have one service function today, (b) we want to validate policy shape first, (c) no hurry — backend already enforces tenancy via middleware explicit filters.

**Tech Stack:**

- **Supabase Postgres 15** with native `ENABLE ROW LEVEL SECURITY` and `CREATE POLICY`
- **`auth.uid()`** — Supabase helper that reads `request.jwt.claims ->> 'sub'` (matches `user_profiles.id`)
- **`@supabase/supabase-js`** in tests — already a dep in `apps/api/package.json`. Used with `Authorization: Bearer <real-supabase-session-token>` so requests go through PostgREST as the `authenticated` role.
- **`psql`** — ships with Supabase CLI install; used by `db:apply-policies`
- **Existing `createAuthenticatedTestUser`** from `apps/api/tests/helpers/auth.ts` — returns a real Supabase session (admin.createUser + signInWithPassword). The RLS test helper composes on top of this.

**Pre-flight checklist:**

- [x] feat/auth-middleware merged (PR #25).
- [x] refactor/auth-use-supabase-sdk merged (PR #26) — backend now verifies via `supabase.auth.getUser`, tests use real sessions via `createAuthenticatedTestUser`.
- [ ] New branch `feat/rls-foundations` created off main.
- [ ] Supabase local running (`supabase status` shows healthy).
- [ ] `.env` populated (`DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `ENCRYPTION_KEY`). `JWT_SECRET` intentionally absent — it no longer gates anything since the refactor.
- [ ] `psql --version` works from shell (comes with Supabase CLI install; if missing, `brew install libpq` and add to PATH, or use `supabase db psql` wrapper).

**Design decisions — read before starting:**

1. **Why policies in `supabase/sql/` and not Prisma migrations?**
   Prisma 7's migration generator produces DDL for tables/indexes/constraints — RLS policies are not represented in the Prisma schema DSL. The standard Supabase + Prisma pattern keeps schema under Prisma and supplementary SQL (RLS, DB functions, triggers) under `supabase/sql/`. Chaining `db:apply-policies` into `db:push` keeps the two in sync for developers; CI should also run both.

2. **Why default-deny for INSERT/UPDATE/DELETE in this plan?**
   No CRUD endpoints exist yet. When the first CREATE endpoint lands (store connect — roadmap next) its plan includes the INSERT policy. Same for UPDATE/DELETE. "No policy" means default deny for non-superuser roles, which is the safest baseline — `authenticated` users cannot write until we explicitly allow them.

3. **Why not make backend go through RLS now (Phase B)?**
   Requires per-request transaction scoping (each request wraps Prisma calls in `BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub = ...; ...; COMMIT;`). Viable with Prisma's `$transaction` but changes every service signature. We have one service function (`organization.service.listForUser`). Revisit after we have ~5–10 services so the refactor has a clear shape. Meanwhile Phase A's policies still protect: direct psql, anon-key clients, realtime subscribers, edge functions using anon key. The only gap is "buggy backend query missing its explicit filter" — that class of bug is caught by middleware enforcement + code review + the tenant-isolation integration test pattern already in place.

4. **Why `auth.uid()` and not `request.jwt.claims ->> 'sub'` directly?**
   `auth.uid()` is a Supabase-provided helper function that returns `(current_setting('request.jwt.claims', true)::json ->> 'sub')::uuid`. Shorter, clearer in policy bodies. It's defined in Supabase's default migrations so it's present on every Supabase project, local or cloud.

---

## Task 1: Add `db:apply-policies` script + chain into `db:push`

**Why:** Developers run `pnpm db:push` after schema changes. If policies aren't chained, they'll forget, and local RLS state will drift from what the SQL file claims. One command = one source of truth.

**Files:**

- Modify: `packages/db/package.json` (add `apply-policies` + update `push`)
- Modify: `package.json` at repo root (add `db:apply-policies` passthrough)

**Step 1: Add the package-level script**

Edit `packages/db/package.json`'s `scripts`:

```json
{
  "scripts": {
    "generate": "prisma generate",
    "migrate:dev": "prisma migrate dev",
    "push": "prisma db push && pnpm apply-policies",
    "apply-policies": "psql $DATABASE_URL -v ON_ERROR_STOP=1 -f ../../supabase/sql/rls-policies.sql",
    "seed": "tsx prisma/seed.ts",
    "studio": "prisma studio",
    "typecheck": "tsc --noEmit"
  }
}
```

Notes:

- `ON_ERROR_STOP=1` makes psql exit non-zero on any SQL error, so `pnpm db:push` fails visibly if a policy has a typo.
- `$DATABASE_URL` comes from the shell env. Developers running locally rely on the workspace-root `.env` — they'll need to `export $(grep -v '^#' .env | xargs)` or `source .env` once per shell session, OR we can use `dotenv-cli` to wrap. For simplicity this plan assumes shell-exported env; if it friction-tests badly later, add `dotenv -e ../../.env -- ...` wrapper.

**Step 2: Add repo-root passthrough**

Edit root `package.json` `scripts`:

```json
{
  "scripts": {
    "db:apply-policies": "pnpm --filter @pazarsync/db apply-policies"
  }
}
```

**Step 3: Smoke test — script runs against empty rls-policies.sql**

```bash
export $(grep -v '^#' .env | xargs)
pnpm db:apply-policies
```

Expected: psql runs, prints nothing notable (file has only comments), exit 0.

**Step 4: Commit**

```bash
git add packages/db/package.json package.json
git commit -m "chore(db): add db:apply-policies; chain into db:push"
```

**Done when:** `pnpm db:push` succeeds end-to-end and applies (currently empty) policies file.

---

## Task 2: Add RLS test client helper

**Why:** Prisma via our `DATABASE_URL` connects as `postgres` superuser, which bypasses RLS. To test that a policy actually denies access, we need a connection that runs as the `authenticated` role. Supabase JS client with a user JWT in its Authorization header goes through PostgREST, which sets the role and claims correctly.

**Files:**

- Create: `apps/api/tests/helpers/rls-client.ts`

**Step 1: Implement the helper**

`createAuthenticatedTestUser` already exists (`tests/helpers/auth.ts`) and returns a real `accessToken` — build on it so RLS tests use the same identity primitive as every other integration test.

```typescript
// apps/api/tests/helpers/rls-client.ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { createAuthenticatedTestUser, type AuthenticatedTestUser } from './auth';

/**
 * Build a Supabase JS client scoped to a real user's JWT.
 *
 * All queries go through PostgREST with `Authorization: Bearer <jwt>`,
 * which Supabase translates to `SET ROLE authenticated` + claims for
 * RLS. This is the ONLY way to prove RLS policies in tests — Prisma
 * connects as `postgres` superuser and bypasses RLS entirely.
 *
 * Builds on `createAuthenticatedTestUser` (which already creates a real
 * Supabase auth.users row + user_profiles + returns an access_token via
 * password grant) so the JWT is a genuine Supabase-issued ES256 token.
 */
export async function createRlsScopedClient(): Promise<{
  user: AuthenticatedTestUser;
  client: SupabaseClient;
}> {
  const user = await createAuthenticatedTestUser();
  const url = process.env['SUPABASE_URL'];
  const publishableKey = process.env['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'];
  if (url === undefined || url.length === 0 || publishableKey === undefined) {
    throw new Error('SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are required');
  }
  const client = createClient(url, publishableKey, {
    global: { headers: { Authorization: `Bearer ${user.accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return { user, client };
}

/**
 * Build a Supabase JS client with NO auth header — goes through
 * PostgREST as the `anon` role. Use to verify anon users cannot read
 * any tenant data.
 */
export function createAnonClient(): SupabaseClient {
  const url = process.env['SUPABASE_URL'];
  const publishableKey = process.env['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'];
  if (url === undefined || url.length === 0 || publishableKey === undefined) {
    throw new Error('SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are required');
  }
  return createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
```

**Step 2: Verify Node can import it (typecheck)**

```bash
pnpm --filter @pazarsync/api typecheck
```

Expected: green.

**Step 3: Commit**

```bash
git add apps/api/tests/helpers/rls-client.ts
git commit -m "feat(api): add RLS-scoped Supabase client helper for tests"
```

**Done when:** Helper compiles, test suite still green (helper unused — that's fine).

### Adapting Task 3–7 test code to the new helper

The code samples in Tasks 3–7 below use the pre-refactor patterns
(`createUserProfile()` + `signTestJwt()`). The refactor replaced that
whole chain with `createAuthenticatedTestUser`. When executing,
substitute per this table:

| Plan sample | Refactor-era replacement |
|---|---|
| `const user = await createUserProfile(); const client = await createRlsScopedClient(user.id);` | `const { user, client } = await createRlsScopedClient();` |
| `const user = await createUserProfile(...)` (used only for org_members FK, not as test subject) | `const user = await createUserProfile(...)` (factories.ts helper is still there for this case) |
| `const [userA, userB] = await Promise.all([createUserProfile(), createUserProfile()])` + later `signTestJwt(userA.id)` | Call `createRlsScopedClient()` for the user whose perspective is being tested; `createUserProfile()` for the "other" user you just need a row for |

For cases where we need TWO authenticated users (e.g., verifying user A is isolated from user B and both are real auth'd users), call `createRlsScopedClient()` twice. Otherwise `createUserProfile()` (no token needed) plus `createRlsScopedClient()` for the one subject suffices.

---

## Task 3: `user_profiles` — enable RLS + self-read policy

**Why:** Users must be able to read their own profile (for the future `GET /v1/me` endpoint) but nobody else's. Start the pattern here because `user_profiles` has the simplest policy shape — single-row self-scoped.

**Files:**

- Modify: `supabase/sql/rls-policies.sql` (add enable + policies)
- Create: `apps/api/tests/integration/rls/user-profiles.rls.test.ts`

**Step 1: Write the failing test**

Create `apps/api/tests/integration/rls/user-profiles.rls.test.ts`:

```typescript
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createUserProfile } from '../../helpers/factories';
import { createAnonClient, createRlsScopedClient } from '../../helpers/rls-client';

describe('RLS — user_profiles', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('user CAN read own profile', async () => {
    const user = await createUserProfile({ fullName: 'Self' });
    const client = await createRlsScopedClient(user.id);

    const { data, error } = await client.from('user_profiles').select('*').eq('id', user.id);

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]?.full_name).toBe('Self');
  });

  it('user CANNOT read another user\'s profile', async () => {
    const [self, other] = await Promise.all([
      createUserProfile({ fullName: 'Self' }),
      createUserProfile({ fullName: 'Other' }),
    ]);
    const client = await createRlsScopedClient(self.id);

    const { data, error } = await client.from('user_profiles').select('*').eq('id', other.id);

    // RLS filters rows; a forbidden row just doesn't appear.
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('anon cannot read any profile', async () => {
    await createUserProfile();
    const client = createAnonClient();

    const { data, error } = await client.from('user_profiles').select('*');

    // Either an empty result or an error — both are acceptable denials.
    if (error === null) {
      expect(data).toEqual([]);
    }
  });
});
```

**Step 2: Run test — expect FAIL**

```bash
pnpm --filter @pazarsync/api test:integration -- user-profiles.rls
```

Expected: all three tests fail. The first test fails because RLS isn't enabled yet, so the default `postgres` role sees the row but wait — the Supabase JS client isn't connecting as postgres, it's going through PostgREST. With no RLS enabled, PostgREST's default behavior allows the query to succeed. So test 1 might pass by accident. Test 2 will likely fail because without RLS, `.eq('id', other.id)` will return `other`'s row — user can read everyone's. That's what we need to fix.

**Step 3: Enable RLS and add policies in `supabase/sql/rls-policies.sql`**

Replace `supabase/sql/rls-policies.sql` contents with:

```sql
-- Row-Level Security policies for multi-tenant isolation.
-- Applied after Prisma's `db push` via `pnpm db:apply-policies`.
--
-- Design principles:
--   - Policies target the `authenticated` role. The `postgres` superuser
--     (which our Prisma DATABASE_URL uses today) bypasses RLS entirely,
--     so backend service-role queries continue to work unchanged.
--   - Only SELECT policies are defined in Phase A. INSERT/UPDATE/DELETE
--     have no policy, which means default-deny for non-superuser roles.
--     CRUD endpoints add their own policies when they land.
--   - All policies use `auth.uid()`, which Supabase provides out of the
--     box to read the JWT `sub` claim.

-- ─── user_profiles ─────────────────────────────────────────────────────
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- A user can read their own profile.
CREATE POLICY user_profiles_self_read ON user_profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid());
```

**Step 4: Apply policies + run tests**

```bash
export $(grep -v '^#' .env | xargs)
pnpm db:apply-policies
pnpm --filter @pazarsync/api test:integration -- user-profiles.rls
```

Expected: all three tests PASS.

**Step 5: Commit**

```bash
git add supabase/sql/rls-policies.sql apps/api/tests/integration/rls/user-profiles.rls.test.ts
git commit -m "feat(db): enable RLS + self-read policy on user_profiles"
```

**Done when:** Three user_profiles RLS tests green; typecheck clean.

---

## Task 4: `organizations` — enable RLS + member-read policy

**Why:** Users see only organizations they belong to. This is the policy that `GET /v1/organizations` will effectively rely on once Phase B (scoped Prisma) lands. For now it protects the row from anon/realtime access.

**Files:**

- Modify: `supabase/sql/rls-policies.sql` (add org section)
- Create: `apps/api/tests/integration/rls/organizations.rls.test.ts`

**Step 1: Write the failing test**

```typescript
// apps/api/tests/integration/rls/organizations.rls.test.ts
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ensureDbReachable, truncateAll } from '../../helpers/db';
import {
  createMembership,
  createOrganization,
  createUserProfile,
} from '../../helpers/factories';
import { createRlsScopedClient } from '../../helpers/rls-client';

describe('RLS — organizations', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('member CAN read their organization', async () => {
    const user = await createUserProfile();
    const org = await createOrganization({ name: 'Alpha' });
    await createMembership(org.id, user.id, 'OWNER');
    const client = await createRlsScopedClient(user.id);

    const { data, error } = await client.from('organizations').select('*').eq('id', org.id);

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]?.name).toBe('Alpha');
  });

  it('non-member CANNOT see an organization they don\'t belong to', async () => {
    const [userA, userB] = await Promise.all([createUserProfile(), createUserProfile()]);
    const orgB = await createOrganization({ name: 'Only-B' });
    await createMembership(orgB.id, userB.id, 'OWNER');
    const client = await createRlsScopedClient(userA.id);

    const { data, error } = await client.from('organizations').select('*');

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('user sees only the orgs they are a member of, not all', async () => {
    const user = await createUserProfile();
    const [mine, theirs] = await Promise.all([
      createOrganization({ name: 'Mine' }),
      createOrganization({ name: 'Theirs' }),
    ]);
    await createMembership(mine.id, user.id, 'OWNER');
    const client = await createRlsScopedClient(user.id);

    const { data, error } = await client.from('organizations').select('name');

    expect(error).toBeNull();
    expect(data?.map((o) => o.name)).toEqual(['Mine']);
  });
});
```

**Step 2: Run — expect FAIL**

```bash
pnpm --filter @pazarsync/api test:integration -- organizations.rls
```

**Step 3: Add the policies**

Append to `supabase/sql/rls-policies.sql`:

```sql
-- ─── organizations ─────────────────────────────────────────────────────
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

-- A user can read any organization they are a member of.
CREATE POLICY organizations_member_read ON organizations
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM organization_members
      WHERE organization_members.organization_id = organizations.id
        AND organization_members.user_id = auth.uid()
    )
  );
```

**Step 4: Apply + test**

```bash
pnpm db:apply-policies
pnpm --filter @pazarsync/api test:integration -- organizations.rls
```

Expected: 3 tests PASS.

**Step 5: Commit**

```bash
git add supabase/sql/rls-policies.sql apps/api/tests/integration/rls/organizations.rls.test.ts
git commit -m "feat(db): enable RLS + member-read policy on organizations"
```

**Done when:** Three organizations RLS tests green.

---

## Task 5: `organization_members` — enable RLS + co-member read policy

**Why:** Two access patterns: a user reading their own memberships (for the current `/v1/organizations` list), and (future) a user reading their org-mates' memberships (for the future "Members" page). Both are SELECT-only in Phase A; INSERT/UPDATE/DELETE (invite/remove/change-role) come with the first membership-management endpoint.

**Files:**

- Modify: `supabase/sql/rls-policies.sql`
- Create: `apps/api/tests/integration/rls/organization-members.rls.test.ts`

**Step 1: Write the failing test**

```typescript
// apps/api/tests/integration/rls/organization-members.rls.test.ts
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ensureDbReachable, truncateAll } from '../../helpers/db';
import {
  createMembership,
  createOrganization,
  createUserProfile,
} from '../../helpers/factories';
import { createRlsScopedClient } from '../../helpers/rls-client';

describe('RLS — organization_members', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('user can read own membership rows', async () => {
    const user = await createUserProfile();
    const [orgA, orgB] = await Promise.all([createOrganization(), createOrganization()]);
    await createMembership(orgA.id, user.id, 'OWNER');
    await createMembership(orgB.id, user.id, 'MEMBER');
    const client = await createRlsScopedClient(user.id);

    const { data, error } = await client.from('organization_members').select('role');

    expect(error).toBeNull();
    expect(data?.map((m) => m.role).sort()).toEqual(['MEMBER', 'OWNER']);
  });

  it('user can read other members of an org they belong to', async () => {
    const [self, coworker] = await Promise.all([createUserProfile(), createUserProfile()]);
    const org = await createOrganization();
    await createMembership(org.id, self.id, 'OWNER');
    await createMembership(org.id, coworker.id, 'MEMBER');
    const client = await createRlsScopedClient(self.id);

    const { data, error } = await client
      .from('organization_members')
      .select('user_id')
      .eq('organization_id', org.id);

    expect(error).toBeNull();
    expect(data?.map((m) => m.user_id).sort()).toEqual([coworker.id, self.id].sort());
  });

  it('user CANNOT read memberships of an org they do not belong to', async () => {
    const [self, stranger] = await Promise.all([createUserProfile(), createUserProfile()]);
    const org = await createOrganization();
    await createMembership(org.id, stranger.id, 'OWNER');
    const client = await createRlsScopedClient(self.id);

    const { data, error } = await client
      .from('organization_members')
      .select('user_id')
      .eq('organization_id', org.id);

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});
```

**Step 2: Run — expect FAIL**

**Step 3: Add the policy**

Append to `supabase/sql/rls-policies.sql`:

```sql
-- ─── organization_members ──────────────────────────────────────────────
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;

-- A user can read any membership row for an org they are also a member of.
-- Covers both own-memberships (trivially) and co-member rows.
CREATE POLICY organization_members_co_member_read ON organization_members
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM organization_members AS self
      WHERE self.organization_id = organization_members.organization_id
        AND self.user_id = auth.uid()
    )
  );
```

> **Recursion note:** The policy references `organization_members` inside its own USING clause. Postgres handles this without infinite recursion because RLS evaluation does not re-apply policies to the table referenced in a sub-query of its own policy (documented behavior). If in local testing you see "infinite recursion detected in policy", switch to a `SECURITY DEFINER` helper function — but start with this shape; it is the canonical Supabase pattern.

**Step 4: Apply + test**

**Step 5: Commit**

```bash
git add supabase/sql/rls-policies.sql apps/api/tests/integration/rls/organization-members.rls.test.ts
git commit -m "feat(db): enable RLS + co-member read policy on organization_members"
```

**Done when:** 3 tests green; no policy-recursion errors in psql output.

---

## Task 6: Org-scoped children — `stores`, `products`, `orders`, `order_items`, `expenses`

**Why:** All five share the same access shape: "row visible if the requesting user is a member of the organization that owns it." Batching them into one task is OK because the policy template is identical — only the JOIN path differs. Each gets its own integration test asserting the pattern works on that table.

**Files:**

- Modify: `supabase/sql/rls-policies.sql` (add a section per table)
- Create: `apps/api/tests/integration/rls/org-scoped-tables.rls.test.ts`

**Step 1: Write the failing test (batched — one file, one describe per table)**

```typescript
// apps/api/tests/integration/rls/org-scoped-tables.rls.test.ts
import { prisma } from '@pazarsync/db';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ensureDbReachable, truncateAll } from '../../helpers/db';
import {
  createMembership,
  createOrder,
  createOrganization,
  createStore,
  createUserProfile,
} from '../../helpers/factories';
import { createRlsScopedClient } from '../../helpers/rls-client';

describe('RLS — org-scoped tables', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  async function twoTenantsSetup() {
    const [userA, userB] = await Promise.all([createUserProfile(), createUserProfile()]);
    const [orgA, orgB] = await Promise.all([createOrganization(), createOrganization()]);
    await createMembership(orgA.id, userA.id, 'OWNER');
    await createMembership(orgB.id, userB.id, 'OWNER');
    const [storeA, storeB] = await Promise.all([
      createStore(orgA.id, { name: 'A Store' }),
      createStore(orgB.id, { name: 'B Store' }),
    ]);
    return { userA, userB, orgA, orgB, storeA, storeB };
  }

  describe('stores', () => {
    it('member sees only own org stores', async () => {
      const { userA, storeA, storeB } = await twoTenantsSetup();
      const client = await createRlsScopedClient(userA.id);

      const { data, error } = await client.from('stores').select('id,name');

      expect(error).toBeNull();
      expect(data?.map((s) => s.id)).toEqual([storeA.id]);
      expect(data?.map((s) => s.id)).not.toContain(storeB.id);
    });
  });

  describe('orders', () => {
    it('member sees only own org orders', async () => {
      const { userA, orgA, orgB, storeA, storeB } = await twoTenantsSetup();
      const [orderA, orderB] = await Promise.all([
        createOrder(orgA.id, storeA.id),
        createOrder(orgB.id, storeB.id),
      ]);
      const client = await createRlsScopedClient(userA.id);

      const { data, error } = await client.from('orders').select('id');

      expect(error).toBeNull();
      expect(data?.map((o) => o.id)).toEqual([orderA.id]);
      expect(data?.map((o) => o.id)).not.toContain(orderB.id);
    });
  });

  describe('products', () => {
    it('member sees only own org products', async () => {
      const { userA, orgA, orgB, storeA, storeB } = await twoTenantsSetup();
      const [productA] = await Promise.all([
        prisma.product.create({
          data: {
            organizationId: orgA.id,
            storeId: storeA.id,
            platformProductId: 'p-a',
            title: 'Product A',
          },
        }),
        prisma.product.create({
          data: {
            organizationId: orgB.id,
            storeId: storeB.id,
            platformProductId: 'p-b',
            title: 'Product B',
          },
        }),
      ]);
      const client = await createRlsScopedClient(userA.id);

      const { data, error } = await client.from('products').select('id,title');

      expect(error).toBeNull();
      expect(data?.map((p) => p.id)).toEqual([productA.id]);
    });
  });

  describe('order_items', () => {
    it('member sees only items of orders in own org', async () => {
      const { userA, orgA, orgB, storeA, storeB } = await twoTenantsSetup();
      const [orderA, orderB] = await Promise.all([
        createOrder(orgA.id, storeA.id),
        createOrder(orgB.id, storeB.id),
      ]);
      const [itemA] = await Promise.all([
        prisma.orderItem.create({
          data: {
            orderId: orderA.id,
            quantity: 1,
            unitPrice: '10',
            commissionRate: '10',
            commissionAmount: '1',
          },
        }),
        prisma.orderItem.create({
          data: {
            orderId: orderB.id,
            quantity: 1,
            unitPrice: '10',
            commissionRate: '10',
            commissionAmount: '1',
          },
        }),
      ]);
      const client = await createRlsScopedClient(userA.id);

      const { data, error } = await client.from('order_items').select('id,order_id');

      expect(error).toBeNull();
      expect(data?.map((i) => i.id)).toEqual([itemA.id]);
    });
  });

  describe('expenses', () => {
    it('member sees only own org expenses', async () => {
      const { userA, orgA, orgB } = await twoTenantsSetup();
      const [expA] = await Promise.all([
        prisma.expense.create({
          data: { organizationId: orgA.id, category: 'ADVERTISING', amount: '100', date: new Date() },
        }),
        prisma.expense.create({
          data: { organizationId: orgB.id, category: 'ADVERTISING', amount: '200', date: new Date() },
        }),
      ]);
      const client = await createRlsScopedClient(userA.id);

      const { data, error } = await client.from('expenses').select('id,amount');

      expect(error).toBeNull();
      expect(data?.map((e) => e.id)).toEqual([expA.id]);
    });
  });
});
```

**Step 2: Run — expect FAILS across the 5 describes**

**Step 3: Add policies to `supabase/sql/rls-policies.sql`**

Append:

```sql
-- ─── stores ────────────────────────────────────────────────────────────
ALTER TABLE stores ENABLE ROW LEVEL SECURITY;

CREATE POLICY stores_org_member_read ON stores
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM organization_members
      WHERE organization_members.organization_id = stores.organization_id
        AND organization_members.user_id = auth.uid()
    )
  );

-- ─── products ──────────────────────────────────────────────────────────
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

CREATE POLICY products_org_member_read ON products
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM organization_members
      WHERE organization_members.organization_id = products.organization_id
        AND organization_members.user_id = auth.uid()
    )
  );

-- ─── orders ────────────────────────────────────────────────────────────
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY orders_org_member_read ON orders
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM organization_members
      WHERE organization_members.organization_id = orders.organization_id
        AND organization_members.user_id = auth.uid()
    )
  );

-- ─── order_items ───────────────────────────────────────────────────────
-- order_items has no organization_id; reach via orders.
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY order_items_org_member_read ON order_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM orders
        JOIN organization_members
          ON organization_members.organization_id = orders.organization_id
       WHERE orders.id = order_items.order_id
         AND organization_members.user_id = auth.uid()
    )
  );

-- ─── expenses ──────────────────────────────────────────────────────────
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY expenses_org_member_read ON expenses
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM organization_members
      WHERE organization_members.organization_id = expenses.organization_id
        AND organization_members.user_id = auth.uid()
    )
  );
```

**Step 4: Apply + test**

```bash
pnpm db:apply-policies
pnpm --filter @pazarsync/api test:integration -- org-scoped-tables
```

Expected: 5 describes, 5 tests PASS.

**Step 5: Commit**

```bash
git add supabase/sql/rls-policies.sql apps/api/tests/integration/rls/org-scoped-tables.rls.test.ts
git commit -m "feat(db): enable RLS + member-read policies on stores/products/orders/order_items/expenses"
```

**Done when:** All 5 org-scoped-tables tests green.

---

## Task 7: Settlement family + `sync_logs`

**Why:** Settlements and their items follow the store → org ownership chain. `sync_logs` also reaches via store. Batched like Task 6 because the policy shape repeats.

**Files:**

- Modify: `supabase/sql/rls-policies.sql`
- Create: `apps/api/tests/integration/rls/settlements-synclogs.rls.test.ts`

**Step 1: Write the failing test**

```typescript
// apps/api/tests/integration/rls/settlements-synclogs.rls.test.ts
import { prisma } from '@pazarsync/db';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ensureDbReachable, truncateAll } from '../../helpers/db';
import {
  createMembership,
  createOrganization,
  createStore,
  createUserProfile,
} from '../../helpers/factories';
import { createRlsScopedClient } from '../../helpers/rls-client';

describe('RLS — settlements/sync_logs', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  async function twoTenantsSetup() {
    const [userA, userB] = await Promise.all([createUserProfile(), createUserProfile()]);
    const [orgA, orgB] = await Promise.all([createOrganization(), createOrganization()]);
    await createMembership(orgA.id, userA.id, 'OWNER');
    await createMembership(orgB.id, userB.id, 'OWNER');
    const [storeA, storeB] = await Promise.all([createStore(orgA.id), createStore(orgB.id)]);
    return { userA, orgA, orgB, storeA, storeB };
  }

  it('settlements: member sees only own org', async () => {
    const { userA, orgA, orgB, storeA, storeB } = await twoTenantsSetup();
    const period = { periodStart: new Date(), periodEnd: new Date() };
    const [setA] = await Promise.all([
      prisma.settlement.create({
        data: { ...period, organizationId: orgA.id, storeId: storeA.id, grossAmount: '100', netAmount: '80' },
      }),
      prisma.settlement.create({
        data: { ...period, organizationId: orgB.id, storeId: storeB.id, grossAmount: '200', netAmount: '150' },
      }),
    ]);
    const client = await createRlsScopedClient(userA.id);

    const { data, error } = await client.from('settlements').select('id,gross_amount');

    expect(error).toBeNull();
    expect(data?.map((s) => s.id)).toEqual([setA.id]);
  });

  it('settlement_items: member sees only items of settlements in own org', async () => {
    const { userA, orgA, orgB, storeA, storeB } = await twoTenantsSetup();
    const period = { periodStart: new Date(), periodEnd: new Date() };
    const [setA, setB] = await Promise.all([
      prisma.settlement.create({
        data: { ...period, organizationId: orgA.id, storeId: storeA.id, grossAmount: '100', netAmount: '80' },
      }),
      prisma.settlement.create({
        data: { ...period, organizationId: orgB.id, storeId: storeB.id, grossAmount: '200', netAmount: '150' },
      }),
    ]);
    const [itemA] = await Promise.all([
      prisma.settlementItem.create({ data: { settlementId: setA.id, amount: '50', type: 'SALE' } }),
      prisma.settlementItem.create({ data: { settlementId: setB.id, amount: '75', type: 'SALE' } }),
    ]);
    const client = await createRlsScopedClient(userA.id);

    const { data, error } = await client.from('settlement_items').select('id');

    expect(error).toBeNull();
    expect(data?.map((i) => i.id)).toEqual([itemA.id]);
  });

  it('sync_logs: member sees only own store logs', async () => {
    const { userA, storeA, storeB } = await twoTenantsSetup();
    const [logA] = await Promise.all([
      prisma.syncLog.create({
        data: { storeId: storeA.id, syncType: 'ORDERS', status: 'COMPLETED', startedAt: new Date() },
      }),
      prisma.syncLog.create({
        data: { storeId: storeB.id, syncType: 'ORDERS', status: 'COMPLETED', startedAt: new Date() },
      }),
    ]);
    const client = await createRlsScopedClient(userA.id);

    const { data, error } = await client.from('sync_logs').select('id');

    expect(error).toBeNull();
    expect(data?.map((l) => l.id)).toEqual([logA.id]);
  });
});
```

**Step 2: Run — expect FAIL (3 tests)**

**Step 3: Add policies**

Append to `supabase/sql/rls-policies.sql`:

```sql
-- ─── settlements ───────────────────────────────────────────────────────
ALTER TABLE settlements ENABLE ROW LEVEL SECURITY;

CREATE POLICY settlements_org_member_read ON settlements
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM organization_members
      WHERE organization_members.organization_id = settlements.organization_id
        AND organization_members.user_id = auth.uid()
    )
  );

-- ─── settlement_items ──────────────────────────────────────────────────
-- Reach via settlement → organization.
ALTER TABLE settlement_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY settlement_items_org_member_read ON settlement_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM settlements
        JOIN organization_members
          ON organization_members.organization_id = settlements.organization_id
       WHERE settlements.id = settlement_items.settlement_id
         AND organization_members.user_id = auth.uid()
    )
  );

-- ─── sync_logs ─────────────────────────────────────────────────────────
-- Reach via store → organization.
ALTER TABLE sync_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY sync_logs_org_member_read ON sync_logs
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM stores
        JOIN organization_members
          ON organization_members.organization_id = stores.organization_id
       WHERE stores.id = sync_logs.store_id
         AND organization_members.user_id = auth.uid()
    )
  );
```

**Step 4: Apply + test**

**Step 5: Commit**

```bash
git add supabase/sql/rls-policies.sql apps/api/tests/integration/rls/settlements-synclogs.rls.test.ts
git commit -m "feat(db): enable RLS + member-read policies on settlements/settlement_items/sync_logs"
```

**Done when:** 3 settlement/sync_logs RLS tests green.

---

## Task 8: Sanity check — all 11 tenant tables now have RLS enabled

**Why:** Catch a table we forgot. If any tenant table is missing `relrowsecurity`, we should know now, not when an anon client accidentally reads it in staging.

**Files:**

- Create: `apps/api/tests/integration/rls/coverage.rls.test.ts`

**Step 1: Write the assertion test**

```typescript
// apps/api/tests/integration/rls/coverage.rls.test.ts
import { prisma } from '@pazarsync/db';
import { beforeAll, describe, expect, it } from 'vitest';

import { ensureDbReachable } from '../../helpers/db';

const TENANT_TABLES = [
  'user_profiles',
  'organizations',
  'organization_members',
  'stores',
  'products',
  'orders',
  'order_items',
  'expenses',
  'settlements',
  'settlement_items',
  'sync_logs',
] as const;

describe('RLS — coverage', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  it('every tenant table has RLS enabled', async () => {
    const rows = await prisma.$queryRaw<Array<{ relname: string; relrowsecurity: boolean }>>`
      SELECT relname, relrowsecurity
        FROM pg_class
       WHERE relname = ANY(${TENANT_TABLES}::text[])
         AND relkind = 'r'
    `;

    const lookup = new Map(rows.map((r) => [r.relname, r.relrowsecurity]));
    for (const table of TENANT_TABLES) {
      expect(lookup.get(table), `${table} should exist and have RLS enabled`).toBe(true);
    }
  });

  it('every tenant table has at least one SELECT policy', async () => {
    const rows = await prisma.$queryRaw<Array<{ tablename: string; count: bigint }>>`
      SELECT tablename, COUNT(*)::bigint AS count
        FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename = ANY(${TENANT_TABLES}::text[])
         AND (cmd = 'SELECT' OR cmd = 'ALL')
       GROUP BY tablename
    `;

    const lookup = new Map(rows.map((r) => [r.tablename, Number(r.count)]));
    for (const table of TENANT_TABLES) {
      expect(lookup.get(table) ?? 0, `${table} should have at least one SELECT policy`).toBeGreaterThan(0);
    }
  });
});
```

**Step 2: Run — expect PASS (if Tasks 3–7 were completed)**

```bash
pnpm --filter @pazarsync/api test:integration -- coverage.rls
```

If a table fails: revisit the task that should have enabled it.

**Step 3: Commit**

```bash
git add apps/api/tests/integration/rls/coverage.rls.test.ts
git commit -m "test(db): coverage assertion — every tenant table has RLS"
```

**Done when:** Both assertion tests green.

---

## Task 9: Update `pnpm db:seed` to re-apply policies after truncate + push cycles

**Why:** The seed script uses Prisma, which runs as superuser and bypasses RLS — seed itself is unaffected. But developers running `pnpm db:push && pnpm db:seed` need policies to land in between. We already chained apply-policies into `db:push` in Task 1. This task only adds a sanity log.

**Files:**

- Modify: `packages/db/prisma/seed.ts` (log current policy count at end)

**Step 1: Add the logging**

At the end of `main()` before "Seed complete", add:

```typescript
const policyCount = await prisma.$queryRaw<Array<{ count: bigint }>>`
  SELECT COUNT(*)::bigint AS count FROM pg_policies WHERE schemaname = 'public'
`;
console.log(`\u2713 policies present: ${policyCount[0]?.count.toString() ?? '0'}`);
```

**Step 2: Run seed**

```bash
pnpm db:seed
```

Expected: ends with "✓ policies present: 10" (or however many CREATE POLICY statements are in the SQL file).

**Step 3: Commit**

```bash
git add packages/db/prisma/seed.ts
git commit -m "chore(db): seed logs pg_policies count for quick RLS drift check"
```

**Done when:** Seed output shows non-zero policy count.

---

## Task 10: Document the pattern in CLAUDE.md files + api-changelog

**Why:** The pattern is useless if the next contributor doesn't know to follow it. Every new table adds an RLS task in the same PR; every new SELECT-through-anon path gets tested with the scoped client.

**Files:**

- Modify: `docs/SECURITY.md` (add RLS subsection under "Tenant isolation")
- Modify: `apps/api/CLAUDE.md` (add "RLS for new tables" under "Testing")
- Modify: `CLAUDE.md` (root) — add pointer to `supabase/sql/rls-policies.sql`
- Modify: `docs/api-changelog.md` (Unreleased)

**Step 1: docs/SECURITY.md — new subsection**

Under "Tenant isolation", after the existing three-layer model description, add:

```markdown
### Layer 2 — Row-Level Security

Policies live in `supabase/sql/rls-policies.sql`. One `ENABLE RLS` + one
or more `CREATE POLICY` blocks per tenant-scoped table. Applied
automatically by `pnpm db:push` (chained with `pnpm db:apply-policies`).

**Role model:**

| Role                  | How the connection gets it                              | RLS behavior                        |
| --------------------- | ------------------------------------------------------- | ----------------------------------- |
| `postgres` (superuser) | `DATABASE_URL` as `postgres:postgres@...`                | **Bypasses RLS entirely**           |
| `authenticated`        | Supabase JS client with `Authorization: Bearer <user JWT>` | RLS enforced; `auth.uid()` populated |
| `anon`                 | Supabase JS client with no user JWT                      | RLS enforced; `auth.uid()` returns NULL |

The backend currently uses the `postgres` role via Prisma, so RLS does
not filter backend queries. RLS is still load-bearing: it blocks
direct psql access, realtime subscribers, edge functions using the
anon key, and any future code path that uses a non-superuser
connection. Phase B (scoped Prisma so backend hits RLS too) is a
future plan — see `docs/plans/`.

**Adding a new tenant-scoped table:**

1. Add the Prisma model and run `pnpm db:push` to create the table.
2. Append to `supabase/sql/rls-policies.sql`:
   ```sql
   ALTER TABLE your_table ENABLE ROW LEVEL SECURITY;
   CREATE POLICY your_table_org_member_read ON your_table
     FOR SELECT TO authenticated
     USING (EXISTS (
       SELECT 1 FROM organization_members
       WHERE organization_members.organization_id = your_table.organization_id
         AND organization_members.user_id = auth.uid()
     ));
   ```
3. Add an integration test in `apps/api/tests/integration/rls/` using
   `createRlsScopedClient(userId)` that inserts a row via service-role
   Prisma, then reads it via the scoped client as both a member and a
   non-member. Assert the non-member gets an empty result.
4. The coverage test in `coverage.rls.test.ts` MUST pass after your
   changes — it will catch a missing `ENABLE RLS`.

**RLS is never deferred to a later PR.** Every PR that adds or modifies
a tenant table includes its RLS story.
```

**Step 2: apps/api/CLAUDE.md — new testing subsection**

Add under "Testing":

```markdown
### RLS tests

Every new tenant-scoped table gets an integration test in
`tests/integration/rls/<table>.rls.test.ts` that:

- Creates rows in two different orgs via service-role Prisma factories
- Uses `createRlsScopedClient(userId)` from `tests/helpers/rls-client.ts`
  to query as a member of org A
- Asserts org B's rows do not appear

Why not test via Prisma? Prisma connects as `postgres` (superuser) and
bypasses RLS. A test that only uses Prisma cannot prove a policy works.
The scoped Supabase JS client routes through PostgREST where RLS
activates.
```

**Step 3: CLAUDE.md (root) — pointer**

Under "Documentation References" table, add row:

```markdown
| RLS Policies             | `supabase/sql/rls-policies.sql` | When adding a tenant-scoped table or changing tenant access patterns |
```

**Step 4: docs/api-changelog.md — Unreleased entry**

Append to Unreleased / Added:

```markdown
- Row-Level Security policies on all 11 tenant-scoped tables
  (`user_profiles`, `organizations`, `organization_members`, `stores`,
  `products`, `orders`, `order_items`, `expenses`, `settlements`,
  `settlement_items`, `sync_logs`). Applied via `pnpm db:push` (which
  chains `pnpm db:apply-policies`). SELECT only in this phase;
  INSERT/UPDATE/DELETE default-deny until CRUD endpoints ship their
  own policies.
- `createRlsScopedClient(userId)` test helper in
  `apps/api/tests/helpers/rls-client.ts` for verifying RLS enforcement
  through a user-scoped Supabase JS client (Prisma service-role
  connections bypass RLS and cannot prove policies work).
```

**Step 5: Commit**

```bash
git add docs/SECURITY.md apps/api/CLAUDE.md CLAUDE.md docs/api-changelog.md
git commit -m "docs: RLS pattern, test helper, per-table workflow"
```

**Done when:** All four docs reflect the new workflow.

---

## Closing notes

**Order of implementation.** Tasks 1 → 10 in order. Task 1 is infrastructure, Tasks 2–7 build policies table-by-table with tests, Task 8 is the "did I forget one?" check, Task 9 is a seed-time safety, Task 10 captures the workflow for the next contributor.

**Verification before PR.**

```bash
export $(grep -v '^#' .env | xargs)
pnpm db:push                 # schema + policies in one go
pnpm db:seed                 # ends with "policies present: N"
pnpm check:full              # typecheck + lint + ALL tests + format
```

All green.

**Things deliberately NOT in this plan.**

- **Per-request scoped Prisma (Phase B).** When the backend's service functions get wrapped in a transaction that sets `ROLE authenticated` + JWT claims, RLS will directly filter backend queries. Deferred because: (1) one service function exists today, (2) we want to validate policy shape with real endpoints first, (3) the current middleware-based filtering already passes the tenant-isolation invariant test.
- **INSERT/UPDATE/DELETE policies.** No CRUD endpoints exist yet. When the first one lands (store connect, per the `feat/auth-middleware` closing notes), its PR includes the write policies + tests.
- **`requireRole()` middleware.** Belongs to the first endpoint that needs role-gating.
- **Service role → `app_api` role split.** Currently `DATABASE_URL` uses `postgres`. Eventually we want a dedicated `app_api` role with only the privileges the backend needs. Separate plan; doesn't block Phase B.
- **Realtime authorization via RLS.** Supabase's realtime respects RLS out of the box once policies are in place — so this plan automatically enables safe realtime subscriptions when we add them. No extra config in this plan.

**Commits.** One commit per task (10 total), each conventional-commits formatted, each passing the check locally.

**If a test fails because a policy is subtly wrong.** Never weaken the test. The test expresses the security invariant. Fix the policy. If the policy shape doesn't support the invariant, the invariant is more important than the shape — rethink the policy (e.g., use `SECURITY DEFINER` helper, or restructure the FK path).
