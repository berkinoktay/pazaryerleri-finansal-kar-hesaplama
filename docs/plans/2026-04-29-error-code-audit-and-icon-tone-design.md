# Error Code Audit + Terminal-Failed Icon Tone

## Context

PR #84 promoted `sync_log.error_code` to a typed `SyncErrorCode` Prisma enum and consolidated downstream consumers. Two follow-ups remain after that work:

1. **Drift detection for the broader error-code namespace.** The RFC 7807 error codes (`UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `INVALID_REFERENCE`, `RATE_LIMITED`, `INTERNAL_ERROR`, `NETWORK_ERROR`, `UNKNOWN_ERROR`) are NOT DB-backed, so they don't fit the SyncErrorCode-style Prisma enum approach. They live as string literals across **four loosely-coupled lists** (backend domain classes, `problem-details.ts` mapping, frontend `KNOWN_CODES` toast whitelist, `common.errors.*` translations in TR + EN). Each new code requires updating 4–5 places. Drift here is silent — a missing translation falls through to the `'generic'` fallback toast and nobody notices until a user reports unhelpful error copy. Full extraction into an `RfcProblemCode` enum is overkill at the project's current size; a CI audit script that detects drift is the high-value, low-effort middle ground.

2. **Icon tone for terminal-failed sync rows.** The `SyncCenter`'s `RecentSyncItem` component renders a terminal `FAILED` row with `AlertCircleIcon` (info-style ⓘ glyph) — visually reading as "warning" rather than "failure". Cosmetic, single-line fix.

The third originally-listed follow-up (move/remove `sync_log.error_message` column) is intentionally NOT included — without Sentry/Logtail, the column is the only audit trail for sync failures and pulling it would regress observability.

## Decisions

| Decision | Choice |
| -------- | ------ |
| **PR shape** | Single PR (`chore: post-#84 hygiene`) — both items are post-merge cleanup, combined diff is small (~150 lines audit + 5 lines icon) |
| **Audit strictness** | Hybrid (mirrors `audit-feature-boundaries`) — drift in critical pairs `error`, less critical `warn`, exit 1 on any error-severity edge |
| **Audit canonical-list policy** | Multi-source: scan both `packages/sync-core/src/errors.ts` and `apps/api/src/lib/errors.ts` for domain error class `code` literals; treat `apps/api/src/lib/problem-details.ts` `code:` literals as the OUTBOUND set the API can return; translations + KNOWN_CODES must cover the OUTBOUND set |
| **Silent codes** | `UNAUTHENTICATED` and `VALIDATION_ERROR` are intentionally absent from `KNOWN_CODES` (handled by SessionExpiredHandler + form inline errors, per `apps/web/CLAUDE.md`); the audit knows them via a `SILENT_CODES` set in its config |
| **Special i18n keys** | `'generic'` is a toast fallback marker, not a backend code — listed in `I18N_SPECIALS` |
| **Icon choice** | `CancelCircleIcon` (X in circle) from `hugeicons-react` — pairs symmetrically with the existing `CheckmarkCircle02Icon` (✓ in circle) for clean ✓ / ✗ semantics; `completedWithSkips` warning state continues to use `AlertCircleIcon` |
| **`RfcProblemCode` full extraction** | Out of scope — defer until 3+ new error codes accumulate or drift causes a real user-visible bug |

## Approach

### 1. Icon fix

`apps/web/src/components/patterns/sync-center.tsx` — `RecentSyncItem` icon ternary at line ~445:

```tsx
// Before
const Icon =
  log.status === 'FAILED'
    ? AlertCircleIcon
    : completedWithSkips
      ? AlertCircleIcon
      : CheckmarkCircle02Icon;

// After
const Icon =
  log.status === 'FAILED'
    ? CancelCircleIcon            // destructive ✗ — terminal failure
    : completedWithSkips
      ? AlertCircleIcon           // warning ⚠ — partial success
      : CheckmarkCircle02Icon;    // success ✓
```

Plus the import:
```tsx
import {
  AlertCircleIcon,
  CancelCircleIcon,
  CheckmarkCircle02Icon,
  PackageIcon,
  RefreshIcon,
  Time04Icon,
} from 'hugeicons-react';
```

`toneClass` (line ~447) already routes `text-destructive` for `FAILED` — color is correct, only the glyph was wrong. No other component or test changes.

### 2. Audit script

Mirror the `scripts/audit-feature-boundaries` three-file pattern:

```
scripts/
├── audit-error-codes.ts          # runner
├── audit-error-codes.config.ts   # SILENT_CODES + I18N_SPECIALS policy
└── audit-error-codes.types.ts    # types (Severity, ErrorCodeViolation, AuditReport)
```

#### Sources (parsed from disk per run — no codegen, no caching)

| Source | Parser | Output |
| ------ | ------ | ------ |
| `packages/sync-core/src/errors.ts` | regex `readonly code = (?:SyncErrorCode\.(\w+)\|'(\w+)' as const)` | `Set<string>` of domain-class codes (sync-core) |
| `apps/api/src/lib/errors.ts` | same regex | `Set<string>` of domain-class codes (api) |
| `apps/api/src/lib/problem-details.ts` | regex `code: (?:SyncErrorCode\.(\w+)\|'(\w+)')` (within `app.onError` / response builder branches) | `Set<string>` of OUTBOUND HTTP codes |
| `apps/web/src/lib/api-error.ts` | regex inside the `ApiError` constructor / fallback paths for `code: '(\w+)'` literals | `Set<string>` of CLIENT-emitted codes (`NETWORK_ERROR`, `UNKNOWN_ERROR`) |
| `apps/web/src/providers/query-provider.tsx` | regex inside the `KNOWN_CODES` Set initializer | `Set<string>` of toast pipeline whitelist |
| `apps/web/messages/tr.json` `common.errors.*` | `JSON.parse` + key extraction | `Set<string>` of TR translation keys |
| `apps/web/messages/en.json` `common.errors.*` | `JSON.parse` + key extraction | `Set<string>` of EN translation keys |

#### Drift edges

Let `S` = (errors.ts ∪ problem-details.ts ∪ api-error.ts client-emitted) — the union of "all codes that can ever reach a frontend `error.code`".

| Edge | Severity | Failure mode |
| ---- | -------- | ------------ |
| domain-class codes ⊄ `problem-details.ts` | **error** | Class throws but no RFC 7807 mapping — `app.onError` fallback returns 500 instead of typed code |
| `S` ⊄ TR translations | **error** | Server emits a code without a Turkish translation — toast falls to `'generic'` (silent UX bug) |
| TR keys ≠ EN keys | **error** | Language drift — EN users see the raw key string |
| `S` ⊄ (`KNOWN_CODES` ∪ `SILENT_CODES`) | **error** | Server emits a code that's neither toast-routed nor silenced — falls to generic toast |
| TR translations ⊄ (`S` ∪ `SILENT_CODES` ∪ `I18N_SPECIALS`) | **warn** | Orphaned translation key — no live consumer (clean-up candidate, not a bug) |

#### Config

`audit-error-codes.config.ts`:

```ts
// Codes intentionally absent from the global toast pipeline. The audit
// won't flag these as "missing in KNOWN_CODES" because they're handled
// by dedicated UI handlers, not a generic toast.
//
// - UNAUTHENTICATED: SessionExpiredHandler triggers sign-out + redirect
// - VALIDATION_ERROR: forms render field-level inline errors via
//   form.setError; a generic toast on top would be redundant.
export const SILENT_CODES: ReadonlySet<string> = new Set([
  'UNAUTHENTICATED',
  'VALIDATION_ERROR',
]);

// i18n keys under common.errors.* that don't correspond to a backend
// or client-emitted code. Audit accepts these without flagging.
//
// - generic: the fallback toast string when an unknown code is received.
export const I18N_SPECIALS: ReadonlySet<string> = new Set(['generic']);
```

Single-file policy — tune strictness here. Anti-pattern: editing the runner to silence a violation.

#### CLI

```
pnpm audit:errors           # human-readable text report
pnpm audit:errors --json    # machine-readable for CI parsing
```

Exit codes:
- `0` — no errors (warnings allowed)
- `1` — at least one error-severity violation
- `2` — script broke (missing source file, parse failure, etc.)

#### Wire-up

- `package.json` root scripts: add `"audit:errors": "tsx scripts/audit-error-codes.ts"`
- `package.json` `check:all` chain: prepend `pnpm audit:errors` after `audit:boundaries`
- CI (`.github/workflows/ci.yml`): no change needed if `check:all` is what CI runs; if CI runs the steps separately, add a job step

#### Tests

`scripts/__tests__/audit-error-codes.test.ts` (Vitest):

| Fixture | Expectation |
| ------- | ----------- |
| Clean state (current main + this branch's changes) | `errors: 0`, `warnings: 0`, exit 0 |
| Backend code without TR translation | error edge `S ⊄ TR` reported, exit 1 |
| TR/EN key drift | error edge `TR ≠ EN` reported, exit 1 |
| Backend code in neither `KNOWN_CODES` nor `SILENT_CODES` | error edge reported, exit 1 |
| Orphan translation key (not in `S` or any allow-list) | warn edge reported, exit 0 |

Fixtures live as inline string source in the test (mock filesystem), not as real-file edits.

## Files Touched

| Path | Change |
| ---- | ------ |
| `apps/web/src/components/patterns/sync-center.tsx` | Import `CancelCircleIcon`; swap glyph in `RecentSyncItem`'s FAILED branch |
| `scripts/audit-error-codes.ts` | **NEW** runner |
| `scripts/audit-error-codes.config.ts` | **NEW** policy (`SILENT_CODES`, `I18N_SPECIALS`) |
| `scripts/audit-error-codes.types.ts` | **NEW** types |
| `scripts/__tests__/audit-error-codes.test.ts` | **NEW** Vitest tests with fixture sources |
| `package.json` | Add `audit:errors` script + chain into `check:all` |

## Verification

1. **Audit clean against current state:** `pnpm audit:errors` reports `0 errors, 0 warnings` on the current branch (post-icon-swap).
2. **Audit unit tests:** `pnpm vitest run scripts/__tests__/audit-error-codes.test.ts` — all fixtures pass with expected severity.
3. **Negative test (manual sanity):** temporarily delete a key from `apps/web/messages/tr.json` `common.errors.*` and re-run `pnpm audit:errors` — confirms an error-severity edge fires; restore the key.
4. **Pre-PR gate:** `pnpm check:all` — typecheck + lint + tests + format + boundary audit + error-code audit, all green.
5. **Visual check:** dev server, dashboard with a seeded FAILED sync row → terminal-failed row renders with red ✗ in circle, not info-style ⓘ.

## Out Of Scope

- Full `RfcProblemCode` enum extraction (defer until pain felt — see Context).
- Removing or relocating `sync_log.error_message` column (without Sentry, the column is the only audit trail; keep).
- Changes to the existing `audit-feature-boundaries` script.
- i18n auto-completion tooling, fuzzy-match suggestions, or any kind of "fix this drift for me" automation — the audit reports drift; humans decide and edit.

## Deploy Ordering

Single PR, single merge, single deploy:

1. Icon swap is purely client-side. No coordination needed.
2. Audit script is dev tooling; runs locally + in CI. Doesn't affect runtime.

The PR ships the audit at `0 errors, 0 warnings` baseline. Subsequent PRs that introduce drift will fail CI until the drift is resolved — that's the whole point.
