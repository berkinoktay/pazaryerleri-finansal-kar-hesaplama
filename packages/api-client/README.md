# @pazarsync/api-client

Typed REST client for the PazarSync backend. Wraps [`openapi-fetch`](https://openapi-ts.dev/openapi-fetch/) over types generated from the backend's OpenAPI 3.1 spec — autocomplete on every path, param, request body, and response.

## How it works

```
apps/api  ──(@hono/zod-openapi)──▶  packages/api-client/openapi.json  ──(openapi-typescript)──▶  src/generated/api.d.ts
                                       (committed snapshot)                                       (gitignored)
```

1. **`apps/api`** defines routes with `@hono/zod-openapi`'s `createRoute(...)` and Zod schemas annotated via `.openapi(...)`.
2. **`apps/api/scripts/dump-openapi.ts`** writes the resulting OpenAPI 3.1 document to **`./openapi.json`** in this package — that file is committed and is the contract.
3. **`openapi-typescript`** reads `openapi.json` and emits **`./src/generated/api.d.ts`** — typed `paths` + `components` interfaces. Generated types are gitignored and rebuilt during `pnpm install` / on demand.
4. **`apps/web`** consumes both the runtime client and the generated types from this package.

CI rejects PRs where `openapi.json` drifts from the registered routes.

## Usage

```typescript
import type { components, paths } from '@pazarsync/api-client';
import createClient from 'openapi-fetch';

export const apiClient = createClient<paths>({
  baseUrl: process.env.NEXT_PUBLIC_API_URL,
});

// Autocompletes on path, params, query, and body
const { data, error } = await apiClient.GET('/v1/organizations/{orgId}/stores/{storeId}/orders', {
  params: { path: { orgId, storeId }, query: { status: 'DELIVERED' } },
});

type Order = components['schemas']['Order'];
```

> **Path keys are version-prefixed** (`/v1/...`) because `OpenAPIHono().basePath("/v1")` bakes the prefix into the spec. The frontend `baseUrl` must NOT include `/v1`.

The frontend wraps this client in feature-level API functions (`apps/web/src/features/<feature>/api/<feature>.api.ts`) — never call raw `fetch()` against the API.

## Regenerating

After any backend route change:

```bash
pnpm api:sync               # from the repo root — runs:
                            #   1) apps/api openapi:dump  → ./openapi.json
                            #   2) packages/api-client codegen → ./src/generated/api.d.ts
```

Commit the regenerated `openapi.json`. Generated types are not committed — the snapshot is enough to reproduce them.

## Why this design

- **One source of truth.** Backend Zod schemas are the contract. Frontend types can never drift, because they're rebuilt from the spec.
- **Type-safe end to end.** Path typos, missing params, wrong request shapes — all caught at compile time.
- **Mockable in tests.** Frontend hook tests intercept HTTP at the network layer with MSW, so the same typed client is exercised in tests as in production.
