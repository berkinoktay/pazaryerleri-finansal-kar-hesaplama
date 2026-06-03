# AGENTS.md — PazarSync

This is the **shared, tool-agnostic brief** for any AI coding agent (Cursor, Codex, Aider, Gemini, Copilot, …). It is intentionally short: identity, the non-negotiable rules, an accurate map of the repo, and pointers to the deep docs. **Claude Code agents:** the canonical, far more detailed playbooks live in `CLAUDE.md`, `apps/web/CLAUDE.md`, and `apps/api/CLAUDE.md` — read those; this file is the cross-tool summary, not a replacement.

## What PazarSync is

A multi-tenant SaaS for Turkish e-commerce marketplace sellers (Trendyol, Hepsiburada, …). It connects to marketplace APIs, pulls financial data (orders, returns, commissions, cargo invoices, settlements), and computes **real profitability** at the order and product level — the question a seller can't answer from a marketplace dashboard alone: _"how much did I actually make?"_ It also handles expense management and automatic settlement reconciliation across multiple stores.

Tenancy model: `User → OrganizationMember → Organization (tenant boundary) → Store (one marketplace account) → Orders / Products / Settlements / SyncLogs`. An organization is the hard tenant boundary; operational screens are always scoped to one selected store. See `docs/PRODUCT_VISION.md` for the product narrative.

## The two non-negotiable invariants

> **Before writing ANY code that touches user data, credentials, or cross-tenant boundaries, read `docs/SECURITY.md`.**

1. **Tenant isolation is absolute.** A user must NEVER see or modify data from an organization/store they aren't authorized for. Enforced at three layers — backend middleware → Postgres RLS → schema. **Every query filters by `organization_id`**; every store-scoped operation verifies the store belongs to the current org. RLS policies ship in the **same PR** as the feature, never deferred.
2. **Credentials are never plaintext.** Marketplace API keys/secrets are encrypted with **AES-256-GCM** at rest, decrypted only in-memory for the duration of an API call, never logged, never returned in responses.

## Universal coding rules

These apply to every package, frontend and backend:

- **Money:** `decimal.js` end-to-end — never floating point. `Decimal` in services, **string** on the API wire.
- **TypeScript:** strict mode. No `any`, no `as` assertions, no `@ts-ignore`. Explicit return types on exported functions. Exhaustive `switch` with a `default: never` guard on unions.
- **Turkish copy:** all user-facing text goes through `next-intl` (frontend). Backend errors are English, machine-readable codes (RFC 7807 Problem Details) — the frontend localizes from the `code`. Never put Turkish in backend messages.
- **No hard-coded values:** no magic numbers/strings. Marketplace parameters (commission baremler, desi limits, fee thresholds) live in **DB rows**, never baked into enum names or code.
- **No utility duplication:** shared → `packages/utils`; web-only → `apps/web/src/lib`; api-only → `apps/api/src/lib`. Check before writing a new helper.
- **Domain enums** (Platform, OrderStatus, MemberRole, …) live exactly once in the Prisma schema and are imported from `@pazarsync/db` — never re-declared as string-literal unions.
- **Naming:** `kebab-case` files, `PascalCase` components, `use-` hooks, `UPPER_SNAKE_CASE` constants. No barrel exports except at package boundaries.
- **Errors:** never swallow. Throw typed domain errors on the backend; let the frontend's global handler localize. No empty catch blocks.
- **Feature boundaries (web):** `apps/web/src/features/<X>/` is a private vertical slice. No `features/<X>` may import from `features/<Y>` — promote shared symbols to `src/lib` / `src/components/patterns` / `packages/*`. Enforced by `pnpm audit:boundaries`.

## Testing (mandatory minimums)

- Every org-scoped endpoint **must** have a multi-tenancy isolation test in `apps/api/tests/integration/tenant-isolation/`. No exceptions.
- Every new endpoint ships its happy-path integration test in the **same PR**. Every tenant-scoped table ships its RLS test.
- Pure functions: unit tests, TDD. Frontend data hooks: tested via **MSW** (never mock the API client). Interactive components: a component test.
- Vendor contracts: mock tests prove _our_ contract, not the marketplace's — validate against the real API in a stage round-trip before closing an integration epic.
- Full pattern library: `docs/TESTING.md`.

## Monorepo layout

Turborepo + pnpm workspaces, Node 20+. (Exact tool versions live in `package.json` / the root `CLAUDE.md` tech-stack table.)

```
apps/
  web/          Next.js 16 frontend (App Router, React 19, Tailwind v4)  → apps/web/CLAUDE.md
  api/          Hono REST backend (Prisma 7, Zod 4, OpenAPI 3.1)          → apps/api/CLAUDE.md
  sync-worker/  Long-running worker: polls the SyncLog queue, claims jobs,
                runs marketplace sync handlers (orders/products/settlements/fx) in chunks
packages/
  db/           Prisma 7 schema + client (→ generated/prisma) + migrations + domain enums
  utils/        Shared utils: currency (TRY), dates, business-timezone, cursor, permissions, validation
  api-client/   Typed API contracts — backend OpenAPI → openapi-fetch client. Cross-app types live here
  marketplace/  Marketplace adapters (Trendyol, Hepsiburada) + MarketplaceAdapter interface + registry
  sync-core/    Sync primitives: job claim, checkpoint, crypto, logger, sync-log service, prisma-error map
  order-sync/   Idempotent order upsert (marketplace payload → domain Order)
  profit/       Profit engine: formula, on-create estimates, settlement reconcile, fee resolution
supabase/
  functions/    Edge Functions for marketplace sync (sync-trendyol, sync-hepsiburada, fx-rates-sync)
  sql/          RLS policies, pg_cron setup, DB functions
docs/            Local-only knowledge base (gitignored): SECURITY, ARCHITECTURE, PRODUCT_VISION, plans, integrations
```

API URL shape: org-scoped `/api/v1/organizations/:orgId/...`, store-scoped `/api/v1/organizations/:orgId/stores/:storeId/...`.

## Commands

```bash
pnpm install
pnpm dev                         # all apps (web + api)         · --filter web | api to narrow
pnpm build                       # all apps
pnpm typecheck                   # type-check every package
pnpm lint                        # ESLint 9 (flat config)
pnpm db:push                     # apply Prisma schema to local DB
pnpm db:seed                     # seed
pnpm api:sync                    # regenerate the OpenAPI spec + typed api-client (run after backend route changes)

pnpm test:unit                   # fast, no DB — run on every change
supabase start && pnpm test:integration   # needs local Postgres (port 54322) + pnpm db:push first

pnpm check:all                   # pre-commit gate — static checks + fast tests + audits, no DB
pnpm check:full                  # pre-PR gate — check:all plus the integration suite (needs `supabase start`)
```

## Before touching a marketplace integration

Trendyol API docs live under `docs/integrations/trendyol/` (Turkish) — **read the relevant file first**: `2-authorization.md` (auth), `7-trendyol-marketplace-entegrasyonu/siparis-entegrasyonlari.md` (orders), `.../urun-entegrasyonlari-v2.md` (products), `8-trendyol-muhasebe-ve-finans-entegrasyonu/` (settlements). The vendor's chosen endpoint for a workload is an architectural constraint, not a suggestion.

## Git

Branch (`feature/xxx`, `fix/xxx`, `refactor/xxx`) + PR for everything — never commit directly to `main`. Conventional commits (`feat`, `fix`, `refactor`, `docs`, `chore`).

## Deeper docs

| Topic                    | Path                     |
| ------------------------ | ------------------------ |
| **Security (mandatory)** | `docs/SECURITY.md`       |
| Architecture & DB schema | `docs/ARCHITECTURE.md`   |
| Product vision           | `docs/PRODUCT_VISION.md` |
| Testing patterns         | `docs/TESTING.md`        |
| Frontend playbook        | `apps/web/CLAUDE.md`     |
| Backend playbook         | `apps/api/CLAUDE.md`     |
| Shared standards         | `CLAUDE.md` (root)       |
