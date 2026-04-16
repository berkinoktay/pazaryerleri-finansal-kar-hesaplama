# REST API Documentation Infrastructure — Design

**Date:** 2026-04-16
**Status:** Approved (pending implementation)
**Owner:** Backend / DX

---

## Overview

PazarSync exposes an internal REST API from `apps/api` (Hono) that is consumed by `apps/web` (Next.js + React Query). The API will be documented via OpenAPI 3.1, generated automatically from Zod request/response schemas. Documentation is rendered via Scalar in dev/staging only; production exposes no public surface beyond the API itself. Frontend types are generated from the spec via `openapi-typescript`, paired with `openapi-fetch` for a typed runtime client.

This design covers spec generation, type generation, codegen workflow, and the conventions every route must follow (casing, pagination, errors, versioning, rate limiting).

---

## Goals & Non-Goals

### Goals

- Single source of truth: Zod schemas drive both runtime validation and OpenAPI spec
- End-to-end type safety: backend route → generated TypeScript types → typed React Query hooks
- Zero schema drift: any divergence fails CI
- Zero documentation drift: docs are generated, not hand-written
- Zero production attack surface: spec and docs UI off in production
- Predictable contracts: every route follows the same conventions for casing, errors, pagination, rate limits

### Non-Goals (for now)

- Public developer portal with marketing copy, OAuth app registration, multi-language SDKs
- Auto-generated SDKs in non-TypeScript languages
- API key issuance / management for third-party consumers
- Auto-generated CHANGELOG from commits
- Webhook receiver documentation (deferred until webhook receivers are built)

---

## Architecture

```
Backend (apps/api)
  Zod schemas + .openapi() metadata
        │
        ▼
  @hono/zod-openapi  ──── generates ────►  /v1/openapi.json (dev/staging only)
        │                                          │
        ▼                                          ▼
  OpenAPIHono routes                      Scalar UI at /v1/docs
                                                   │
                                                   ▼
                                          (developers browse interactively)

Build / Codegen pipeline
  pnpm api:openapi  →  apps/api dumps spec to packages/api-client/openapi.json (committed snapshot)
  pnpm api:codegen  →  openapi-typescript reads openapi.json
                    →  emits packages/api-client/src/generated/api.d.ts (gitignored)
  pnpm api:sync     →  runs both above

Frontend (apps/web)
  import { paths } from "@pazarsync/api-client"
  import { apiClient } from "@/lib/api-client"        // openapi-fetch instance
        │
        ▼
  Custom React Query hooks in src/features/*/hooks/use-*.ts
```

---

## Backend

### Library Choice

`@hono/zod-openapi` (official Hono package).

- Wraps Zod schemas with `.openapi()` metadata (title, description, example, deprecated flag)
- Replaces `Hono` with `OpenAPIHono`; routes declared via `createRoute` helper
- Auto-emits OpenAPI 3.1 spec via `app.doc31(path, info)`
- Already paired with our existing `@hono/zod-validator` workflow

### Route Definition Pattern

Every route is declared with `createRoute` from `@hono/zod-openapi`. Schemas live next to routes in `apps/api/src/validators/<feature>.validator.ts`:

```ts
// apps/api/src/validators/order.validator.ts
import { z } from "@hono/zod-openapi";

export const OrderSchema = z
  .object({
    id: z.string().uuid(),
    storeId: z.string().uuid(),
    orderDate: z.string().datetime(),
    totalAmount: z.string(),
    netProfit: z.string().nullable(),
    status: z.enum([
      "PENDING",
      "PROCESSING",
      "SHIPPED",
      "DELIVERED",
      "CANCELLED",
      "RETURNED",
    ]),
  })
  .openapi("Order", {
    description: "A marketplace order with computed profitability",
  });

export const OrderListQuery = z
  .object({
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    sort: z.enum(["order_date:desc", "order_date:asc", "net_profit:desc"]).default("order_date:desc"),
    status: z.enum(["PENDING", "DELIVERED", "..."]).optional(),
  })
  .openapi("OrderListQuery");
```

```ts
// apps/api/src/routes/order.routes.ts
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { OrderListQuery, PaginatedOrdersResponse, ProblemDetails, RateLimitHeaders } from "../openapi";

const app = new OpenAPIHono();

const listRoute = createRoute({
  method: "get",
  path: "/organizations/{orgId}/stores/{storeId}/orders",
  tags: ["Orders"],
  summary: "List orders for a store",
  description: "Returns a cursor-paginated list of orders for the given store. Sort field is locked into the cursor; changing sort requires dropping the cursor.",
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      orgId: z.string().uuid(),
      storeId: z.string().uuid(),
    }),
    query: OrderListQuery,
  },
  responses: {
    200: {
      content: { "application/json": { schema: PaginatedOrdersResponse } },
      description: "Cursor-paginated list of orders",
      headers: RateLimitHeaders,
    },
    400: { content: { "application/json": { schema: ProblemDetails } }, description: "Invalid cursor or sort mismatch" },
    401: { content: { "application/json": { schema: ProblemDetails } }, description: "Missing or invalid auth token" },
    403: { content: { "application/json": { schema: ProblemDetails } }, description: "User is not a member of this organization" },
    422: { content: { "application/json": { schema: ProblemDetails } }, description: "Validation error" },
    429: { content: { "application/json": { schema: ProblemDetails } }, description: "Rate limit exceeded" },
  },
});

app.openapi(listRoute, async (c) => {
  const { orgId, storeId } = c.req.valid("param");
  const query = c.req.valid("query");
  const result = await orderService.list(orgId, storeId, query);
  return c.json(result, 200);
});

export default app;
```

### Common OpenAPI Components

Shared schemas and reusable components live under `apps/api/src/openapi/`:

```
apps/api/src/openapi/
├── index.ts                    # Re-exports
├── error-schemas.ts            # ProblemDetails, ValidationErrorDetail
├── pagination.ts               # CursorMeta, paginated<T>() helper
├── components/
│   ├── rate-limit-headers.ts   # X-RateLimit-* header definitions
│   └── common-responses.ts     # 401, 403, 429 reusable response objects
└── security.ts                 # bearerAuth scheme registration
```

Routes import from this module rather than redefining error/pagination shapes per file.

### Where Docs Are Served

```ts
// apps/api/src/index.ts
const app = new OpenAPIHono().basePath("/v1");

// ... mount routes ...

if (process.env.NODE_ENV !== "production") {
  app.doc31("/openapi.json", {
    openapi: "3.1.0",
    info: {
      title: "PazarSync API",
      version: "1.0.0",  // see Versioning conventions
      description: "Internal REST API for PazarSync. See docs/plans/2026-04-16-api-docs-design.md for conventions.",
    },
    servers: [
      { url: "http://localhost:3001/v1", description: "Local dev" },
      { url: "https://staging-api.pazarsync.com/v1", description: "Staging" },
    ],
    security: [{ bearerAuth: [] }],
  });

  app.get("/docs", apiReference({ spec: { url: "/v1/openapi.json" } }));
}
```

In production, both `/v1/openapi.json` and `/v1/docs` return 404 (the `if` block isn't mounted). The OpenAPI snapshot in `packages/api-client/openapi.json` is generated at build time via a separate script and committed; production doesn't expose it over HTTP.

---

## Frontend Type Generation

### Package Layout

New workspace package: `packages/api-client/`.

```
packages/api-client/
├── src/
│   ├── generated/              # gitignored
│   │   └── api.d.ts            # generated by openapi-typescript
│   └── index.ts                # exports `paths`, `components`, helper to create client
├── openapi.json                # committed snapshot, single source of truth
├── package.json
└── tsconfig.json
```

`package.json`:
```json
{
  "name": "@pazarsync/api-client",
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "codegen": "openapi-typescript ./openapi.json -o ./src/generated/api.d.ts"
  },
  "dependencies": { "openapi-fetch": "^0.13.0" },
  "devDependencies": { "openapi-typescript": "^7.5.0" }
}
```

`src/index.ts`:
```ts
export type { paths, components, operations } from "./generated/api";
export { default as createApiClient } from "openapi-fetch";
```

### Why a separate package (vs `@pazarsync/types`)

- `@pazarsync/types` is zero-runtime (just `.d.ts` exports). Adding `openapi-fetch` would force a runtime dep on every consumer.
- Generated code lives in `src/generated/` (gitignored). Mixing with hand-written types muddles "this is authoritative" vs "this is a build artifact".
- The `openapi.json` snapshot belongs WITH the generated artifacts.
- Future apps (`apps/admin`, mobile) all consume the same client → dedicated package makes the boundary obvious.

`@pazarsync/types` keeps its current role: hand-curated domain types (Platform enum, MarketplaceOrder for the integration layer, etc.) that describe domain concepts independent of HTTP shape.

### Frontend Usage Pattern

```ts
// apps/web/src/lib/api-client.ts
import { createApiClient, type paths } from "@pazarsync/api-client";

export const apiClient = createApiClient<paths>({
  baseUrl: process.env.NEXT_PUBLIC_API_URL,
});

// apps/web/src/features/orders/api/orders.api.ts
import { apiClient } from "@/lib/api-client";
import type { components } from "@pazarsync/api-client";

export type Order = components["schemas"]["Order"];
export type OrderListQuery = components["schemas"]["OrderListQuery"];

export async function listOrders(orgId: string, storeId: string, query: OrderListQuery) {
  const { data, error } = await apiClient.GET(
    "/v1/organizations/{orgId}/stores/{storeId}/orders",
    { params: { path: { orgId, storeId }, query } },
  );
  if (error) throw new ApiError(error);
  return data;
}

// apps/web/src/features/orders/hooks/use-orders.ts
import { useQuery } from "@tanstack/react-query";
import { listOrders, type OrderListQuery } from "../api/orders.api";
import { orderKeys } from "../query-keys";

export function useOrders(orgId: string, storeId: string, query: OrderListQuery) {
  return useQuery({
    queryKey: orderKeys.list({ orgId, storeId, ...query }),
    queryFn: () => listOrders(orgId, storeId, query),
  });
}
```

React Query hooks are still hand-written per feature (per `apps/web/CLAUDE.md`). The win is that the underlying API call is fully typed end-to-end with zero manual type maintenance.

---

## Codegen Workflow

### Local Dev (auto-regen)

- `pnpm dev` in `apps/api` writes `packages/api-client/openapi.json` on every Hono server restart (i.e., whenever a route file changes via `tsx watch`).
- `pnpm dev` in `apps/web` runs `openapi-typescript --watch packages/api-client/openapi.json -o packages/api-client/src/generated/api.d.ts` in parallel. As soon as the spec changes, types regenerate.
- Result: change a route → save → frontend types are updated within ~1 second.

### Manual Sync

For one-off regeneration outside dev mode:
```bash
pnpm api:sync       # runs api:openapi then api:codegen
pnpm api:openapi    # dump spec only
pnpm api:codegen    # types only (assumes spec is current)
```

### CI Enforcement

Single CI step:
```yaml
- run: pnpm install
- run: pnpm api:sync
- run: git diff --exit-code packages/api-client/
```

If diff is non-empty, CI fails with: "Run `pnpm api:sync` and commit the result."

This catches the 5% of cases where a contributor edited routes without running dev mode (e.g., codegen-style refactors, IDE-only edits).

### Why CI-only (no pre-commit hook)

- Solo dev iteration speed matters: pre-commit hooks add friction to WIP commits
- Auto-regen during `pnpm dev` covers 95% of cases
- CI as the safety net catches the remaining 5% with one extra push cycle
- Turborepo can cache `api:codegen` on `openapi.json` hash → near-zero CI cost when nothing changed
- Pre-commit hooks remain optional for any contributor who wants strict workflow

---

## Conventions

### Casing

**camelCase everywhere on the HTTP boundary.** This applies to:
- JSON request bodies
- JSON response bodies
- Query string parameters (`?orderId=...`, not `?order_id=...`)
- Path parameters (`/orders/{orderId}`)
- Custom headers (where casing is meaningful)

Rationale:
- Both backend and frontend speak TypeScript natively
- Prisma client already returns camelCase (auto-converted from DB snake_case via `@map`)
- Zod schemas are written in camelCase, matching Prisma output
- Zero conversion overhead at the API layer
- Matches Linear, Vercel, Posthog conventions
- We don't have multi-language SDK consumers (and don't expect to)

The DB stays snake_case (Postgres convention via `@@map`/`@map`). Conversion happens once, by Prisma, at the data access layer. Never elsewhere.

Implication: error responses use camelCase field references too:
```json
{ "errors": [{ "field": "costPrice", "code": "NUMBER_TOO_SMALL", "meta": { "min": 0 } }] }
```

### Pagination

**Cursor-based only. Offset/page-number not supported.**

Justification (from project context):
- Trendyol sellers can hold 50k–150k products and proportionally large order volumes accumulating over months
- Operational pages lean toward virtualized tables / infinite scroll → cursor fits
- Reports and dashboards are aggregations, not paginated lists
- Building two pagination strategies invites bugs

Cursor format (opaque to clients, base64-encoded JSON):
```json
{
  "v": 1,
  "sort": "order_date:desc",
  "values": { "order_date": "2026-04-15T14:30:00Z", "id": "abc-uuid" }
}
```

- `v`: cursor format version (allows future format changes without breaking old cursors gracefully)
- `sort`: locked-in sort for this cursor sequence — server validates this matches the request's sort param
- `values`: field values for the boundary record; always includes `id` as a deterministic tiebreaker

Request shape:
```
GET /v1/.../orders?cursor=<base64>&limit=50&sort=order_date:desc&status=DELIVERED
```

Response shape:
```json
{
  "data": [...],
  "meta": {
    "nextCursor": "<base64-string-or-null>",
    "hasMore": true,
    "limit": 50
  }
}
```

Server behavior on cursor decode:
1. Validate `v` is a supported cursor version (else `400 INVALID_CURSOR`)
2. Validate `sort` matches request's `sort` param (else `400 CURSOR_SORT_MISMATCH`)
3. Construct `WHERE` clause from `values` for keyset pagination

Frontend pattern (defense-in-depth — server still validates):
- React Query key includes `sort` and filters
- Changing sort or filters changes the query key → fresh query, no cursor passed
- Cursor is only ever passed within the same query key (i.e., infinite scroll loading "next page")

Filter changes are NOT encoded in the cursor — they're handled by query key changes on the frontend (encoding everything would bloat cursor size).

For "give me total count for this date range" use cases, add separate aggregate endpoints (e.g., `/orders/summary?from=...&to=...`) that return totals without listing rows.

Default sort per resource (declared in spec):
- Orders: `order_date:desc`
- Products: `title:asc`
- Settlements: `period_start:desc`
- Expenses: `date:desc`
- Sync logs: `started_at:desc`

Limits: `limit` default 50, max 100. Caller cannot pick the sort field freely — sort options are an enum per endpoint.

### Error Responses

Every error response follows RFC 7807 ProblemDetails with extensions for stable error codes and field-level validation errors:

```json
{
  "type": "https://api.pazarsync.com/errors/order-not-found",
  "title": "Order Not Found",
  "status": 404,
  "code": "ORDER_NOT_FOUND",
  "detail": "Order abc-uuid not found in store xyz-uuid",
  "errors": [
    { "field": "costPrice", "code": "NUMBER_TOO_SMALL", "meta": { "min": 0 } }
  ]
}
```

Fields:
- `type` (required): URI identifying the error category. Stable, used for documentation links.
- `title` (required): English human-readable summary. For logs, Sentry, third-party debugging.
- `status` (required): HTTP status code, matches response status.
- `code` (required): Stable machine-readable error code (`SCREAMING_SNAKE_CASE`). Frontend keys translations off this.
- `detail` (required): English context-specific description. For logs.
- `errors` (optional): Per-field validation errors with their own codes. Present on 422 responses.

Translation flow:
- Backend always returns `code` in English, no localization at API layer
- Frontend uses next-intl: `t(\`errors.${error.code}\`, error.meta)`
- Translation files in `apps/web/messages/tr.json` under `errors.*`
- Zod error codes (`too_small`, `invalid_type`, etc.) are mapped to user messages via `errors.zod.*` keys

Example translation file:
```json
{
  "errors": {
    "ORDER_NOT_FOUND": "Sipariş bulunamadı",
    "RATE_LIMIT_EXCEEDED": "Çok fazla istek gönderdiniz. {retryAfter} saniye sonra tekrar deneyin",
    "zod": {
      "too_small": "{field} en az {minimum} olmalı",
      "invalid_type": "{field} geçersiz tür"
    }
  }
}
```

Why codes + frontend translation (not Accept-Language):
- Single source of truth for translations: next-intl on the frontend
- Frontend can adapt messaging per context ("Sipariş bulunamadı" vs "Bu mağazada sipariş yok")
- Future external consumers get stable English codes/titles they can map themselves
- Backend stays free of i18n dependencies
- Zod's structured error output maps cleanly to error codes

### Versioning

Two version concepts, **coupled at the major number**:

- **URL path version (`/v1/`)** — the consumer-facing contract namespace. The only version that matters in client code. URL bumps require coordinated client migration.
- **`info.version` in the OpenAPI spec** — `MAJOR.MINOR.PATCH`. Major is locked to the URL path version (URL `/v1/` → spec major is always `1`). Minor/patch increment as the spec within `/v1/` evolves.

#### Internal-only phase (current)

- Breaking changes within `/v1/` are allowed because frontend deploys atomically with backend in the same monorepo
- Generated TypeScript types catch breaking changes at frontend compile time
- Breaking changes bump **minor** in `info.version`, NOT major (URL stays `/v1/`)
- This explicitly violates strict semver — that's intentional. The URL prefix is the real consumer contract.
- Every change documented in `docs/api-changelog.md` (Keep a Changelog format)

#### Once external consumers exist

- v1 is frozen against breaking changes
- Breaking changes require cutting `/v2/`
- Hono mounts both: `app.basePath('/v1')` + `app.basePath('/v2')` as separate routers
- v2 spec starts `info.version: 2.0.0`
- v1 keeps incrementing minor for non-breaking fixes during deprecation period
- Deprecated v1 endpoints get OpenAPI `deprecated: true` flag + `Deprecation` and `Sunset` HTTP headers (RFC 8594, RFC 9745)
- Minimum 6-month overlap between v1 and v2 before v1 is removed
- Migration guide written in `docs/api-changelog.md`

#### Breaking change definition

| Change | Breaking? |
|--------|----------|
| Remove a field from a response | Yes |
| Change a field's type or semantics | Yes |
| Remove an endpoint | Yes |
| Make an optional request field required | Yes |
| Change URL structure | Yes |
| Change auth requirements | Yes |
| Change pagination contract | Yes |
| Add a new endpoint | No |
| Add a new optional request field | No |
| Add a new field to a response (clients should ignore unknown fields) | No |
| Add a new error code | No |
| Performance improvements, bug fixes | No |

### Rate Limiting

Documented from day one via shared OpenAPI components, even though docs are internal-only — adding to one new route is trivial; retrofitting to 30 routes later is painful.

Shared components in `apps/api/src/openapi/components/`:

**RateLimitHeaders** (added to all 200 responses on protected endpoints):
- `X-RateLimit-Limit` (integer): max requests in current window
- `X-RateLimit-Remaining` (integer): requests remaining in current window
- `X-RateLimit-Reset` (integer): epoch seconds when the window resets

**Common429Response** (added to `responses[429]` on all protected endpoints):
- Body: `ProblemDetails` with `code: "RATE_LIMIT_EXCEEDED"`
- Header: `Retry-After` (integer seconds)

The middleware (existing in plan, per `apps/api/CLAUDE.md`) enforces baseline limits:
- Per IP: 100 req/min
- Per authenticated user: 300 req/min
- Marketplace sync endpoints: 10 req/min

Spec documents the contract (headers + 429 shape); middleware enforces actual numbers (which can change without spec updates).

---

## Documentation Standards (per route)

Every route in `apps/api/src/routes/` MUST include:

- `tags: [...]` — one or more tags grouping the route in Scalar UI (e.g., `["Orders"]`, `["Stores", "Trendyol"]`)
- `summary` — one-line action ("List orders for a store")
- `description` — markdown body explaining the endpoint, edge cases, role requirements, and links to relevant integration docs (e.g., Trendyol API reference)
- All request schemas with at least one `.openapi({ example: {...} })` example using placeholder data (uuid zeros, fake names) — never real customer data
- All response status codes the endpoint can actually return (200, 400, 401, 403, 404, 422, 429, 5xx as applicable)
- `security: [{ bearerAuth: [] }]` for authenticated endpoints
- Response headers documented where present (`RateLimitHeaders` on 200s for protected endpoints, `Retry-After` on 429s, `Deprecation`/`Sunset` on deprecated endpoints)
- `deprecated: true` flag on routes scheduled for removal

This becomes a hard rule in `apps/api/CLAUDE.md` and the security review checklist in `docs/SECURITY.md`.

---

## Boundaries: What's in the Spec, What's Not

### In the spec (`apps/api/src/routes/`)

The PazarSync REST API consumed by `apps/web`:
- `/v1/auth/*` — auth flow endpoints (signup, signin, refresh)
- `/v1/organizations/*` — org and member management
- `/v1/organizations/{orgId}/stores/*` — store connections
- `/v1/organizations/{orgId}/stores/{storeId}/orders/*` — orders
- `/v1/organizations/{orgId}/stores/{storeId}/products/*` — products
- `/v1/organizations/{orgId}/stores/{storeId}/profitability/*`
- `/v1/organizations/{orgId}/expenses/*`
- `/v1/organizations/{orgId}/stores/{storeId}/settlements/*`
- `/v1/organizations/{orgId}/stores/{storeId}/reconciliation/*`
- `/v1/organizations/{orgId}/stores/{storeId}/sync/*`
- `/v1/organizations/{orgId}/stores/{storeId}/dashboard`

### NOT in the spec

**Marketplace integration code** (`apps/api/src/integrations/`) — outbound clients that call Trendyol/Hepsiburada APIs. Called by services, never exposed via REST. Reorganization required: the existing `apps/api/src/marketplace/` directory becomes `apps/api/src/integrations/marketplace/` to leave room for future integrations (accounting platforms, banking APIs for reconciliation, export tools).

```
apps/api/src/integrations/
├── marketplace/
│   ├── types.ts                     # MarketplaceAdapter interface
│   ├── trendyol/                    # Inbound client + mappers
│   └── hepsiburada/
├── (future) accounting/             # Logo, Mikro, Paraşüt
├── (future) banking/                # Bank statement APIs
└── (future) export/                 # Google Sheets, Excel
```

Symmetric naming with documentation: `docs/integrations/trendyol/` documents what `apps/api/src/integrations/marketplace/trendyol/` implements.

**Supabase Edge Functions** (`supabase/functions/`) — background sync workers triggered by `pg_cron`. Internal infrastructure, not part of the public REST surface.

**Inbound webhooks from marketplaces** (future) — when implemented, they live under `apps/api/src/routes/webhooks/*` and ARE in the spec, but use a separate auth scheme (HMAC signature verification, not JWT). They are inbound from Trendyol/Hepsiburada, not consumed by `apps/web`. Out of scope for this design doc.

---

## Security

Aligned with `docs/SECURITY.md`:

- **Spec and docs UI disabled in production.** Both `/v1/openapi.json` and `/v1/docs` return 404 when `NODE_ENV === 'production'`. Production has no public attack surface beyond the API itself.
- **Generated `openapi.json` is not sensitive.** It lists endpoints and shapes, not data. Safe to commit to git, safe to ship in CI artifacts.
- **Examples use placeholder data only.** All `.openapi({ example })` values use uuid zeros, fake names, dummy amounts. Never real customer/order/product data.
- **Bearer auth scheme documented.** Scalar's "try it now" requires the user to paste their own Supabase token. No shared dev tokens. No public test credentials.
- **Rate limiting still applies to spec/docs endpoints.** Standard middleware doesn't except them.
- **Tenant-isolation invariants apply.** Even in the docs UI, hitting an endpoint with a token only returns data the token's user can access. The docs surface no privileged paths.

### Security Schemes

Initial spec documents only:
- `bearerAuth` — Supabase JWT in `Authorization: Bearer <token>`

Reserved for future (will be added when implemented, not now):
- `apiKey` — for service accounts when external integrators arrive
- `webhookSignature` — HMAC for inbound marketplace webhook verification

CSRF tokens are not applicable (JWT-bearer in headers, not cookies).

---

## Implementation Steps (high-level)

This design doc is the contract. Actual implementation will be planned via the `writing-plans` skill in a separate document. High-level sequence:

1. Add deps: `@hono/zod-openapi`, `@scalar/hono-api-reference`. Replace `@hono/zod-validator` usage where it overlaps.
2. Create `apps/api/src/openapi/` with shared schemas (ProblemDetails, CursorMeta, RateLimitHeaders, Common429Response, bearerAuth).
3. Replace `Hono` with `OpenAPIHono` in `apps/api/src/index.ts`. Add env-gated `/openapi.json` and `/docs` endpoints.
4. Rename `apps/api/src/marketplace/` → `apps/api/src/integrations/marketplace/`. Update CLAUDE.md and ARCHITECTURE.md references.
5. Replace `paginationSchema` (offset) in `packages/utils/src/validation.ts` with `cursorPaginationSchema`. Add `decodeCursor`/`encodeCursor` helpers with sort validation.
6. Create `packages/api-client/` package: `package.json`, `tsconfig.json`, `src/index.ts`, `openapi.json` snapshot, `.gitignore` for `src/generated/`.
7. Wire root `package.json` scripts: `api:openapi`, `api:codegen`, `api:sync`. Wire Turborepo cache for codegen.
8. Wire `apps/api` dev mode to dump spec on Hono restart.
9. Wire `apps/web` dev mode to watch and regenerate types.
10. Add `apps/web/src/lib/api-client.ts` using `createApiClient` from `@pazarsync/api-client`.
11. Create `docs/api-changelog.md` with initial `[Unreleased]` and `[1.0.0] - YYYY-MM-DD` Initial release sections.
12. Add CI step: `pnpm api:sync && git diff --exit-code packages/api-client/`.
13. Update `docs/ARCHITECTURE.md`, `apps/api/CLAUDE.md`, `apps/web/CLAUDE.md` with new conventions (casing, pagination, errors, versioning, integrations folder name).
14. Implement first end-to-end route as exemplar (suggested: `GET /v1/organizations`) and validate the full flow: spec generation → snapshot → frontend types → React Query hook.

---

## Open Questions / Future Work

- **Webhook receivers**: Trendyol sends webhooks (per `docs/integrations/trendyol/.../webhook/`). When we build receivers, define the `webhookSignature` security scheme and document under `/v1/webhooks/*`. Separate design doc when scoped.
- **Service account API keys**: when external integrators arrive, define API key issuance flow, scope grants, and the `apiKey` security scheme.
- **Auto-generated changelog**: if manual `docs/api-changelog.md` maintenance becomes burdensome, evaluate `oasdiff` or `changesets`. Defer until pain is real.
- **Multi-language SDKs**: not on the roadmap. If demand emerges, the OpenAPI spec is already the source — `openapi-generator` can produce Python/Go/Java SDKs without changes here.
- **Cursor format v2**: if we ever need to encode filters or other context in the cursor, bump `v` and reject old cursors with a clear error.

---

## References

- [@hono/zod-openapi](https://hono.dev/examples/zod-openapi)
- [Scalar API reference](https://github.com/scalar/scalar)
- [openapi-typescript](https://openapi-ts.dev/)
- [openapi-fetch](https://openapi-ts.dev/openapi-fetch/)
- [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
- [RFC 7807 — Problem Details for HTTP APIs](https://www.rfc-editor.org/rfc/rfc7807)
- [RFC 8594 — Sunset HTTP Header](https://www.rfc-editor.org/rfc/rfc8594)
- [RFC 9745 — Deprecation HTTP Header](https://www.rfc-editor.org/rfc/rfc9745)
- Internal: `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, `apps/api/CLAUDE.md`, `apps/web/CLAUDE.md`
