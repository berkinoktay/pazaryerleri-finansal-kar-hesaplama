# Store Connection (Trendyol Phase 1) — Design

> **Status:** Draft — awaiting approval before the implementation plan is produced. When this document ships, move it (and its implementation pair) to `docs/plans/archive/` per the repo convention.

## 1. Goal

Enable an authenticated user to **connect a Trendyol seller account to their organization** — from two entry points (post-org-creation onboarding + dashboard-level "add store") — such that:

1. Credentials are validated against the live Trendyol API before we persist anything.
2. Credentials are encrypted at rest (AES-256-GCM), never returned in responses, never logged.
3. Sandbox credentials are completely unreachable in production deployments — enforced at the backend, not just hidden in the UI.
4. The data shapes, adapter interface, and route layer accommodate a second marketplace (Hepsiburada is the confirmed next phase) with zero modifications to Trendyol-specific code.
5. Failed credential-validation attempts are rate-limited so brute-force probing of Trendyol accounts via our endpoint is not cheaper than doing it directly.

## 2. Explicit non-goals

This phase ships the "connect" leg only. The following are deliberately deferred — flagged inline where a minimal forward-compatible hook is added:

- Sync jobs (orders, products, settlements, sync_logs writes)
- Credential rotation UI / re-probe endpoint (`POST /stores/:id/test`)
- PATCH `/stores/:id` (edit store name / credentials)
- Auto-reconnect on credential expiry
- Email notifications when a store's credentials become invalid
- Audit logs for store lifecycle events
- Hepsiburada adapter implementation (factory registry is shaped for it; no code lands)
- Amazon TR (not on the roadmap per current scope)
- `requireRole()` OWNER/ADMIN gate — see §10.3 for the accepted interim risk

## 3. Key decisions (decided, recorded)

| #   | Decision                                                                                                                                                                                                                                                                                                       | Why                                                                                                                                                                                                                                 |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Plan lives in `docs/plans/` while active; moves to `docs/plans/archive/` once shipped (per `archive/README.md`).                                                                                                                                                                                               | Repo convention.                                                                                                                                                                                                                    |
| D2  | One Trendyol seller account = at most one `Store` row per organization. Unique constraint: `UNIQUE(organization_id, platform, external_account_id)`.                                                                                                                                                          | Product decision. Prevents accidental double-connection and reflects that a single Trendyol account maps to a single operational store in our model. Sandbox supplierId ≠ prod supplierId in Trendyol, so switching envs still works. |
| D3  | **Role gate deferred.** Connect/disconnect is gated by org membership only in this PR. `requireRole('OWNER','ADMIN')` lands when the role middleware does (Milestone #2 backlog).                                                                                                                              | Product decision — accepted risk. Practical impact today is zero: no invite flow exists, so every member is the OWNER who created the org. Every `POST /stores` handler will carry a `// TODO(roles): requireRole('OWNER','ADMIN')` marker for a grep-able swap later. |
| D4  | **Sandbox hard-gated at the backend via env var.** `ALLOW_SANDBOX_CONNECTIONS=true` is required for the server to accept `environment: SANDBOX`. Production deployments set it to `false` (or omit). Frontend mirrors with `NEXT_PUBLIC_ALLOW_SANDBOX_CONNECTIONS` but that is cosmetic — backend is the gate. | Defense-in-depth. Even if the frontend is bypassed, the route rejects sandbox env in prod with a 422 `SANDBOX_NOT_ALLOWED` before any credential decrypt / outbound call.                                                           |
| D5  | **MVP platforms**: `TRENDYOL` active, `HEPSIBURADA` visible in UI as "Yakında" (disabled card). Amazon TR is not modeled. `Platform` enum stays as `TRENDYOL | HEPSIBURADA` — no Amazon branch to carry.                                                                                                       | YAGNI. Adding an enum value before the adapter exists creates dead branches across the codebase.                                                                                                                                    |
| D6  | **Store name is user-supplied.** A required `name` field in the connect form, 2–80 chars, defaults empty (placeholder `"Trendyol Mağazam"` in UI). No API probe needed.                                                                                                                                        | Product decision. Simpler, and Trendyol's account endpoints do not return a canonical display name in a lightweight call.                                                                                                           |
| D7  | **Rate-limit middleware lands in this PR.** Minimal in-memory token bucket keyed by `{userId, routeKey}`. Applied with tighter limits on `POST /stores` specifically; other authenticated routes get a looser default.                                                                                         | User decision — building it now avoids a retrofitting pass later. `RateLimitedError` + RFC 7807 mapping + `Retry-After` header are already in place (PR #34); only the middleware that throws was missing.                          |

## 4. Scope at a glance

```
┌──────────────────────────────────────────────────────────────────────┐
│ apps/web                                                              │
│  ├─ app/[locale]/onboarding/connect-store/page.tsx   (NEW)            │
│  ├─ features/stores/                                  (NEW FEATURE)   │
│  │   ├─ api/{list-stores,connect-store,disconnect-store}.api.ts       │
│  │   ├─ hooks/{use-stores,use-connect-store,use-disconnect-store}.ts  │
│  │   ├─ components/                                                   │
│  │   │   ├─ connect-store-form.tsx       (shared onboarding + modal)  │
│  │   │   ├─ connect-store-modal.tsx      (dashboard CTA)              │
│  │   │   ├─ platform-card.tsx            (Trendyol active, HB "Yakında")│
│  │   │   ├─ stores-empty-state.tsx       (dashboard when 0 stores)    │
│  │   │   └─ environment-tabs.tsx         (dev-only; hidden in prod)   │
│  │   ├─ validation/connect-store.schema.ts                            │
│  │   └─ query-keys.ts                                                 │
│  └─ messages/{tr,en}.json                            (NEW keys)       │
├──────────────────────────────────────────────────────────────────────┤
│ apps/api                                                              │
│  ├─ routes/store.routes.ts                  (NEW)                     │
│  ├─ services/store.service.ts               (NEW)                     │
│  ├─ validators/store.validator.ts           (NEW)                     │
│  ├─ integrations/marketplace/                                         │
│  │   ├─ types.ts                            (NEW — adapter iface)     │
│  │   ├─ registry.ts                         (NEW — factory lookup)    │
│  │   └─ trendyol/                                                     │
│  │       ├─ adapter.ts                      (NEW — TrendyolAdapter)   │
│  │       ├─ client.ts                       (NEW — HTTP client)       │
│  │       ├─ errors.ts                       (NEW — vendor→domain map) │
│  │       └─ types.ts                        (NEW)                     │
│  ├─ middleware/rate-limit.middleware.ts     (NEW)                     │
│  └─ lib/errors.ts                           (+ MarketplaceAuthError,  │
│                                                MarketplaceUnreachable)│
├──────────────────────────────────────────────────────────────────────┤
│ packages/db                                                           │
│  └─ prisma/schema.prisma                                              │
│      └─ Store: +environment, +externalAccountId, +status              │
│         + UNIQUE(organization_id, platform, external_account_id)      │
│      + enum StoreEnvironment { PRODUCTION, SANDBOX }                  │
│      + enum StoreStatus { ACTIVE, CONNECTION_ERROR, DISABLED }        │
├──────────────────────────────────────────────────────────────────────┤
│ supabase/sql/rls-policies.sql                                         │
│  └─ stores: ENABLE RLS + SELECT policy via is_org_member (NEW)        │
├──────────────────────────────────────────────────────────────────────┤
│ .env.example + turbo.json + .github/workflows/ci.yml  (3-file update) │
│  └─ TRENDYOL_PROD_BASE_URL, TRENDYOL_SANDBOX_BASE_URL,                │
│     ALLOW_SANDBOX_CONNECTIONS, NEXT_PUBLIC_ALLOW_SANDBOX_CONNECTIONS, │
│     TRENDYOL_INTEGRATOR_UA_SUFFIX                                     │
└──────────────────────────────────────────────────────────────────────┘
```

## 5. Data model changes

### 5.1 New enums

```prisma
enum StoreEnvironment {
  PRODUCTION
  SANDBOX
}

enum StoreStatus {
  ACTIVE            // credentials validated recently, ready for sync
  CONNECTION_ERROR  // last probe failed — future sync jobs will flip here
  DISABLED          // user-initiated soft-pause (not in this phase; FK hook only)
}
```

### 5.2 Extend `Store`

```prisma
model Store {
  id                 String           @id @default(uuid()) @db.Uuid
  organizationId     String           @map("organization_id") @db.Uuid
  name               String
  platform           Platform
  environment        StoreEnvironment @default(PRODUCTION)                 // NEW
  externalAccountId  String           @map("external_account_id")          // NEW
  credentials        Json
  status             StoreStatus      @default(ACTIVE)                     // NEW
  isActive           Boolean          @default(true) @map("is_active")     // keep; DEPRECATED in favor of status. Removed in a follow-up.
  lastSyncAt         DateTime?        @map("last_sync_at")
  lastConnectedAt    DateTime?        @map("last_connected_at")            // NEW — stamps successful validate
  createdAt          DateTime         @default(now()) @map("created_at")
  updatedAt          DateTime         @updatedAt      @map("updated_at")

  organization Organization @relation(...)
  products     Product[]
  orders       Order[]
  settlements  Settlement[]
  syncLogs     SyncLog[]

  @@unique([organizationId, platform, externalAccountId])                   // NEW — enforces D2
  @@index([organizationId])
  @@map("stores")
}
```

**On `isActive`:** we keep it this phase to avoid breaking anything that might already read it. `status` is the new source of truth. Next PR removes `isActive` and backfills.

**On `credentials` JSON shape (encrypted at rest):** the shape depends on the platform. For Trendyol:

```jsonc
// BEFORE encryption — in-memory only, never persisted:
{
  "supplierId": "1234",
  "apiKey": "...",
  "apiSecret": "..."
}
```

After `encryptCredentials(obj)` it becomes the base64 `iv||authTag||ciphertext` blob stored in the JSON column. The column type stays `Json` so a per-platform shape stays fluid (Hepsiburada will have `merchantId` instead of `supplierId`).

`externalAccountId` is stored **unencrypted** in its own column specifically so we can enforce the uniqueness constraint (D2) without decrypting. It is also safe to return in API responses — it is not a secret, it is a public seller ID visible on the Trendyol product listing.

### 5.3 Migration + RLS

- Prisma migration: add the three columns + the two new enums + the unique constraint.
- `supabase/sql/rls-policies.sql`: `stores` table was not previously RLS-scoped at the DB layer (Prisma-as-postgres bypasses RLS). Add the policy now — it is a tenant-scoped table and the RLS coverage test (`tests/integration/rls/coverage.rls.test.ts`) will fail CI if omitted.
- Add `stores` to `TENANT_TABLES` in the coverage test.
- Add `apps/api/tests/integration/rls/stores.rls.test.ts` using `createRlsScopedClient` (pattern established in existing `*.rls.test.ts` files).

## 6. Marketplace adapter interface

### 6.1 Shape

```typescript
// apps/api/src/integrations/marketplace/types.ts

export interface MarketplaceAdapter {
  /**
   * Verify the credentials work against the chosen environment.
   * Throws a domain error on any failure:
   *   - MarketplaceAuthError     → credentials rejected by vendor
   *   - MarketplaceAccessError   → env allowed but access denied (e.g. sandbox IP whitelist missing)
   *   - MarketplaceUnreachable   → network / 5xx / timeout
   * Does NOT throw for success — returns the vendor-supplied externalAccountId
   * so the caller can store it unencrypted.
   */
  testConnection(): Promise<{ externalAccountId: string }>;

  // Phase 2+ methods, listed here so adapter implementors know the surface
  // they will grow into. Not required by this phase.
  //   fetchOrders(params: SyncParams): Promise<MarketplaceOrder[]>;
  //   fetchProducts(params: SyncParams): Promise<MarketplaceProduct[]>;
  //   fetchSettlements(params: SyncParams): Promise<MarketplaceSettlement[]>;
}

export interface MarketplaceAdapterFactory {
  readonly platform: Platform;
  readonly supportedEnvironments: readonly StoreEnvironment[];
  create(params: {
    environment: StoreEnvironment;
    credentials: unknown; // narrowed inside the factory via a type guard
  }): MarketplaceAdapter;
}
```

### 6.2 Registry

```typescript
// apps/api/src/integrations/marketplace/registry.ts

import { trendyolFactory } from './trendyol/adapter';

// Partial<Platform> — Hepsiburada is intentionally absent. The route layer
// (§9.2) rejects `platform: HEPSIBURADA` with PLATFORM_NOT_YET_AVAILABLE
// before the registry is ever consulted. When the Hepsiburada phase starts,
// import and register its factory here — zero changes to Trendyol code.
const FACTORIES: Partial<Record<Platform, MarketplaceAdapterFactory>> = {
  TRENDYOL: trendyolFactory,
};

export function getAdapter(
  platform: Platform,
  environment: StoreEnvironment,
  credentials: unknown,
): MarketplaceAdapter {
  const factory = FACTORIES[platform];
  if (factory === undefined) {
    // Defense-in-depth: the route-level check should have caught this first.
    throw new ValidationError([{ field: 'platform', code: 'PLATFORM_NOT_YET_AVAILABLE' }]);
  }
  if (!factory.supportedEnvironments.includes(environment)) {
    throw new ValidationError([{ field: 'environment', code: 'ENVIRONMENT_NOT_SUPPORTED' }]);
  }
  return factory.create({ environment, credentials });
}
```

No Hepsiburada code lands this phase. The factory registry is shaped for it (one-line addition when the time comes); nothing is stubbed or half-written.

## 7. Trendyol adapter

### 7.1 Facts confirmed from `docs/integrations/trendyol/`

- Prod endpoint: `https://apigw.trendyol.com`
- Sandbox endpoint: `https://stageapigw.trendyol.com`
- Sandbox requires IP whitelisting by Trendyol (no-whitelist → 503).
- Auth: HTTP Basic `Authorization: Basic base64(apiKey:apiSecret)`.
- `User-Agent` **mandatory**: `"{supplierId} - SelfIntegration"`. Missing → 403.
- Rate limit: 10s window / 50 req per endpoint → 429 with body `too.many.requests`.
- Wrong auth → 401 body `{"exception":"ClientApiAuthenticationException"}`.

### 7.2 Credential shape + guard

```typescript
// apps/api/src/integrations/marketplace/trendyol/types.ts

export interface TrendyolCredentials {
  supplierId: string;   // alphanumeric; becomes store.externalAccountId on success
  apiKey: string;
  apiSecret: string;
}

export function isTrendyolCredentials(v: unknown): v is TrendyolCredentials {
  return (
    typeof v === 'object' && v !== null &&
    'supplierId' in v && typeof (v as TrendyolCredentials).supplierId === 'string' &&
    'apiKey' in v && typeof (v as TrendyolCredentials).apiKey === 'string' &&
    'apiSecret' in v && typeof (v as TrendyolCredentials).apiSecret === 'string'
  );
}
```

### 7.3 Probe endpoint

We need the cheapest call that proves "these credentials can read this seller's data on this environment." Candidates from `docs/integrations/trendyol/1-servis-limitleri.md`:

| Endpoint                                                          | Rate        | Returns                         | Suitable?                                                      |
| ----------------------------------------------------------------- | ----------- | ------------------------------- | -------------------------------------------------------------- |
| `GET /integration/product/sellers/{sellerId}/products?size=1`     | 2000 req/min | Seller's first product (or empty list) | **Yes.** Ownership-proving, high rate budget, returns 200 on zero products. |
| `GET /integration/order/sellers/{sellerId}/orders?size=1`         | 2000+ req/min | Seller's first order (or empty) | Works, but orders endpoint has additional auth scopes a just-onboarded seller may lack. |
| `GET /sapigw/suppliers/{id}/addresses`                            | 1 req/hour   | Warehouse addresses             | **No** — rate is too tight for repeated probes during dev/testing. |

**Recommendation:** products endpoint. Records the returned supplierId as `externalAccountId` via the URL path — we do not need to decode the response body. Empty product list is fine (new seller).

Exact call in `apps/api/src/integrations/marketplace/trendyol/client.ts`:

```typescript
// Pseudocode for the probe. Real impl uses fetch + AbortSignal.timeout(10_000).
async function probe(cred: TrendyolCredentials, baseUrl: string): Promise<void> {
  const res = await fetch(
    `${baseUrl}/integration/product/sellers/${cred.supplierId}/products?page=0&size=1&approved=true`,
    {
      headers: {
        Authorization: `Basic ${base64(`${cred.apiKey}:${cred.apiSecret}`)}`,
        'User-Agent': `${cred.supplierId} - ${process.env.TRENDYOL_INTEGRATOR_UA_SUFFIX ?? 'SelfIntegration'}`,
      },
      signal: AbortSignal.timeout(10_000),
    },
  );
  // mapTrendyolResponseToDomainError(res) — see §7.4
}
```

### 7.4 Vendor → domain error mapping

```typescript
// apps/api/src/integrations/marketplace/trendyol/errors.ts

export function mapTrendyolResponseToDomainError(res: Response): never {
  const status = res.status;
  if (status === 401) throw new MarketplaceAuthError('TRENDYOL');
  if (status === 403 || status === 503) throw new MarketplaceAccessError('TRENDYOL', { httpStatus: status });
  if (status === 429) throw new RateLimitedError(/* parse Retry-After or default 10 */);
  // Any 4xx not covered above → generic VALIDATION_ERROR on creds (typo in secret, etc.)
  if (status >= 400 && status < 500) throw new MarketplaceAuthError('TRENDYOL');
  // 5xx → upstream down
  throw new MarketplaceUnreachable('TRENDYOL', { httpStatus: status });
}
```

We never surface Trendyol's raw error text to the frontend. Every outbound mapping lands in our own closed vocabulary — the frontend localizes by code only.

## 8. New error codes

Two new domain error classes in `apps/api/src/lib/errors.ts`, both already consistent with the RFC 7807 pipeline:

| Class                     | HTTP | `code`                    | When                                                                                       |
| ------------------------- | ---- | ------------------------- | ------------------------------------------------------------------------------------------ |
| `MarketplaceAuthError`    | 422  | `MARKETPLACE_AUTH_FAILED` | Credentials rejected by Trendyol (401 / generic 4xx).                                      |
| `MarketplaceAccessError`  | 422  | `MARKETPLACE_ACCESS_DENIED` | Access blocked by environment-specific rules (sandbox IP whitelist missing, 403 / 503).  |
| `MarketplaceUnreachable`  | 503  | `MARKETPLACE_UNREACHABLE` | Trendyol itself is down / timed out / 5xx. User retries later.                             |

Plus two validation codes consumed via the existing `VALIDATION_ERROR` pipe:

| Validator code                  | When                                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------- |
| `SANDBOX_NOT_ALLOWED`           | D4 enforcement: request sent `environment: SANDBOX` but server has it gated off.      |
| `PLATFORM_NOT_YET_AVAILABLE`    | `POST /stores` with `platform: HEPSIBURADA` in this phase.                            |
| `ENVIRONMENT_NOT_SUPPORTED`     | Adapter does not support the requested environment (future-proofing).                |
| `INVALID_SUPPLIER_ID_FORMAT`    | Zod-level: supplierId must be alphanumeric.                                          |
| `INVALID_API_KEY_FORMAT`        | Zod-level: apiKey/apiSecret length/format.                                           |
| `DUPLICATE_STORE_CONNECTION`    | UNIQUE constraint hit → `ConflictError` with this as `meta.code`.                     |

Follow the existing "SCREAMING_SNAKE_CASE in Zod `message`" convention — the frontend's `stores.connect.errors.<CODE>` namespace localizes.

## 9. API surface (Phase 1)

```
GET    /v1/organizations/:orgId/stores               → list stores (no credentials in body)
POST   /v1/organizations/:orgId/stores               → create + validate credentials, atomic
GET    /v1/organizations/:orgId/stores/:storeId      → single store (no credentials)
DELETE /v1/organizations/:orgId/stores/:storeId      → disconnect (hard delete, cascade)
```

Out of scope this phase: `PATCH /stores/:id`, `POST /stores/:id/test`, `POST /stores/:id/sync`.

### 9.1 Request / response shapes

```typescript
// apps/api/src/validators/store.validator.ts

export const ConnectStoreInputSchema = z.object({
  name: z.string().trim().min(2, 'INVALID_NAME_TOO_SHORT').max(80, 'INVALID_NAME_TOO_LONG'),
  environment: z.enum(['PRODUCTION', 'SANDBOX']).default('PRODUCTION'),
  // Discriminator lives on credentials.platform — single source of platform
  // identity. Root-level `platform` was considered but would duplicate the
  // discriminator and invite the two values to drift.
  credentials: z.discriminatedUnion('platform', [
    z.object({
      platform: z.literal('TRENDYOL'),
      supplierId: z.string().regex(/^[A-Za-z0-9]+$/, 'INVALID_SUPPLIER_ID_FORMAT').min(1).max(20),
      apiKey: z.string().min(8, 'INVALID_API_KEY_FORMAT').max(128),
      apiSecret: z.string().min(8, 'INVALID_API_KEY_FORMAT').max(128),
    }),
    // When Hepsiburada lands:
    //   z.object({ platform: z.literal('HEPSIBURADA'), merchantId, apiKey, apiSecret, ... })
    // Today, sending `platform: 'HEPSIBURADA'` from the client fails Zod's
    // discriminator match → 422 VALIDATION_ERROR. The route handler ALSO
    // checks `credentials.platform === 'HEPSIBURADA'` and throws
    // PLATFORM_NOT_YET_AVAILABLE, which is what the UI surfaces. Defense
    // in depth — Zod drift during enum updates won't let HB leak through.
  ]),
}).openapi('ConnectStoreInput');

export const StoreSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  platform: z.enum(['TRENDYOL', 'HEPSIBURADA']),
  environment: z.enum(['PRODUCTION', 'SANDBOX']),
  externalAccountId: z.string(),   // public — supplierId / merchantId
  status: z.enum(['ACTIVE', 'CONNECTION_ERROR', 'DISABLED']),
  lastConnectedAt: z.string().datetime().nullable(),
  lastSyncAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).openapi('Store');
// NOTE: no `credentials` field, ever.
```

The credentials sub-schema is a discriminated union so TypeScript infers the right credential shape per platform. The `platform` field duplicates across input root and credentials object — the Zod refinement enforces they match (prevents `{ platform: TRENDYOL, credentials: { platform: HEPSIBURADA, ... } }` oddities).

### 9.2 Route handler outline (happy + sad path)

```typescript
// apps/api/src/services/store.service.ts (outline)

export async function connect(
  orgId: string,
  input: ConnectStoreInput,
): Promise<StoreResponse> {
  // D4 — sandbox gate enforced before adapter touches the network
  if (input.environment === 'SANDBOX' && process.env.ALLOW_SANDBOX_CONNECTIONS !== 'true') {
    throw new ValidationError([{ field: 'environment', code: 'SANDBOX_NOT_ALLOWED' }]);
  }

  // D5 — HB not yet supported at the route level
  if (input.credentials.platform === 'HEPSIBURADA') {
    throw new ValidationError([{ field: 'credentials.platform', code: 'PLATFORM_NOT_YET_AVAILABLE' }]);
  }

  // 1. Adapter probe — throws on failure (422/503 via error taxonomy)
  const adapter = getAdapter(input.credentials.platform, input.environment, input.credentials);
  const { externalAccountId } = await adapter.testConnection();

  // 2. Encrypt credentials ONCE after successful probe
  const encrypted = encryptCredentials(input.credentials);

  // 3. Persist. UNIQUE(org_id, platform, external_account_id) may hit P2002
  //    → mapPrismaError → ConflictError with code DUPLICATE_STORE_CONNECTION
  try {
    const store = await prisma.store.create({
      data: {
        organizationId: orgId,
        name: input.name,
        platform: input.credentials.platform,
        environment: input.environment,
        externalAccountId,
        credentials: encrypted,
        status: 'ACTIVE',
        lastConnectedAt: new Date(),
      },
    });
    return toStoreResponse(store); // strips credentials
  } catch (err) {
    mapPrismaError(err); // never returns on P2002
  }
}
```

`toStoreResponse` is the **mandatory** mapper — explicit field allowlist, no `...store` spread. This is the pattern already codified in `docs/SECURITY.md` §4 "Usage Rules".

### 9.3 OpenAPI changes

Single PR adds the new route definitions to `apps/api/src/routes/store.routes.ts`, mounted in `createApp()`. `pnpm api:sync` regenerates `packages/api-client/openapi.json` and types — snapshot committed, types gitignored (standard flow).

`docs/api-changelog.md` gets a `[Unreleased]` entry listing the four new routes + three new shared error codes.

## 10. Security model

Checked against `docs/SECURITY.md` §9 "Security Review Checklist" row by row:

### 10.1 Query safety

- Every `prisma.store.*` call in the service filters by `organizationId` from `c.get('organizationId')` (set by `orgContextMiddleware`).
- Store-scoped queries (`GET/DELETE /stores/:id`) do `findFirst({ where: { id, organizationId } })` per SECURITY.md §3 pattern. 404 on cross-tenant access, never 403 (existence non-disclosure).

### 10.2 Credentials

- `encryptCredentials(input.credentials)` before any `prisma.store.create`. Nothing else touches the raw values.
- `toStoreResponse(store)` on every write-return and read path. Explicit field allowlist, no `...store` spread.
- Grep-able commit hygiene: each store-related commit runs the SECURITY.md §9 grep (`credentials|apiKey|apiSecret|supplier`) on its diff before push. Noted in the implementation plan as a per-commit gate.
- `ENCRYPTION_KEY` already validated at boot via `validateRequiredEnv()`; no change.

### 10.3 Authorization

- Every new route mounted under the existing `authMiddleware → orgContextMiddleware` chain. No handler reads `orgId` from the URL raw — all via `c.get('organizationId')`.
- **Role gate is deferred.** Every `POST /stores` and `DELETE /stores/:id` handler carries a `// TODO(roles): requireRole('OWNER', 'ADMIN')` line immediately after the middleware stack. When `requireRole()` lands (Milestone #2 backlog), one grep + one diff swaps them in. Accepted risk is documented here, not silent.

### 10.4 API responses

- `StoreSchema` has no `credentials` field. The OpenAPI snapshot enforces this in CI — the committed `openapi.json` is the source of truth.
- `DELETE /stores/:id` returns 204 No Content. No body, nothing to leak.
- Store existence in another org → 404, not 403 (SECURITY.md §3 "non-disclosure" rule).

### 10.5 RLS

- `stores` table gets `ENABLE ROW LEVEL SECURITY` + SELECT policy via `is_org_member(organization_id)` (pattern from `rls-policies.sql`).
- Added to `TENANT_TABLES` in the coverage test.
- New `stores.rls.test.ts` asserts cross-tenant read blocked with a scoped JWT.

### 10.6 Transport

- No HTTP-only additions. Trendyol URLs are HTTPS. `.env.example` comments call out that both prod + sandbox URLs are HTTPS.

### 10.7 Rate limiting (D7)

See §11.

## 11. Rate-limit middleware

### 11.1 Shape

```typescript
// apps/api/src/middleware/rate-limit.middleware.ts

export interface RateLimitOptions {
  max: number;         // requests per window
  windowSec: number;   // window in seconds
  keyPrefix?: string;  // defaults to route pattern
}

export function rateLimit(opts: RateLimitOptions): MiddlewareHandler { ... }
```

Emits `RateLimitedError(retryAfter)` on overflow → existing `app.onError` picks up → 429 with `Retry-After` header (pipeline built in PR #34, previously never triggered).

### 11.2 Backend

MVP: in-memory Map-of-windows keyed by `${userId}:${keyPrefix}`. Each entry stores `{ count, windowStart }`. Window rolls forward on next request after `windowSec` elapsed.

**Known limits of this backend — documented in the module header:**

- Single-instance only. Two API pods would each maintain an independent count — the overall rate would be `pods × max`. Not acceptable at scale; explicitly in the "pods === 1" MVP assumption.
- Memory unbounded across distinct users. LRU eviction at 10k keys added.
- Process restart resets all windows. A user who just hit 429 could retry immediately after a deploy.

None of these are blocking for MVP deployment (single pod, low user count). When we scale past one pod, the middleware's public interface stays identical — only the backing store swaps (Postgres or Upstash Redis). The "Postgres-backed" option is the most likely upgrade path since we already talk to Postgres on every request.

### 11.3 Applied to

| Route                            | `max` | `windowSec` | Reason                                                                       |
| -------------------------------- | ----- | ----------- | ---------------------------------------------------------------------------- |
| `POST /v1/organizations/:orgId/stores` | 5     | 60          | Tightens failed-credential brute-forcing. Successful creates also count — 5/min is plenty for an onboarding flow. |
| All other authenticated routes   | 300   | 60          | Default — matches SECURITY.md §6 baseline (300 req/min per user).            |

Applied as a global middleware on the protected sub-app, with a per-route override for `POST /stores`.

### 11.4 Not included (to keep scope honest)

- Per-IP limiting (complements per-user; defer until we see abusive anons).
- Sliding window algorithm (MVP uses fixed window — slightly less fair but much simpler).
- Distributed backend (see §11.2).

## 12. UI / UX flows

### 12.1 Onboarding — post-org-creation

After `POST /v1/organizations` returns 201, the **create-organization** flow's success redirect changes from `/dashboard` → `/onboarding/connect-store`. The new page:

1. Renders the `ConnectStoreForm` (shared component, also used in the dashboard modal).
2. `ConnectStoreForm` shows:
   - A platform selector: two `PlatformCard`s. Trendyol selectable; Hepsiburada rendered with a "Yakında" badge and `aria-disabled` / not clickable.
   - A store name input (D6 — user types, placeholder `Trendyol Mağazam`).
   - `EnvironmentTabs` (`Canlı` / `Sandbox`). Hidden entirely in prod — decided by `NEXT_PUBLIC_ALLOW_SANDBOX_CONNECTIONS !== 'true'`. When hidden, the implicit value is `PRODUCTION`.
   - Credential fields: `supplierId`, `apiKey`, `apiSecret` (all `type="password"` — no eye-toggle reveal; zero copy-out paths).
   - Submit button with `loading` state during credential probe (§7.3 — up to 10s timeout).
   - Below the form: a low-emphasis `"Şimdilik geç →"` link that navigates to `/dashboard`. No persistence, no flag; the dashboard's empty state reappears every load until a store exists. Simpler than a "skipped" tombstone.

3. On success (201): `sonner` toast (localized), redirect to `/dashboard`.

### 12.2 Dashboard — recurring access

Two surfaces:

**Empty state** — when `useStores().data.length === 0`, the dashboard main column renders the existing `<EmptyState>` pattern component with a "Mağazanı bağla" primary CTA opening `<ConnectStoreModal>`. This reuses `components/patterns/empty-state.tsx` — no custom UI.

**Add another store** — the existing `OrgSwitcher` dropdown in the context-rail gains a second section "Mağazalar" with a `+ Yeni Mağaza` item that also opens `<ConnectStoreModal>`. The modal is just the same `<ConnectStoreForm>` wrapped in `<Dialog>`. Closes on success, triggers `queryClient.invalidateQueries({ queryKey: storeKeys.all })` so any dashboard panel reflects the new store without a full reload.

### 12.3 UI component cascade (CLAUDE.md discipline)

Every new component is composed from existing primitives:

| New component              | Built on                                                       |
| -------------------------- | -------------------------------------------------------------- |
| `connect-store-form.tsx`   | `ui/{form, input, label, button, alert}`                       |
| `connect-store-modal.tsx`  | `ui/dialog` + `connect-store-form.tsx`                         |
| `platform-card.tsx`        | `ui/card` + `ui/badge` (for "Yakında")                         |
| `stores-empty-state.tsx`   | `patterns/empty-state.tsx` (existing) — no fork                |
| `environment-tabs.tsx`     | `ui/tabs`                                                      |

No new tokens. No new colors. No new `patterns/` composites unless the cross-feature reuse is obvious — our `stores-empty-state` stays in the feature folder unless `expenses` or `products` needs the same shape.

### 12.4 Error surface UX

The frontend relies on the existing `QueryProvider` global onError (PR #34):

- `MARKETPLACE_AUTH_FAILED` → Turkish toast via `common.errors.MARKETPLACE_AUTH_FAILED`.
- `MARKETPLACE_UNREACHABLE` → Turkish toast via `common.errors.MARKETPLACE_UNREACHABLE` + (meta) a "Tekrar dene" affordance on the form submit button.
- `SANDBOX_NOT_ALLOWED` is `VALIDATION_ERROR` — flows through the existing per-form inline-error path (form.setError via the discriminated union walk in `use-create-organization`).
- `DUPLICATE_STORE_CONNECTION` → `CONFLICT` → toast + (for polish) the form disables the `supplierId` input and suggests navigating to the existing store. This suggestion is optional polish — not in the Definition of Done.
- `RATE_LIMITED` → global toast already handles it; no form special-casing.

## 13. i18n additions

Both `apps/web/messages/tr.json` and `en.json` get:

- `stores.connect.*` — page copy (`title`, `subtitle`, `labels.*`, `actions.*`, `skip`)
- `stores.connect.errors.*` — feature codes (`INVALID_SUPPLIER_ID_FORMAT`, `INVALID_API_KEY_FORMAT`, `INVALID_NAME_TOO_SHORT`, `INVALID_NAME_TOO_LONG`, `SANDBOX_NOT_ALLOWED`, `PLATFORM_NOT_YET_AVAILABLE`, `DUPLICATE_STORE_CONNECTION`)
- `stores.platforms.{TRENDYOL,HEPSIBURADA}` — display labels
- `stores.platformStatus.comingSoon` — "Yakında"
- `stores.empty.{title,subtitle,cta}` — empty-state copy
- `common.errors.MARKETPLACE_AUTH_FAILED` — pan-app
- `common.errors.MARKETPLACE_ACCESS_DENIED` — pan-app
- `common.errors.MARKETPLACE_UNREACHABLE` — pan-app

New pan-app codes also go into `KNOWN_CODES` in `apps/web/src/providers/query-provider.tsx` so the global toast doesn't fall back to `generic`.

Zero inline Turkish in components or validators — every user-facing string flows through next-intl. (`apps/web/CLAUDE.md`, `apps/api/CLAUDE.md` §"Zod validation → VALIDATION_ERROR")

## 14. Testing strategy

Follows `docs/TESTING.md` + the `apps/api/CLAUDE.md` "When tests are required" table. Non-negotiable items first.

### 14.1 Backend

- **Unit (`tests/unit/`):**
  - `lib/errors.test.ts` — add cases for `MarketplaceAuthError`, `MarketplaceAccessError`, `MarketplaceUnreachable` (status / code / headers).
  - `lib/problem-details.test.ts` — map each of the three new errors.
  - `integrations/marketplace/trendyol/errors.test.ts` — every vendor-status-code-to-domain-error mapping has a test.
  - `middleware/rate-limit.middleware.test.ts` — standalone Hono app + sequential requests exercising max+1, window rollover, key isolation by user.

- **Integration (`tests/integration/routes/`):**
  - `stores.routes.test.ts` — happy path, auth rejection, HB platform rejected, SANDBOX gate (with env toggled both ways via `vi.stubEnv`), duplicate connection returns 409 with code `DUPLICATE_STORE_CONNECTION`.
  - Trendyol HTTP client is mocked at the `fetch` layer — we own the vendor mapping; we don't want the test suite reaching stageapigw.

- **Multi-tenancy (`tests/integration/tenant-isolation/`):**
  - `stores-isolation.test.ts` — create a store in org A, query it from org B's token → 404. Mandatory per SECURITY.md §9 + `apps/api/CLAUDE.md` "Forbidden patterns" list. No exceptions.

- **RLS (`tests/integration/rls/`):**
  - `stores.rls.test.ts` — canonical pattern from `org-scoped-tables.rls.test.ts`. Two JWT-scoped Supabase clients, each probing the other org's store rows, asserting empty result.
  - Append `"stores"` to `TENANT_TABLES` in `coverage.rls.test.ts`.

### 14.2 Frontend

- **Hook tests (`tests/unit/hooks/`):**
  - `use-stores.test.tsx` — MSW handler returning a list; assert `.data` shape.
  - `use-connect-store.test.tsx` — success path + `MARKETPLACE_AUTH_FAILED` path (asserts `ApiError.code` surfaces unchanged); `VALIDATION_ERROR` propagation into `form.setError`.
  - `use-disconnect-store.test.tsx` — success path + cache invalidation.

- **Component tests (`tests/component/`):**
  - `connect-store-form.test.tsx` — happy submit, field validation errors, Hepsiburada card disabled & unreachable, environment-tabs hidden when env var absent.
  - `stores-empty-state.test.tsx` — CTA opens modal.

### 14.3 Manual smoke (pre-merge)

Required per `apps/api/CLAUDE.md` — auth-touching changes need an end-to-end manual check. We extend the habit:

1. `supabase start && pnpm db:push && pnpm db:seed` → local stack green.
2. `pnpm dev` (both apps).
3. Sign in as seed user → `/onboarding/create-organization` → create → land on `/onboarding/connect-store`.
4. Type invalid Trendyol credentials → assert Turkish toast with the right code.
5. Type correct sandbox credentials (requires IP whitelist per Trendyol; dev's own IP works for the personal sandbox account). Assert 201 + redirect.
6. Check DB: `stores` row exists, `credentials` column is a base64 blob (not plaintext JSON), `external_account_id` equals the supplierId.
7. Re-submit the same creds → assert 409 + the localized "zaten bağlı" toast.
8. Sign out → sign in → dashboard shows the connected store via `useStores()`.
9. Disconnect → assert 204 + dashboard empty state reappears.

This smoke script is included verbatim in the implementation plan's `Verification` section.

## 15. Environment variables

Per the memory note "new env var requires three-file update" — `.env.example`, `turbo.json`, `.github/workflows/ci.yml` all get the additions in the same commit, plus `validateRequiredEnv()` in `apps/api/src/lib/env.ts` picks up the required ones.

```bash
# ─── apps/api (Trendyol) ──────────────────────────
TRENDYOL_PROD_BASE_URL=https://apigw.trendyol.com
TRENDYOL_SANDBOX_BASE_URL=https://stageapigw.trendyol.com
TRENDYOL_INTEGRATOR_UA_SUFFIX=SelfIntegration

# D4 — sandbox gate. PROD deployments MUST set this to `false` or omit.
ALLOW_SANDBOX_CONNECTIONS=true

# ─── apps/web ─────────────────────────────────────
# Mirror of ALLOW_SANDBOX_CONNECTIONS — hides the sandbox tab in the UI.
# Cosmetic only; backend is the real gate.
NEXT_PUBLIC_ALLOW_SANDBOX_CONNECTIONS=true
```

Also: **removes** the current `TRENDYOL_BASE_URL=https://api.trendyol.com/sapigw` line — it is an outdated URL from a pre-PR baseline; Trendyol's live docs say `apigw.trendyol.com`. The `HEPSIBURADA_BASE_URL` line stays untouched (HB is next-phase).

## 16. Open questions / risks

None are blocking; each has a recommended disposition.

| #   | Question / risk                                                                                                                             | Recommended disposition                                                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| O1  | If Trendyol changes the product-filter endpoint path / rate, the probe breaks silently with 404.                                            | Return a `MarketplaceUnreachable` on any non-mapped 4xx outside of 401/403 — logs surface the oddity. Monitor vendor changelog quarterly.              |
| O2  | The in-memory rate-limit store resets on deploy, briefly letting a rate-limited user retry immediately.                                    | Acceptable for MVP; §11.2 documents this. Upgrade ticket opened when we scale to >1 pod.                                                              |
| O3  | Sandbox IP whitelist is manual via Trendyol support call (0850 258 58 00).                                                                   | Developer responsibility — not automatable. Document in `docs/integrations/trendyol/` with a note for new contributors.                              |
| O4  | `isActive` column on `Store` duplicates `status` semantics during the transition.                                                            | Keep both this PR; follow-up PR removes `isActive` and backfills `status` from it. Avoids breaking any unseen readers today.                          |
| O5  | Our `User-Agent` always says `SelfIntegration`. If we ever build a white-label integration offering, this has to change to per-org values. | Out of scope. `TRENDYOL_INTEGRATOR_UA_SUFFIX` is already env-driven, so a single deploy-wide override is a one-line change.                          |
| O6  | Rate-limit applied to `POST /stores` at 5/min counts **successful** creates too. A power user legitimately onboarding multiple stores could hit the wall. | Acceptable — 5 stores in 60 seconds is still well above realistic onboarding patterns. If it becomes a user complaint, narrow the key to exclude 2xx responses (common pattern; deferred). |

## 17. Rollback plan

Each implementation commit is individually revertable. The order (detailed in the implementation plan) is chosen so that partial reverts leave the system working:

1. DB migration + RLS commit (forward-compatible — new columns are nullable-with-defaults or have a backfill step).
2. Backend adapter + service + route commits.
3. Frontend feature commits.
4. Rate-limit middleware — independent; revertable in isolation.
5. Env var additions — revertable alongside the consumer commits.

If a regression is caught post-merge:

- **DB-layer regression** (migration failed on a seat of real data): the migration up/down pair is symmetric. `prisma migrate resolve` + `prisma migrate reset` on staging; on prod, `pnpm db:push` with the previous schema after a branch revert.
- **Credential-probe regression** (Trendyol changed something): revert the PR that touched `trendyol/client.ts` — the DB rows created under the old probe stay valid (they only validate on connect, not on read).
- **Rate-limit misconfiguration** (5/min too tight, real users blocked): revert just the rate-limit commit. Store create stays working because the error class + mapping already exist in main; only the middleware that throws is removed.

## 18. Summary for the reviewer

The goal is a one-click "connect Trendyol" that is **atomically safe** (probe + encrypt + persist in one route), **environment-gated** (sandbox unreachable in prod by backend rule, not just UI), **tenant-isolated** at three layers per `docs/SECURITY.md`, and **open to Hepsiburada** without touching Trendyol code.

The bulk of this doc is not new infrastructure — it is threading store creation through the existing primitives (encryption helper, RFC 7807 error pipeline, throwApiError, QueryProvider onError, createSubApp, mapPrismaError, RLS template, three-file env discipline). Two genuinely new things land: the marketplace adapter interface + registry (§6) and the rate-limit middleware (§11). Both are minimum-viable shapes chosen to make the second adapter and the second rate-limit backend painless.
