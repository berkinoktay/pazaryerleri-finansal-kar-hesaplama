# Sync Error Code Prisma Enum — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote `sync_log.error_code` from `String?` to a Prisma `SyncErrorCode` enum. Make the worker the gate that validates caught-error `.code` values against the enum before writing — unknown values coerce to `INTERNAL_ERROR`. Replace every downstream string-literal duplicate of the code list with a reference to the canonical `@pazarsync/db/enums` export.

**Architecture:** Single PR. Prisma 7 emits the enum as both a runtime const and a type alias (per PR #78 convention). The worker validates before writing; the migration coerces any pre-existing junk values to `INTERNAL_ERROR` via a `USING CASE` clause. Frontend's just-shipped `KNOWN_SYNC_ERROR_CODES` tuple gets replaced with `Object.values(SyncErrorCode)`.

**Tech Stack:** Prisma 7 (`prisma-client` generator + `@prisma/adapter-pg`), Zod 4, TypeScript 6, Vitest 4, pnpm workspaces, Supabase (PostgreSQL 15).

**Spec:** `docs/plans/2026-04-29-sync-error-code-prisma-enum-design.md`

**Branch dependency:** Branches off `main` AFTER PR #83 (i18n leak fix) merges. Task 6 modifies `apps/web/src/features/sync/lib/format-sync-error.ts` which is created in #83.

**Preflight (one-time, not a task):**
- `git checkout main && git pull`
- `git checkout -b feat/sync-error-code-enum`
- `pnpm install`
- `supabase start` (needed for migration smoke tests)

---

## File Structure

| File | Responsibility | Created/Modified |
| ---- | -------------- | ---------------- |
| `packages/db/prisma/schema.prisma` | Add `enum SyncErrorCode`; retype `SyncLog.errorCode` | Modified |
| `packages/db/prisma/migrations/<timestamp>_add_sync_error_code_enum/migration.sql` | Coerce-fallback migration with `USING CASE` | Created |
| `packages/sync-core/src/errors.ts` | Domain error classes use enum values | Modified |
| `apps/sync-worker/src/error-code.ts` | Extracted `errorCodeOf` + `isSyncErrorCode` (so it's testable in isolation) | Created |
| `apps/sync-worker/src/index.ts` | Imports the extracted helper | Modified |
| `apps/sync-worker/tests/unit/error-code.test.ts` | Locks the gate behavior | Created |
| `apps/sync-worker/src/skip-bad-page.ts` | String literal → enum value | Modified |
| `packages/sync-core/src/sync-log.service.ts` | `fail()` signature: `errorCode: SyncErrorCode` | Modified |
| `packages/sync-core/src/checkpoint.ts` | `z.string()` → `z.enum(SyncErrorCode)` | Modified |
| `apps/api/src/validators/product.validator.ts` | Zod schemas tightened, runtime guards reduced, TS interfaces aligned | Modified |
| `apps/web/src/features/sync/lib/format-sync-error.ts` | Derive `KNOWN` from `Object.values(SyncErrorCode)` | Modified |

---

## Task 1: Schema + Migration

Add the enum, retype the column, and produce a coerce-fallback migration. This is the foundation — every downstream task depends on `@pazarsync/db/enums` exporting `SyncErrorCode`.

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_add_sync_error_code_enum/migration.sql`

- [ ] **Step 1: Add the enum and retype the column in `schema.prisma`**

Find the existing enum block (next to `SyncStatus` / `SyncType`) and add:

```prisma
enum SyncErrorCode {
  MARKETPLACE_AUTH_FAILED
  MARKETPLACE_ACCESS_DENIED
  MARKETPLACE_UNREACHABLE
  SYNC_IN_PROGRESS
  RATE_LIMITED
  VALIDATION_ERROR
  INTERNAL_ERROR
}
```

In the `SyncLog` model, change line 372:
```prisma
errorCode        String?    @map("error_code")
```
to:
```prisma
errorCode        SyncErrorCode? @map("error_code")
```

- [ ] **Step 2: Generate the migration**

Run:
```bash
pnpm db:migrate
```
(equivalent to `prisma migrate dev --name add_sync_error_code_enum`)

When prompted, name it `add_sync_error_code_enum`. Prisma will create:
`packages/db/prisma/migrations/<timestamp>_add_sync_error_code_enum/migration.sql`

- [ ] **Step 3: Replace auto-generated SQL with the coerce-fallback variant**

Open the generated `migration.sql`. Prisma will likely have produced a `DROP COLUMN ... ADD COLUMN` shape (lossy — drops existing rows' values). Replace the entire file with:

```sql
-- Promote sync_log.error_code from free-form String to typed enum.
-- Existing rows with values outside the enum (e.g. 'EAGAIN' from a Node
-- net error that leaked through the old free-form column) are coerced
-- to 'INTERNAL_ERROR'. The original diagnostic remains in error_message.
CREATE TYPE "SyncErrorCode" AS ENUM (
  'MARKETPLACE_AUTH_FAILED',
  'MARKETPLACE_ACCESS_DENIED',
  'MARKETPLACE_UNREACHABLE',
  'SYNC_IN_PROGRESS',
  'RATE_LIMITED',
  'VALIDATION_ERROR',
  'INTERNAL_ERROR'
);

ALTER TABLE "sync_logs"
  ALTER COLUMN "error_code" TYPE "SyncErrorCode"
  USING (
    CASE
      WHEN "error_code" IS NULL THEN NULL
      WHEN "error_code" IN (
        'MARKETPLACE_AUTH_FAILED',
        'MARKETPLACE_ACCESS_DENIED',
        'MARKETPLACE_UNREACHABLE',
        'SYNC_IN_PROGRESS',
        'RATE_LIMITED',
        'VALIDATION_ERROR',
        'INTERNAL_ERROR'
      ) THEN "error_code"::"SyncErrorCode"
      ELSE 'INTERNAL_ERROR'::"SyncErrorCode"
    END
  );
```

- [ ] **Step 4: Re-apply the corrected migration**

Reset the local DB and re-apply (so the new SQL is what runs):
```bash
pnpm supabase:start || true
pnpm --filter @pazarsync/db prisma migrate reset --force --skip-seed
pnpm db:migrate
```
Expected: migration runs cleanly; `pnpm db:generate` runs as part of `prisma migrate dev`. Verify the generated enum exists:
```bash
grep -A 9 "SyncErrorCode" packages/db/generated/prisma/enums.ts
```
Expected output: a const `SyncErrorCode = { MARKETPLACE_AUTH_FAILED: 'MARKETPLACE_AUTH_FAILED', ... } as const;` plus the type alias.

- [ ] **Step 5: Smoke-test the coercion**

Insert a junk row, run a fresh migration cycle, assert it's coerced. (Skip if no production data is at risk locally — but verify the SQL by inspection.)

```bash
psql "$DATABASE_URL" -c "INSERT INTO sync_logs (id, organization_id, store_id, sync_type, status, started_at, error_code, error_message) SELECT gen_random_uuid(), organization_id, id, 'PRODUCTS', 'FAILED', now(), 'EAGAIN', 'fixture' FROM stores LIMIT 1;"
pnpm --filter @pazarsync/db prisma migrate reset --force --skip-seed
# (the reset re-applies all migrations including our new one against a fresh DB —
#  the smoke value is in the SQL itself, which we already inspected)
```

The real smoke test is reading the migration SQL and confirming the `USING CASE` covers every branch. If you have a populated dev DB you don't want to reset, use a dedicated test DB instead.

- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/
git commit -m "feat(db): add SyncErrorCode enum, coerce-migrate sync_log.error_code

Promotes sync_log.error_code from free-form String? to a typed
SyncErrorCode enum (7 values: MARKETPLACE_*, SYNC_IN_PROGRESS,
RATE_LIMITED, VALIDATION_ERROR, INTERNAL_ERROR).

The auto-generated DROP+ADD migration is replaced with an
ALTER TYPE ... USING CASE variant that preserves rows: any
pre-existing value outside the enum coerces to INTERNAL_ERROR
while error_message keeps the original diagnostic for audit."
```

---

## Task 2: Domain error classes use enum values

Switch `packages/sync-core/src/errors.ts` from string literals to enum imports. Mechanical and type-narrowing — no behavior change.

**Files:**
- Modify: `packages/sync-core/src/errors.ts`

- [ ] **Step 1: Inspect the current file**

```bash
grep -n "readonly code" packages/sync-core/src/errors.ts
```
Expected: 6 lines (one per domain error class — MarketplaceAuthError, MarketplaceAccessError, MarketplaceUnreachable, SyncInProgressError, ValidationError, RateLimitedError).

- [ ] **Step 2: Add the enum import + replace each literal**

At the top of the file, add:
```ts
import { SyncErrorCode } from '@pazarsync/db/enums';
```

For each domain error class, replace:
```ts
readonly code = 'MARKETPLACE_AUTH_FAILED' as const;
```
with:
```ts
readonly code = SyncErrorCode.MARKETPLACE_AUTH_FAILED;
```

Apply the same pattern to all six classes. The `as const` is no longer needed — Prisma's emitted const already constrains the type.

- [ ] **Step 3: Verify typecheck**

```bash
pnpm --filter @pazarsync/sync-core typecheck
```
Expected: zero errors. If you see "Type 'string' is not assignable to type 'SyncErrorCode'" anywhere, the literal didn't match a real enum value — fix the typo.

- [ ] **Step 4: Run sync-core tests**

```bash
pnpm --filter @pazarsync/sync-core test:unit
```
Expected: all pre-existing tests pass. Behavior didn't change.

- [ ] **Step 5: Commit**

```bash
git add packages/sync-core/src/errors.ts
git commit -m "refactor(sync-core): use SyncErrorCode enum in domain error classes"
```

---

## Task 3: Worker `errorCodeOf` becomes the gate (TDD)

Extract `errorCodeOf` to its own file (so it's testable in isolation), write a failing test that asserts unknown codes coerce to `INTERNAL_ERROR`, then make the test pass.

**Files:**
- Create: `apps/sync-worker/src/error-code.ts`
- Create: `apps/sync-worker/tests/unit/error-code.test.ts`
- Modify: `apps/sync-worker/src/index.ts` (lines 185–203, plus the call sites at 133, 159)

- [ ] **Step 1: Extract the current `errorCodeOf` to its own file (NO behavior change yet)**

Create `apps/sync-worker/src/error-code.ts` with the EXISTING logic:

```ts
/**
 * Narrow an unknown caught value to extract its `code` string, if any.
 * Mirrors the structural-narrowing pattern used in
 * `apps/api/src/lib/map-prisma-error.ts` and `sync-log.service.ts`'s
 * `isUniqueViolation` — the documented exception in CLAUDE.md for
 * runtime structural type guards on third-party / unknown shapes.
 */
export function errorCodeOf(err: unknown): string {
  if (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof (err as { code: unknown }).code === 'string'
  ) {
    return (err as { code: string }).code;
  }
  return 'INTERNAL_ERROR';
}
```

In `apps/sync-worker/src/index.ts`, delete lines 186–203 (the docblock + the function definition) and add to the imports at the top:
```ts
import { errorCodeOf } from './error-code';
```

- [ ] **Step 2: Confirm extraction didn't break anything**

```bash
pnpm --filter @pazarsync/sync-worker typecheck
pnpm --filter @pazarsync/sync-worker test:unit
```
Expected: typecheck clean, all existing tests still pass. Behavior is identical.

- [ ] **Step 3: Write the failing test for the new gate behavior**

Create `apps/sync-worker/tests/unit/error-code.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { SyncErrorCode } from '@pazarsync/db/enums';

import { errorCodeOf } from '../../src/error-code';

describe('errorCodeOf — sync_log.error_code gate', () => {
  it('returns the matching SyncErrorCode when caught error has a known .code', () => {
    expect(errorCodeOf({ code: 'MARKETPLACE_AUTH_FAILED' })).toBe(
      SyncErrorCode.MARKETPLACE_AUTH_FAILED,
    );
    expect(errorCodeOf({ code: 'MARKETPLACE_UNREACHABLE' })).toBe(
      SyncErrorCode.MARKETPLACE_UNREACHABLE,
    );
  });

  it('returns INTERNAL_ERROR when caught error has an UNKNOWN .code (the gate)', () => {
    // The DB now rejects anything not in SyncErrorCode. Without this
    // coercion, a Node fs/net error like 'EAGAIN' would crash the
    // INSERT in sync-log.service. Guarding here is load-bearing.
    expect(errorCodeOf({ code: 'EAGAIN' })).toBe(SyncErrorCode.INTERNAL_ERROR);
    expect(errorCodeOf({ code: 'PRISMA_P2002' })).toBe(SyncErrorCode.INTERNAL_ERROR);
  });

  it('returns INTERNAL_ERROR for non-object inputs', () => {
    expect(errorCodeOf(null)).toBe(SyncErrorCode.INTERNAL_ERROR);
    expect(errorCodeOf(undefined)).toBe(SyncErrorCode.INTERNAL_ERROR);
    expect(errorCodeOf('some string')).toBe(SyncErrorCode.INTERNAL_ERROR);
    expect(errorCodeOf(42)).toBe(SyncErrorCode.INTERNAL_ERROR);
  });

  it('returns INTERNAL_ERROR when .code exists but is not a string', () => {
    expect(errorCodeOf({ code: 42 })).toBe(SyncErrorCode.INTERNAL_ERROR);
    expect(errorCodeOf({ code: null })).toBe(SyncErrorCode.INTERNAL_ERROR);
    expect(errorCodeOf({ code: { nested: true } })).toBe(SyncErrorCode.INTERNAL_ERROR);
  });
});
```

- [ ] **Step 4: Run the test — it should FAIL on the unknown-code case**

```bash
pnpm --filter @pazarsync/sync-worker test:unit -- error-code
```
Expected: the second test case fails with a message like:
```
expected 'EAGAIN' to be 'INTERNAL_ERROR'
```
The current implementation passes through unknown `.code` values verbatim — the test catches that.

- [ ] **Step 5: Update `errorCodeOf` to validate against the enum**

Replace the contents of `apps/sync-worker/src/error-code.ts` with:

```ts
import { SyncErrorCode } from '@pazarsync/db/enums';

const SYNC_ERROR_CODE_VALUES: ReadonlySet<string> = new Set(Object.values(SyncErrorCode));

function isSyncErrorCode(value: string): value is SyncErrorCode {
  return SYNC_ERROR_CODE_VALUES.has(value);
}

/**
 * Narrow an unknown caught value to a `SyncErrorCode` for `sync_log.error_code`.
 * Anything that doesn't carry a known enum value coerces to `INTERNAL_ERROR` —
 * the DB rejects anything else, and silent loss of granularity is preferable
 * to a crash mid-failure-handling. The original diagnostic is preserved in
 * `error_message` by callers.
 */
export function errorCodeOf(err: unknown): SyncErrorCode {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const code = (err as { code: unknown }).code;
    if (typeof code === 'string' && isSyncErrorCode(code)) {
      return code;
    }
  }
  return SyncErrorCode.INTERNAL_ERROR;
}
```

- [ ] **Step 6: Run the test — it should now PASS**

```bash
pnpm --filter @pazarsync/sync-worker test:unit -- error-code
```
Expected: all 4 `it` blocks pass.

- [ ] **Step 7: Run all sync-worker tests to catch regressions**

```bash
pnpm --filter @pazarsync/sync-worker test:unit
pnpm --filter @pazarsync/sync-worker typecheck
```
Expected: green across the board. The signature change from `string` to `SyncErrorCode` may surface type errors in `index.ts` call sites — fix them in Task 4 (`sync-log.service` accepts `SyncErrorCode`).

If `index.ts` shows a type error at lines 133 / 159 ("type 'SyncErrorCode' is not assignable to parameter of type 'string'"), that's expected — Task 4 fixes the receiving signature. Either commit this task with the type error and proceed to Task 4, OR temporarily widen `errorCodeOf`'s return to `SyncErrorCode | string` (don't — just go to Task 4).

- [ ] **Step 8: Commit**

```bash
git add apps/sync-worker/src/error-code.ts apps/sync-worker/src/index.ts apps/sync-worker/tests/unit/error-code.test.ts
git commit -m "feat(sync-worker): validate caught error codes against SyncErrorCode

errorCodeOf now narrows unknown caught-error .code values to the
SyncErrorCode enum before returning. Anything not in the enum
coerces to INTERNAL_ERROR — the DB rejects anything else, and the
worker is the gate. Original diagnostic remains in error_message.

Extracted to apps/sync-worker/src/error-code.ts so the gate
behavior is unit-testable in isolation."
```

---

## Task 4: Tighten `sync-log.service.fail()` signature

The service writes to the column. Its signature must accept `SyncErrorCode` so the type flows end-to-end from worker → service → DB.

**Files:**
- Modify: `packages/sync-core/src/sync-log.service.ts`

- [ ] **Step 1: Inspect the current signatures**

```bash
grep -n "errorCode" packages/sync-core/src/sync-log.service.ts
```
Expected: lines 42, 300, 360, 379 (or similar — the `fail` definition and internal callers).

- [ ] **Step 2: Add the enum import and tighten the function signature**

At the top of the file, add (or extend the existing import):
```ts
import { SyncErrorCode } from '@pazarsync/db/enums';
```

Change line 42 from:
```ts
export async function fail(id: string, errorCode: string, errorMessage: string): Promise<void> {
```
to:
```ts
export async function fail(id: string, errorCode: SyncErrorCode, errorMessage: string): Promise<void> {
```

For the internal caller at line 300, look for:
```ts
errorCode: string,
```
and change to:
```ts
errorCode: SyncErrorCode,
```
(Repeat for line 360 / any other caller — `grep` again to confirm you got them all.)

The line 379 occurrence (`errorCode: null`) stays — `null` is still valid because the column is `SyncErrorCode?` (nullable).

- [ ] **Step 3: Verify typecheck across both worker and sync-core**

```bash
pnpm --filter @pazarsync/sync-core typecheck
pnpm --filter @pazarsync/sync-worker typecheck
```
Expected: clean. The worker call site at `apps/sync-worker/src/index.ts:133` (which passes `errorCodeOf(err)` into `fail()`) now type-aligns.

- [ ] **Step 4: Run sync-core integration tests**

```bash
pnpm --filter @pazarsync/sync-core test:integration
```
Expected: pass. (Integration tests need `supabase start` and a clean DB.)

- [ ] **Step 5: Commit**

```bash
git add packages/sync-core/src/sync-log.service.ts
git commit -m "refactor(sync-core): tighten sync-log.service.fail to SyncErrorCode

The service is the last hop before the DB INSERT — its signature
now accepts SyncErrorCode so the typing flows end-to-end from
worker.errorCodeOf through sync-log.fail through Prisma."
```

---

## Task 5: Tighten validators (Zod) and the skip-bad-page literal

Replace `z.string()` with `z.enum(SyncErrorCode)` in the schema layer; remove now-redundant runtime guards; fix the one remaining hardcoded literal in `skip-bad-page.ts`.

**Files:**
- Modify: `packages/sync-core/src/checkpoint.ts`
- Modify: `apps/api/src/validators/product.validator.ts`
- Modify: `apps/sync-worker/src/skip-bad-page.ts`

- [ ] **Step 1: Tighten `checkpoint.ts`**

In `packages/sync-core/src/checkpoint.ts`, find line 48:
```ts
errorCode: z.string(),
```
Add the import at the top (if not already present):
```ts
import { SyncErrorCode } from '@pazarsync/db/enums';
```
Change line 48 to:
```ts
errorCode: z.enum(SyncErrorCode),
```

- [ ] **Step 2: Tighten `product.validator.ts` Zod schemas**

Open `apps/api/src/validators/product.validator.ts`. Add the import at the top:
```ts
import { SyncErrorCode } from '@pazarsync/db/enums';
```

Line 67 (nullable in the response schema):
```ts
errorCode: z.string().nullable().openapi({ example: null }),
```
becomes:
```ts
errorCode: z.enum(SyncErrorCode).nullable().openapi({ example: null }),
```

Line 96 (non-nullable in the inner schema):
```ts
errorCode: z.string(),
```
becomes:
```ts
errorCode: z.enum(SyncErrorCode),
```

- [ ] **Step 3: Tighten the TS interfaces and runtime guards**

In the same file, the TS interface declarations at lines 369 / 387 / 405 (search the file for `errorCode:` in non-Zod contexts) currently declare `errorCode: string` or `errorCode: string | null`. Tighten each to `errorCode: SyncErrorCode` or `errorCode: SyncErrorCode | null` to match the inferred Zod types.

The hand-rolled runtime guards around lines 430 and 438:
```ts
typeof o['errorCode'] !== 'string' ||
```
The Zod schema is now the contract — if these guards are part of a `parse()`-using validator, delete them. If they're inside a manual validator that doesn't go through Zod, tighten to:
```ts
const code = o['errorCode'];
if (code !== null && (typeof code !== 'string' || !Object.values(SyncErrorCode).includes(code as SyncErrorCode))) {
  return false;
}
```
(Read the surrounding context — pick the lighter touch.)

- [ ] **Step 4: Replace the `skip-bad-page.ts` literal**

In `apps/sync-worker/src/skip-bad-page.ts`, find line 98:
```ts
errorCode: 'MARKETPLACE_UNREACHABLE',
```
Add the import at the top:
```ts
import { SyncErrorCode } from '@pazarsync/db/enums';
```
Change line 98 to:
```ts
errorCode: SyncErrorCode.MARKETPLACE_UNREACHABLE,
```

- [ ] **Step 5: Typecheck and test**

```bash
pnpm --filter @pazarsync/sync-core typecheck
pnpm --filter @pazarsync/api typecheck
pnpm --filter @pazarsync/sync-worker typecheck
pnpm --filter @pazarsync/sync-core test
pnpm --filter @pazarsync/api test:unit
pnpm --filter @pazarsync/sync-worker test
```
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add packages/sync-core/src/checkpoint.ts apps/api/src/validators/product.validator.ts apps/sync-worker/src/skip-bad-page.ts
git commit -m "refactor(api,sync-core,sync-worker): use SyncErrorCode enum in Zod schemas + skip-bad-page

Replaces z.string() with z.enum(SyncErrorCode) in checkpoint and the
product validator response shape. Drops the hand-rolled runtime guards
that the Zod schema now subsumes. skip-bad-page's hardcoded
'MARKETPLACE_UNREACHABLE' literal is replaced with the enum value."
```

---

## Task 6: Frontend — derive `KNOWN` from the enum

Replace the hand-written `KNOWN_SYNC_ERROR_CODES` tuple in `format-sync-error.ts` (shipped in PR #83) with `Object.values(SyncErrorCode)`. The shipped tests should keep passing — only the source of truth changes.

**Files:**
- Modify: `apps/web/src/features/sync/lib/format-sync-error.ts`

- [ ] **Step 1: Replace the hand-written tuple with the enum-derived set**

Open `apps/web/src/features/sync/lib/format-sync-error.ts`. Replace the entire file with:

```ts
import { SyncErrorCode } from '@pazarsync/db/enums';
import { useTranslations } from 'next-intl';
import { useCallback } from 'react';

const KNOWN_SYNC_ERROR_CODE_SET: ReadonlySet<string> = new Set(Object.values(SyncErrorCode));

function isKnownSyncErrorCode(value: string): value is SyncErrorCode {
  return KNOWN_SYNC_ERROR_CODE_SET.has(value);
}

export interface SyncErrorCopy {
  title: string;
  description: string;
}

export type SyncErrorFormatter = (code: string | null | undefined) => SyncErrorCopy | null;

/**
 * Translates a SyncLog `errorCode` into the `{ title, description }` copy pair
 * the SyncCenter rows + retry banner consume.
 *
 * - `null` / `undefined` input → `null` (no error to render)
 * - Unknown code → the `fallback` copy (still localized, no raw enum leak)
 *
 * The known-set is derived from `Object.values(SyncErrorCode)` so it stays in
 * sync with the DB enum automatically — adding a new error class in
 * `packages/sync-core/src/errors.ts` requires updating `schema.prisma`'s enum
 * (which propagates here through codegen) AND adding the matching
 * `syncCenter.errors.<CODE>` entry to `messages/{tr,en}.json`.
 */
export function useFormatSyncError(): SyncErrorFormatter {
  const t = useTranslations('syncCenter.errors');
  return useCallback(
    (code) => {
      if (code === null || code === undefined) return null;
      const key = isKnownSyncErrorCode(code) ? code : 'fallback';
      return {
        title: t(`${key}.title`),
        description: t(`${key}.description`),
      };
    },
    [t],
  );
}
```

The deletions vs the PR #83 version: the hand-written `KNOWN_SYNC_ERROR_CODES` tuple, the local `KnownSyncErrorCode` type alias, the duplicated comment block.

- [ ] **Step 2: Typecheck the web app**

```bash
pnpm --filter @pazarsync/web typecheck
```
Expected: clean. The `value is SyncErrorCode` guard now narrows to the canonical type.

- [ ] **Step 3: Run the existing tests**

```bash
pnpm --filter @pazarsync/web test:unit -- format-sync-error
pnpm --filter @pazarsync/web test:component -- sync-center
```
Expected: all 4 helper tests pass; all 7+ sync-center component tests pass. The fallback path still works because `Object.values(SyncErrorCode)` includes all 7 codes — anything else routes to `fallback`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/sync/lib/format-sync-error.ts
git commit -m "refactor(web): derive sync error codes from SyncErrorCode enum

Replaces the hand-written KNOWN_SYNC_ERROR_CODES tuple with
Object.values(SyncErrorCode) imported from @pazarsync/db/enums.
Adding a new sync error code now requires only schema.prisma
(plus the matching i18n key) — the frontend stays in sync via
codegen, no manual list maintenance."
```

---

## Task 7: Final verification + open PR

Repo-wide check + PR.

- [ ] **Step 1: Pre-PR gate**

```bash
pnpm check:full
```
Expected: green. (Needs `supabase start` running for integration tests.)

- [ ] **Step 2: Audit boundaries**

```bash
pnpm audit:boundaries
```
Expected: 0 errors. If a new web → `@pazarsync/db` edge appears, that's expected (the dep already exists for other enums); if any new cross-feature edge appears in `apps/web/src/features/`, that's a regression — investigate.

- [ ] **Step 3: Push and open PR**

```bash
git push -u origin feat/sync-error-code-enum
gh pr create --title "feat(db): SyncErrorCode Prisma enum + worker validation gate" --body "$(cat <<'EOF'
## Summary

Promotes `sync_log.error_code` from `String?` to a typed `SyncErrorCode` enum (7 values, mirroring the i18n set just shipped in #83). The worker's `errorCodeOf` becomes the load-bearing gate that validates caught-error `.code` values against the enum before they reach the DB — unknown values coerce to `INTERNAL_ERROR` while the original diagnostic remains in `error_message`.

Aligns with PR #78's consolidation rule: domain enum values live exactly once in `schema.prisma`, generated to `@pazarsync/db/enums`, downstream consumers reference rather than redeclare.

The frontend's hand-written `KNOWN_SYNC_ERROR_CODES` tuple from #83 is replaced with `Object.values(SyncErrorCode)` — adding a new code now requires only `schema.prisma` (plus the matching `syncCenter.errors.<CODE>` i18n entry).

## Migration safety

The `ALTER COLUMN ... USING CASE` SQL coerces any pre-existing junk values (e.g. `'EAGAIN'` from a Node net error that historically leaked through the free-form column) to `'INTERNAL_ERROR'`, preserving the row and keeping `error_message` for audit. Pre-launch DBs no-op.

## Test plan

- [x] `pnpm check:full` — typecheck + lint + all tests + format + audit
- [x] Worker regression test: `errorCodeOf({ code: 'EAGAIN' })` → `INTERNAL_ERROR` (the gate)
- [x] Worker happy path: `errorCodeOf({ code: 'MARKETPLACE_AUTH_FAILED' })` → enum value
- [x] Existing `format-sync-error.test.tsx` + `sync-center.test.tsx` still pass with derived const
- [ ] Smoke check on a populated dev DB: junk row's `error_code` becomes `INTERNAL_ERROR` after migration

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Spec: docs/plans/2026-04-29-sync-error-code-prisma-enum-design.md
EOF
)"
```

- [ ] **Step 4: Verify the PR URL was returned**

The `gh pr create` output should include a GitHub URL — record it for handoff.

---

## Out of scope (do NOT include in this PR)

- `apps/web/src/providers/query-provider.tsx` `KNOWN_CODES` set — it's a UNION of `SyncErrorCode` + RFC 7807 generics; not a duplicate. Leave alone.
- The icon-tone fix on terminal-failed sync rows (info ⓘ → destructive). UI nit.
- Generalizing into an `RfcProblemCode` enum from `apps/api/src/lib/errors.ts`. Different scope.

If you find yourself reaching for any of the above, stop and open a follow-up issue instead.
