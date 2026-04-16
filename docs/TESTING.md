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

| Category | Where | Speed | Discipline |
|----------|-------|-------|-----------|
| Unit | `tests/unit/` | <10ms each | Strict TDD for pure logic |
| Integration (route) | `tests/integration/routes/` | ~50ms each | Same-PR-as-code |
| Integration (DB) | `tests/integration/` | ~50ms each | Same-PR-as-code |
| Tenant isolation | `tests/integration/tenant-isolation/` | ~50ms each | MANDATORY |
| Component (frontend) | `tests/component/` | ~30ms each | Pragmatic |

---

## 3. File Organization

```
apps/api/tests/
├── unit/                   # Pure logic, no I/O
├── integration/
│   ├── routes/             # Hono route tests via app.request()
│   └── tenant-isolation/   # CRITICAL multi-tenancy invariants
└── helpers/                # db, factories, (future) auth

apps/web/tests/
├── unit/                   # Hook tests, utility tests
├── component/              # React component tests
└── helpers/                # render, msw

packages/utils/tests/       # Flat, unit only
```

---

## 4. Naming Conventions

- File: `<thing-being-tested>.test.ts` (kebab-case, mirrors source filename)
- Component tests: `<component-name>.test.tsx`
- Helper files (NOT discovered by Vitest): plain names like `factories.ts`, `render.tsx`

---

## 5. TDD Workflow (for pure logic)

```
1. Write failing test
2. Run it. See it fail with the expected error.
3. Write minimal implementation.
4. Run again. See it pass.
5. Refactor (if needed). Tests still pass.
6. Commit.
```

The "see it fail" step is non-negotiable. Tests that pass before implementation are testing the wrong thing.

Example (cursor utility):
```ts
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
```

---

## 6. DB Integration Pattern

Every DB-touching test follows this skeleton:

```ts
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
```

`truncateAll` runs `TRUNCATE TABLE … CASCADE` on every tenant-scoped table. Each test starts with an empty DB.

**Pre-requisite:** Supabase local must be running (`supabase start`) and the schema applied (`pnpm db:push`). The `ensureDbReachable` helper fails fast with a helpful message if not.

### Environment loading

`apps/api/vitest.config.ts` auto-loads the workspace-root `.env` via `dotenv` (see the file for the `path.resolve(here, "../../.env")` block). This means `pnpm --filter @pazarsync/api test` picks up `DATABASE_URL` and `DIRECT_URL` without having to export them in your shell. CI passes them via the workflow `env:` block, so a missing `.env` there is a no-op (dotenv silently skips when the file isn't found).

If you ever see `Cannot reach test database at DATABASE_URL=undefined`, your `.env` is missing or your shell shadowed it — check the worktree root.

---

## 7. Multi-Tenancy Test Pattern

Every org-scoped endpoint MUST have at least one isolation test. Pattern:

```ts
it("does not leak Org A data to Org B queries", async () => {
  const orgA = await createOrganization({ slug: "org-a" });
  const orgB = await createOrganization({ slug: "org-b" });
  const storeA = await createStore(orgA.id);
  await createOrder(orgA.id, storeA.id);

  const ordersForOrgB = await prisma.order.findMany({
    where: { organizationId: orgB.id },
  });
  expect(ordersForOrgB).toEqual([]);  // ← The critical assertion
});
```

For HTTP-level isolation tests (once auth middleware exists):
```ts
// FUTURE — pattern for when signTestJwt() lands
it("returns 403 when user is not a member of the requested organization", async () => {
  const orgA = await createOrganization();
  const orgB = await createOrganization();
  const userA = await createUserProfile();
  await createMembership(orgA.id, userA.id, "OWNER");
  // userA is NOT a member of orgB

  const token = signTestJwt({ userId: userA.id });
  const res = await app.request(`/v1/organizations/${orgB.id}/stores`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  expect(res.status).toBe(403);  // never 200, never leak orgB data
});
```

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
```tsx
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
```

Default MSW handlers live in `tests/helpers/msw.ts`. Add new endpoint defaults there. Per-test overrides use `server.use(...)`.

---

## 10. Frontend Component Tests

Use React Testing Library. Test interaction, not implementation.

```tsx
import { describe, it, expect, vi } from "vitest";
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
```

Guidance:
- Query by accessible role first (`getByRole("button", { name: ... })`)
- Fall back to `getByLabelText`, `getByText`
- AVOID `getByTestId` unless nothing else works
- Use `userEvent` (typed inputs, real keystrokes) over `fireEvent`

---

## 11. Test Helpers Reference

| Helper | Path | Purpose |
|--------|------|---------|
| `prisma` | `apps/api/tests/helpers/db.ts` | Re-exports the singleton from `@pazarsync/db` |
| `truncateAll()` | `apps/api/tests/helpers/db.ts` | Empty all tenant tables; call in `beforeEach` |
| `ensureDbReachable()` | `apps/api/tests/helpers/db.ts` | Fail fast with help if Supabase isn't up |
| `createUserProfile`, `createOrganization`, … | `apps/api/tests/helpers/factories.ts` | Test data factories |
| `render` | `apps/web/tests/helpers/render.tsx` | RTL render with QueryClientProvider |
| `createTestQueryClient` | `apps/web/tests/helpers/render.tsx` | Fresh, retry-disabled QueryClient |
| `server` | `apps/web/tests/helpers/msw.ts` | MSW server (auto-listening per setup.ts) |
| `http`, `HttpResponse` | `apps/web/tests/helpers/msw.ts` | Re-exports for per-test handler overrides |

---

## 12. Common Pitfalls

- **Forgetting `beforeEach(truncateAll)`** → tests pass individually but interfere when run together. Symptom: works locally, fails in CI (different test order).
- **Parallel test files racing on the shared DB** → with Vitest's default file parallelism, two integration test files both calling `truncateAll` in `beforeEach` will race: file A's `TRUNCATE … CASCADE` wipes the rows file B just inserted. The fix lives in `apps/api/vitest.config.ts` as `test.fileParallelism: false`. Don't remove that line without replacing it with schema-per-worker isolation.
- **Using jsdom for tests that need MSW interception** → jsdom 29 isolates `fetch` inside its own per-realm context, so requests issued from the test never reach the Node-level undici fetch that MSW patches. Result: MSW handlers are silently bypassed and the test hangs (success path) or passes for the wrong reason (error path). `apps/web/vitest.config.ts` uses `environment: "happy-dom"` for this reason — happy-dom uses Node's native fetch and MSW intercepts cleanly. If you ever switch back to jsdom, your hook tests will start hanging.
- **Using `as any` in tests** → defeats the entire purpose of typed mocks. Fix the types instead.
- **Snapshot tests** → AVOID. Fragile, hide intent, pollute diffs. Use explicit `toMatchObject` instead.
- **Mocking Prisma in integration tests** → defeats the purpose. Integration tests use the REAL DB.
- **Mocking `apiClient` in frontend tests** → use MSW instead. Mocking apiClient bypasses the typed-client guarantee.
- **`it.skip` without a comment + tracked TODO** → silently broken tests rot. Always document why and link to the plan.
- **Testing implementation details** → e.g., asserting on internal state instead of user-visible behavior. Tests should survive refactors.

---

## 13. Running Tests Locally

### One-time bootstrap (after fresh clone or `node_modules` wipe)

```bash
pnpm install
pnpm db:generate    # generates the Prisma client into packages/db/generated
pnpm api:sync       # writes packages/api-client/openapi.json + regenerates typed paths
```

Without these two, `apps/web` typecheck and any test that imports `@pazarsync/db` or `@pazarsync/api-client` will fail with "Cannot find module" errors.

### Day-to-day commands

```bash
# Fast iteration (no DB needed)
pnpm test:unit

# Full suite — needs local Supabase
supabase start
pnpm db:push        # apply schema to local DB
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
```

---

## 14. CI Behavior

`.github/workflows/ci.yml`'s `test` job:

1. Installs deps with `--frozen-lockfile`.
2. Runs `pnpm db:generate` and `pnpm api:sync` so anything imported by tests is present before they run.
3. Runs `pnpm test:unit` first (fast feedback, no DB needed).
4. If unit tests pass: brings up Supabase local via `supabase/setup-cli@v1` + `supabase start`, applies the schema with `pnpm db:push`, then runs `pnpm test:integration`.
5. Calls `supabase stop` with `if: always()` so the cleanup runs even when a step above failed; nothing leaks between job invocations.

Total time: ~3 minutes. Failing tests block PR merge if branch protection is enabled.

No coverage thresholds. The reviewer's question is "does this PR have the tests it should have?", not "is coverage above 80%?".

### Local mirror commands

Two root scripts mirror what CI runs and give you the same gate locally:

| Script | Runs | DB needed? | Use when |
|--------|------|------------|----------|
| `pnpm check:all` | typecheck + lint + `test:unit` + format check | No | **Before each commit** — fast loop |
| `pnpm check:full` | typecheck + lint + full `test` (incl. integration) + format check | Yes (`supabase start` first) | **Before opening a PR** — full parity with CI |

`check:all` is the pre-commit gate; `check:full` is the pre-PR gate.
