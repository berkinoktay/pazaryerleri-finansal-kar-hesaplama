# Remove Unused `@pazarsync/types` Package — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the orphaned `packages/types/` workspace package and correct all references to it, leaving `@pazarsync/db` and `@pazarsync/api-client` as the sole sources of shared cross-app types.

**Architecture:** Pure refactor — no behavior changes. The package has zero import sites in `apps/`, so removal is a mechanical deletion plus cleanup of `package.json` dependency declarations, `next.config.ts`'s `transpilePackages` array, and three documentation files. Final verification is a full `pnpm check:all` pass plus successful `apps/web` build (the most sensitive check, since `transpilePackages` is changed).

**Tech Stack:** pnpm 10.33 workspaces, Turborepo, Next.js 16, TypeScript 6.

**Design spec:** [`docs/plans/2026-04-20-remove-unused-types-package-design.md`](./2026-04-20-remove-unused-types-package-design.md)

**Branch:** `refactor/remove-unused-types-package` (already created from `main`, design doc committed at `9cd2229`).

---

## Task 1: Pre-flight baseline verification

**Purpose:** Confirm the "zero imports" claim in the spec still holds at execution time (the state could have changed between design and execution). Also confirm the current working tree builds cleanly before any edits — this establishes that a post-change build failure is caused by our change, not by a pre-existing issue.

**Files:** none modified

- [ ] **Step 1: Verify zero source imports of `@pazarsync/types`**

Run:
```bash
grep -rE "from ['\"]@pazarsync/types['\"]" \
  --include='*.ts' --include='*.tsx' \
  apps/ packages/
```

Expected output: nothing (empty result, exit code 1 from grep). If any `.ts`/`.tsx` file in `apps/` or `packages/` imports from `@pazarsync/types`, STOP — the spec's foundational assumption is invalid, and tasks 2-5 are unsafe. Report the findings and revise the design.

- [ ] **Step 2: Verify current baseline typecheck + lint pass**

Run from repo root:
```bash
pnpm typecheck
pnpm lint
```

Expected: both exit 0. If either fails, the failure is pre-existing and must be fixed first (or acknowledged as unrelated). Do not proceed until the baseline is clean — otherwise verification in Task 3 cannot distinguish "we broke something" from "it was already broken".

- [ ] **Step 3: Verify current baseline build passes for both apps**

Run from repo root:
```bash
pnpm build --filter web
pnpm build --filter api
```

Expected: both exit 0. Same reasoning as Step 2.

**No commit in this task** — this is read-only verification.

---

## Task 2: Delete package source and clean dependency declarations

**Purpose:** Physically remove `packages/types/` and purge every `package.json` / Next.js config declaration that references it. After this task, the codebase no longer knows the package exists. Lockfile regenerates automatically.

**Files:**
- Delete: `packages/types/` (entire directory, including `src/`, `tsconfig.json`, `package.json`, `README.md`, `node_modules/`)
- Modify: `apps/api/package.json:25`
- Modify: `apps/web/package.json:20`
- Modify: `apps/web/next.config.ts:5`
- Regenerate: `pnpm-lock.yaml`

- [ ] **Step 1: Delete the `packages/types/` directory**

Run from repo root:
```bash
rm -rf packages/types
```

Verify:
```bash
ls packages/
```

Expected output (order may differ):
```
api-client
db
utils
```

If `types` still appears, re-run the `rm -rf`. If any other package vanishes, STOP and git-restore — the command targeted the wrong path.

- [ ] **Step 2: Remove `@pazarsync/types` from `apps/api/package.json`**

Edit `apps/api/package.json`. Remove the single line inside `"dependencies"`:

Before (showing surrounding context for uniqueness):
```json
    "@pazarsync/db": "workspace:*",
    "@pazarsync/types": "workspace:*",
    "@pazarsync/utils": "workspace:*",
```

After:
```json
    "@pazarsync/db": "workspace:*",
    "@pazarsync/utils": "workspace:*",
```

- [ ] **Step 3: Remove `@pazarsync/types` from `apps/web/package.json`**

Edit `apps/web/package.json`. Remove the single line inside `"dependencies"`:

Before:
```json
    "@pazarsync/api-client": "workspace:^",
    "@pazarsync/types": "workspace:*",
    "@pazarsync/utils": "workspace:*",
```

After:
```json
    "@pazarsync/api-client": "workspace:^",
    "@pazarsync/utils": "workspace:*",
```

- [ ] **Step 4: Remove `@pazarsync/types` from `apps/web/next.config.ts`**

Edit `apps/web/next.config.ts` line 5.

Before:
```ts
const nextConfig: NextConfig = {
  transpilePackages: ['@pazarsync/types', '@pazarsync/utils'],
};
```

After:
```ts
const nextConfig: NextConfig = {
  transpilePackages: ['@pazarsync/utils'],
};
```

- [ ] **Step 5: Regenerate the lockfile**

Run from repo root:
```bash
pnpm install
```

Expected output includes a line like "Progress: ... removed 1 package" (the `@pazarsync/types` workspace linkage is dropped). Exit 0.

If pnpm warns "lockfile is out of sync" and refuses, re-run without frozen-lockfile mode (the default for interactive `pnpm install` is non-frozen, so this should not happen; if it does, investigate before forcing).

- [ ] **Step 6: Verify the lockfile no longer contains workspace entries for the package**

Run:
```bash
grep -c "'@pazarsync/types'" pnpm-lock.yaml || true
```

Expected: `0` (or exit 1 from grep with no output). Any non-zero count indicates pnpm failed to purge the entry — re-run `pnpm install --force`.

**No commit in this task** — verification comes in Task 3 before we commit.

---

## Task 3: Verify code-level removal is clean

**Purpose:** Confirm nothing broke. Runs the same checks as the Task 1 baseline, now expected to still pass with the package gone. The `apps/web` build is the most sensitive check (the `transpilePackages` array was edited).

**Files:** none modified

- [ ] **Step 1: Typecheck both apps**

Run from repo root:
```bash
pnpm typecheck
```

Expected: exit 0. If any file reports "Cannot find module '@pazarsync/types'", there was an import site the grep in Task 1 missed — STOP, grep again with a broader pattern (`@pazarsync/types` without anchoring to `from`), and add that file to the spec before proceeding.

- [ ] **Step 2: Lint both apps**

Run from repo root:
```bash
pnpm lint
```

Expected: exit 0.

- [ ] **Step 3: Build `apps/web` — critical check**

Run from repo root:
```bash
pnpm build --filter web
```

Expected: exit 0. A Next.js build failure with "Module not found: Can't resolve '@pazarsync/types'" means the transpilePackages edit was correct but some other `apps/web` file still references the package — investigate before proceeding. A "type error in /tmp/.next/types/..." message means a generated route-types file has a stale reference; re-running `rm -rf apps/web/.next && pnpm build --filter web` should clear it.

- [ ] **Step 4: Build `apps/api`**

Run from repo root:
```bash
pnpm build --filter api
```

Expected: exit 0.

**No commit in this task** — commit happens in Task 5 after the docs are updated, so the commit represents a single coherent state.

---

## Task 4: Update documentation

**Purpose:** Three documentation files still describe `@pazarsync/types` as a live package. Update each to reflect the post-removal state. These edits are atomic with the code changes in Task 2 (they land in the same commit) — otherwise docs and code would be inconsistent at any intermediate SHA.

**Files:**
- Modify: `CLAUDE.md` (root, `## Shared Packages` section)
- Modify: `apps/web/CLAUDE.md:533`
- Modify: `docs/ARCHITECTURE.md` (two locations)

- [ ] **Step 1: Update root `CLAUDE.md` — remove bullet, add explanatory paragraph**

Edit `CLAUDE.md`. In the `## Shared Packages` section (around line 481), replace the three bullets with two bullets plus an explanatory paragraph.

Before:
```markdown
## Shared Packages

- `@pazarsync/db` — Prisma 7 client (generated to `../generated/prisma`), driver adapter (`@prisma/adapter-pg`), migration scripts
- `@pazarsync/types` — API request/response types, domain model interfaces, marketplace enums
- `@pazarsync/utils` — Currency formatting (TRY), date helpers, Zod schemas shared between frontend and backend
```

After:
```markdown
## Shared Packages

- `@pazarsync/db` — Prisma 7 client (generated to `../generated/prisma`), driver adapter (`@prisma/adapter-pg`), migration scripts
- `@pazarsync/utils` — Currency formatting (TRY), date helpers, Zod schemas shared between frontend and backend

**API request/response contracts** are generated into `@pazarsync/api-client` from backend Zod schemas (see `docs/plans/2026-04-16-api-docs-design.md`). **Domain enums** (Platform, OrderStatus, MemberRole, …) come from `@pazarsync/db` — Prisma 7 emits them as TypeScript types during `pnpm db:generate`.
```

- [ ] **Step 2: Update `apps/web/CLAUDE.md:533`**

Edit `apps/web/CLAUDE.md`. Update the comment in the feature module structure block.

Before:
```
└── types.ts             # Feature-specific types (if not in @pazarsync/types)
```

After:
```
└── types.ts             # Feature-specific types (if not in @pazarsync/api-client)
```

- [ ] **Step 3: Update `docs/ARCHITECTURE.md` — remove tree entry for `packages/types/`**

Edit `docs/ARCHITECTURE.md`. In § 3 Monorepo Structure, remove the `types/` block (approximately lines 280-288).

Before (exact block — match this verbatim):
```
│   ├── api-client/                   # Typed API client (openapi-fetch + openapi-typescript)
│   │   ├── openapi.json              # Committed snapshot of the OpenAPI 3.1 spec
│   │   ├── src/
│   │   │   ├── generated/            # Generated TS types (gitignored)
│   │   │   └── index.ts              # Re-exports paths/components + createApiClient
│   │   └── package.json              # Runs openapi-typescript via `pnpm codegen`
│   │
│   ├── types/                        # Shared types
│   │   ├── src/
│   │   │   ├── api.ts               # API request/response contracts
│   │   │   ├── models.ts            # Domain model interfaces
│   │   │   ├── marketplace.ts       # Platform enum, marketplace types
│   │   │   ├── enums.ts             # Shared enums
│   │   │   └── index.ts
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   └── utils/                        # Shared utilities
```

After:
```
│   ├── api-client/                   # Typed API client (openapi-fetch + openapi-typescript)
│   │   ├── openapi.json              # Committed snapshot of the OpenAPI 3.1 spec
│   │   ├── src/
│   │   │   ├── generated/            # Generated TS types (gitignored)
│   │   │   └── index.ts              # Re-exports paths/components + createApiClient
│   │   └── package.json              # Runs openapi-typescript via `pnpm codegen`
│   │
│   └── utils/                        # Shared utilities
```

- [ ] **Step 4: Update `docs/ARCHITECTURE.md:1031` — feature structure comment**

Edit `docs/ARCHITECTURE.md`. Update the comment in § 9 Frontend Architecture feature module structure.

Before:
```
└── types.ts           # Feature-specific types (if not in @pazarsync/types)
```

After:
```
└── types.ts           # Feature-specific types (if not in @pazarsync/api-client)
```

- [ ] **Step 5: Sanity check — verify no remaining `@pazarsync/types` references in live docs**

Run from repo root:
```bash
grep -rE "@pazarsync/types" \
  --include='*.md' \
  --exclude-dir=node_modules \
  CLAUDE.md apps/ docs/ packages/
```

Expected output: only matches inside `docs/plans/2026-04-16-api-docs-design.md` and `docs/plans/2026-04-20-remove-unused-types-package-design.md` (both historical/design documents; leave them alone per non-goal in the spec). Any hit in `CLAUDE.md`, `apps/web/CLAUDE.md`, `apps/api/CLAUDE.md`, or `docs/ARCHITECTURE.md` indicates a missed edit — fix before moving on.

**No commit in this task** — commit happens in Task 5.

---

## Task 5: Full gate verification and single commit

**Purpose:** Run the full pre-commit gate, then bundle every change from Tasks 2-4 into one atomic commit per the spec's rollback guarantee ("single commit, single revert").

**Files:** none modified (verification + commit only)

- [ ] **Step 1: Run full pre-commit gate**

Run from repo root:
```bash
pnpm check:all
```

Expected: exit 0. This runs typecheck + lint + unit tests + format check. No Supabase needed (integration tests not required for this refactor — no DB or route behavior changed).

If `pnpm check:all` fails on something unrelated to `@pazarsync/types` (e.g., a flaky pre-existing test), STOP and report. Do not silence or skip failures to get a green commit.

- [ ] **Step 2: Stage all changes**

Run from repo root:
```bash
git add -u                              # picks up package.json, next.config.ts, md edits, pnpm-lock.yaml
git add -A packages/types               # records the directory deletion
git status --short
```

Expected `git status --short` output (filenames may vary in order):
```
 M CLAUDE.md
 M apps/api/package.json
 M apps/web/CLAUDE.md
 M apps/web/next.config.ts
 M apps/web/package.json
 M docs/ARCHITECTURE.md
 M pnpm-lock.yaml
 D packages/types/.gitignore
 D packages/types/README.md
 D packages/types/package.json
 D packages/types/src/api.ts
 D packages/types/src/enums.ts
 D packages/types/src/index.ts
 D packages/types/src/marketplace.ts
 D packages/types/tsconfig.json
```

If any unexpected file appears (e.g., a `.turbo/` artifact), unstage it with `git restore --staged <file>` — the commit should contain ONLY the changes scoped to this refactor.

- [ ] **Step 3: Create the single refactor commit**

Run from repo root:
```bash
git commit -m "$(cat <<'EOF'
refactor: remove unused @pazarsync/types package

Zero import sites in apps/ or packages/ — the package's original
role (shared cross-app types) was taken over by:

- @pazarsync/api-client for request/response contracts (OpenAPI
  generated from backend Zod schemas)
- @pazarsync/db for domain enums (Prisma 7 generator output)

Marketplace adapter types are intentionally not re-homed; they will
be authored in apps/api/src/integrations/marketplace/types.ts when
the background-sync milestone begins, as already specified by
apps/api/CLAUDE.md.

Changes:
- Delete packages/types/ (entire directory)
- Remove @pazarsync/types dep from apps/api and apps/web
- Drop @pazarsync/types from apps/web/next.config.ts transpilePackages
- Update root CLAUDE.md, apps/web/CLAUDE.md, docs/ARCHITECTURE.md
- Regenerate pnpm-lock.yaml

See docs/plans/2026-04-20-remove-unused-types-package-design.md.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Pre-commit hooks (lint-staged + prettier) will run automatically. If a hook fails (unlikely — `pnpm check:all` in Step 1 already covered lint/format), investigate the hook output. Do NOT use `--no-verify` to skip; fix the underlying issue and re-stage + re-commit.

- [ ] **Step 4: Verify the commit landed cleanly**

Run:
```bash
git log -1 --stat
git status
```

Expected: latest commit shows ~8 files modified and ~7 deletions (from `packages/types/`), working tree clean.

- [ ] **Step 5: (Optional) Push the branch**

If ready to open a PR, run:
```bash
git push -u origin refactor/remove-unused-types-package
```

Do NOT open the PR automatically — wait for the user to confirm PR creation and title/body content.

---

## Post-plan notes

- **No tests added.** This refactor removes code that had zero callers; writing tests for "a deleted thing is still deleted" is busywork. `pnpm check:all` plus both `pnpm build` invocations provide sufficient coverage.
- **No changelog entry.** `@pazarsync/types` was never consumed; its removal has no user-facing or API-facing impact. `docs/api-changelog.md` describes HTTP contract changes, not internal workspace restructuring.
- **Turbo cache impact.** `turbo.json` does not reference `@pazarsync/types` by name — Turbo discovers packages from `pnpm-workspace.yaml` globs, so removing the directory automatically purges it from the dependency graph. No `turbo.json` edit needed.
