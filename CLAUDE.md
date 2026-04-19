# CLAUDE.md — PazarSync

## CRITICAL: Read Security Rules First

> **Before writing ANY code that touches user data, credentials, or cross-tenant boundaries, read [`docs/SECURITY.md`](docs/SECURITY.md).**
>
> PazarSync stores marketplace API credentials, customer PII, order data, and competitive cost intelligence for multiple independent businesses. Two non-negotiable invariants:
>
> 1. **Tenant isolation is absolute.** A user MUST NEVER see or modify data from an organization or store they are not authorized for. Enforced at three layers: middleware → RLS → schema. All three required.
> 2. **Credentials are never plaintext.** Marketplace API keys/secrets are encrypted with AES-256-GCM at rest, decrypted only in-memory for the duration of an API call, never logged, never returned in responses.
>
> Every query must filter by `organization_id`. Every store-scoped operation must verify the store belongs to the current org. Every PR involving these areas must pass the [Security Review Checklist](docs/SECURITY.md#9-security-review-checklist).

## Project Overview

Multi-tenant SaaS platform for Turkish e-commerce marketplace sellers. Connects to marketplace APIs (Trendyol, Hepsiburada), pulls financial data, and calculates real profitability at order and product level. Handles expense management, automatic settlement reconciliation, and cross-store reporting.

## Tech Stack

> **Always use the current latest version when adding a new dependency.** Run `npm view <pkg> version` (or check the package's docs site / `llms.txt`) to verify before installing. The versions below are the floor that the codebase is known-good against — Dependabot keeps minors/patches current automatically. Anything pinned to a specific major has a reason recorded in the **Version Pinning & Migration Roadmap** section right below this table; consult it before bumping.

| Layer               | Technology                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Monorepo**        | Turborepo 2.x + pnpm workspaces (pnpm 10.33)                                                                              |
| **Frontend**        | Next.js 16 (App Router), React 19.2, TypeScript 6.0                                                                       |
| **Styling**         | Tailwind CSS 4 (token-first), shadcn/ui, Hugeicons                                                                        |
| **Backend**         | Hono 4.x on Node.js (`@hono/node-server`)                                                                                 |
| **API Pattern**     | REST + Zod 4 validation                                                                                                   |
| **OpenAPI**         | `@hono/zod-openapi` 1.x — generates spec → `openapi-typescript` → typed `openapi-fetch` client in `@pazarsync/api-client` |
| **Data Fetching**   | TanStack React Query v5 (frontend), typed `openapi-fetch` client                                                          |
| **Database**        | Supabase (PostgreSQL 15)                                                                                                  |
| **ORM**             | Prisma 7 (`prisma-client` generator + `@prisma/adapter-pg`)                                                               |
| **Auth**            | Supabase Auth (email/password, OAuth); backend delegates token verification to `supabase.auth.getUser`                    |
| **Background Jobs** | Supabase Edge Functions + pg_cron                                                                                         |
| **Crypto**          | Node `crypto` (AES-256-GCM via `apps/api/src/lib/crypto.ts`)                                                              |
| **Money**           | `decimal.js` end-to-end — never floating point                                                                            |
| **Testing**         | Vitest 4 + React Testing Library + MSW v2 + happy-dom (NOT jsdom — see `apps/web/CLAUDE.md`)                              |
| **Package Manager** | pnpm 10.33 (Node ≥ 20.19)                                                                                                 |
| **Lint / Format**   | ESLint 9 (flat config) + Prettier 3 — ESLint 10 migration in roadmap                                                      |

## Version Pinning & Migration Roadmap

One major below is currently held back. It has a reason — do not bump on a whim, and do not let a fresh AI session reach for the latest just because it is "current." (pnpm 9→10, TypeScript 5.9→6, and the Zod 3→4 + `@hono/zod-openapi` 0.19→1 coupled bump were on this list; all migrated — see commit history.)

### Pinned

| Package  | Current | Latest | Why pinned                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------- | ------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `eslint` | 9.x     | 10.x   | **Blocked on upstream, not schedulable.** ESLint 10 removed `context.getFilename()` (now `context.filename`), which runtime-breaks `eslint-plugin-react@7.37.5` (`resolveBasedir` in its React version detector). That plugin is pulled in transitively through `eslint-config-next@16.2.4` along with `eslint-plugin-jsx-a11y@6.10.2` and `eslint-plugin-import@2.32.0` — none of them declare ESLint 10 peer support yet, and `eslint-plugin-react`'s `next` dist-tag (7.8.0-rc.0) is older than `latest`. For a Next.js codebase this blocks the whole migration; the only way forward is wait for the ecosystem to catch up (historically ~6 months after an ESLint major). Re-evaluate when `eslint-plugin-react@8.x` ships with ESLint 10 support. |

### Anti-pattern: bumping a pinned major in a feature PR

Pin removals get their own dedicated PR with the migration in the body. Mixing a Zod 4 bump into a "feat: add stores route" PR makes both the security review and the migration review impossible. If you find yourself reaching for a pinned major mid-feature, stop and open a separate migration PR first.

### Anti-pattern: chasing every patch

Dependabot opens grouped PRs for non-major bumps weekly (see `.github/dependabot.yml`). Do not run `pnpm update` ad-hoc — the grouped PRs are the audit trail. If a single bug fix is urgent, comment `@dependabot recreate` on the existing dev/prod-deps group PR rather than bypassing it.

### What "use the latest" means in practice

When adding a NEW dependency: install whatever `latest` resolves to (no `@x.y.z` pinning) and let Dependabot keep it current. When working with an EXISTING dependency from the table above: assume it is at the version listed unless you just ran `pnpm install` and read the lockfile. Use `pnpm --filter <pkg> ls <dep>` to confirm at any moment.

## Monorepo Structure

```
├── apps/
│   ├── web/              # Next.js 16 frontend (see apps/web/CLAUDE.md)
│   └── api/              # Hono backend server (see apps/api/CLAUDE.md)
├── packages/
│   ├── db/               # Prisma schema, client, migrations
│   ├── types/            # Shared TypeScript types (API contracts, domain models)
│   └── utils/            # Shared utilities (currency, date, validation)
├── supabase/
│   ├── functions/        # Edge Functions (marketplace sync workers)
│   └── sql/              # RLS policies, pg_cron setup, DB functions
├── docs/
│   ├── SECURITY.md       # CRITICAL: Tenant isolation, encryption, auth rules
│   ├── ARCHITECTURE.md   # System architecture, DB schema, API design
│   ├── PRODUCT_VISION.md # Product vision and requirements
│   └── integrations/
│       └── trendyol/     # Trendyol API documentation (Turkish)
├── turbo.json
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

## Documentation References

| Document                 | Path                            | When to Read                                                               |
| ------------------------ | ------------------------------- | -------------------------------------------------------------------------- |
| **Security Rules**       | **`docs/SECURITY.md`**          | **MUST READ before touching user data, credentials, or cross-tenant code** |
| Architecture & DB Schema | `docs/ARCHITECTURE.md`          | Before designing new features or modifying the DB                          |
| Product Vision           | `docs/PRODUCT_VISION.md`        | Before making UX or feature scope decisions                                |
| Trendyol API Docs        | `docs/integrations/trendyol/`   | **MUST READ** before any Trendyol integration work                         |
| Frontend Rules           | `apps/web/CLAUDE.md`            | When working in `apps/web/`                                                |
| Backend Rules            | `apps/api/CLAUDE.md`            | When working in `apps/api/`                                                |
| API Changelog            | `docs/api-changelog.md`         | When changing any route — log under `[Unreleased]`                         |
| Design Plans             | `docs/plans/`                   | When designing or implementing a non-trivial feature                       |
| Testing Patterns         | `docs/TESTING.md`               | When writing OR running tests                                              |
| RLS Policies             | `supabase/sql/rls-policies.sql` | When adding a tenant-scoped table or changing tenant access patterns       |

**Trendyol integration:** Before writing any Trendyol-related code, read the relevant files under `docs/integrations/trendyol/`. Key files:

- `2-authorization.md` — API authentication
- `7-trendyol-marketplace-entegrasyonu/siparis-entegrasyonlari.md` — Order sync
- `7-trendyol-marketplace-entegrasyonu/urun-entegrasyonlari-v2.md` — Product sync
- `8-trendyol-muhasebe-ve-finans-entegrasyonu/` — Settlement & invoice data

## Commands

```bash
# Install
pnpm install

# Development
pnpm dev                    # Start all apps (web + api)
pnpm dev --filter web       # Start frontend only
pnpm dev --filter api       # Start backend only

# Build
pnpm build                  # Build all apps
pnpm build --filter web     # Build frontend only
pnpm build --filter api     # Build backend only

# Database
pnpm db:generate            # Generate Prisma client
pnpm db:migrate             # Run migrations (dev)
pnpm db:push                # Push schema changes (dev)
pnpm db:seed                # Seed database
pnpm db:studio              # Open Prisma Studio

# Type checking
pnpm typecheck              # Type check all packages
pnpm lint                   # Lint all packages
pnpm format                 # Format all files

# Supabase
pnpm supabase:start         # Start local Supabase
pnpm supabase:functions     # Serve Edge Functions locally
```

## Architecture Principles

### Multi-Tenancy Model

```
User (auth.users)
  └── has many → OrganizationMember
        └── belongs to → Organization (tenant boundary)
              └── has many → Store (marketplace connection)
                    └── has many → Orders, Products, Settlements, SyncLogs
```

- **Organization** = tenant boundary. ALL data queries MUST include `organization_id`.
- **Store** = a marketplace account (e.g., one Trendyol seller account). Operational views are always store-scoped.
- **RLS** policies enforce organization isolation at the database level as defense-in-depth.
- Backend middleware handles auth + org context injection on every request.

### API URL Pattern

All org-scoped endpoints follow: `/api/v1/organizations/:orgId/...`
Store-scoped endpoints follow: `/api/v1/organizations/:orgId/stores/:storeId/...`

### Data Flow

```
Marketplace API → Supabase Edge Function (pg_cron) → PostgreSQL
PostgreSQL → Hono API (Prisma) → Next.js Frontend (React Query)
```

## Coding Standards (Shared)

These rules apply to ALL code in the monorepo — frontend, backend, and shared packages.

### TypeScript Discipline

- strict mode, no `any`, no `@ts-ignore`
- No type assertions (`as`) — prefer type guards and discriminated unions
- Explicit return types on exported functions/hooks
- Exhaustive switch/case with `default: never` for union types
- `as const` for static config objects

```typescript
// ❌ Bad — type assertion hides potential runtime errors
function getStoreCredentials(store: Store) {
  const creds = JSON.parse(store.credentials as string) as TrendyolCredentials;
  return creds;
}

// ✅ Good — type guard with runtime validation
function isTrendyolCredentials(value: unknown): value is TrendyolCredentials {
  return (
    typeof value === 'object' &&
    value !== null &&
    'apiKey' in value &&
    'apiSecret' in value &&
    'sellerId' in value
  );
}

function getStoreCredentials(store: Store): TrendyolCredentials {
  const parsed: unknown = JSON.parse(store.credentials);
  if (!isTrendyolCredentials(parsed)) {
    throw new StoreCredentialError(store.id, 'Invalid Trendyol credentials format');
  }
  return parsed;
}
```

```typescript
// ❌ Bad — non-exhaustive switch, missing cases silently ignored
function getOrderStatusLabel(status: OrderStatus): string {
  switch (status) {
    case 'DELIVERED':
      return 'Teslim Edildi';
    case 'SHIPPED':
      return 'Kargoda';
    default:
      return 'Bilinmiyor';
  }
}

// ✅ Good — exhaustive switch with never guard
function getOrderStatusLabel(status: OrderStatus): string {
  switch (status) {
    case 'PENDING':
      return t('order.status.pending');
    case 'PROCESSING':
      return t('order.status.processing');
    case 'SHIPPED':
      return t('order.status.shipped');
    case 'DELIVERED':
      return t('order.status.delivered');
    case 'CANCELLED':
      return t('order.status.cancelled');
    case 'RETURNED':
      return t('order.status.returned');
    default: {
      const _exhaustive: never = status;
      throw new Error(`Unhandled order status: ${_exhaustive}`);
    }
  }
}
```

### No Hard-Coded Values

- No magic numbers or strings — extract to named constants or enums
- Marketplace-specific values (commission rates, cargo types) go in config/DB
- API URLs, feature flags, limits from env vars or shared constants
- Turkish text always through i18n (next-intl), never inline

```typescript
// ❌ Bad — magic numbers and inline strings
function calculateProfit(order: Order): number {
  const commission = order.totalAmount * 0.2364;
  const shippingCost = order.desi > 3 ? 42.99 : 29.99;
  if (order.totalAmount < 150) {
    return order.totalAmount - commission - shippingCost - 5.99;
  }
  return order.totalAmount - commission - shippingCost;
}

// ✅ Good — named constants, configurable values
const MARKETPLACE_CONFIG = {
  TRENDYOL: {
    SERVICE_FEE_THRESHOLD: 150,
    DEFAULT_SERVICE_FEE: new Decimal('5.99'),
  },
} as const;

function calculateProfit(
  order: Order,
  commissionRate: Decimal,
  shippingTariff: ShippingTariff,
): Decimal {
  const commission = order.totalAmount.mul(commissionRate);
  const shippingCost = shippingTariff.getCost(order.desi);
  const serviceFee = order.totalAmount.lt(MARKETPLACE_CONFIG.TRENDYOL.SERVICE_FEE_THRESHOLD)
    ? MARKETPLACE_CONFIG.TRENDYOL.DEFAULT_SERVICE_FEE
    : new Decimal(0);

  return order.totalAmount.sub(commission).sub(shippingCost).sub(serviceFee);
}
```

### Simplicity First

- Early returns over deep nesting
- Single responsibility per function
- Flat over nested data structures
- No clever code — write for readability

```typescript
// ❌ Bad — deeply nested, hard to follow
async function syncOrders(store: Store): Promise<SyncResult> {
  if (store.isActive) {
    const credentials = await getCredentials(store.id);
    if (credentials) {
      try {
        const orders = await fetchOrders(credentials);
        if (orders.length > 0) {
          const saved = await saveOrders(store.id, orders);
          if (saved) {
            await updateSyncStatus(store.id, 'COMPLETED');
            return { success: true, count: orders.length };
          }
        }
        return { success: true, count: 0 };
      } catch (error) {
        await updateSyncStatus(store.id, 'FAILED');
        return { success: false, count: 0 };
      }
    }
    throw new Error('No credentials');
  }
  throw new Error('Store inactive');
}

// ✅ Good — early returns, flat structure
async function syncOrders(store: Store): Promise<SyncResult> {
  if (!store.isActive) {
    throw new StoreInactiveError(store.id);
  }

  const credentials = await getCredentials(store.id);
  if (!credentials) {
    throw new MissingCredentialsError(store.id);
  }

  const orders = await fetchOrders(credentials);
  if (orders.length === 0) {
    return { success: true, count: 0 };
  }

  try {
    await saveOrders(store.id, orders);
    await updateSyncStatus(store.id, 'COMPLETED');
    return { success: true, count: orders.length };
  } catch (error) {
    await updateSyncStatus(store.id, 'FAILED');
    throw new SyncFailedError(store.id, error);
  }
}
```

### Dynamic Mapping Over Repetition

- `Record<Key, Value>` lookup objects over switch chains
- Config-driven rendering — define shape once, vary data
- Map arrays for repeated structures, never copy-paste

```typescript
// ❌ Bad — switch chain for lookup
function getPlatformIcon(platform: Platform): string {
  switch (platform) {
    case 'TRENDYOL':
      return '/icons/trendyol.svg';
    case 'HEPSIBURADA':
      return '/icons/hepsiburada.svg';
    default:
      return '/icons/default.svg';
  }
}

// ✅ Good — Record lookup
const PLATFORM_ICONS: Record<Platform, string> = {
  TRENDYOL: '/icons/trendyol.svg',
  HEPSIBURADA: '/icons/hepsiburada.svg',
};

function getPlatformIcon(platform: Platform): string {
  return PLATFORM_ICONS[platform];
}
```

### Error Handling

- Never swallow errors (no empty catch blocks)
- User-facing errors in Turkish through i18n
- API errors follow RFC 7807 (Problem Details)
- Zod validation errors returned field-level

```typescript
// ❌ Bad — swallowed error, user sees nothing
async function connectStore(data: CreateStoreInput) {
  try {
    const result = await storesApi.create(orgId, data);
    return result;
  } catch (error) {
    console.log(error);
    return null;
  }
}

// ✅ Good — typed error, user-facing message, logged for debugging
async function connectStore(data: CreateStoreInput): Promise<Store> {
  try {
    return await storesApi.create(orgId, data);
  } catch (error) {
    if (error instanceof ApiError && error.status === 422) {
      throw new UserFacingError(t('stores.errors.invalidCredentials'));
    }
    logger.error('Failed to connect store', { orgId, platform: data.platform, error });
    throw new UserFacingError(t('common.errors.unexpected'));
  }
}
```

### File & Naming Conventions

- Files: `kebab-case.ts` / `kebab-case.tsx`
- Components: `PascalCase` name, `kebab-case` file
- Hooks: `use-` prefix, kebab-case file
- Types: `PascalCase` with purpose suffix (`OrderListResponse`, `CreateStoreInput`)
- Constants: `UPPER_SNAKE_CASE`
- No barrel exports except at package boundaries

```
// ❌ Bad
OrdersTable.tsx          → component file in PascalCase
useOrders.ts             → hook without kebab-case
types.ts                 → generic name
helpers.ts               → vague name

// ✅ Good
orders-table.tsx         → kebab-case file, exports OrdersTable
use-orders.ts            → kebab-case with use- prefix
order.types.ts           → domain-specific name
format-currency.ts       → descriptive name
```

## Testing

PazarSync uses a hybrid testing strategy — strict TDD for pure logic, test-with-code for routes/services, pragmatic for UI, MANDATORY for multi-tenancy invariants. See `docs/TESTING.md` for the full pattern library.

Non-negotiable rules:

- Every org-scoped endpoint MUST have a multi-tenancy isolation test in `apps/api/tests/integration/tenant-isolation/`. No exceptions.
- Every utility/pure function MUST have unit tests. TDD discipline (write test → see it fail → implement → see it pass).
- Every new endpoint MUST have at least one happy-path integration test in the SAME PR as the route code.
- Frontend hooks that fetch data MUST have a test using MSW. Components with user interaction (forms, modals) MUST have a component test.
- Never commit with failing tests, never commit with `it.skip` without a comment + tracked TODO.

Commands:

- `pnpm test:unit` — fast (no DB), run on every change
- `pnpm test:integration` — slow (needs `supabase start` + `pnpm db:push`), run before commits
- `pnpm test` — both
- `pnpm test:watch` — watch mode
- `pnpm check:all` — pre-commit gate: typecheck + lint + unit tests + format check (no DB)
- `pnpm check:full` — pre-PR gate: typecheck + lint + ALL tests + format check (needs Supabase local)

## No Utility Duplication

The same function must NEVER be defined in more than one place. Before writing a new utility:

1. Check `packages/utils/src/` — shared across the entire monorepo
2. Check `apps/web/src/lib/` — frontend-only utilities
3. Check `apps/api/src/lib/` — backend-only utilities

**Rules:**

- If both frontend and backend need it → `packages/utils/`
- If only frontend needs it → `apps/web/src/lib/`
- If only backend needs it → `apps/api/src/lib/`

```typescript
// ❌ Bad — formatCurrency defined in both apps
// apps/web/src/lib/format.ts
export function formatCurrency(val: number) { ... }
// apps/api/src/lib/format.ts
export function formatCurrency(val: number) { ... }

// ✅ Good — single source of truth
// packages/utils/src/currency.ts
export function formatCurrency(value: Decimal | string | number): string { ... }
// Used in both apps via: import { formatCurrency } from '@pazarsync/utils';
```

## Shared Packages

- `@pazarsync/db` — Prisma 7 client (generated to `../generated/prisma`), driver adapter (`@prisma/adapter-pg`), migration scripts
- `@pazarsync/types` — API request/response types, domain model interfaces, marketplace enums
- `@pazarsync/utils` — Currency formatting (TRY), date helpers, Zod schemas shared between frontend and backend

### Database (packages/db)

- Prisma 7: Generator is `prisma-client` (not `prisma-client-js`), output to `../generated/prisma`
- Prisma 7: Datasource config in `prisma.config.ts`, not in schema file
- Prisma 7: Driver adapter required — use `@prisma/adapter-pg` for PostgreSQL
- Prisma 7: ESM default — `"type": "module"` in package.json
- Prisma schema uses `@@map` for snake_case table names
- All tables with tenant data MUST have `organization_id` column with index
- Soft delete not used — hard delete with cascading
- `created_at` and `updated_at` on all tables
- Credentials stored as encrypted JSON (encryption at application layer)
- Use composite unique constraints for marketplace entity deduplication
- `Decimal.js` for monetary calculations, never floating point

```typescript
// ❌ Bad — floating point for money
const profit = order.totalAmount - order.commissionAmount - order.shippingCost;
// 100.10 - 23.64 - 29.99 = 46.46999999999999

// ✅ Good — Decimal.js for precision
const profit = order.totalAmount.sub(order.commissionAmount).sub(order.shippingCost);
// 100.10 - 23.64 - 29.99 = 46.47
```

## Environment Variables

```bash
# apps/web
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=   # sb_publishable_*, safe client-side
NEXT_PUBLIC_API_URL=           # Hono backend URL

# apps/api
DATABASE_URL=                  # Supabase PostgreSQL connection string
DIRECT_URL=                    # Supabase direct connection (for migrations)
SUPABASE_URL=
SUPABASE_SECRET_KEY=           # sb_secret_*, server-only (bypasses RLS)
TRENDYOL_BASE_URL=             # Marketplace API base URLs
HEPSIBURADA_BASE_URL=
ENCRYPTION_KEY=                # For encrypting store credentials

# supabase/functions
SUPABASE_URL=
SUPABASE_SECRET_KEY=
```

## Git Conventions

- Branch naming: `feature/xxx`, `fix/xxx`, `refactor/xxx`
- Commit messages: conventional commits (feat, fix, refactor, docs, chore)
- PR required for main branch
- No force push to main

## Verification

- After editing any source file, run the affected package's tests:
  - `pnpm --filter <package> test:unit` — for any logic change
  - `pnpm --filter <package> test:integration` — for any route, service, or DB query change (needs `supabase start`)
- After adding a new endpoint, write the integration test in the same PR. Do NOT merge route code without its test.
- After adding a new org-scoped endpoint, write the multi-tenancy isolation test in the same PR (see `docs/TESTING.md` § "Multi-Tenancy Test Pattern").
- **Before committing**: run `pnpm check:all` — typecheck + lint + unit tests + format check. Fast, no DB required.
- **Before opening a PR**: run `supabase start && pnpm check:full` — same as `check:all` plus the full integration suite. Mirrors what CI runs.
- Never commit with failing tests. If a test reveals a bug in your work, fix the bug — don't disable the test.
- Never commit with skipped tests (`it.skip`, `describe.skip`) without:
  - A code comment explaining why it's skipped, AND
  - A tracked issue/TODO with the unskip plan
- After ANY code edit to TypeScript/TSX files, run `npx tsc --noEmit` for the affected package before proceeding. Fix errors immediately — do not ask the user.

## Pre-Commit Skill Workflow

Before running `pnpm check:all`, apply skills in this order on all changed code:

1. Run `/simplify` on all changed code.
2. After `/simplify` finishes, run `/vercel-react-best-practices` on changed React/Next.js code, and `/postgres` on changed database code (if applicable).
3. After all skill fixes are done, run `pnpm check:all` and fix every error.

## Bug Fix Workflow

For any bug fix:

1. Read all relevant files first.
2. State the root cause and which layer (data vs rendering vs layout) is broken.
3. Fix autonomously — no approval needed.

## LLM Reference Docs

Pull current docs via `WebFetch` or the `context7` MCP server before writing code that touches a library API — Anthropic's training cutoff is January 2026 and these libs ship monthly.

- Hono: https://hono.dev/llms-full.txt
- Supabase: https://supabase.com/llms.txt
- Next.js: https://nextjs.org/llms.txt
- Prisma: https://prisma.io/llms.txt
- For everything else: `mcp__context7__query-docs` with the library name (React Query, Zod, Tailwind, Vitest, MSW, jose, react-hook-form, decimal.js, etc.) — do not rely on training-time memory for API shapes.
