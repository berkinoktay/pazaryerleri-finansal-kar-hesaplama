# Testing Strategy Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Wire up a hybrid testing strategy across the monorepo — Vitest+RTL+jsdom+MSW for the frontend, Supabase-local + Prisma factories for backend integration tests, multi-tenancy isolation tests as a sacred category, Turborepo task definitions, CI integration, and a comprehensive `docs/TESTING.md` pattern library plus updates to all `CLAUDE.md` files.

**Architecture:** Tests live in each package's `tests/` folder, organized by category (`unit/`, `integration/`, `tenant-isolation/`, `component/`). Backend integration tests run against local Supabase Postgres with `TRUNCATE CASCADE` between tests for isolation. Frontend tests use jsdom + React Testing Library + MSW (intercepts the typed `@pazarsync/api-client` calls). Shared test helpers live in `tests/helpers/`. CI starts Supabase local, runs unit tests then integration tests in sequence. The first concrete tests (one DB factory smoke test, one multi-tenancy isolation test, one frontend hook test) prove the infrastructure works end-to-end before the full team adopts the pattern.

**Tech Stack:** Vitest 4, @testing-library/react 16, @testing-library/user-event 14, @testing-library/jest-dom 6, MSW 2, jsdom, Prisma 7, Supabase CLI, Turborepo, GitHub Actions.

**Reference design:** `docs/plans/2026-04-16-testing-strategy-design.md`

**Reference docs (project-internal):**

- `docs/SECURITY.md` — multi-tenancy invariants this strategy enforces
- `docs/ARCHITECTURE.md` — system architecture
- `apps/api/CLAUDE.md`, `apps/web/CLAUDE.md`, root `CLAUDE.md`

---

## Pre-flight: Worktree & Branch

### Task 0: Create worktree and feature branch

**Why:** Isolate this multi-day work from `main`, mirroring the pattern used for the API docs infrastructure plan.

**Steps:**

```bash
cd /Users/berkin/Desktop/My_Code_Workspace/pazaryerleri-finansal-kar-hesaplama-saas
git fetch origin
git checkout main && git pull origin main
git worktree add .worktrees/testing-strategy feature/testing-strategy
cd .worktrees/testing-strategy
pnpm install
```

**Verify:**

```bash
git branch --show-current   # → feature/testing-strategy
git status                  # → clean working tree
```

All subsequent tasks run inside `.worktrees/testing-strategy/`.

---

## Phase 1: Backend Test Infrastructure

### Task 1: Reorganize `apps/api/tests/` into category subfolders

**Why:** The design specifies `unit/`, `integration/`, `tenant-isolation/` subfolders. Current state has a single `tests/routes/` folder. Move the existing test before adding new patterns so we don't accumulate cruft.

**Files:**

- Move: `apps/api/tests/routes/organization.routes.test.ts` → `apps/api/tests/integration/routes/organization.routes.test.ts`
- Create: `apps/api/tests/unit/.gitkeep`
- Create: `apps/api/tests/integration/.gitkeep`
- Create: `apps/api/tests/integration/routes/.gitkeep`
- Create: `apps/api/tests/integration/tenant-isolation/.gitkeep`
- Create: `apps/api/tests/helpers/.gitkeep`

**Step 1: Create the new directories**

```bash
mkdir -p apps/api/tests/unit
mkdir -p apps/api/tests/integration/routes
mkdir -p apps/api/tests/integration/tenant-isolation
mkdir -p apps/api/tests/helpers
```

**Step 2: Move existing test with `git mv` to preserve history**

```bash
git mv apps/api/tests/routes/organization.routes.test.ts \
       apps/api/tests/integration/routes/organization.routes.test.ts
rmdir apps/api/tests/routes
```

**Step 3: Add `.gitkeep` files so empty dirs are tracked**

```bash
touch apps/api/tests/unit/.gitkeep
touch apps/api/tests/integration/tenant-isolation/.gitkeep
touch apps/api/tests/helpers/.gitkeep
```

**Step 4: Verify tests still discover and pass**

```bash
pnpm --filter @pazarsync/api test
```

Expected: 1 test passes (the existing organization route test, now in its new location).

**Step 5: Commit**

```bash
git add apps/api/tests/
git commit -m "refactor(api): reorganize tests into unit/integration/tenant-isolation"
```

---

### Task 2: Create DB test helper (`apps/api/tests/helpers/db.ts`)

**Why:** Integration tests need a single point for DB connection and cleanup. `TRUNCATE CASCADE` between tests gives reliable isolation without the complexity of transaction-rollback wrappers.

**Files:**

- Create: `apps/api/tests/helpers/db.ts`

**Step 1: Write the helper**

Write `apps/api/tests/helpers/db.ts`:

```ts
import { prisma } from '@pazarsync/db';

export { prisma };

/**
 * Truncate all tenant-scoped tables, resetting sequences.
 *
 * Call in `beforeEach` for any test that touches the DB. CASCADE handles
 * any FKs we forgot to enumerate. RESTART IDENTITY resets auto-increment
 * sequences so test data is deterministic.
 *
 * Order doesn't matter for TRUNCATE CASCADE — Postgres figures out the FK
 * dependency graph itself.
 */
export async function truncateAll(): Promise<void> {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE
       sync_logs,
       settlement_items,
       settlements,
       order_items,
       orders,
       products,
       expenses,
       stores,
       organization_members,
       organizations,
       user_profiles
     RESTART IDENTITY CASCADE`,
  );
}

/**
 * Verify the DB is reachable. Used in test setup to fail fast with a clear
 * message when developers forgot to start Supabase local.
 */
export async function ensureDbReachable(): Promise<void> {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (error) {
    throw new Error(
      `Cannot reach test database at DATABASE_URL=${process.env['DATABASE_URL']}. ` +
        `Run \`supabase start\` and \`pnpm db:push\` before integration tests. ` +
        `Original error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
```

**Step 2: Verify typecheck**

```bash
cd /Users/berkin/Desktop/My_Code_Workspace/pazaryerleri-finansal-kar-hesaplama-saas/.worktrees/testing-strategy/apps/api
npx tsc --noEmit
```

Expected: no errors.

**Step 3: Commit**

```bash
git add apps/api/tests/helpers/db.ts
git commit -m "feat(api): add DB test helper with TRUNCATE CASCADE isolation"
```

---

### Task 3: Create test data factories (`apps/api/tests/helpers/factories.ts`)

**Why:** Every integration test needs valid Organization, Store, Order, etc. records. Factories with sensible defaults and override hooks let tests focus on what's being tested, not data setup.

**Files:**

- Create: `apps/api/tests/helpers/factories.ts`

**Step 1: Write the factories**

Write `apps/api/tests/helpers/factories.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { prisma } from './db';

export interface CreateUserProfileOverrides {
  id?: string;
  email?: string;
  fullName?: string | null;
}

export async function createUserProfile(overrides: CreateUserProfileOverrides = {}) {
  const id = overrides.id ?? randomUUID();
  return prisma.userProfile.create({
    data: {
      id,
      email: overrides.email ?? `${id}@test.local`,
      fullName: overrides.fullName ?? 'Test User',
    },
  });
}

export interface CreateOrganizationOverrides {
  name?: string;
  slug?: string;
}

export async function createOrganization(overrides: CreateOrganizationOverrides = {}) {
  const id = randomUUID();
  return prisma.organization.create({
    data: {
      id,
      name: overrides.name ?? 'Test Organization',
      slug: overrides.slug ?? `test-org-${id.slice(0, 8)}`,
    },
  });
}

export type MemberRole = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';

export async function createMembership(
  organizationId: string,
  userId: string,
  role: MemberRole = 'OWNER',
) {
  return prisma.organizationMember.create({
    data: { organizationId, userId, role },
  });
}

export interface CreateStoreOverrides {
  name?: string;
  platform?: 'TRENDYOL' | 'HEPSIBURADA';
}

export async function createStore(organizationId: string, overrides: CreateStoreOverrides = {}) {
  return prisma.store.create({
    data: {
      organizationId,
      name: overrides.name ?? 'Test Store',
      platform: overrides.platform ?? 'TRENDYOL',
      // Encrypted credential placeholder — never use real credentials in tests
      credentials: {
        ciphertext: 'test-ciphertext',
        iv: 'test-iv',
        authTag: 'test-auth-tag',
      },
    },
  });
}

export interface CreateOrderOverrides {
  totalAmount?: string;
  commissionAmount?: string;
  shippingCost?: string;
  status?: 'PENDING' | 'PROCESSING' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED' | 'RETURNED';
}

export async function createOrder(
  organizationId: string,
  storeId: string,
  overrides: CreateOrderOverrides = {},
) {
  return prisma.order.create({
    data: {
      organizationId,
      storeId,
      platformOrderId: `test-order-${randomUUID().slice(0, 8)}`,
      orderDate: new Date(),
      status: overrides.status ?? 'DELIVERED',
      totalAmount: overrides.totalAmount ?? '100.00',
      commissionAmount: overrides.commissionAmount ?? '20.00',
      shippingCost: overrides.shippingCost ?? '10.00',
    },
  });
}
```

**Step 2: Verify typecheck**

```bash
cd /Users/berkin/Desktop/My_Code_Workspace/pazaryerleri-finansal-kar-hesaplama-saas/.worktrees/testing-strategy/apps/api
npx tsc --noEmit
```

Expected: no errors.

**Step 3: Commit**

```bash
git add apps/api/tests/helpers/factories.ts
git commit -m "feat(api): add test data factories for Organization/Store/Order/etc"
```

---

### Task 4: Write DB factory smoke test (validates Phase 1 end-to-end)

**Why:** Before declaring Phase 1 done, prove the helpers work together — connect to DB, truncate cleanly, factory creates record, query returns it.

**Pre-requisite verification:**

```bash
# Ensure Supabase local is running (otherwise the test will error helpfully)
supabase status 2>&1 | head -5
# If not running: supabase start, then `pnpm db:push` from repo root
```

**Files:**

- Create: `apps/api/tests/integration/db-helpers.test.ts`

**Step 1: Write the failing test**

Write `apps/api/tests/integration/db-helpers.test.ts`:

```ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { ensureDbReachable, truncateAll, prisma } from '../helpers/db';
import { createOrganization } from '../helpers/factories';

describe('DB test helpers', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('truncateAll produces an empty organizations table', async () => {
    const count = await prisma.organization.count();
    expect(count).toBe(0);
  });

  it('createOrganization factory produces a queryable record', async () => {
    const org = await createOrganization({ name: 'Acme', slug: 'acme' });
    expect(org.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(org.name).toBe('Acme');
    expect(org.slug).toBe('acme');

    const fromDb = await prisma.organization.findUnique({ where: { id: org.id } });
    expect(fromDb?.name).toBe('Acme');
  });

  it('each test starts with an empty DB (isolation)', async () => {
    const count = await prisma.organization.count();
    expect(count).toBe(0); // proves the previous test's data was truncated
  });
});
```

**Step 2: Run test to verify it fails for the right reason or passes**

```bash
cd /Users/berkin/Desktop/My_Code_Workspace/pazaryerleri-finansal-kar-hesaplama-saas/.worktrees/testing-strategy
pnpm --filter @pazarsync/api test
```

Expected:

- If Supabase local isn't running → first test fails with the helpful "Cannot reach test database" message. Start Supabase, retry.
- If running → all 3 tests pass (this also retroactively validates Tasks 2 and 3).

**Step 3: Commit**

```bash
git add apps/api/tests/integration/db-helpers.test.ts
git commit -m "test(api): add smoke test proving DB helpers and factories work end-to-end"
```

---

### Task 5: Write canonical multi-tenancy isolation test

**Why:** The design names this as a sacred category. This first concrete example sets the pattern every future org-scoped endpoint must follow. Tests at the data layer (Prisma) — auth-middleware-level isolation tests come in a separate plan once auth lands.

**Files:**

- Create: `apps/api/tests/integration/tenant-isolation/data-layer-isolation.test.ts`

**Step 1: Write the failing test**

Write `apps/api/tests/integration/tenant-isolation/data-layer-isolation.test.ts`:

```ts
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { ensureDbReachable, truncateAll, prisma } from '../../helpers/db';
import { createOrganization, createStore, createOrder } from '../../helpers/factories';

describe('Data-layer tenant isolation', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it("prisma.order.findMany filtered by organizationId returns only that org's orders", async () => {
    const orgA = await createOrganization({ name: 'Org A', slug: 'org-a' });
    const orgB = await createOrganization({ name: 'Org B', slug: 'org-b' });

    const storeA = await createStore(orgA.id);
    await createOrder(orgA.id, storeA.id, { totalAmount: '150.00' });

    // Sanity: Org A sees its own order
    const ordersForOrgA = await prisma.order.findMany({
      where: { organizationId: orgA.id },
    });
    expect(ordersForOrgA).toHaveLength(1);
    expect(ordersForOrgA[0]?.totalAmount.toString()).toBe('150');

    // CRITICAL: Org B sees nothing — Org A's order does not leak
    const ordersForOrgB = await prisma.order.findMany({
      where: { organizationId: orgB.id },
    });
    expect(ordersForOrgB).toEqual([]);
  });

  it('prisma.store.findMany respects org scope', async () => {
    const orgA = await createOrganization({ slug: 'iso-a' });
    const orgB = await createOrganization({ slug: 'iso-b' });
    await createStore(orgA.id, { name: "A's Store" });
    await createStore(orgB.id, { name: "B's Store" });

    const storesForOrgA = await prisma.store.findMany({
      where: { organizationId: orgA.id },
    });
    expect(storesForOrgA.map((s) => s.name)).toEqual(["A's Store"]);

    const storesForOrgB = await prisma.store.findMany({
      where: { organizationId: orgB.id },
    });
    expect(storesForOrgB.map((s) => s.name)).toEqual(["B's Store"]);
  });
});
```

**Step 2: Run test**

```bash
pnpm --filter @pazarsync/api test
```

Expected: all tests in `data-layer-isolation.test.ts` pass (Prisma's `where` clause does the work; the test is documenting that and creating a regression net).

**Step 3: Commit**

```bash
git add apps/api/tests/integration/tenant-isolation/data-layer-isolation.test.ts
git commit -m "test(api): add canonical multi-tenancy data-layer isolation test"
```

---

## Phase 2: Frontend Test Setup

### Task 6: Install frontend testing dependencies

**Files:**

- Modify: `apps/web/package.json`

**Step 1: Install deps**

```bash
cd /Users/berkin/Desktop/My_Code_Workspace/pazaryerleri-finansal-kar-hesaplama-saas/.worktrees/testing-strategy
pnpm --filter @pazarsync/web add -D \
  vitest @vitest/ui jsdom \
  @testing-library/react@^16 @testing-library/user-event@^14 @testing-library/jest-dom@^6 \
  msw@^2 @vitejs/plugin-react
```

Expected: all packages added under `apps/web/package.json` `devDependencies`.

**Step 2: Verify versions**

```bash
grep -E '"vitest"|"@testing-library|"msw"|"jsdom"|"@vitejs/plugin-react"' apps/web/package.json
```

Expected: all present with the major versions above.

**Step 3: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml
git commit -m "chore(web): install Vitest, RTL, jsdom, MSW for frontend testing"
```

---

### Task 7: Create Vitest config + setup file for `apps/web`

**Files:**

- Create: `apps/web/vitest.config.ts`
- Create: `apps/web/tests/setup.ts`

**Step 1: Write `apps/web/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
  },
});
```

**Step 2: Write `apps/web/tests/setup.ts`**

```ts
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});
```

**Step 3: Add `test` scripts to `apps/web/package.json`**

In the `scripts` block, add:

```json
"test": "vitest run",
"test:watch": "vitest",
"test:unit": "vitest run tests/unit",
"test:component": "vitest run tests/component"
```

**Step 4: Add a placeholder to verify the runner starts**

```bash
mkdir -p apps/web/tests/unit apps/web/tests/component apps/web/tests/helpers
touch apps/web/tests/unit/.gitkeep
touch apps/web/tests/component/.gitkeep
touch apps/web/tests/helpers/.gitkeep
```

**Step 5: Verify Vitest starts**

```bash
pnpm --filter @pazarsync/web test 2>&1 | tail -5
```

Expected: "No test files found" — that's fine, the runner started successfully.

**Step 6: Commit**

```bash
git add apps/web/vitest.config.ts apps/web/tests/setup.ts apps/web/package.json apps/web/tests/
git commit -m "feat(web): add Vitest config with jsdom environment and jest-dom matchers"
```

---

### Task 8: Create custom render helper (`apps/web/tests/helpers/render.tsx`)

**Why:** Hook tests and component tests need a `QueryClientProvider` wrapper. Centralize this so every test gets it without boilerplate.

**Files:**

- Create: `apps/web/tests/helpers/render.tsx`

**Step 1: Write the helper**

```tsx
import { type ReactElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render as rtlRender, type RenderOptions } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * Build a fresh QueryClient per test. Disables retries and caching so tests
 * are deterministic — no leftover state between tests, no flaky retry-induced
 * timing.
 */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

interface ProvidersProps {
  children: ReactNode;
  queryClient?: QueryClient;
}

function AllProviders({ children, queryClient }: ProvidersProps) {
  const client = queryClient ?? createTestQueryClient();
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/**
 * Render a React tree wrapped in all standard providers (QueryClient for now;
 * add more here as the app grows: theme, i18n, auth context, etc).
 *
 * Returns the standard RTL render result plus a `user` instance for typing
 * and clicking — preferred over `fireEvent` per Testing Library guidance.
 */
export function render(
  ui: ReactElement,
  options: RenderOptions & { queryClient?: QueryClient } = {},
) {
  const { queryClient, ...rtlOptions } = options;
  const user = userEvent.setup();
  const result = rtlRender(ui, {
    wrapper: ({ children }) => <AllProviders queryClient={queryClient}>{children}</AllProviders>,
    ...rtlOptions,
  });
  return { ...result, user };
}

export * from '@testing-library/react';
```

**Step 2: Verify typecheck**

```bash
pnpm --filter @pazarsync/web typecheck
```

Expected: no errors.

**Step 3: Commit**

```bash
git add apps/web/tests/helpers/render.tsx
git commit -m "feat(web): add custom render helper with QueryClientProvider and user-event setup"
```

---

### Task 9: Create MSW handlers and server (`apps/web/tests/helpers/msw.ts`)

**Why:** Hook tests should hit real (typed) HTTP, not mock the apiClient module. MSW intercepts requests at the network boundary, so tests use the actual generated client.

**Files:**

- Create: `apps/web/tests/helpers/msw.ts`

**Step 1: Write the handlers + server**

```ts
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

/**
 * Default base URL for tests — matches the api-client's fallback when
 * NEXT_PUBLIC_API_URL is unset. Tests can override per-handler if needed.
 */
const TEST_API_BASE = 'http://localhost:3001';

/**
 * Sample handlers for the routes that exist today. As more endpoints land,
 * add their default handlers here. Individual tests can override with
 * `server.use(http.get(...))` for non-default scenarios (errors, slow
 * responses, etc).
 */
export const defaultHandlers = [
  http.get(`${TEST_API_BASE}/v1/organizations`, () => {
    return HttpResponse.json({
      data: [
        {
          id: '00000000-0000-0000-0000-000000000001',
          name: 'Test Organization',
          slug: 'test-org',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
      ],
    });
  }),

  http.get(`${TEST_API_BASE}/v1/health`, () => {
    return HttpResponse.json({ status: 'ok' });
  }),
];

export const server = setupServer(...defaultHandlers);

export { http, HttpResponse };
```

**Step 2: Wire the server into the global setup file**

Edit `apps/web/tests/setup.ts` and append:

```ts
import { beforeAll, afterEach as afterEachMsw, afterAll } from 'vitest';
import { server } from './helpers/msw';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEachMsw(() => server.resetHandlers());
afterAll(() => server.close());
```

So the full `apps/web/tests/setup.ts` reads:

```ts
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeAll, afterAll } from 'vitest';
import { cleanup } from '@testing-library/react';
import { server } from './helpers/msw';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

afterEach(() => {
  cleanup();
  server.resetHandlers();
});

afterAll(() => server.close());
```

**Step 3: Verify typecheck**

```bash
pnpm --filter @pazarsync/web typecheck
```

Expected: no errors.

**Step 4: Commit**

```bash
git add apps/web/tests/helpers/msw.ts apps/web/tests/setup.ts
git commit -m "feat(web): add MSW handlers and integrate server into test setup"
```

---

### Task 10: Write canonical hook test (`apps/web/tests/unit/hooks/use-organizations.test.tsx`)

**Why:** First exemplar that exercises the full chain — typed apiClient → MSW intercept → React Query hook → assertion. Future hook tests follow this pattern.

**Files:**

- Create: `apps/web/tests/unit/hooks/use-organizations.test.tsx`

**Step 1: Write the test**

```tsx
import { describe, it, expect } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode } from 'react';

import { useOrganizations } from '@/features/organization/hooks/use-organizations';
import { createTestQueryClient } from '../../helpers/render';
import { server, http, HttpResponse } from '../../helpers/msw';

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>;
}

describe('useOrganizations', () => {
  it('returns organizations on success', async () => {
    const { result } = renderHook(() => useOrganizations(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0]).toMatchObject({
      id: '00000000-0000-0000-0000-000000000001',
      name: 'Test Organization',
      slug: 'test-org',
    });
  });

  it('returns an error when the API responds 500', async () => {
    // Override the default handler for this test only
    server.use(
      http.get('http://localhost:3001/v1/organizations', () => {
        return HttpResponse.json(
          {
            type: 'https://api.pazarsync.com/errors/internal',
            title: 'Internal Server Error',
            status: 500,
            code: 'INTERNAL_ERROR',
            detail: 'Something went wrong',
          },
          { status: 500 },
        );
      }),
    );

    const { result } = renderHook(() => useOrganizations(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
  });
});
```

**Step 2: Run the test**

```bash
pnpm --filter @pazarsync/web test
```

Expected: 2 tests pass.

**Step 3: Commit**

```bash
git add apps/web/tests/unit/hooks/use-organizations.test.tsx
git commit -m "test(web): add canonical hook test exercising MSW + React Query + typed client"
```

---

## Phase 3: Workspace Wiring

### Task 11: Add per-package `test:unit` and `test:integration` scripts

**Why:** CI and Turborepo need to distinguish fast unit tests from slow DB-dependent integration tests.

**Files:**

- Modify: `apps/api/package.json`
- Modify: `apps/web/package.json` (already done in Task 7 — verify)
- Modify: `packages/utils/package.json`

**Step 1: Update `apps/api/package.json` scripts**

Replace the `test` and `test:watch` lines under `scripts` with:

```json
"test": "vitest run",
"test:unit": "vitest run tests/unit",
"test:integration": "vitest run tests/integration",
"test:watch": "vitest"
```

**Step 2: Verify `apps/web/package.json` has the right scripts (from Task 7)**

```bash
grep -E '"test|"test:' apps/web/package.json
```

Expected:

```
"test": "vitest run",
"test:watch": "vitest",
"test:unit": "vitest run tests/unit",
"test:component": "vitest run tests/component"
```

**Step 3: Update `packages/utils/package.json` scripts**

Add `test:unit` (utils only has unit tests, so it aliases to `test`):

```json
"test": "vitest run",
"test:unit": "vitest run",
"test:watch": "vitest"
```

**Step 4: Verify each package's `test` runs**

```bash
pnpm --filter @pazarsync/api test:unit       # 0 unit tests yet (folder is empty), exits 0
pnpm --filter @pazarsync/api test:integration # 4 integration tests (Tasks 1, 4, 5)
pnpm --filter @pazarsync/utils test:unit      # 6 cursor tests
pnpm --filter @pazarsync/web test:unit        # 2 hook tests
```

**Step 5: Commit**

```bash
git add apps/api/package.json apps/web/package.json packages/utils/package.json
git commit -m "build: add test:unit / test:integration scripts to each package"
```

---

### Task 12: Update `turbo.json` with test task definitions

**Files:**

- Modify: `turbo.json`

**Step 1: Add the test tasks**

Edit `turbo.json` to extend the `tasks` block:

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "dev": { "cache": false, "persistent": true },
    "build": { "dependsOn": ["^build"], "outputs": [".next/**", "dist/**"] },
    "typecheck": { "dependsOn": ["^build"] },
    "lint": { "dependsOn": ["^build"] },
    "clean": { "cache": false },
    "codegen": { "inputs": ["openapi.json"], "outputs": ["src/generated/**"] },
    "test": {
      "dependsOn": ["^build", "codegen"],
      "outputs": []
    },
    "test:unit": {
      "outputs": []
    },
    "test:integration": {
      "outputs": [],
      "env": ["DATABASE_URL", "DIRECT_URL"]
    },
    "test:watch": {
      "cache": false,
      "persistent": true
    }
  }
}
```

**Step 2: Verify Turborepo recognizes the tasks**

```bash
pnpm turbo run test:unit --dry-run 2>&1 | tail -10
```

Expected: lists each package with a `test:unit` script as an executable task.

**Step 3: Commit**

```bash
git add turbo.json
git commit -m "build: add test/test:unit/test:integration/test:watch to turbo tasks"
```

---

### Task 13: Update root `package.json` scripts

**Files:**

- Modify: `package.json` (root)

**Step 1: Edit root `package.json` scripts**

Add (or extend) under `scripts`:

```json
"test": "turbo run test",
"test:unit": "turbo run test:unit",
"test:integration": "turbo run test:integration",
"test:watch": "turbo run test:watch --parallel",
"check:all": "turbo run typecheck lint test && pnpm format:check"
```

(`check:all` previously only ran `typecheck lint` plus format — add `test`.)

**Step 2: Run the full suite to verify wiring**

```bash
# Make sure Supabase is up first (integration tests need it)
supabase status 2>&1 | grep -q "RUNNING" || supabase start

pnpm test:unit
pnpm test:integration
```

Expected:

- `test:unit` runs ~8 tests across utils + web hook test (and any future ones)
- `test:integration` runs ~4 tests in apps/api against local Postgres

**Step 3: Commit**

```bash
git add package.json
git commit -m "build: add root test/test:unit/test:integration scripts and expand check:all"
```

---

## Phase 4: CI Integration

### Task 14: Update `.github/workflows/ci.yml` with Supabase local + integration tests

**Files:**

- Modify: `.github/workflows/ci.yml`

**Step 1: Replace the `test` job**

Open `.github/workflows/ci.yml` and replace the `test` job with:

```yaml
test:
  name: Unit and integration tests
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4

    - uses: pnpm/action-setup@v4

    - uses: actions/setup-node@v4
      with:
        node-version: 22
        cache: 'pnpm'

    - run: pnpm install --frozen-lockfile

    - run: pnpm db:generate
    - run: pnpm api:sync

    # Fast feedback: unit tests first, fail before spinning up DB
    - name: Run unit tests
      run: pnpm test:unit

    # DB integration tests
    - name: Setup Supabase CLI
      uses: supabase/setup-cli@v1
      with:
        version: latest

    - name: Start Supabase local
      run: supabase start

    - name: Apply Prisma schema to local DB
      run: pnpm db:push
      env:
        DATABASE_URL: postgresql://postgres:postgres@127.0.0.1:54322/postgres
        DIRECT_URL: postgresql://postgres:postgres@127.0.0.1:54322/postgres

    - name: Run integration tests
      run: pnpm test:integration
      env:
        DATABASE_URL: postgresql://postgres:postgres@127.0.0.1:54322/postgres
        DIRECT_URL: postgresql://postgres:postgres@127.0.0.1:54322/postgres

    - name: Stop Supabase local
      if: always()
      run: supabase stop
```

**Step 2: Verify YAML is valid**

```bash
cat .github/workflows/ci.yml | head -20    # sanity glance
# (Real validation happens on push when GitHub parses it.)
```

**Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: split test job into unit + integration with Supabase local startup"
```

---

## Phase 5: Documentation

### Task 15: Create `docs/TESTING.md` pattern library

**Why:** Comprehensive reference for HOW to write tests. CLAUDE.md files link here for details. Lives alongside SECURITY.md and ARCHITECTURE.md.

**Files:**

- Create: `docs/TESTING.md`

**Step 1: Write the doc**

Write `docs/TESTING.md`:

```markdown
# TESTING.md — PazarSync Testing Patterns

> Companion document to `docs/plans/2026-04-16-testing-strategy-design.md` (the design)
> and `docs/plans/2026-04-16-testing-strategy-implementation.md` (the implementation history).

This is the canonical reference for HOW to write tests in PazarSync. The
`CLAUDE.md` files link here for details and only restate the non-negotiable
rules inline.

---

## Table of Contents

1. [Philosophy](#1-philosophy)
2. [Test Categories](#2-test-categories)
3. [File Organization](#3-file-organization)
4. [Naming Conventions](#4-naming-conventions)
5. [TDD Workflow](#5-tdd-workflow-for-pure-logic)
6. [DB Integration Pattern](#6-db-integration-pattern)
7. [Multi-Tenancy Test Pattern](#7-multi-tenancy-test-pattern)
8. [Test Data Factories](#8-test-data-factories)
9. [Frontend Hook Tests](#9-frontend-hook-tests-msw--react-query)
10. [Frontend Component Tests](#10-frontend-component-tests)
11. [Test Helpers Reference](#11-test-helpers-reference)
12. [Common Pitfalls](#12-common-pitfalls)
13. [Running Tests Locally](#13-running-tests-locally)
14. [CI Behavior](#14-ci-behavior)

---

## 1. Philosophy

Hybrid by layer. See the [design document](plans/2026-04-16-testing-strategy-design.md#1-philosophy-hybrid-by-layer) for full rationale. Summary:

- **Pure logic** → strict TDD (test first)
- **Routes/services** → tested in the same PR as the code (test-with)
- **UI** → pragmatic — test interaction, not rendering
- **Multi-tenancy** → MANDATORY for every org-scoped endpoint

No hard coverage thresholds. Coverage is a symptom, not a goal.

---

## 2. Test Categories

| Category             | Where                                 | Speed      | Discipline                |
| -------------------- | ------------------------------------- | ---------- | ------------------------- |
| Unit                 | `tests/unit/`                         | <10ms each | Strict TDD for pure logic |
| Integration (route)  | `tests/integration/routes/`           | ~50ms each | Same-PR-as-code           |
| Integration (DB)     | `tests/integration/`                  | ~50ms each | Same-PR-as-code           |
| Tenant isolation     | `tests/integration/tenant-isolation/` | ~50ms each | MANDATORY                 |
| Component (frontend) | `tests/component/`                    | ~30ms each | Pragmatic                 |

---

## 3. File Organization

\`\`\`
apps/api/tests/
├── unit/ # Pure logic, no I/O
├── integration/
│ ├── routes/ # Hono route tests via app.request()
│ └── tenant-isolation/ # CRITICAL multi-tenancy invariants
└── helpers/ # db, factories, (future) auth

apps/web/tests/
├── unit/ # Hook tests, utility tests
├── component/ # React component tests
└── helpers/ # render, msw

packages/utils/tests/ # Flat, unit only
\`\`\`

---

## 4. Naming Conventions

- File: `<thing-being-tested>.test.ts` (kebab-case, mirrors source filename)
- Component tests: `<component-name>.test.tsx`
- Helper files (NOT discovered by Vitest): plain names like `factories.ts`, `render.tsx`

---

## 5. TDD Workflow (for pure logic)

\`\`\`

1. Write failing test
2. Run it. See it fail with the expected error.
3. Write minimal implementation.
4. Run again. See it pass.
5. Refactor (if needed). Tests still pass.
6. Commit.
   \`\`\`

The "see it fail" step is non-negotiable. Tests that pass before implementation are testing the wrong thing.

Example (cursor utility):
\`\`\`ts
// 1. Write the test
it("round-trips a cursor with the same sort", () => {
const encoded = encodeCursor({ sort: "order_date:desc", values: { ... } });
expect(decodeCursor(encoded, "order_date:desc")).toEqual({ ... });
});
// 2. Run → FAIL (encodeCursor doesn't exist)
// 3. Implement encodeCursor + decodeCursor
// 4. Run → PASS
// 5. Refactor as needed
// 6. Commit
\`\`\`

---

## 6. DB Integration Pattern

Every DB-touching test follows this skeleton:

\`\`\`ts
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { ensureDbReachable, truncateAll, prisma } from "../helpers/db";

describe("MyService", () => {
beforeAll(async () => {
await ensureDbReachable();
});

beforeEach(async () => {
await truncateAll();
});

it("does the thing", async () => {
// Arrange — use factories
// Act — call the function or HTTP route
// Assert — verify DB state or response
});
});
\`\`\`

`truncateAll` runs `TRUNCATE TABLE … CASCADE` on every tenant-scoped table. Each test starts with an empty DB.

**Pre-requisite:** Supabase local must be running (`supabase start`) and the schema applied (`pnpm db:push`). The `ensureDbReachable` helper fails fast with a helpful message if not.

---

## 7. Multi-Tenancy Test Pattern

Every org-scoped endpoint MUST have at least one isolation test. Pattern:

\`\`\`ts
it("does not leak Org A data to Org B queries", async () => {
const orgA = await createOrganization({ slug: "org-a" });
const orgB = await createOrganization({ slug: "org-b" });
const storeA = await createStore(orgA.id);
await createOrder(orgA.id, storeA.id);

const ordersForOrgB = await prisma.order.findMany({
where: { organizationId: orgB.id },
});
expect(ordersForOrgB).toEqual([]); // ← The critical assertion
});
\`\`\`

For HTTP-level isolation tests (once auth middleware exists):
\`\`\`ts
// FUTURE — pattern for when signTestJwt() lands
it("returns 403 when user is not a member of the requested organization", async () => {
const orgA = await createOrganization();
const orgB = await createOrganization();
const userA = await createUserProfile();
await createMembership(orgA.id, userA.id, "OWNER");
// userA is NOT a member of orgB

const token = signTestJwt({ userId: userA.id });
const res = await app.request(\`/v1/organizations/\${orgB.id}/stores\`, {
headers: { Authorization: \`Bearer \${token}\` },
});

expect(res.status).toBe(403); // never 200, never leak orgB data
});
\`\`\`

---

## 8. Test Data Factories

Located in `apps/api/tests/helpers/factories.ts`. Each factory:

- Accepts an overrides object for any field
- Generates sensible defaults (random UUIDs, deterministic-ish names)
- Returns the created Prisma record

Available factories:

- `createUserProfile(overrides?)`
- `createOrganization(overrides?)`
- `createMembership(orgId, userId, role?)`
- `createStore(orgId, overrides?)`
- `createOrder(orgId, storeId, overrides?)`

To extend with new factories: add to `factories.ts`, follow the same `(scopeId, overrides)` signature.

---

## 9. Frontend Hook Tests (MSW + React Query)

Pattern:
\`\`\`tsx
import { describe, it, expect } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { useMyHook } from "@/features/my-feature/hooks/use-my-hook";
import { createTestQueryClient } from "../../helpers/render";
import { server, http, HttpResponse } from "../../helpers/msw";

describe("useMyHook", () => {
it("returns data on success", async () => {
const { result } = renderHook(() => useMyHook(), {
wrapper: ({ children }) => (
<QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>
),
});
await waitFor(() => expect(result.current.isSuccess).toBe(true));
expect(result.current.data).toMatchObject({ ... });
});

it("handles errors", async () => {
server.use(
http.get("http://localhost:3001/v1/...", () =>
HttpResponse.json({ ... }, { status: 500 }),
),
);
// ...
});
});
\`\`\`

Default MSW handlers live in `tests/helpers/msw.ts`. Add new endpoint defaults there. Per-test overrides use `server.use(...)`.

---

## 10. Frontend Component Tests

Use React Testing Library. Test interaction, not implementation.

\`\`\`tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "../../helpers/render";
import { MyForm } from "@/features/my-feature/components/my-form";

describe("<MyForm>", () => {
it("submits valid input", async () => {
const onSubmit = vi.fn();
const { user } = render(<MyForm onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText("Name"), "Acme");
    await user.click(screen.getByRole("button", { name: /submit/i }));

    expect(onSubmit).toHaveBeenCalledWith({ name: "Acme" });

});
});
\`\`\`

Guidance:

- Query by accessible role first (`getByRole("button", { name: ... })`)
- Fall back to `getByLabelText`, `getByText`
- AVOID `getByTestId` unless nothing else works
- Use `userEvent` (typed inputs, real keystrokes) over `fireEvent`

---

## 11. Test Helpers Reference

| Helper                                       | Path                                  | Purpose                                       |
| -------------------------------------------- | ------------------------------------- | --------------------------------------------- |
| `prisma`                                     | `apps/api/tests/helpers/db.ts`        | Re-exports the singleton from `@pazarsync/db` |
| `truncateAll()`                              | `apps/api/tests/helpers/db.ts`        | Empty all tenant tables; call in `beforeEach` |
| `ensureDbReachable()`                        | `apps/api/tests/helpers/db.ts`        | Fail fast with help if Supabase isn't up      |
| `createUserProfile`, `createOrganization`, … | `apps/api/tests/helpers/factories.ts` | Test data factories                           |
| `render`                                     | `apps/web/tests/helpers/render.tsx`   | RTL render with QueryClientProvider           |
| `createTestQueryClient`                      | `apps/web/tests/helpers/render.tsx`   | Fresh, retry-disabled QueryClient             |
| `server`                                     | `apps/web/tests/helpers/msw.ts`       | MSW server (auto-listening per setup.ts)      |
| `http`, `HttpResponse`                       | `apps/web/tests/helpers/msw.ts`       | Re-exports for per-test handler overrides     |

---

## 12. Common Pitfalls

- **Forgetting `beforeEach(truncateAll)`** → tests pass individually but interfere when run together. Symptom: works locally, fails in CI (different test order).
- **Using `as any` in tests** → defeats the entire purpose of typed mocks. Fix the types instead.
- **Snapshot tests** → AVOID. Fragile, hide intent, pollute diffs. Use explicit `toMatchObject` instead.
- **Mocking Prisma in integration tests** → defeats the purpose. Integration tests use the REAL DB.
- **Mocking `apiClient` in frontend tests** → use MSW instead. Mocking apiClient bypasses the typed-client guarantee.
- **`it.skip` without a comment + tracked TODO** → silently broken tests rot. Always document why and link to the plan.
- **Testing implementation details** → e.g., asserting on internal state instead of user-visible behavior. Tests should survive refactors.

---

## 13. Running Tests Locally

\`\`\`bash

# Fast iteration (no DB needed)

pnpm test:unit

# Full suite — needs local Supabase

supabase start
pnpm db:push # apply schema to local DB
pnpm test:integration

# Watch mode (during dev)

pnpm test:watch

# Single package

pnpm --filter @pazarsync/api test
pnpm --filter @pazarsync/web test:watch

# Single file

pnpm --filter @pazarsync/api exec vitest run tests/integration/routes/organization.routes.test.ts

# Cleanup

supabase stop
\`\`\`

---

## 14. CI Behavior

`.github/workflows/ci.yml`'s `test` job:

1. Runs `pnpm test:unit` first (fast feedback, no DB needed)
2. If unit tests pass: starts Supabase local, applies schema, runs `pnpm test:integration`
3. Stops Supabase regardless of pass/fail (cleanup with `if: always()`)

Total time: ~3 minutes. Failing tests block PR merge if branch protection is enabled.

No coverage thresholds. The reviewer's question is "does this PR have the tests it should have?", not "is coverage above 80%?".
```

**Step 2: Verify file**

```bash
wc -l docs/TESTING.md
grep -c "^##" docs/TESTING.md   # 14+ section headers
```

**Step 3: Commit**

```bash
git add docs/TESTING.md
git commit -m "docs: add comprehensive testing pattern library (TESTING.md)"
```

---

### Task 16: Update root `CLAUDE.md` with Testing section + Verification rewrite

**Files:**

- Modify: `CLAUDE.md` (root)

**Step 1: Add `docs/TESTING.md` to the Documentation References table**

Find the Documentation References table and add a new row:

```markdown
| Testing Patterns | `docs/TESTING.md` | When writing OR running tests |
```

**Step 2: Add a new "## Testing" section after "## Coding Standards (Shared)" and before "## No Utility Duplication"**

Insert:

```markdown
## Testing

PazarSync uses a hybrid testing strategy — strict TDD for pure logic, test-with-code for routes/services, pragmatic for UI, MANDATORY for multi-tenancy invariants. See `docs/TESTING.md` for the full pattern library.

Non-negotiable rules:

- Every org-scoped endpoint MUST have a multi-tenancy isolation test in `apps/api/tests/integration/tenant-isolation/`. No exceptions.
- Every utility/pure function MUST have unit tests. TDD discipline (write test → see it fail → implement → see it pass).
- Every new endpoint MUST have at least one happy-path integration test in the SAME PR as the route code.
- Frontend hooks that fetch data MUST have a test using MSW. Components with user interaction (forms, modals) MUST have a component test.
- Never commit with failing tests, never commit with `it.skip` without a comment + tracked TODO.

Commands:

- `pnpm test:unit` — fast (no DB), run on every change
- `pnpm test:integration` — slow (needs `supabase start` + `pnpm db:push`), run before commits
- `pnpm test` — both
- `pnpm test:watch` — watch mode
- `pnpm check:all` — typecheck + lint + ALL tests + format check
```

**Step 3: Replace the existing "## Verification" section**

Find the `## Verification` section. Replace its body with:

```markdown
- After editing any source file, run the affected package's tests:
  - `pnpm --filter <package> test:unit` — for any logic change
  - `pnpm --filter <package> test:integration` — for any route, service, or DB query change
- After adding a new endpoint, write the integration test in the same PR. Do NOT merge route code without its test.
- After adding a new org-scoped endpoint, write the multi-tenancy isolation test in the same PR (see `docs/TESTING.md` § "Multi-Tenancy Test Pattern").
- Before committing, run `pnpm check:all` — typecheck + lint + ALL tests across all packages.
- Never commit with failing tests. If a test reveals a bug in your work, fix the bug — don't disable the test.
- Never commit with skipped tests (`it.skip`, `describe.skip`) without:
  - A code comment explaining why it's skipped, AND
  - A tracked issue/TODO with the unskip plan
- After ANY code edit to TypeScript/TSX files, run `npx tsc --noEmit` for the affected package before proceeding. Fix errors immediately — do not ask the user.
```

**Step 4: Verify the file is well-formed**

```bash
head -5 CLAUDE.md
grep -c "^##" CLAUDE.md   # section count
```

**Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add Testing section to root CLAUDE.md and rewrite Verification rules"
```

---

### Task 17: Update `apps/api/CLAUDE.md` with backend-specific Testing section

**Files:**

- Modify: `apps/api/CLAUDE.md`

**Step 1: Add a "## Testing" section before "## No Utility Duplication"**

Insert:

```markdown
## Testing

Backend tests live in `apps/api/tests/`, organized by category:

\`\`\`
apps/api/tests/
├── unit/ # Pure logic — no DB, no I/O. Strict TDD.
├── integration/
│ ├── routes/ # Hono routes via app.request() — uses real DB
│ └── tenant-isolation/ # CRITICAL — multi-tenancy invariants
└── helpers/ # db, factories, (future) auth
\`\`\`

### When tests are required

| Change                                                 | Required test                                                          |
| ------------------------------------------------------ | ---------------------------------------------------------------------- |
| New utility function (`apps/api/src/lib/`)             | Unit test, TDD                                                         |
| New service function (`apps/api/src/services/`)        | Integration test (real DB via factories)                               |
| New route (`apps/api/src/routes/`)                     | Integration test in `tests/integration/routes/`                        |
| New org-scoped route                                   | Above + tenant-isolation test in `tests/integration/tenant-isolation/` |
| New marketplace adapter (`apps/api/src/integrations/`) | Unit test for mapper logic; mock the HTTP client                       |

### Pattern reference

Full patterns in `docs/TESTING.md`. The most important ones:

- **DB integration pattern**: every DB test does `await ensureDbReachable()` in `beforeAll`, `await truncateAll()` in `beforeEach` (see `tests/helpers/db.ts`)
- **Test data factories**: use `createOrganization`, `createStore`, `createOrder`, etc. from `tests/helpers/factories.ts` — never hand-construct Prisma create payloads in tests
- **Multi-tenancy isolation pattern**: create two orgs, write data in one, query in the other, assert empty result. See `tests/integration/tenant-isolation/data-layer-isolation.test.ts` for the canonical example.

### Pre-requisites for running integration tests

\`\`\`bash
supabase start # local Postgres on port 54322
pnpm db:push # apply Prisma schema to local DB
pnpm --filter @pazarsync/api test:integration
\`\`\`

If integration tests error with "Cannot reach test database", you skipped one of these steps. The `ensureDbReachable` helper prints the exact remediation.

### Forbidden patterns

- ❌ Mocking Prisma in integration tests — they exist to test real SQL
- ❌ Sharing state across tests — every test starts with empty DB via `truncateAll`
- ❌ Hand-rolled JWTs in tests — when auth lands, use `signTestJwt` from `tests/helpers/auth.ts` (planned)
- ❌ Skipping the tenant-isolation test for a "trivial" endpoint — there is no trivial multi-tenant endpoint
```

**Step 2: Commit**

```bash
git add apps/api/CLAUDE.md
git commit -m "docs(api): add Testing section with backend-specific patterns and rules"
```

---

### Task 18: Update `apps/web/CLAUDE.md` with frontend-specific Testing section

**Files:**

- Modify: `apps/web/CLAUDE.md`

**Step 1: Add a "## Testing" section near the bottom (after "## Performance" or similar)**

Insert:

```markdown
## Testing

Frontend tests live in `apps/web/tests/`, organized by category:

\`\`\`
apps/web/tests/
├── unit/ # Hook tests, pure utility tests
├── component/ # React component tests via RTL
└── helpers/ # render, msw
\`\`\`

### Stack

- **Vitest** — test runner
- **jsdom** — DOM environment
- **@testing-library/react** — component rendering
- **@testing-library/user-event** — typing, clicking (preferred over `fireEvent`)
- **@testing-library/jest-dom** — DOM matchers (`toBeInTheDocument`, etc.)
- **MSW (Mock Service Worker)** — intercepts HTTP at the network layer

### When tests are required

| Change                                                | Required test                             |
| ----------------------------------------------------- | ----------------------------------------- |
| New custom React Query hook in `features/*/hooks/`    | Hook test using MSW (`tests/unit/hooks/`) |
| New form component (validation, error states)         | Component test (`tests/component/`)       |
| New interactive component (modal, wizard, multi-step) | Component test                            |
| New utility in `lib/`                                 | Unit test                                 |

NOT required (over-testing slows iteration):

- Pure presentational components (`<Card>`, `<Badge>`, layout primitives)
- shadcn/ui re-exports
- Trivial layout/wrapper components

### Pattern reference

Full patterns in `docs/TESTING.md`. The most important ones:

- **Hook tests use MSW**, never mock `apiClient`. The whole point of the typed client is end-to-end type safety from backend Zod → frontend hook. Mocking `apiClient` defeats this.
- **Custom render wrapper**: use `render` from `tests/helpers/render.tsx` — provides `QueryClientProvider` and a `user` instance for `userEvent`.
- **MSW handlers**: defaults in `tests/helpers/msw.ts`. Per-test overrides via `server.use(http.get(...))`.

### Forbidden patterns

- ❌ Mocking `@pazarsync/api-client` directly — use MSW
- ❌ `getByTestId` as the first choice — use `getByRole` (accessibility-first)
- ❌ `fireEvent` for typing/clicking — use `userEvent`
- ❌ Snapshot tests — fragile, hide intent
- ❌ Testing internal state — assert on what the user sees, not implementation
```

**Step 2: Commit**

```bash
git add apps/web/CLAUDE.md
git commit -m "docs(web): add Testing section with frontend-specific patterns and rules"
```

---

## Phase 6: Final Validation

### Task 19: End-to-end smoke test

**Why:** Confirm everything works together from a clean state before declaring the plan complete.

**Step 1: Clean install**

```bash
rm -rf node_modules apps/*/node_modules packages/*/node_modules
pnpm install
```

Expected: install succeeds, no peer-dep errors.

**Step 2: Generate Prisma client and sync OpenAPI**

```bash
pnpm db:generate
pnpm api:sync
```

Expected: both succeed.

**Step 3: Start Supabase local and apply schema**

```bash
supabase start
pnpm db:push
```

Expected: Supabase reports running services, db:push succeeds.

**Step 4: Run unit tests**

```bash
pnpm test:unit
```

Expected: all unit tests pass across all packages.

Approximate counts:

- `@pazarsync/utils`: 6 cursor tests
- `@pazarsync/api`: 0 unit tests yet (folder exists but empty — that's fine)
- `@pazarsync/web`: 2 hook tests

**Step 5: Run integration tests**

```bash
pnpm test:integration
```

Expected: all pass.

Approximate counts:

- `@pazarsync/api`: 1 (existing route) + 3 (db-helpers smoke) + 2 (data-layer isolation) = 6 integration tests

**Step 6: Run typecheck across workspace**

```bash
pnpm typecheck
```

Expected: all 6 packages pass.

**Step 7: Stop Supabase**

```bash
supabase stop
```

**Step 8: Commit any final updates** (e.g., if step 4 or 5 surfaced a bug needing fix)

If everything was green, no commit needed. If any fix was required, commit it with a descriptive message.

**Step 9: Push**

```bash
git push -u origin feature/testing-strategy
```

Expected: branch pushes to GitHub. CI will trigger on the push and on any subsequent PR.

---

### Task 20: Open PR and verify CI passes

**Why:** The new CI workflow (Task 14) is the ultimate validation that this all works in a clean GitHub Actions environment.

**Step 1: Open the PR**

Use GitHub UI or:

```bash
gh pr create --title "feat: testing strategy infrastructure (Vitest + RTL + MSW + Supabase local)" \
  --body "$(cat <<'EOF'
## Summary

Implements the testing strategy designed in `docs/plans/2026-04-16-testing-strategy-design.md`. Adds Vitest+RTL+jsdom+MSW for `apps/web`, Supabase-local + Prisma factories for backend integration tests, multi-tenancy isolation as a sacred test category, Turborepo task definitions, CI integration, and a comprehensive `docs/TESTING.md` pattern library plus updates to all `CLAUDE.md` files.

## What's delivered

- `apps/api/tests/` reorganized into `unit/`, `integration/routes/`, `integration/tenant-isolation/`, `helpers/`
- DB test helpers (`db.ts`, `factories.ts`) — `truncateAll`, `ensureDbReachable`, factories for Organization/Store/Order/etc.
- Canonical multi-tenancy data-layer isolation test
- `apps/web` testing stack: Vitest + jsdom + RTL + user-event + jest-dom + MSW
- Frontend test helpers: custom `render` with QueryClientProvider, MSW server with default handlers
- Canonical hook test (`use-organizations.test.tsx`) exercising MSW + React Query + typed client
- Per-package and root `test:unit` / `test:integration` / `test:watch` scripts
- Turborepo task definitions for test tasks
- CI workflow split: unit tests first (fast feedback), then Supabase local + integration tests
- `docs/TESTING.md` pattern library
- Testing sections in root `CLAUDE.md`, `apps/api/CLAUDE.md`, `apps/web/CLAUDE.md`
- Verification section in root `CLAUDE.md` rewritten with concrete test rules

## Test plan

- [x] `pnpm test:unit` passes (utils, api, web)
- [x] `pnpm test:integration` passes (api with local Postgres)
- [x] `pnpm typecheck` passes across all 6 packages
- [x] Multi-tenancy isolation test demonstrates the canonical pattern
- [x] Frontend hook test demonstrates MSW + React Query integration
- [ ] CI passes on this PR (validation in GitHub Actions)

## Deferred (separate plans)

- Auth middleware → JWT helper (`signTestJwt`) implementation
- HTTP-level multi-tenancy tests (need auth middleware)
- Playwright E2E tests (need user-facing flows)
- Coverage tooling (intentional — no thresholds)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

**Step 2: Watch CI in the GitHub PR page**

The new `test` job will:

1. Run `pnpm test:unit` (~30s)
2. Setup Supabase CLI + start local Supabase (~60s)
3. Apply schema with `pnpm db:push` (~5s)
4. Run `pnpm test:integration` (~20s)
5. Stop Supabase

Total: ~2-3 min for the test job.

**Step 3: If CI is green, the plan is done. If red, report back here for diagnosis.**

Common CI failure modes and fixes:

- **Supabase setup-cli fails**: pin to a specific working version in `.github/workflows/ci.yml`
- **DB connection refused in integration tests**: Supabase didn't fully start before tests ran — add a wait/retry
- **Frontend tests fail with "Cannot find module @pazarsync/api-client"**: workspace install missed a step; ensure `pnpm install --frozen-lockfile` ran before any test job

---

## Open Items (deferred to later plans)

- **JWT helper implementation** (`apps/api/tests/helpers/auth.ts` with `signTestJwt`) — needed for HTTP-level multi-tenancy tests once auth middleware lands
- **Auth middleware tests** — separate plan, can use `signTestJwt` once both exist
- **Playwright E2E suite** — separate plan when first user-facing flow is built (signup → org create → store connect)
- **Coverage tooling** — opt-in `pnpm test --coverage` works locally; never as merge gate per design
- **Performance benchmarks** with `vitest bench` — for hot-path code (cursor encoding, profitability calc) when scale matters
- **Visual regression** (Percy/Chromatic) — when design system stabilizes
- **Mutation testing** (Stryker) — interesting but expensive; defer until baseline test suite is mature

---

## Skills Reference

- `@superpowers:test-driven-development` — for Tasks 4, 5, 10 (the canonical test exemplars)
- `@superpowers:verification-before-completion` — before claiming any task complete, confirm the verification step's expected output
- `@superpowers:subagent-driven-development` OR `@superpowers:executing-plans` — for executing this plan
- `@superpowers:finishing-a-development-branch` — at the very end of Task 19/20 when wrapping up
