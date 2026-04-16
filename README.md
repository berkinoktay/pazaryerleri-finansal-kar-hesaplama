# PazarSync

> Türkiye pazaryeri satıcıları için sipariş bazında gerçek karlılık platformu.
> _Real per-order profitability for Turkish marketplace sellers._

PazarSync, Trendyol ve Hepsiburada gibi pazaryerlerinde satış yapan işletmelerin "bu ay gerçekten ne kadar kazandım?" sorusunu sipariş ve ürün seviyesinde, doğrulanmış olarak cevaplamasını sağlayan çok kiracılı (multi-tenant) bir SaaS platformudur. Komisyon, kargo, platform bedeli, KDV ve operasyonel maliyetleri otomatik birleştirip net kâr hesaplar; pazaryeri hakediş raporlarıyla otomatik mutabakat yapar.

Detaylı ürün vizyonu için [`docs/PRODUCT_VISION.md`](docs/PRODUCT_VISION.md).

---

## Tech Stack

| Layer               | Technology                                                  |
| ------------------- | ----------------------------------------------------------- |
| **Monorepo**        | Turborepo + pnpm workspaces                                 |
| **Frontend**        | Next.js 16 (App Router) · React 19.2 · TypeScript 5         |
| **Styling**         | Tailwind CSS 4 · shadcn/ui · Hugeicons                      |
| **Backend**         | Hono on Node.js · `@hono/zod-openapi`                       |
| **API Pattern**     | REST · OpenAPI 3.1 · Zod validation · cursor pagination     |
| **Data fetching**   | TanStack React Query v5 · typed `openapi-fetch` client      |
| **Database**        | Supabase (PostgreSQL 15) · RLS for tenant isolation         |
| **ORM**             | Prisma 7 (`prisma-client` generator + `@prisma/adapter-pg`) |
| **Auth**            | Supabase Auth (email/password, OAuth)                       |
| **Background jobs** | Supabase Edge Functions + `pg_cron`                         |
| **Testing**         | Vitest · React Testing Library · MSW v2 · happy-dom         |

---

## Monorepo Structure

```
.
├── apps/
│   ├── web/                Next.js 16 frontend                (see apps/web/CLAUDE.md)
│   └── api/                Hono backend                        (see apps/api/CLAUDE.md)
├── packages/
│   ├── db/                 Prisma 7 schema + client + migrations
│   ├── types/              Shared TypeScript types (API contracts, domain models)
│   ├── utils/              Currency / date / cursor / validation helpers
│   └── api-client/         Typed openapi-fetch client (codegen from apps/api)
├── supabase/
│   ├── functions/          Edge Functions (sync workers)
│   └── sql/                RLS policies, pg_cron, DB functions
├── docs/                   Architecture, security, API, integration docs
└── .github/workflows/      CI: typecheck · lint · tests · OpenAPI sync
```

---

## Getting Started

### Prerequisites

- **Node.js** ≥ 20.19
- **pnpm** ≥ 9.15
- **Docker** (or [OrbStack](https://orbstack.dev)) — required by `supabase start`
- **Supabase CLI** — `brew install supabase/tap/supabase`

### Install

```bash
pnpm install
cp .env.example .env        # then fill in the values (see .env.example)
```

### Start the local stack

```bash
supabase start              # local Postgres + Auth on ports 54321/54322
pnpm db:push                # apply Prisma schema to local DB
pnpm dev                    # web (3000) + api (3001) in parallel
```

API docs (dev only): <http://localhost:3001/v1/docs> · spec: <http://localhost:3001/v1/openapi.json>

### Common scripts

```bash
pnpm dev                    # all apps
pnpm dev --filter web       # frontend only
pnpm dev --filter api       # backend only

pnpm db:generate            # regenerate Prisma client
pnpm db:push                # push schema to dev DB
pnpm db:studio              # open Prisma Studio

pnpm api:sync               # regenerate OpenAPI spec + typed client

pnpm test:unit              # fast — no DB
pnpm test                   # full — needs `supabase start`
pnpm check:all              # pre-commit gate (typecheck + lint + unit + format)
pnpm check:full             # pre-PR gate  (above + integration tests)
```

---

## Documentation

| Document                                                    | When to read                                                               |
| ----------------------------------------------------------- | -------------------------------------------------------------------------- |
| **[`docs/SECURITY.md`](docs/SECURITY.md)**                  | **Mandatory** before touching user data, credentials, or tenant boundaries |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)              | Before designing a feature or modifying the DB schema                      |
| [`docs/PRODUCT_VISION.md`](docs/PRODUCT_VISION.md)          | Before scoping or making UX decisions                                      |
| [`docs/TESTING.md`](docs/TESTING.md)                        | Before writing or running tests                                            |
| [`docs/api-changelog.md`](docs/api-changelog.md)            | When changing any API route                                                |
| [`docs/integrations/trendyol/`](docs/integrations/trendyol) | **Mandatory** before any Trendyol integration work                         |
| [`CLAUDE.md`](CLAUDE.md)                                    | Shared coding standards (TypeScript discipline, error handling, naming)    |
| [`apps/web/CLAUDE.md`](apps/web/CLAUDE.md)                  | Frontend rules (React Query, MSW, happy-dom, Next.js 16 specifics)         |
| [`apps/api/CLAUDE.md`](apps/api/CLAUDE.md)                  | Backend rules (route architecture, multi-tenancy enforcement, OpenAPI)     |

---

## Architecture at a Glance

```
User → Organization (tenant boundary) → Store (one marketplace account)
                                          └── Orders / Products / Settlements / SyncLogs
```

- **Organization** = tenant boundary. Every query MUST filter by `organizationId`.
- **Store** = a single marketplace account (e.g. one Trendyol seller). Operational pages are always store-scoped.
- **Three-layer isolation:** middleware (org context) → RLS policies → schema constraints. All three required.
- **Credentials** are encrypted at rest with AES-256-GCM, decrypted only in-memory inside marketplace adapters.

```
Marketplace API ── Edge Function (pg_cron) ──▶ PostgreSQL
PostgreSQL  ── Hono API (Prisma) ──▶ Next.js (React Query)
```

Full schema and request lifecycle in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## Contributing

This is a private project. Internal workflow:

- Branch naming: `feature/...`, `fix/...`, `refactor/...`, `docs/...`
- Conventional commits (`feat:`, `fix:`, `refactor:`, `docs:`, `chore:`)
- All changes go through PR — `main` is protected
- Run `pnpm check:full` (with Supabase running) before opening a PR; CI mirrors this

---

## License

Proprietary — all rights reserved. Not licensed for third-party use.
