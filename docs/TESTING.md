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
14. [Gates and CI Behavior](#14-gates-and-ci-behavior)
15. [Campaign Workbook Pipeline Tests](#15-campaign-workbook-pipeline-tests)

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
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { ensureDbReachable, truncateAll, prisma } from '../helpers/db';

describe('MyService', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('does the thing', async () => {
    // Arrange — use factories
    // Act — call the function or HTTP route
    // Assert — verify DB state or response
  });
});
```

`truncateAll` runs `TRUNCATE TABLE … CASCADE` on every tenant-scoped table. Each test starts with an empty DB.

**Pre-requisite:** Supabase local must be running (`supabase start`), and the ISOLATED test DB must be bootstrapped once with `pnpm db:test-setup` with `TEST_DATABASE_URL` set in the workspace-root `.env`. The integration suite runs against that separate DB — never the shared dev DB — so `truncateAll` can never wipe your dev data. The `ensureDbReachable` helper fails fast with a helpful message if the DB is unreachable, and the vitest config throws a clear error if `TEST_DATABASE_URL` is missing.

> The RLS suite is the ONE exception: it still runs against the dev "postgres" DB (PostgREST/GoTrue/Realtime only ever serve that database), via its own command `pnpm --filter @pazarsync/api test:integration:rls`. It is excluded from the main integration run.

### Environment loading

`apps/api/vitest.config.ts` auto-loads the workspace-root `.env` via `dotenv` (see the file for the `path.resolve(here, "../../.env")` block). This means `pnpm --filter @pazarsync/api test` picks up `DATABASE_URL` and `DIRECT_URL` without having to export them in your shell. CI passes them via the workflow `env:` block, so a missing `.env` there is a no-op (dotenv silently skips when the file isn't found).

Immediately after loading `.env`, each integration `vitest.config.ts` calls `remapDatabaseUrlToTestDb()` (`@pazarsync/db/test-env`), which redirects `DATABASE_URL`/`DIRECT_URL` at `TEST_DATABASE_URL` (the isolated test DB) and stashes the original dev URL in `PAZARSYNC_DEV_DATABASE_URL` so the teardown can purge GoTrue-minted `@test.local` auth users from the dev DB (GoTrue only ever writes the dev "postgres" DB). The RLS config (`vitest.rls.config.ts`) deliberately skips the remap. A DB-free unit run (`PAZARSYNC_SKIP_RESEED=1`) does not require `TEST_DATABASE_URL`.

If you ever see `Cannot reach test database at DATABASE_URL=undefined`, your `.env` is missing or your shell shadowed it — check the worktree root.

---

## 7. Multi-Tenancy Test Pattern

Every org-scoped endpoint MUST have at least one isolation test. Pattern:

```ts
it('does not leak Org A data to Org B queries', async () => {
  const orgA = await createOrganization({ slug: 'org-a' });
  const orgB = await createOrganization({ slug: 'org-b' });
  const storeA = await createStore(orgA.id);
  await createOrder(orgA.id, storeA.id);

  const ordersForOrgB = await prisma.order.findMany({
    where: { organizationId: orgB.id },
  });
  expect(ordersForOrgB).toEqual([]); // ← The critical assertion
});
```

For HTTP-level isolation tests (once auth middleware exists):

```ts
// FUTURE — pattern for when signTestJwt() lands
it('returns 403 when user is not a member of the requested organization', async () => {
  const orgA = await createOrganization();
  const orgB = await createOrganization();
  const userA = await createUserProfile();
  await createMembership(orgA.id, userA.id, 'OWNER');
  // userA is NOT a member of orgB

  const token = signTestJwt({ userId: userA.id });
  const res = await app.request(`/v1/organizations/${orgB.id}/stores`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  expect(res.status).toBe(403); // never 200, never leak orgB data
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

The campaign workbook hooks are tested as one matrix over every `WorkbookPage` (`tests/unit/hooks/use-import-workbook.test.tsx`, `use-export-workbook.test.tsx`), each with its own page table and a test that the table covers every page, so a new page is a new row, not a new file.

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

The campaign upload dialog is one matrix over every page (`tests/component/features/campaigns/workbook-upload-dialog.test.tsx`). Build a backend refusal for a component or hook test with `apps/web/tests/helpers/api-error.ts` (`validationApiError(issues)`, `problemApiError(status, code)`) rather than a hand-written `ApiError`.

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '../../helpers/render';
import { MyForm } from '@/features/my-feature/components/my-form';

describe('<MyForm>', () => {
  it('submits valid input', async () => {
    const onSubmit = vi.fn();
    const { user } = render(<MyForm onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText('Name'), 'Acme');
    await user.click(screen.getByRole('button', { name: /submit/i }));

    expect(onSubmit).toHaveBeenCalledWith({ name: 'Acme' });
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
- **Parallel test files racing on a shared DB** → two integration test files both calling `truncateAll` in `beforeEach` race if they share a database: file A's `TRUNCATE … CASCADE` wipes the rows file B just inserted. Every integration config is wired with `configureWorkerDatabases()` (`@pazarsync/db/test-env`), so each vitest worker runs against its own clone of the test DB template (`<TEST_DATABASE_URL db>_<package>_w<N>`, created by a globalSetup, dropped after the run). Never point a worker at a shared DB, and never set `VITEST_MAX_WORKERS` (see §14).
- **"Test DB template is out of date"** → the template (`<TEST_DATABASE_URL db>_tpl`) is stamped with a fingerprint of `schema.prisma`, `supabase/sql/*.sql` and the reference/fixture seeders. After changing any of them, run `pnpm db:test-setup` again. Keep the clones of a failed run for inspection with `PAZARSYNC_KEEP_TEST_DBS=1`.
- **"Could not clone … into …"** → a session is connected to the template (psql, Prisma Studio). `pnpm db:test-setup` seals the template (`ALLOW_CONNECTIONS false`), so this only happens before the first setup run.
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
# Fast iteration (no DB needed): the files you touched, then the affected gate
pnpm --filter @pazarsync/api exec vitest run tests/unit/lib/errors.test.ts
pnpm check:affected   # typecheck + lint + unit tests for changed packages, format, audits

# Integration — needs local Supabase + the isolated test DB. CI runs the whole
# suite on every backend PR; locally run the files your change touches.
supabase start
pnpm db:push          # apply schema to the dev "postgres" DB
pnpm db:test-setup    # build the clone template; re-run after schema / supabase/sql changes
pnpm --filter @pazarsync/api exec vitest run tests/integration/routes/store.routes.test.ts
pnpm test:integration # whole suite, one package at a time; runs against TEST_DATABASE_URL

# RLS suite: CI only. It runs against the dev "postgres" DB via PostgREST and
# TRUNCATEs its tenant tables; its config refuses to load without an explicit
# opt-in that only CI sets. Never run it locally without a full pg_dump backup
# of the dev data and the owner's go-ahead.

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

## 14. Gates and CI Behavior

### Three layers

| Layer              | Runs                                                                                                     | Scope                                    |
| ------------------ | -------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| pre-commit (husky) | `lint-staged` (prettier on staged files)                                                                 | staged files                             |
| pre-push (husky)   | `turbo run typecheck lint test:unit --affected`, 3 tasks at a time, 2 vitest workers each                | changed packages + their dependents      |
| CI (the authority) | typecheck + OpenAPI drift, lint + format + repo audits, build, unit, component, integration + RLS suites | everything; only CI decides "green"      |

The pre-push gate compares the current working tree (not the pushed ref range — same as the old gate) against `origin/main` (override with `TURBO_SCM_BASE`). If that ref can't be resolved it checks every package instead. Component, integration and slow suites never run on push — CI runs them. Escape hatch for a WIP push: `git push --no-verify`.

### CI jobs (`.github/workflows/ci.yml`)

- **Typecheck** — `pnpm typecheck`, plus a `git diff --exit-code packages/api-client/openapi.json` drift check (the setup composite already ran `api:sync`).
- **Lint** — every workspace's `lint`, `format:check`, and the repo audits (`audit:boundaries`, `audit:errors`, `audit:lint`, `audit:money`, `audit:no-barrel`, `audit:test-hygiene`, `audit:test-config`). CI is the only place the audits are enforced. `audit:test-config` fails when a vitest config does not take its pool size from `@pazarsync/vitest-config`, when a package runs vitest without a config, or when a test file sits outside the directories its package's configs include (it would never run).
- **Unit / Component** — `turbo run test:unit|test:component --concurrency=2`. The unit job runs `@pazarsync/spreadsheet` alone after the other packages: its CI-only budget tests time wall-clock work in a parse worker, and another package's suite beside it on the 2-vCPU runner pushes them past their budgets. Packages that also have DB-backed tests keep DB-free unit tests in a separate `vitest.unit.config.ts` (no `.env`, no DB remap, no globalSetup, files in parallel); `vitest.config.ts` there is integration-only, with each worker on its own clone of the test DB template.
- **Integration** — fresh Supabase local, `db:push`, migration drift check, `pnpm db:test-setup` (builds the `pazarsync_test_tpl` clone template), `turbo run test:integration --concurrency=1` (one package at a time; inside a package, files run in parallel, each worker on its own clone), then the RLS suite with `PAZARSYNC_ALLOW_DEV_DB_TRUNCATE=1` against the disposable job DB. On a pull request it only runs when something outside `apps/web` changed; every non-docs push to `main` runs it.
- **Change detection** — `dorny/paths-filter` with `predicate-quantifier: 'some-with-excludes'`; docs-only changes skip build, unit, component and integration.
- **Dependency-aware caching** — every check task depends on turbo's `transit` node, so a change inside a package invalidates the cached results of every package that depends on it (without it, a dependent's `typecheck` / tests were replayed from cache as green).
- **Turbo cache** — persisted per job (`turbo-<os>-<job>-<sha>`), entries older than 14 days are pruned before saving. The integration job never uses it (its hash can't see every out-of-package input).

No coverage thresholds. The reviewer's question is "does this PR have the tests it should have?", not "is coverage above 80%?".

### Resource bounds: `PAZARSYNC_TEST_WORKERS`

Every vitest config sets `maxWorkers: testWorkers()` from `@pazarsync/vitest-config`. Defaults: 2 workers in CI, 50% of the cores locally. Override with `PAZARSYNC_TEST_WORKERS=<count>` or `<percent>%` (turbo passes it through).

Never use `VITEST_MAX_WORKERS`: vitest applies it after the config is resolved, so it silently overrides `maxWorkers` — and `fileParallelism: false` where a suite still needs it (the spreadsheet time budgets, the RLS suite on the shared dev DB). The integration globalSetup creates exactly `maxWorkers` clones, so a worker count changed behind its back would leave workers without a database. `@pazarsync/vitest-config` deletes it on import.

### Local commands

| Script                | Runs                                                                                          | DB needed?                   | Use when                                        |
| --------------------- | --------------------------------------------------------------------------------------------- | ---------------------------- | ----------------------------------------------- |
| `pnpm check:affected` | the pre-push gate (affected typecheck + lint + `test:unit`) + format check + audits           | No                           | Before each commit                              |
| `pnpm check:all`      | typecheck + lint + `test:unit` + `test:component` for every package (bounded) + format + audits | No                           | On demand — full local mirror of CI's fast jobs |
| `pnpm check:full`     | `check:all` + `test:integration` (one package at a time) + migration drift check              | Yes (`supabase start` first) | On demand — full parity with CI                 |

Day to day, run the test files your change touches (`pnpm --filter <pkg> exec vitest run <file>`), then `pnpm check:affected`; the pre-push gate and CI do the rest. Root `test:unit` / `test` / `test:integration` are bounded too (`--concurrency=3` with 2 workers, or one package at a time for anything that touches the database).

---

## 15. Campaign Workbook Pipeline Tests

The campaign workbook pipeline (`apps/api/src/workbooks/`, see "Campaign workbooks" in `apps/api/CLAUDE.md`) is pinned by tests that cover every page at once: a page that joins the pipeline adds a row to each matrix, not a new file. Paths below are under `apps/api/`.

- **Contract matrix** (`tests/integration/routes/workbook-routes-contract.test.ts`): one `CONTRACT_ROWS` row per page. The import refuses bytes that are not an xlsx (422 `NOT_XLSX`) and another page's real fixture (422 `WRONG_FILE_FOR_PAGE` with `meta.detectedPage`), and after each refusal every workbook parent table and item table keeps its row count; the page's own real fixture imports; a viewer granted the store gets 403 on the export; both routes are in the OpenAPI document. `TARIFF_CROSS_ROWS` also tries the commission and Plus commission tariff files on each other's route, both directions, since the two pages share headers.
- **Tenant-isolation matrix** (`tests/integration/tenant-isolation/workbook-routes-isolation.test.ts`): one `ISOLATION_ROWS` row per page; the victim list is seeded through the import route with the real fixture, so the rightful export can succeed.
  - Import: a non-member is 403 before the engine reads a byte (`readWorkbookGrid` is wrapped in a spy); another organization's store under the caller's path, and a store of the caller's own organization without a grant, are 404 and write nothing; the rightful member's import of the same file succeeds.
  - Export, own path: another organization's record id, and a sibling store's record id, under the caller's OWN store path are 404 and leave `exportedAt` null. These are the requests that reach `adapter.load`; a foreign store path stops in the middleware and proves nothing about the query. The foreign store path, the ungranted store and the non-member cases follow, then the rightful export.
  - Adapter level, no HTTP: `load` and `touchExported` with another organization's scope or a sibling store's scope return null and `{ count: 0 }` and leave `exportedAt` unchanged, and `countLists` is 0.
  - The page's own isolation file (section 7) keeps its cases; this matrix is required in addition.
- **Golden digests** (`tests/fixtures/workbook-golden/legacy-rows.json`): digests the legacy parser wrote before it was deleted: a `real` digest per real fixture (the fixture's rows) and a `derived` digest for each page's main fixture (the fixture plus its page's derived rows); each holds `keptRows`, `skippedRows` and the SHA-256 of the kept rows' canonical JSON (`tests/helpers/canonical-json.ts`). Each page's format test (`tests/unit/workbooks/formats/<page>.format.test.ts`) reads the fixture through `readRows` and compares, so a change to `mapRow` or the keep rule that alters any field of any row fails. The legacy parsers are gone and cannot write a digest again: a digest changes only with a deliberate change to a mapping rule, a keep rule or the derived rows, in the same commit and with the reason in its message, never to turn a red test green.
- **Derived rows** (`tests/helpers/workbook-derived-rows.ts`): the real exports drop no row, so each page also has rows built from its fixture's first kept row with cells blanked or rewritten (the `*_DERIVED` cases, turned into a grid by `derivedGrid`), each flagged `kept` or not. They put every fallback chain of a `mapRow` and the dropping side of every keep rule under the golden; the format tests assert that each case lands on the side its flag names.
- **Composition root** (`tests/unit/workbooks/registry.test.ts`): every page has exactly one adapter with at least one Trendyol format; format ids are unique and of the form `PLATFORM:PAGE:v<n>`; every summary in `FORMAT_SUMMARIES` is used by exactly one adapter format with the same values, and every format has its summary; no Hepsiburada format is registered; parent tables are distinct members of `WORKBOOK_PARENT_TABLES`; each default list name equals an expectation written from code points, independent of `labels.ts`. Every `.xlsx` under `tests/fixtures/` must be classified in `FIXTURE_PAGES` and is diagnosed as its own format on every other page. `tests/unit/workbooks/workbook-errors.test.ts` pins `WORKBOOK_ENGINE_FILE_CODES` (`@pazarsync/utils`, the list the web buckets) to the engine's own `SPREADSHEET_FILE_ERROR_CODES` minus `ENGINE_BUSY`.
- **Migration text** (`tests/unit/workbooks/source-format-backfill.test.ts`, helper `tests/helpers/workbook-migrations.ts`): neither the drift check (empty tables) nor the test database (`prisma db push`) runs a backfill, so the test reads the SQL of the migrations that backfill `source_format_id` and pins it: one `UPDATE` per parent table, each id built from `WORKBOOK_PAGES` and scoped to rows that hold a stored file; in the name-limit migration, a guard that stops on a name over the limit, run with the backfills before its first `ALTER TABLE`. `registry.test.ts` ties each backfilled id to its adapter's format.
- **Parity before delete.** Before a legacy path is deleted, a temporary test compares its output with the new path's on the same input: the legacy parser's full row output against `mapRow` on the real and the derived rows (that run also writes the golden entry), and the legacy export against `exportWorkbook` cell by cell on the same stored list, byte for byte for a list with no selection. The comparison test is deleted, as a whole file, together with the legacy code it compares: vitest fails a file with no suite.
- **A mutation per money rule.** Every price an adapter writes back (`pick`, `resolveWriteBack`) is pinned by literal cases in `tests/unit/workbooks/verticals/<page>.adapter.test.ts`, and each rule is proven by one mutation done by hand: change the fallback order, or `toFixed(2)` to `toFixed(1)`, in the adapter, see the test fail, restore. A literal that still passes under the mutation does not pin the rule.
- **Checking the read-only audit on real rows.** `scripts/audit-stored-workbooks.ts` exports nothing; it runs on load and connects only to `AUDIT_DATABASE_URL`. To check it against real rows, write a temporary integration file under `tests/integration/` that seeds the rows it needs (real fixtures through the import route, plus any broken row the check is about), runs the script as a child process with `AUDIT_DATABASE_URL` set to the worker's own `DATABASE_URL` (the private clone the integration setup points each worker at, `packages/db/src/test-worker-env.ts`), and asserts on its output and exit code. Run that file alone, then delete it; it is never committed. Never point the script at the dev database or any other shared database from a test.
