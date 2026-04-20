# Testing Strategy — Design

**Date:** 2026-04-16
**Status:** Approved (pending implementation)
**Owner:** Engineering / DX

---

## Overview

PazarSync handles tenant-isolated financial data — orders, profitability, encrypted marketplace credentials. Regression bugs in this domain are not "annoying"; they leak data, miscalculate money, or silently corrupt settlements. This document defines the project-wide testing strategy: what to test, how to test it, when to write tests, where they live, and how CI enforces them.

The current state is partial: Vitest is wired into `apps/api` and `packages/utils` (7 tests total), but `apps/web` has no test setup, multi-tenancy invariants are untested, and `CLAUDE.md` files lack concrete testing rules. This design closes those gaps.

---

## Goals & Non-Goals

### Goals

- Each layer of the stack has a clear, named test approach with explicit when/how rules
- Multi-tenancy invariants (cross-org data isolation) are tested with real Postgres + RLS, not mocked
- Frontend tests are possible from day one — `apps/web` gets Vitest + React Testing Library before the first feature ships
- Test discipline is written down (in `CLAUDE.md` files + `docs/TESTING.md`) so contributors and AI assistants know the expectations
- CI enforces test passing on every PR — no merge with red

### Non-Goals (for now)

- Hard coverage thresholds (no `--coverage --reporter=fail-under=80`)
- Visual regression testing (Percy, Chromatic) — overkill until UI exists
- E2E tests with Playwright — separate plan once the first user-facing flow is built
- Performance / load testing — deferred until we have real traffic patterns
- Mutation testing — interesting but expensive in dev cycle time

---

## 1. Philosophy: Hybrid by Layer

Test strictness scales with the cost of a bug in that layer. Three categories:

### Category A — Pure Logic (Strict TDD)

Where the code is a function with inputs, outputs, no I/O.

- **What**: Utility functions in `packages/utils`, validation schemas, encoding/decoding, profit calculation, currency math, date helpers.
- **Discipline**: **Test-first.** Write the failing test, watch it fail with the expected error, implement the minimal code to pass, refactor.
- **Why**: These functions are leaf nodes — easy to test, high reuse, and bugs here propagate into every consumer.
- **Examples**: `encodeCursor`, `decodeCursor`, `formatCurrency`, `calculateOrderProfit`, `calculateCommissionDeduction`.

### Category B — Stateful Logic & Routes (Test-Together)

Where the code touches DB, external APIs, request/response cycles.

- **What**: Hono routes, service-layer functions, Prisma queries, marketplace adapter calls.
- **Discipline**: Test written **in the same PR** as the code. Not test-first, not test-after — test-with.
- **Why**: These tests need real infrastructure (DB, sometimes mocked external APIs). Writing them alongside the code surfaces design issues early.
- **Examples**: `GET /v1/organizations`, `OrderService.list()`, `TrendyolAdapter.fetchOrders()`.

### Category C — UI Behavior (Pragmatic)

Where the code is React components, hooks, forms.

- **What**: Custom React Query hooks, form components, complex interactive components (multi-step wizards, data tables with filtering).
- **Discipline**: Test the **interaction**, not the rendering. Write a test for any component that has user-facing logic the user could break — forms, validation, conditional rendering, error states. Skip pure presentational components.
- **Why**: UI is the most fluid layer; over-testing it slows iteration. Focus on behavior contracts, not pixel correctness.
- **Examples**: `useOrganizations()`, `<StoreConnectionForm>`, `<ProfitabilityFilters>`. Skip: `<Card>`, `<Button>`, `<DashboardLayout>`.

### Category D — Multi-Tenancy Invariants (CRITICAL)

A separate, sacred category. Not optional.

- **What**: Every endpoint that touches tenant data needs a test proving it cannot return data from another organization, even when called by a member of a different org with valid auth.
- **Discipline**: Mandatory for every org-scoped endpoint. Lives in `apps/api/tests/integration/tenant-isolation/`. Reviewed with extra care.
- **Why**: This is the security invariant of the entire platform per `docs/SECURITY.md`. Application middleware can have bugs; RLS can be misconfigured. The only sustainable defense is automated tests that try the bad-actor scenario.
- **Examples**: `cross-org-leak.test.ts` — User A is in Org X, queries `/v1/organizations/{Org Y's id}/stores` → expects 403, never 200 with Org Y's data.

### What's Explicitly NOT Tested

- TypeScript type definitions in `packages/types` (typecheck covers this)
- Generated code in `packages/api-client/src/generated/` (it's a build artifact)
- Configuration files (`next.config.ts`, `tsconfig.json`, etc.)
- Layout components with no logic (`<RootLayout>`, `<DashboardLayout>`)
- Pure presentational components from shadcn/ui
- Trivial getters/setters

---

## 2. Test Stack per Package

| Package               | Current            | Add                                                                                                                                         |
| --------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/utils`      | Vitest ✓ (6 tests) | —                                                                                                                                           |
| `apps/api`            | Vitest ✓ (1 test)  | Supabase local for DB integration; `@testing-library/jest-dom`-style matchers if needed                                                     |
| `apps/web`            | **Nothing**        | Vitest + jsdom env + `@testing-library/react` + `@testing-library/user-event` + `@testing-library/jest-dom` + **MSW (Mock Service Worker)** |
| `packages/db`         | —                  | Vitest (only for schema migration smoke tests, when migrations exist)                                                                       |
| `packages/types`      | —                  | None (types only)                                                                                                                           |
| `packages/api-client` | —                  | None (generated)                                                                                                                            |

### Why MSW for the frontend

Frontend hooks call `apiClient.GET("/v1/...")` from `@pazarsync/api-client`. In tests, we don't want to start the real backend — but we also don't want to mock `apiClient` directly (that would test against fake types instead of the real generated `paths`). MSW intercepts the actual HTTP call and returns mock data. The result: hook tests use the real typed client, and changing the OpenAPI spec immediately surfaces broken mocks.

### Vitest config conventions

- `environment: "node"` for `apps/api` and `packages/utils`
- `environment: "jsdom"` for `apps/web`
- `include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"]`
- `setupFiles` for jest-dom matchers in `apps/web`
- `globals: true` is **not** used — explicit `import { describe, it, expect } from "vitest"` is required (consistent with current pattern)

---

## 3. Database Integration Test Pattern

DB integration tests run against a real local Postgres (Supabase local), with each test isolated via transaction rollback.

### Setup

- `supabase start` brings up local Postgres on port 54322 (already configured in `supabase/config.toml`)
- `pnpm db:push` applies the Prisma schema to the local DB
- Tests connect using the same `DATABASE_URL` as dev (`postgresql://postgres:postgres@127.0.0.1:54322/postgres`)

### Isolation pattern

Each test runs inside a transaction that's rolled back after the test. Multiple tests can run in parallel against the same DB without interfering (each gets its own transaction).

```ts
// Conceptual pattern — exact API in TESTING.md
import { describe, it, beforeEach, afterEach } from 'vitest';
import { prisma } from '@pazarsync/db';

describe('OrderService.list', () => {
  beforeEach(async () => {
    await prisma.$executeRaw`BEGIN`;
  });
  afterEach(async () => {
    await prisma.$executeRaw`ROLLBACK`;
  });

  it('returns only orders for the current organization', async () => {
    // Arrange: seed two orgs with distinct orders
    // Act: query as Org A
    // Assert: only Org A's orders returned
  });
});
```

### Multi-tenancy test pattern (CRITICAL)

For every endpoint that is org-scoped, a dedicated test proves cross-org isolation:

```ts
describe('GET /v1/organizations/{orgId}/stores — cross-org isolation', () => {
  it('returns 403 when user is not a member of the requested organization', async () => {
    // Arrange: create Org A and Org B; create User1 as member of Org A only
    // Act: User1 (with valid JWT) calls GET /v1/organizations/{OrgB.id}/stores
    // Assert: response is 403 ProblemDetails, never 200 with Org B data
  });

  it("returns Org A's stores when called by a member of Org A", async () => {
    // Sanity check that the endpoint actually works for legit users
  });
});
```

The full pattern (test data factories, JWT generation for tests, RLS policy verification) lives in `docs/TESTING.md`.

---

## 4. File Organization

```
apps/api/tests/
├── unit/                       # Pure logic, no I/O — fast (<10ms each)
│   └── services/
│       └── profitability.service.test.ts
├── integration/                # DB + Hono routes — needs Supabase local
│   ├── routes/
│   │   ├── organization.routes.test.ts
│   │   └── store.routes.test.ts
│   └── tenant-isolation/      # CRITICAL — multi-tenancy invariants
│       ├── organization-isolation.test.ts
│       ├── store-isolation.test.ts
│       └── order-isolation.test.ts
└── helpers/                    # Test factories, JWT generators, db helpers
    ├── factories.ts
    ├── auth.ts
    └── db.ts

apps/web/tests/
├── unit/                       # Hooks, utilities, pure functions
│   ├── hooks/
│   │   └── use-organizations.test.ts
│   └── lib/
│       └── api-client.test.ts
├── component/                  # React component tests
│   └── features/
│       └── orders/
│           ├── orders-table.test.tsx
│           └── order-filters.test.tsx
└── helpers/
    ├── render.tsx              # Custom render with QueryClientProvider, providers
    └── msw-handlers.ts         # Mock Service Worker handlers

packages/utils/tests/
└── (existing flat structure — unit tests only)
```

### File naming

- `<thing-being-tested>.test.ts` — kebab-case, exactly mirrors the source file name
- `<thing>.test.tsx` for React component tests
- Helper files (factories, fixtures) NOT named `.test.ts` so Vitest doesn't try to run them

---

## 5. Commands

### Root `package.json`

```json
{
  "scripts": {
    "test": "turbo run test",
    "test:unit": "turbo run test:unit",
    "test:integration": "turbo run test:integration",
    "test:watch": "turbo run test:watch --parallel",
    "check:all": "turbo run typecheck lint test && pnpm format:check"
  }
}
```

### Per-package conventions

Every package with tests defines:

- `test` — runs everything (unit + integration if applicable)
- `test:unit` — only unit tests (fast, no I/O)
- `test:integration` — only integration tests (slow, needs DB)
- `test:watch` — watch mode

If a package only has unit tests (e.g., `packages/utils`), `test:integration` is omitted; Turbo handles missing tasks gracefully.

### Local workflow

```bash
# Quick iteration during dev
pnpm test:unit                                # all packages, ~5s
pnpm --filter @pazarsync/api test:watch       # watch backend tests

# Before committing
supabase start                                # local Postgres up
pnpm test                                     # unit + integration, ~60s
supabase stop
```

---

## 6. Turborepo Configuration

Add test tasks to `turbo.json`:

```json
{
  "tasks": {
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

`test:integration` declares `DATABASE_URL` / `DIRECT_URL` as env inputs — Turbo caches will invalidate when these change, preventing stale test results when switching between local and CI databases.

---

## 7. CI Workflow Changes

`.github/workflows/ci.yml` — `test` job is rebuilt:

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

    # NEW — fast unit tests run first; fail fast if these break
    - run: pnpm test:unit

    # NEW — Supabase local for integration tests
    - uses: supabase/setup-cli@v1
      with:
        version: latest
    - run: supabase start
      working-directory: ./
    - run: pnpm db:push
    - run: pnpm test:integration
    - run: supabase stop
      if: always()
```

### CI duration impact

- Current `test` job: ~30s
- New: ~2-3 min (Supabase local boot ~60s, integration tests ~60s, teardown ~10s)
- Acceptable — caught security regressions are worth more than 2 minutes of CI

### Failure modes covered

- Unit test fails → build fails fast (~1 min) without spinning up DB
- Schema migration fails on `db:push` → integration tests don't run, build fails
- Integration test fails → output shows failed test + DB state
- Supabase teardown fails → `if: always()` cleans up regardless

---

## 8. Coverage Policy

**No hard threshold.** No `--coverage --reporter=fail-under=N` in CI.

### Why no threshold

- Coverage % is a symptom, not a goal. Chasing it produces useless tests.
- A well-tested critical-path module at 95% beats every leaf component at 80%.
- Solo dev can self-audit: "did I test what matters?" — that question is more useful than a number.

### Coverage as a tool (opt-in)

`pnpm test --coverage` works locally. In CI, an optional non-blocking job can publish a coverage report (Codecov / Coveralls) for visibility — but never as a merge gate.

### What we DO enforce

- Every CRITICAL category D test (multi-tenancy isolation) MUST exist for every org-scoped endpoint. PR review catches missing ones.
- Every category A pure-logic function MUST have at least one unit test (the TDD discipline enforces this naturally).
- Every category B route MUST have at least one happy-path integration test.

These are reviewed manually in PRs, not measured by tools.

---

## 9. Documentation Updates

| File                    | Change                                                                                                                                                                     |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/TESTING.md` (NEW) | The detailed pattern library — TDD workflow, integration test pattern, multi-tenancy test recipes, MSW setup, hook test examples, factory pattern, JWT generation in tests |
| `CLAUDE.md` (root)      | New "Testing" section with the philosophy summary + commands; expand the existing "Verification" section                                                                   |
| `apps/api/CLAUDE.md`    | Add "Testing" section: route test pattern, service test pattern, multi-tenancy test rule, link to `docs/TESTING.md`                                                        |
| `apps/web/CLAUDE.md`    | Add "Testing" section: hook test pattern (MSW), component test pattern (RTL + user-event), what NOT to test, link to `docs/TESTING.md`                                     |

`docs/TESTING.md` is the single source of truth for _how_ to write tests. The CLAUDE.md updates point to it for details and only restate the most important rules inline (the "must" rules — when tests are required).

---

## 10. Verification Workflow Changes

The existing root `CLAUDE.md` "Verification" section is too vague. Replacement:

```markdown
## Verification

- After editing any source file, run the affected package's tests:
  - `pnpm --filter <package> test:unit` — for any logic change
  - `pnpm --filter <package> test:integration` — for any route, service, or DB query change
- After adding a new endpoint, write the integration test in the same PR. Do NOT merge route code without its test.
- After adding a new org-scoped endpoint, write the multi-tenancy isolation test in the same PR (see `docs/TESTING.md` § "Multi-Tenancy Test Pattern").
- Before committing, run `pnpm check:all` — typecheck + lint + format + ALL tests across all packages.
- Never commit with failing tests. If a test reveals a bug in your work, fix the bug — don't disable the test.
- Never commit with skipped tests (`it.skip`, `describe.skip`) without:
  - A code comment explaining why it's skipped, AND
  - A tracked issue/TODO with the unskip plan
- After ANY code edit to TypeScript/TSX files, run `npx tsc --noEmit` for the affected package before proceeding. Fix errors immediately — do not ask the user.
```

---

## Implementation Order (high-level)

This design will be expanded into a step-by-step implementation plan via `superpowers:writing-plans`. High-level sequence:

1. Add Vitest + RTL + jsdom + MSW to `apps/web`. Verify a sample test runs.
2. Add Supabase local startup helper + transaction-rollback test base to `apps/api/tests/helpers/`.
3. Add `tests/helpers/factories.ts` (test data builders for Organization, OrganizationMember, Store, Order — produces valid records with deterministic UUIDs).
4. Migrate the existing `apps/api/tests/routes/organization.routes.test.ts` to the new `tests/integration/routes/` location and use the helper pattern.
5. Add ONE multi-tenancy isolation test as the canonical example (`organization-isolation.test.ts`).
6. Add ONE frontend hook test as the canonical example (`use-organizations.test.ts` with MSW).
7. Add ONE frontend component test as the canonical example (skeleton until UI components exist — placeholder).
8. Update `turbo.json` with `test:unit` / `test:integration` task definitions.
9. Update root `package.json` scripts (`test`, `test:unit`, `test:integration`, `test:watch`, expand `check:all`).
10. Update `.github/workflows/ci.yml` `test` job with Supabase local setup.
11. Write `docs/TESTING.md` (the detailed pattern library).
12. Update `CLAUDE.md` (root, `apps/api`, `apps/web`) with Testing sections.
13. Update root `CLAUDE.md` Verification section.
14. End-to-end smoke: clean checkout → install → `supabase start` → `pnpm test` → all green.

---

## Open Questions / Future Work

- **E2E tests with Playwright** — when the first user flow exists (signup → org create → store connect), add a Playwright E2E suite as a separate test category. Out of scope here.
- **Visual regression** — Percy or Chromatic if/when the design system stabilizes. Not now.
- **Mutation testing (Stryker)** — interesting for measuring test quality, expensive in dev cycle. Defer.
- **Performance benchmarks** — `vitest bench` for hot-path code (cursor encoding, profitability calc) when scale matters.
- **Snapshot tests** — explicitly avoided. They're fragile, hide intent, and pollute diffs. Use explicit `toMatchObject` instead.
- **Contract testing with the marketplace APIs** — Pact / mock-server for Trendyol/Hepsiburada once we hit drift issues. Out of scope.

---

## References

- [Vitest docs](https://vitest.dev/)
- [Testing Library — guiding principles](https://testing-library.com/docs/guiding-principles/)
- [Mock Service Worker](https://mswjs.io/)
- [Supabase Local Development](https://supabase.com/docs/guides/cli/local-development)
- Internal: `docs/SECURITY.md` (multi-tenancy invariants this strategy enforces), `docs/ARCHITECTURE.md`, `apps/api/CLAUDE.md`, `apps/web/CLAUDE.md`
