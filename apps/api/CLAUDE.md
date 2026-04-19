# CLAUDE.md — PazarSync Backend

> See also: root `CLAUDE.md` for shared coding standards, and `docs/ARCHITECTURE.md` for system architecture.

## CRITICAL: Security First

> **`docs/SECURITY.md` is mandatory reading.** The backend is the enforcement point for tenant isolation and credential security. Every route, service, and DB query you write must satisfy:
>
> 1. **Tenant isolation** — every query filters by `organizationId` from the request context (set by `orgContextMiddleware`). Cross-tenant data leak = critical bug.
> 2. **Store authorization** — store-scoped queries verify the store belongs to the current org before returning data.
> 3. **Credential encryption** — marketplace API keys are stored encrypted (AES-256-GCM), decrypted only inside marketplace adapters, never logged, never returned in API responses.
> 4. **Role enforcement** — destructive or sensitive actions are gated by `requireRole()` middleware on the backend, not the frontend.
>
> See [`docs/SECURITY.md`](../../docs/SECURITY.md) for full rules, enforcement patterns, and the Security Review Checklist.

## Marketplace Integration References

**Before writing ANY Trendyol-related code, you MUST read the relevant documentation:**

| Task               | Read First                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------- |
| Order sync         | `docs/integrations/trendyol/7-trendyol-marketplace-entegrasyonu/siparis-entegrasyonlari.md` |
| Product sync       | `docs/integrations/trendyol/7-trendyol-marketplace-entegrasyonu/urun-entegrasyonlari-v2.md` |
| Settlement/finance | `docs/integrations/trendyol/8-trendyol-muhasebe-ve-finans-entegrasyonu/`                    |
| Returns/refunds    | `docs/integrations/trendyol/7-trendyol-marketplace-entegrasyonu/iade-entegrasyonu/`         |
| Auth/API keys      | `docs/integrations/trendyol/2-authorization.md`                                             |
| Rate limits        | `docs/integrations/trendyol/1-servis-limitleri.md`                                          |
| Error codes        | `docs/integrations/trendyol/7-trendyol-marketplace-entegrasyonu/hata-kodlari.md`            |

## Route Architecture

Feature-based folder structure. Each route module has its own route, service, validator, and types:

```
src/
├── routes/
│   ├── order.routes.ts          # Route definitions, delegates to service
│   ├── product.routes.ts
│   ├── store.routes.ts
│   └── ...
├── services/
│   ├── order.service.ts         # Business logic, uses Prisma
│   ├── product.service.ts
│   └── ...
├── validators/
│   ├── order.validator.ts       # Zod schemas for request validation
│   ├── store.validator.ts
│   └── ...
├── integrations/
│   └── marketplace/             # Marketplace API adapters
│       ├── types.ts             # Common MarketplaceAdapter interface
│       ├── trendyol/
│       │   ├── client.ts
│       │   ├── mapper.ts
│       │   └── types.ts
│       └── hepsiburada/
│           ├── client.ts
│           ├── mapper.ts
│           └── types.ts
├── openapi/                     # Shared OpenAPI components (errors, pagination, rate-limit, security)
├── scripts/
│   └── dump-openapi.ts          # Build-time spec writer → packages/api-client/openapi.json
├── middleware/
├── lib/
└── index.ts
```

```typescript
// ❌ Bad — business logic in route handler
app.get('/orders', async (c) => {
  const orgId = c.get('organizationId');
  const orders = await prisma.order.findMany({
    where: { organizationId: orgId },
    include: { items: true },
  });
  const withProfit = orders.map((o) => ({
    ...o,
    profit: Number(o.totalAmount) - Number(o.commissionAmount) - Number(o.shippingCost),
  }));
  return c.json({ data: withProfit });
});

// ✅ Good — route delegates to service
// routes/order.routes.ts
app.get('/orders', zValidator('query', orderListSchema), async (c) => {
  const filters = c.req.valid('query');
  const orgId = c.get('organizationId');
  const storeId = c.req.param('storeId');
  const result = await orderService.list(orgId, storeId, filters);
  return c.json(result);
});

// services/order.service.ts
export async function list(
  orgId: string,
  storeId: string,
  filters: OrderListInput,
): Promise<PaginatedResponse<OrderWithProfit>> {
  const orders = await prisma.order.findMany({
    where: { organizationId: orgId, storeId, ...buildFilters(filters) },
    include: { items: true },
    ...buildPagination(filters),
  });
  return toPaginatedResponse(orders.map(calculateOrderProfit), filters);
}
```

## Middleware Chain

Every request passes through this middleware chain in order:

```
cors → logger → auth → orgContext → rateLimit → handler
```

```typescript
// ❌ Bad — auth check inside route handler
app.get('/orders', async (c) => {
  const token = c.req.header('Authorization');
  if (!token) return c.json({ error: 'Unauthorized' }, 401);
  const user = await verifyToken(token);
  if (!user) return c.json({ error: 'Invalid token' }, 401);
  // ... then check org membership manually
});

// ✅ Good — middleware handles auth + org context
// middleware/auth.middleware.ts
export const authMiddleware = createMiddleware(async (c, next) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '');
  if (!token) throw new UnauthorizedError();
  const payload = await verifySupabaseJwt(token);
  c.set('userId', payload.sub);
  await next();
});

// middleware/org-context.middleware.ts
export const orgContextMiddleware = createMiddleware(async (c, next) => {
  const orgId = c.req.param('orgId');
  const userId = c.get('userId');
  const membership = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: orgId, userId } },
  });
  if (!membership) throw new ForbiddenError('Not a member of this organization');
  c.set('organizationId', orgId);
  c.set('memberRole', membership.role);
  await next();
});
```

## Multi-Tenancy Enforcement

**Every database query MUST filter by `organization_id`.** This is enforced by the `orgContext` middleware injecting it into context.

```typescript
// ❌ Bad — no org filter, data leak across tenants
async function getProducts(storeId: string) {
  return prisma.product.findMany({
    where: { storeId },
  });
}

// ✅ Good — always filter by organizationId
async function getProducts(orgId: string, storeId: string) {
  return prisma.product.findMany({
    where: {
      organizationId: orgId,
      storeId,
    },
  });
}
```

## API Design

### Request Validation

Every route validates input with Zod. Never trust raw request data.

```typescript
// validators/order.validator.ts
export const orderListSchema = z.object({
  status: z.nativeEnum(OrderStatus).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  sort: z.string().default('order_date:desc'),
});

export type OrderListInput = z.infer<typeof orderListSchema>;
```

### Error Responses (RFC 7807)

```typescript
// ❌ Bad — inconsistent error format
return c.json({ error: 'Not found' }, 404);
return c.json({ message: 'Bad request', field: 'cost_price' }, 400);

// ✅ Good — RFC 7807 Problem Details
return c.json(
  {
    type: 'https://api.pazarsync.com/errors/not-found',
    title: 'Order Not Found',
    status: 404,
    detail: `Order ${orderId} not found in store ${storeId}`,
  },
  404,
);

return c.json(
  {
    type: 'https://api.pazarsync.com/errors/validation',
    title: 'Validation Error',
    status: 422,
    detail: 'Request body contains invalid fields',
    errors: [{ field: 'cost_price', message: 'Must be a positive number' }],
  },
  422,
);
```

### Monetary Values

All money values use `Decimal` in the service layer and string representation in API responses:

```typescript
// ❌ Bad — floating point in API response
return c.json({ profit: 46.46999999999999 });

// ✅ Good — string representation preserving precision
return c.json({ profit: order.netProfit.toString() }); // "46.47"
```

### Dates

ISO 8601 format (UTC) across all API boundaries:

```typescript
// ❌ Bad — locale-specific date format
return c.json({ orderDate: '15/04/2026' });

// ✅ Good — ISO 8601 UTC
return c.json({ orderDate: '2026-04-15T14:30:00.000Z' });
```

## Marketplace Adapters (Strategy Pattern)

Each marketplace implements a common interface. New marketplaces are added by implementing this interface:

```typescript
// integrations/marketplace/types.ts
export interface MarketplaceAdapter {
  testConnection(): Promise<boolean>;
  fetchOrders(params: SyncParams): Promise<MarketplaceOrder[]>;
  fetchProducts(params: SyncParams): Promise<MarketplaceProduct[]>;
  fetchSettlements(params: SyncParams): Promise<MarketplaceSettlement[]>;
}

// ❌ Bad — marketplace-specific logic scattered everywhere
if (store.platform === 'TRENDYOL') {
  const orders = await fetchTrendyolOrders(store.credentials);
} else if (store.platform === 'HEPSIBURADA') {
  const orders = await fetchHepsiburadaOrders(store.credentials);
}

// ✅ Good — adapter pattern
function getAdapter(store: Store): MarketplaceAdapter {
  const adapters: Record<Platform, (creds: Json) => MarketplaceAdapter> = {
    TRENDYOL: (creds) => new TrendyolAdapter(creds),
    HEPSIBURADA: (creds) => new HepsiburadaAdapter(creds),
  };
  const credentials = decryptCredentials(store.credentials);
  return adapters[store.platform](credentials);
}

const adapter = getAdapter(store);
const orders = await adapter.fetchOrders({ since: lastSyncAt });
```

## Prisma 7 Conventions

- Generator: `prisma-client` (not `prisma-client-js`)
- Output: `../generated/prisma` (relative to schema dir)
- Datasource URL: configured in `prisma.config.ts`, not in schema
- Driver adapter: `@prisma/adapter-pg` required
- ESM default: `"type": "module"` in package.json
- Schema: `@@map` for snake_case table names
- All tenant tables: `organization_id` with index
- Hard delete with cascading (no soft delete)
- `created_at` + `updated_at` on all tables

```typescript
// ❌ Bad — importing from old Prisma path
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

// ✅ Good — Prisma 7 with adapter (note: output dir has no index, import client.ts directly)
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

const adapter = new PrismaPg({ connectionString: process.env['DATABASE_URL'] });
export const prisma = new PrismaClient({ adapter });
```

## REST API Documentation

The REST API is self-documenting via OpenAPI 3.1, auto-generated from Zod schemas using `@hono/zod-openapi@1.x`. Every route in `apps/api/src/routes/` is defined with `createRoute()`. Schemas live in `apps/api/src/validators/` with `.openapi()` metadata. Shared error/pagination/rate-limit/security components live in `apps/api/src/openapi/`.

### Required per route

- `tags: [...]`, `summary`, `description`
- `security: [{ bearerAuth: [] }]` for authenticated endpoints
- All possible response status codes (200, 400, 401, 403, 404, 422, 429, …)
- `headers: RateLimitHeaders` on 200s of protected endpoints
- `429: Common429Response` on protected endpoints
- Examples on schemas via `.openapi({ example })` — placeholder data only, never real customer data
- `deprecated: true` on routes scheduled for removal

### Shared OpenAPI components (apps/api/src/openapi/)

- `ProblemDetailsSchema` (RFC 7807 with machine-readable `code`) — use as the schema on every error response
- `ValidationErrorDetailSchema` — nested inside `ProblemDetails.errors` on 422
- `RateLimitHeaders` — **a `z.object({...})` whose fields are header names** (`X-RateLimit-Limit/Remaining/Reset`). Pass it directly as `responses[200].headers: RateLimitHeaders`; the library accepts `AnyZodObject | HeadersObject` there.
- `Common429Response` — complete `{ description, headers, content }` with `Retry-After` header and `ProblemDetailsSchema` body
- `CursorMetaSchema` + `paginated(itemSchema)` — paginated list response shape
- `bearerAuthScheme` — HTTP Bearer JWT, registered on the document via `openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", bearerAuthScheme)` in `index.ts` (and mirrored in `scripts/dump-openapi.ts`)

### Adding or changing a route

1. Define/update the Zod schema in `apps/api/src/validators/<feature>.validator.ts` with `.openapi(name, { description, example })`.
2. Define the route in `apps/api/src/routes/<feature>.routes.ts` using `createRoute(...)` + `app.openapi(route, handler)`.
3. Mount in `apps/api/src/index.ts` via `app.route("/", <feature>Routes)`.
4. Route registrations live inside `createApp()` in `apps/api/src/app.ts`. `index.ts` (runtime entry that calls `serve()`) and `scripts/dump-openapi.ts` (build-time spec writer) both import this single factory, so there is no duplication to keep in sync — edit the factory once.
5. From the repo root: `pnpm api:sync` — regenerates `packages/api-client/openapi.json` and `packages/api-client/src/generated/api.d.ts`.
6. Commit the regenerated `openapi.json` snapshot. Types are gitignored and rebuilt from the snapshot.
7. Log the change in `docs/api-changelog.md` under `[Unreleased]`.

CI rejects PRs where the spec snapshot drifts from the registered routes (see `.github/workflows/ci.yml`).

### Serving the docs

- Dev/staging: `/v1/openapi.json` (spec) and `/v1/docs` (Scalar UI) are mounted inside `createApp()` gated on `NODE_ENV !== "production"`. Production does not expose either.
- Local: `pnpm dev --filter api` runs `src/index.ts`, which calls `createApp()` and hands the app to `@hono/node-server`'s `serve()` to bind port 3001.

### Conventions

- **Casing**: camelCase in all JSON request/response bodies, query/path params, and headers. Snake_case is confined to the DB layer (Prisma `@@map`).
- **Pagination**: cursor-based only. Use `cursorPaginationSchema` from `@pazarsync/utils`. Cursor encodes `{ v, sort, values: { …, id } }`. Server validates `sort` matches the request param; mismatch returns `400 CURSOR_SORT_MISMATCH`.
- **Errors**: RFC 7807 `ProblemDetails` with a stable `code` field (SCREAMING_SNAKE_CASE). English `title`/`detail` for logs; `code` is what the frontend translates.
- **Money**: `Decimal` in services, string representation in API responses.
- **Dates**: ISO 8601 (UTC) on the wire.
- **Path keys in the spec are version-prefixed** (`/v1/organizations`) because `OpenAPIHono().basePath("/v1")` bakes the prefix into the paths. Pair with a frontend `baseUrl` that does NOT include `/v1`.

See `docs/plans/2026-04-16-api-docs-design.md` for the full design and `docs/plans/2026-04-16-api-docs-implementation.md` for the implementation history.

## Testing

Backend tests live in `apps/api/tests/`, organized by category:

```
apps/api/tests/
├── unit/                       # Pure logic — no DB, no I/O. Strict TDD.
├── integration/
│   ├── routes/                 # Hono routes via app.request() — uses real DB
│   └── tenant-isolation/       # CRITICAL — multi-tenancy invariants
└── helpers/                    # db, factories, (future) auth
```

### When tests are required

| Change                                                 | Required test                                                          |
| ------------------------------------------------------ | ---------------------------------------------------------------------- |
| New utility function (`apps/api/src/lib/`)             | Unit test, TDD                                                         |
| New service function (`apps/api/src/services/`)        | Integration test (real DB via factories)                               |
| New route (`apps/api/src/routes/`)                     | Integration test in `tests/integration/routes/`                        |
| New org-scoped route                                   | Above + tenant-isolation test in `tests/integration/tenant-isolation/` |
| New marketplace adapter (`apps/api/src/integrations/`) | Unit test for mapper logic; mock the HTTP client                       |

### Pattern reference

Full patterns in `docs/TESTING.md`. The most important ones:

- **DB integration pattern**: every DB test does `await ensureDbReachable()` in `beforeAll`, `await truncateAll()` in `beforeEach` (see `tests/helpers/db.ts`)
- **Test data factories**: use `createOrganization`, `createStore`, `createOrder`, etc. from `tests/helpers/factories.ts` — never hand-construct Prisma create payloads in tests
- **Multi-tenancy isolation pattern**: create two orgs, write data in one, query in the other, assert empty result. See `tests/integration/tenant-isolation/data-layer-isolation.test.ts` for the canonical example.

### Pre-requisites for running integration tests

```bash
supabase start             # local Postgres on port 54322
pnpm db:push               # apply Prisma schema to local DB
pnpm --filter @pazarsync/api test:integration
```

The workspace-root `.env` is auto-loaded by `apps/api/vitest.config.ts` via dotenv, so `DATABASE_URL` and `DIRECT_URL` don't need to be exported in your shell. If integration tests error with "Cannot reach test database", you skipped one of the steps above (or your `.env` is missing). The `ensureDbReachable` helper prints the exact remediation.

### Forbidden patterns

- ❌ Mocking Prisma in integration tests — they exist to test real SQL
- ❌ Sharing state across tests — every test starts with empty DB via `truncateAll`
- ❌ Hand-rolled JWTs in tests — use `signTestJwt` and `bearer()` from `tests/helpers/auth.ts`
- ❌ Skipping the tenant-isolation test for a "trivial" endpoint — there is no trivial multi-tenant endpoint
- ❌ Removing `fileParallelism: false` from `vitest.config.ts` — integration tests share one DB; parallel files race on `truncateAll`

## No Utility Duplication

Before writing a new utility, check `packages/utils/src/` first. If it's backend-only (e.g., encryption, JWT verification), put it in `apps/api/src/lib/`. If it's shared (currency, date, validation), it goes in `@pazarsync/utils`.

```typescript
// ❌ Bad — redefining formatCurrency in the backend
// apps/api/src/lib/format.ts
export function formatCurrency(val: number) { ... }

// ✅ Good — import from shared package
import { formatCurrency } from '@pazarsync/utils';
```
