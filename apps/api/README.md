# @pazarsync/api

Hono-based REST backend for PazarSync. Multi-tenant API for managing organizations, stores, marketplace credentials, and the financial data pipeline (orders, settlements, profitability).

> **Coding rules: [`CLAUDE.md`](./CLAUDE.md)** — mandatory reading. Covers route architecture, middleware chain, multi-tenancy enforcement, OpenAPI conventions, marketplace adapter pattern, and forbidden patterns.
>
> **Security: [`docs/SECURITY.md`](../../docs/SECURITY.md)** — mandatory before any auth, credential, or tenant-scoped work. Every PR touching these areas must pass the Security Review Checklist.

## Stack

- **Framework:** [Hono](https://hono.dev) on Node.js (`@hono/node-server`)
- **OpenAPI:** `@hono/zod-openapi@1.x`
- **Validation:** Zod 4 + `@hono/zod-validator`
- **ORM:** Prisma 7 (`prisma-client` generator + `@prisma/adapter-pg`) — see [`@pazarsync/db`](../../packages/db)
- **Auth:** Supabase JWT verification _(middleware planned)_
- **Money:** `decimal.js` — never floating point
- **Testing:** Vitest + real Postgres (no Prisma mocks in integration tests)

## Develop

From the repo root:

```bash
pnpm dev --filter api       # http://localhost:3001
```

Standalone (inside `apps/api/`):

```bash
pnpm dev                    # tsx watch
pnpm typecheck
pnpm lint
pnpm test:unit              # fast — no DB
pnpm test:integration       # needs `supabase start` + `pnpm db:push` first
pnpm openapi:dump           # write packages/api-client/openapi.json
```

## API Documentation

Spec is auto-generated from Zod schemas via `@hono/zod-openapi`. In dev/staging:

- **Spec:** <http://localhost:3001/v1/openapi.json>
- **Scalar UI:** <http://localhost:3001/v1/docs>

Both endpoints are gated on `NODE_ENV !== "production"`.

The committed [`packages/api-client/openapi.json`](../../packages/api-client/openapi.json) snapshot drives codegen for the typed frontend client. After any route change:

```bash
pnpm api:sync               # from repo root — regenerates spec + client types
```

CI rejects PRs where the snapshot drifts from the registered routes. Log the change in [`docs/api-changelog.md`](../../docs/api-changelog.md) under `[Unreleased]`.

## Folder Layout

```
src/
├── routes/                 Route definitions (createRoute + app.openapi)
├── services/               Business logic — Prisma-backed
├── validators/             Zod schemas with .openapi() metadata
├── integrations/
│   └── marketplace/        Marketplace adapters (Trendyol, Hepsiburada)
├── openapi/                Shared OpenAPI components (errors, pagination, rate-limit, security)
├── middleware/             auth, orgContext, rateLimit
├── lib/                    Backend-only utilities
├── scripts/
│   └── dump-openapi.ts     Build-time spec writer
└── index.ts                App bootstrap + middleware chain

tests/
├── unit/                   Pure logic — no DB
├── integration/
│   ├── routes/             Hono routes via app.request() — real DB
│   └── tenant-isolation/   CRITICAL — multi-tenancy invariants
└── helpers/                db (truncateAll, ensureDbReachable), factories
```

## Environment

```
DATABASE_URL=               # Supabase Postgres
DIRECT_URL=                 # Direct connection (for migrations)
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
JWT_SECRET=                 # Supabase JWT secret
TRENDYOL_BASE_URL=
HEPSIBURADA_BASE_URL=
ENCRYPTION_KEY=             # AES-256-GCM key for marketplace credentials
```

See repo-root [`.env.example`](../../.env.example) for the full set.

## Multi-Tenancy

Every database query MUST filter by `organizationId`, injected by `orgContextMiddleware` from the URL path (`/v1/organizations/:orgId/...`). Every store-scoped operation MUST verify the store belongs to the current org. Every new org-scoped endpoint MUST ship with a tenant-isolation test in `tests/integration/tenant-isolation/`. No exceptions — see [`docs/TESTING.md`](../../docs/TESTING.md).
