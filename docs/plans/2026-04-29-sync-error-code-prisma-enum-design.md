# Sync Error Code Hardening: Promote to Prisma Enum

## Context

`sync_log.error_code` is currently a free-form `String?`. Domain error classes in `packages/sync-core/src/errors.ts` declare `readonly code = '...' as const` literal types, but nothing enforces that those values are the only ones reaching the DB. The just-shipped i18n leak fix (PR #83) had to hand-write a `KNOWN_SYNC_ERROR_CODES` tuple in `apps/web/src/features/sync/lib/format-sync-error.ts` to know what to translate — that hand-written list will drift from the canonical source the moment a new domain error class lands. The `INTERNAL_ERROR` sentinel chosen by `errorCodeOf(err)` in `apps/sync-worker/src/index.ts:193` is a fallback, but unknown caught-error `.code` values (e.g. Node's `'EAGAIN'`, marketplace SDK internal codes) currently flow straight into the DB.

This spec promotes the column to a Prisma enum aligned with the conventions PR #78 (`chore(types): consolidate enum value declarations to @pazarsync/db`) established: domain enum values live exactly once in `schema.prisma`, generate to `@pazarsync/db/enums`, and downstream code never redeclares them. The new enum becomes the contract; the worker becomes the gate.

**Dependency**: this spec touches `apps/web/src/features/sync/lib/format-sync-error.ts`, a file created in PR #83. The implementation PR for this spec must branch off `main` AFTER #83 merges (or rebase if branched earlier).

## Decisions

| Decision | Choice | Rationale |
| -------- | ------ | --------- |
| Enum scope | 7 values: `MARKETPLACE_AUTH_FAILED`, `MARKETPLACE_ACCESS_DENIED`, `MARKETPLACE_UNREACHABLE`, `SYNC_IN_PROGRESS`, `RATE_LIMITED`, `VALIDATION_ERROR`, `INTERNAL_ERROR` | Mirrors the just-shipped i18n set + the `errorCodeOf` sentinel — captures every value that legitimately reaches the column today |
| Migration shape | `CREATE TYPE` + `ALTER COLUMN ... USING CASE` with coercion fallback to `INTERNAL_ERROR` | Universally safe: pre-launch DBs are no-op, post-launch DBs preserve audit trail in `error_message` while sanitizing the column |
| Worker behavior | `errorCodeOf(err)` validates `.code` against `Object.values(SyncErrorCode)` BEFORE returning; unknown values become `INTERNAL_ERROR` | DB now rejects anything not in the enum — the worker is the load-bearing gate |
| `KNOWN_CODES` in `query-provider.tsx` | Out of scope | It's a UNION of SyncErrorCode + RFC 7807 generics (`UNAUTHENTICATED`, `FORBIDDEN`, `NETWORK_ERROR`, …); references but doesn't duplicate. A future `RfcProblemCode` enum could dedup the wider namespace — separate hardening |
| Icon-tone visual nit on terminal-failed rows | Out of scope | Cosmetic, separate sweep |

## Approach

### 1. Schema

`packages/db/prisma/schema.prisma` — add the enum, retype the column:

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

model SyncLog {
  // ...
  errorCode SyncErrorCode? @map("error_code")
  // ...
}
```

`pnpm db:generate` refreshes `@pazarsync/db/enums` (Prisma 7 emits both runtime const and type alias).

### 2. Migration

`packages/db/prisma/migrations/<timestamp>_add_sync_error_code_enum/migration.sql`:

```sql
CREATE TYPE "SyncErrorCode" AS ENUM (
  'MARKETPLACE_AUTH_FAILED', 'MARKETPLACE_ACCESS_DENIED',
  'MARKETPLACE_UNREACHABLE', 'SYNC_IN_PROGRESS',
  'RATE_LIMITED', 'VALIDATION_ERROR', 'INTERNAL_ERROR'
);

ALTER TABLE "sync_logs"
  ALTER COLUMN "error_code" TYPE "SyncErrorCode"
  USING (
    CASE
      WHEN "error_code" IS NULL THEN NULL
      WHEN "error_code" IN (
        'MARKETPLACE_AUTH_FAILED', 'MARKETPLACE_ACCESS_DENIED',
        'MARKETPLACE_UNREACHABLE', 'SYNC_IN_PROGRESS',
        'RATE_LIMITED', 'VALIDATION_ERROR', 'INTERNAL_ERROR'
      ) THEN "error_code"::"SyncErrorCode"
      ELSE 'INTERNAL_ERROR'::"SyncErrorCode"
    END
  );
```

`prisma migrate dev` may auto-generate a different SQL shape (DROP + CREATE, lossy). Inspect the generated file and replace with the handwritten USING-clause variant if Prisma chose the lossy path. The handwritten form preserves audit data and works in all environments.

### 3. Worker — the gate

`apps/sync-worker/src/index.ts` (replaces lines 193–203):

```ts
import { SyncErrorCode } from '@pazarsync/db/enums';

const SYNC_ERROR_CODE_VALUES: ReadonlySet<string> = new Set(Object.values(SyncErrorCode));

function isSyncErrorCode(value: string): value is SyncErrorCode {
  return SYNC_ERROR_CODE_VALUES.has(value);
}

function errorCodeOf(err: unknown): SyncErrorCode {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const code = (err as { code: unknown }).code;
    if (typeof code === 'string' && isSyncErrorCode(code)) return code;
  }
  return SyncErrorCode.INTERNAL_ERROR;
}
```

The narrowing from `string` to `SyncErrorCode` is the load-bearing change. Without it, the DB rejects inserts when caught errors carry non-enum `.code` values. The original error message stays in `error_message` for diagnostic continuity.

### 4. Domain error classes

`packages/sync-core/src/errors.ts` — replace literal strings with enum values across all six classes:

```ts
import { SyncErrorCode } from '@pazarsync/db/enums';

export class MarketplaceAuthError extends Error {
  readonly code = SyncErrorCode.MARKETPLACE_AUTH_FAILED;
  // constructor unchanged
}
// + MarketplaceAccessError, MarketplaceUnreachable, SyncInProgressError,
//   ValidationError, RateLimitedError — same pattern.
```

`apps/api/src/lib/problem-details.ts` already destructures `err.code` to build the RFC 7807 response — no change needed beyond TypeScript picking up the tighter type.

### 5. Validators / Zod 4

| File | Line | Change |
| ---- | ---- | ------ |
| `packages/sync-core/src/checkpoint.ts` | 48 | `errorCode: z.string()` → `errorCode: z.enum(SyncErrorCode)` |
| `apps/api/src/validators/product.validator.ts` | 67, 96 | `errorCode: z.string().nullable()` → `errorCode: z.enum(SyncErrorCode).nullable()` |
| `apps/api/src/validators/product.validator.ts` | 369, 387, 405 | TS interface declarations + property access — `errorCode: string \| null` → `errorCode: SyncErrorCode \| null` (driven automatically by the tightened Zod inference; explicit type aliases follow) |
| `apps/api/src/validators/product.validator.ts` | 430, 438 | hand-rolled runtime guards `typeof o['errorCode'] !== 'string'` → tighten to `Object.values(SyncErrorCode).includes(...)` or delete entirely (the Zod schema is now the contract) |
| `apps/sync-worker/src/skip-bad-page.ts` | 98 | string literal `'MARKETPLACE_UNREACHABLE'` → `SyncErrorCode.MARKETPLACE_UNREACHABLE` |
| `packages/sync-core/src/sync-log.service.ts` | 42, 300, 360 | `fail(id, errorCode: string, ...)` and internal callers → `errorCode: SyncErrorCode` |

### 6. Frontend dedup

`apps/web/src/features/sync/lib/format-sync-error.ts` (created in PR #83) — drop the hand-written tuple, derive from the canonical enum:

```ts
import { SyncErrorCode } from '@pazarsync/db/enums';
import { useTranslations } from 'next-intl';
import { useCallback } from 'react';

const KNOWN_SYNC_ERROR_CODE_SET: ReadonlySet<string> = new Set(Object.values(SyncErrorCode));

function isKnownSyncErrorCode(value: string): value is SyncErrorCode {
  return KNOWN_SYNC_ERROR_CODE_SET.has(value);
}

// (interface SyncErrorCopy + type SyncErrorFormatter unchanged)

export function useFormatSyncError(): SyncErrorFormatter {
  const t = useTranslations('syncCenter.errors');
  return useCallback(
    (code) => {
      if (code === null || code === undefined) return null;
      const key = isKnownSyncErrorCode(code) ? code : 'fallback';
      return { title: t(`${key}.title`), description: t(`${key}.description`) };
    },
    [t],
  );
}
```

The local `KNOWN_SYNC_ERROR_CODES` tuple and the `KnownSyncErrorCode` type alias (both in PR #83) get deleted. The shipped tests (`format-sync-error.test.tsx`, `sync-center.test.tsx`) keep passing — only the source of truth for the known-set changes.

## Files Touched

| Path | Change |
| ---- | ------ |
| `packages/db/prisma/schema.prisma` | add `enum SyncErrorCode`; retype `SyncLog.errorCode` |
| `packages/db/prisma/migrations/<timestamp>_add_sync_error_code_enum/migration.sql` | **NEW** — coerce-fallback migration |
| `packages/sync-core/src/errors.ts` | domain error classes import enum values |
| `packages/sync-core/src/sync-log.service.ts` | `fail()` arg type → `SyncErrorCode`; internal callers updated |
| `packages/sync-core/src/checkpoint.ts` | `z.string()` → `z.enum(SyncErrorCode)` |
| `apps/sync-worker/src/index.ts` | `errorCodeOf` validates against enum, returns `SyncErrorCode` |
| `apps/sync-worker/src/skip-bad-page.ts` | string literal → enum value |
| `apps/api/src/validators/product.validator.ts` | Zod schemas tightened; runtime guards reduced |
| `apps/web/src/features/sync/lib/format-sync-error.ts` | derive `KNOWN` from `Object.values(SyncErrorCode)` |
| `apps/sync-worker/tests/.../*.test.ts` | **NEW** assertion: unknown `.code` → `INTERNAL_ERROR` |

## Tests

- **Worker (regression lock)** — assert `errorCodeOf({ code: 'EAGAIN' })` returns `SyncErrorCode.INTERNAL_ERROR`. Assert `errorCodeOf({ code: 'MARKETPLACE_AUTH_FAILED' })` returns the matching enum value. Assert `errorCodeOf(null)` returns `INTERNAL_ERROR`.
- **API validators** — Zod parse rejection for an unknown code in the API response shape (typecheck + one runtime parse test).
- **Frontend** — `format-sync-error.test.tsx` already covers "unknown code → fallback"; passes through unchanged with the derived const.
- **Migration smoke** — seed a row with `error_code = 'EAGAIN'`, run the migration, assert the row's `error_code` becomes `'INTERNAL_ERROR'`.

## Verification

1. `pnpm typecheck` — every layer (db, sync-core, sync-worker, api, web) compiles cleanly.
2. **Migration on clean DB**: `supabase stop && supabase start` then `pnpm db:migrate` — no rows, no coercion, fast no-op pass.
3. **Migration on seeded-junk DB**: against a local Supabase, before applying the new migration, manually insert a row with `error_code = 'EAGAIN'` (a value the column currently accepts but the new enum rejects). Apply the migration. Assert the row's `error_code` becomes `'INTERNAL_ERROR'` and `error_message` is preserved.
4. `pnpm test` — repo-wide; the new worker test asserts the gate.
5. `pnpm audit:boundaries` — no new cross-feature imports.
6. Pre-PR gate: `pnpm check:full` (with Supabase local running).

## Out Of Scope

- `apps/web/src/providers/query-provider.tsx` `KNOWN_CODES` — references SyncErrorCode but is a UNION with RFC 7807 generics; not a duplicate. A future `RfcProblemCode` enum on the API side would unify the wider namespace.
- Icon-tone correction on terminal-failed sync rows.
- Generalizing into an `RfcProblemCode` enum exported from `@pazarsync/db` or `apps/api/src/lib/errors.ts`.

## Deploy Ordering

Single PR, single merge, single deploy:

1. Migration runs first — column type tightened, junk coerced.
2. Worker rolls out — from this point only enum-validated values reach the DB.
3. Web + API typecheck-aligned in the same PR's deploy artifact.

The `USING CASE` in step 1 already coerces in-flight rows, so there's no multi-stage rollout requirement.
