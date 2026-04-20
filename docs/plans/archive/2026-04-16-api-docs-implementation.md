# REST API Documentation Infrastructure — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Wire up automatic OpenAPI 3.1 spec generation from Zod schemas, render Scalar docs UI in dev/staging, generate TypeScript types for the frontend, and validate the full pipeline with one exemplar route.

**Architecture:** `@hono/zod-openapi` wraps Zod schemas with `.openapi()` metadata. `OpenAPIHono` auto-generates the spec at `/v1/openapi.json` (env-gated, dev/staging only). Scalar renders interactive docs at `/v1/docs`. A new `@pazarsync/api-client` package holds the `openapi.json` snapshot and runs `openapi-typescript` to emit TypeScript types. `apps/web` imports types via the package and uses `openapi-fetch` as a typed runtime client.

**Tech Stack:** Hono 4, `@hono/zod-openapi`, `@scalar/hono-api-reference`, `openapi-typescript`, `openapi-fetch`, Zod 3, Vitest, TypeScript 5, Prisma 7, Turborepo, pnpm 10.

**Reference design:** `docs/plans/2026-04-16-api-docs-design.md`

**Reference docs (project-internal):**

- `docs/SECURITY.md` — security invariants
- `docs/ARCHITECTURE.md` — system architecture
- `apps/api/CLAUDE.md` — backend coding rules
- `apps/web/CLAUDE.md` — frontend coding rules

---

## Phase 1: Foundation (low-risk standalone changes)

### Task 1: Add Vitest to apps/api and packages/utils

**Why:** Cursor encode/decode utilities (Phase 2) and the exemplar route (Phase 5) need a test runner. Vitest is mentioned in `pnpm check:all` per root CLAUDE.md but not yet installed.

**Files:**

- Modify: `apps/api/package.json`
- Modify: `packages/utils/package.json`
- Create: `apps/api/vitest.config.ts`
- Create: `packages/utils/vitest.config.ts`
- Create: `apps/api/tests/.gitkeep`
- Create: `packages/utils/tests/.gitkeep`

**Step 1: Add vitest dev dep to apps/api**

```bash
pnpm --filter @pazarsync/api add -D vitest @vitest/ui
```

Expected: `+ vitest 3.x.y` in output, `apps/api/package.json` updated.

**Step 2: Add vitest dev dep to packages/utils**

```bash
pnpm --filter @pazarsync/utils add -D vitest
```

Expected: `+ vitest 3.x.y` added to `packages/utils/package.json`.

**Step 3: Create vitest config for apps/api**

Write `apps/api/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
  },
});
```

**Step 4: Create vitest config for packages/utils**

Write `packages/utils/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
  },
});
```

**Step 5: Add `test` script to both package.json files**

In `apps/api/package.json`, add to `scripts`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

In `packages/utils/package.json`, add to `scripts`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

**Step 6: Add empty placeholder so test dirs aren't lost**

```bash
mkdir -p apps/api/tests packages/utils/tests
touch apps/api/tests/.gitkeep packages/utils/tests/.gitkeep
```

**Step 7: Verify vitest runs (no tests yet, but the runner should start)**

```bash
pnpm --filter @pazarsync/api test 2>&1 | tail -5
pnpm --filter @pazarsync/utils test 2>&1 | tail -5
```

Expected: "No test files found" or similar — that's fine, the runner started.

**Step 8: Commit**

```bash
git add apps/api/package.json apps/api/vitest.config.ts apps/api/tests/.gitkeep \
        packages/utils/package.json packages/utils/vitest.config.ts packages/utils/tests/.gitkeep \
        pnpm-lock.yaml
git commit -m "chore: add vitest test runner to apps/api and packages/utils"
```

---

### Task 2: Create API changelog file

**Why:** Per design Section "Versioning", every API change is logged in `docs/api-changelog.md` using Keep a Changelog format.

**Files:**

- Create: `docs/api-changelog.md`

**Step 1: Write the changelog**

```markdown
# API Changelog

All notable changes to the PazarSync REST API.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this API follows [Semantic Versioning](https://semver.org/) within each URL
path version (`/v1/`, `/v2/`, …). The major number of `info.version` is locked
to the URL path version. While the API is internal-only, breaking changes
within `/v1/` bump minor — see `docs/plans/2026-04-16-api-docs-design.md`
section "Versioning" for details.

## [Unreleased]

### Added

- (PR template: list new endpoints, fields, schemas here)

### Changed

- (Document non-breaking modifications here)

### Deprecated

- (Mark endpoints scheduled for removal)

### Removed

- (Document removed endpoints / fields)

### Fixed

- (Document API behavior fixes)

### Security

- (Document security-relevant changes)

## [1.0.0] — 2026-04-16

Initial release. API exposed under `/v1/`. Documentation served via Scalar at
`/v1/docs` (dev/staging only). Spec at `/v1/openapi.json`. Frontend consumes
via the `@pazarsync/api-client` workspace package.
```

**Step 2: Commit**

```bash
git add docs/api-changelog.md
git commit -m "docs: add API changelog (Keep a Changelog format)"
```

---

### Task 3: Rename `apps/api/src/marketplace/` → `apps/api/src/integrations/marketplace/`

**Why:** Per design Section "Boundaries", marketplace adapters live under `integrations/` to leave room for future integration types (accounting, banking, export).

**Files:**

- Move: `apps/api/src/marketplace/**` → `apps/api/src/integrations/marketplace/**`

**Step 1: Move with git mv to preserve history**

```bash
mkdir -p apps/api/src/integrations
git mv apps/api/src/marketplace apps/api/src/integrations/marketplace
```

**Step 2: Verify the structure**

```bash
ls apps/api/src/integrations/marketplace/
```

Expected: `hepsiburada/  trendyol/`

**Step 3: Verify nothing imports the old path**

```bash
grep -rn "src/marketplace\|from \"@/marketplace" apps/api/src/ 2>&1 || echo "No references found"
```

Expected: "No references found" (the skeleton has only `.gitkeep` files in those folders, no real imports yet).

**Step 4: Verify typecheck still passes**

```bash
cd /Users/berkin/Desktop/My_Code_Workspace/pazaryerleri-finansal-kar-hesaplama-saas/apps/api && npx tsc --noEmit
```

Expected: no errors.

**Step 5: Commit**

```bash
git add apps/api/src/
git commit -m "refactor(api): move marketplace adapters under integrations/"
```

---

## Phase 2: Cursor Pagination Utilities

### Task 4: Replace offset paginationSchema with cursor utilities (TDD)

**Why:** Per design Section "Pagination", the API uses cursor-based pagination only. The current `paginationSchema` (offset/page) in `packages/utils/src/validation.ts` must be replaced with `cursorPaginationSchema` plus `encodeCursor` / `decodeCursor` helpers that validate sort consistency.

**Files:**

- Modify: `packages/utils/src/validation.ts`
- Create: `packages/utils/src/cursor.ts`
- Create: `packages/utils/tests/cursor.test.ts`
- Modify: `packages/utils/src/index.ts`

**Step 1: Write the failing test for cursor encode/decode round-trip**

Write `packages/utils/tests/cursor.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  encodeCursor,
  decodeCursor,
  CursorSortMismatchError,
  InvalidCursorError,
} from '../src/cursor';

describe('encodeCursor / decodeCursor', () => {
  it('round-trips a cursor with the same sort', () => {
    const sort = 'order_date:desc';
    const values = { order_date: '2026-04-15T14:30:00Z', id: 'abc-123' };
    const encoded = encodeCursor({ sort, values });
    const decoded = decodeCursor(encoded, sort);
    expect(decoded).toEqual({ sort, values });
  });

  it('throws CursorSortMismatchError when sort param differs from cursor sort', () => {
    const encoded = encodeCursor({
      sort: 'order_date:desc',
      values: { order_date: '2026-04-15T14:30:00Z', id: 'abc-123' },
    });
    expect(() => decodeCursor(encoded, 'profit:desc')).toThrow(CursorSortMismatchError);
  });

  it('throws InvalidCursorError when cursor is malformed base64', () => {
    expect(() => decodeCursor('not-valid-base64!@#', 'order_date:desc')).toThrow(
      InvalidCursorError,
    );
  });

  it('throws InvalidCursorError when cursor JSON is missing required fields', () => {
    const malformed = Buffer.from(JSON.stringify({ values: { id: 'x' } })).toString('base64');
    expect(() => decodeCursor(malformed, 'order_date:desc')).toThrow(InvalidCursorError);
  });

  it('throws InvalidCursorError when cursor version is unsupported', () => {
    const futureVersion = Buffer.from(
      JSON.stringify({ v: 99, sort: 'order_date:desc', values: { order_date: 'x', id: 'y' } }),
    ).toString('base64');
    expect(() => decodeCursor(futureVersion, 'order_date:desc')).toThrow(InvalidCursorError);
  });

  it('includes id as a deterministic tiebreaker in encoded cursor', () => {
    const encoded = encodeCursor({
      sort: 'order_date:desc',
      values: { order_date: '2026-04-15T14:30:00Z', id: 'abc-123' },
    });
    const decoded = JSON.parse(Buffer.from(encoded, 'base64').toString());
    expect(decoded.values.id).toBe('abc-123');
  });
});
```

**Step 2: Run test to verify it fails**

```bash
pnpm --filter @pazarsync/utils test 2>&1 | tail -20
```

Expected: FAIL with errors about missing `../src/cursor` module.

**Step 3: Write the cursor module**

Write `packages/utils/src/cursor.ts`:

```ts
const CURRENT_CURSOR_VERSION = 1 as const;

export interface CursorPayload {
  sort: string;
  values: Record<string, string | number | null> & { id: string };
}

interface EncodedCursor {
  v: number;
  sort: string;
  values: CursorPayload['values'];
}

export class InvalidCursorError extends Error {
  override name = 'InvalidCursorError';
  constructor(reason: string) {
    super(`Invalid cursor: ${reason}`);
  }
}

export class CursorSortMismatchError extends Error {
  override name = 'CursorSortMismatchError';
  constructor(
    public cursorSort: string,
    public requestSort: string,
  ) {
    super(`Cursor was issued for sort "${cursorSort}" but request sort is "${requestSort}"`);
  }
}

export function encodeCursor(payload: CursorPayload): string {
  const obj: EncodedCursor = {
    v: CURRENT_CURSOR_VERSION,
    sort: payload.sort,
    values: payload.values,
  };
  return Buffer.from(JSON.stringify(obj), 'utf-8').toString('base64');
}

export function decodeCursor(cursor: string, expectedSort: string): CursorPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64').toString('utf-8'));
  } catch {
    throw new InvalidCursorError('not valid base64-encoded JSON');
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>).v !== 'number' ||
    typeof (parsed as Record<string, unknown>).sort !== 'string' ||
    typeof (parsed as Record<string, unknown>).values !== 'object' ||
    (parsed as Record<string, unknown>).values === null
  ) {
    throw new InvalidCursorError('missing required fields (v, sort, values)');
  }

  const { v, sort, values } = parsed as EncodedCursor;

  if (v !== CURRENT_CURSOR_VERSION) {
    throw new InvalidCursorError(`unsupported cursor version ${v}`);
  }

  if (typeof values.id !== 'string') {
    throw new InvalidCursorError("missing required tiebreaker 'id' in values");
  }

  if (sort !== expectedSort) {
    throw new CursorSortMismatchError(sort, expectedSort);
  }

  return { sort, values };
}
```

**Step 4: Run tests to verify all pass**

```bash
pnpm --filter @pazarsync/utils test 2>&1 | tail -20
```

Expected: 6 tests pass.

**Step 5: Replace offset `paginationSchema` with `cursorPaginationSchema` in validation.ts**

Read the current `packages/utils/src/validation.ts` and replace the `paginationSchema` block with a cursor-based one. Final content:

```ts
import { z } from 'zod';

export const cursorPaginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const dateRangeSchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
});

export type CursorPaginationInput = z.infer<typeof cursorPaginationSchema>;
export type DateRangeInput = z.infer<typeof dateRangeSchema>;
```

**Step 6: Update barrel export in packages/utils/src/index.ts**

Replace:

```ts
export { paginationSchema, dateRangeSchema } from './validation';
export type { PaginationInput, DateRangeInput } from './validation';
```

With:

```ts
export { cursorPaginationSchema, dateRangeSchema } from './validation';
export type { CursorPaginationInput, DateRangeInput } from './validation';
export {
  encodeCursor,
  decodeCursor,
  InvalidCursorError,
  CursorSortMismatchError,
  type CursorPayload,
} from './cursor';
```

**Step 7: Verify typecheck passes for packages/utils**

```bash
cd /Users/berkin/Desktop/My_Code_Workspace/pazaryerleri-finansal-kar-hesaplama-saas/packages/utils && npx tsc --noEmit
```

Expected: no errors.

**Step 8: Commit**

```bash
git add packages/utils/
git commit -m "feat(utils): replace offset pagination with cursor utilities

- Add encodeCursor/decodeCursor with sort-mismatch and version validation
- Replace paginationSchema (page/limit) with cursorPaginationSchema (cursor/limit)
- Add unit tests for round-trip, sort mismatch, malformed input, version mismatch"
```

---

## Phase 3: OpenAPI Backend Infrastructure

### Task 5: Install OpenAPI dependencies in apps/api

**Files:**

- Modify: `apps/api/package.json`

**Step 1: Install runtime deps**

```bash
pnpm --filter @pazarsync/api add @hono/zod-openapi @scalar/hono-api-reference
```

Expected: both packages added under `dependencies`.

**Step 2: Verify @hono/zod-validator is still present (we keep it for routes that don't need OpenAPI yet)**

```bash
grep "@hono/zod-validator" apps/api/package.json
```

Expected: line printed.

**Step 3: Commit**

```bash
git add apps/api/package.json pnpm-lock.yaml
git commit -m "chore(api): install @hono/zod-openapi and @scalar/hono-api-reference"
```

---

### Task 6: Create shared OpenAPI schemas — `ProblemDetails` and validation error

**Why:** Every route returns RFC 7807 ProblemDetails. Defining once avoids per-route duplication and locks the contract shape.

**Files:**

- Create: `apps/api/src/openapi/error-schemas.ts`

**Step 1: Write the schemas**

Write `apps/api/src/openapi/error-schemas.ts`:

```ts
import { z } from '@hono/zod-openapi';

export const ValidationErrorDetailSchema = z
  .object({
    field: z.string().openapi({ example: 'costPrice' }),
    code: z.string().openapi({ example: 'NUMBER_TOO_SMALL' }),
    meta: z
      .record(z.string(), z.unknown())
      .optional()
      .openapi({ example: { min: 0 } }),
  })
  .openapi('ValidationErrorDetail');

export const ProblemDetailsSchema = z
  .object({
    type: z.string().url().openapi({
      example: 'https://api.pazarsync.com/errors/order-not-found',
      description: 'URI identifying the error category',
    }),
    title: z.string().openapi({ example: 'Order Not Found' }),
    status: z.number().int().openapi({ example: 404 }),
    code: z.string().openapi({
      example: 'ORDER_NOT_FOUND',
      description: 'Stable machine-readable error code (SCREAMING_SNAKE_CASE)',
    }),
    detail: z.string().openapi({ example: 'Order abc-uuid not found in store xyz-uuid' }),
    errors: z.array(ValidationErrorDetailSchema).optional(),
  })
  .openapi('ProblemDetails');
```

**Step 2: Verify typecheck**

```bash
cd /Users/berkin/Desktop/My_Code_Workspace/pazaryerleri-finansal-kar-hesaplama-saas/apps/api && npx tsc --noEmit
```

Expected: no errors.

**Step 3: Commit**

```bash
git add apps/api/src/openapi/error-schemas.ts
git commit -m "feat(api): add shared ProblemDetails OpenAPI schemas (RFC 7807)"
```

---

### Task 7: Create rate-limit headers and shared 429 response

**Files:**

- Create: `apps/api/src/openapi/rate-limit.ts`

**Step 1: Define the rate-limit headers component**

Write `apps/api/src/openapi/rate-limit.ts`:

```ts
import { z } from '@hono/zod-openapi';
import { ProblemDetailsSchema } from './error-schemas';

/**
 * Standard rate-limit response headers attached to every successful response
 * on a protected endpoint. Values are set by the rate-limit middleware.
 */
export const RateLimitHeaders = {
  'X-RateLimit-Limit': {
    schema: z.number().int(),
    description: 'Maximum requests permitted in the current window',
  },
  'X-RateLimit-Remaining': {
    schema: z.number().int(),
    description: 'Requests remaining in the current window',
  },
  'X-RateLimit-Reset': {
    schema: z.number().int(),
    description: 'Epoch seconds when the current window resets',
  },
} as const;

/**
 * Shared 429 response definition. Every protected endpoint inherits this in
 * its `responses[429]` block.
 */
export const Common429Response = {
  description: 'Rate limit exceeded',
  headers: {
    'Retry-After': {
      schema: z.number().int(),
      description: 'Seconds to wait before retrying',
    },
  },
  content: {
    'application/json': { schema: ProblemDetailsSchema },
  },
} as const;
```

**Step 2: Verify typecheck**

```bash
cd /Users/berkin/Desktop/My_Code_Workspace/pazaryerleri-finansal-kar-hesaplama-saas/apps/api && npx tsc --noEmit
```

Expected: no errors.

**Step 3: Commit**

```bash
git add apps/api/src/openapi/rate-limit.ts
git commit -m "feat(api): add rate-limit headers and shared 429 response component"
```

---

### Task 8: Create cursor pagination response shape and helper

**Why:** Every paginated endpoint returns `{ data: [...], meta: { nextCursor, hasMore, limit } }`. Define once.

**Files:**

- Create: `apps/api/src/openapi/pagination.ts`

**Step 1: Write the schemas**

Write `apps/api/src/openapi/pagination.ts`:

```ts
import { z, type ZodTypeAny } from '@hono/zod-openapi';

export const CursorMetaSchema = z
  .object({
    nextCursor: z.string().nullable().openapi({
      example:
        'eyJ2IjoxLCJzb3J0Ijoib3JkZXJfZGF0ZTpkZXNjIiwidmFsdWVzIjp7Im9yZGVyX2RhdGUiOiIyMDI2LTA0LTE1VDE0OjMwOjAwWiIsImlkIjoiYWJjLTEyMyJ9fQ',
      description: 'Base64-encoded opaque cursor for the next page; null if no more results',
    }),
    hasMore: z.boolean(),
    limit: z.number().int(),
  })
  .openapi('CursorMeta');

/**
 * Build a paginated response schema for a given item type.
 *
 * Usage:
 *   const PaginatedOrders = paginated(OrderSchema).openapi("PaginatedOrders");
 */
export function paginated<T extends ZodTypeAny>(itemSchema: T) {
  return z.object({
    data: z.array(itemSchema),
    meta: CursorMetaSchema,
  });
}
```

**Step 2: Verify typecheck**

```bash
cd /Users/berkin/Desktop/My_Code_Workspace/pazaryerleri-finansal-kar-hesaplama-saas/apps/api && npx tsc --noEmit
```

Expected: no errors.

**Step 3: Commit**

```bash
git add apps/api/src/openapi/pagination.ts
git commit -m "feat(api): add cursor pagination meta schema and paginated() helper"
```

---

### Task 9: Register `bearerAuth` security scheme + barrel export

**Files:**

- Create: `apps/api/src/openapi/security.ts`
- Create: `apps/api/src/openapi/index.ts`

**Step 1: Define the security scheme**

Write `apps/api/src/openapi/security.ts`:

```ts
/**
 * Supabase JWT Bearer token. Documented in the OpenAPI spec under
 * `components.securitySchemes.bearerAuth`. Applied via `security: [{ bearerAuth: [] }]`
 * on each authenticated route.
 */
export const bearerAuthScheme = {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
  description: 'Supabase JWT token issued by `/v1/auth/signin`',
} as const;
```

**Step 2: Create the barrel export**

Write `apps/api/src/openapi/index.ts`:

```ts
export { ProblemDetailsSchema, ValidationErrorDetailSchema } from './error-schemas';
export { RateLimitHeaders, Common429Response } from './rate-limit';
export { CursorMetaSchema, paginated } from './pagination';
export { bearerAuthScheme } from './security';
```

**Step 3: Verify typecheck**

```bash
cd /Users/berkin/Desktop/My_Code_Workspace/pazaryerleri-finansal-kar-hesaplama-saas/apps/api && npx tsc --noEmit
```

Expected: no errors.

**Step 4: Commit**

```bash
git add apps/api/src/openapi/
git commit -m "feat(api): register bearerAuth security scheme and barrel-export OpenAPI components"
```

---

### Task 10: Migrate `apps/api/src/index.ts` to OpenAPIHono with `/health` route, register security scheme, mount Scalar UI (env-gated)

**Files:**

- Modify: `apps/api/src/index.ts`

**Step 1: Rewrite the entry file**

Replace the entire contents of `apps/api/src/index.ts` with:

```ts
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { apiReference } from '@scalar/hono-api-reference';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';

import { bearerAuthScheme } from './openapi';

const app = new OpenAPIHono().basePath('/v1');

app.use('*', logger());
app.use('*', cors());

// Register the bearerAuth security scheme on the document.
app.openAPIRegistry.registerComponent('securitySchemes', 'bearerAuth', bearerAuthScheme);

// Health check — public, unauthenticated, used by load balancers.
const healthRoute = createRoute({
  method: 'get',
  path: '/health',
  tags: ['System'],
  summary: 'Health check',
  description: 'Returns 200 when the service is up. Public endpoint, no auth required.',
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.object({ status: z.literal('ok') }).openapi('HealthResponse'),
        },
      },
      description: 'Service is healthy',
    },
  },
});

app.openapi(healthRoute, (c) => c.json({ status: 'ok' as const }, 200));

// Spec + docs UI — DEV/STAGING ONLY. Production has no public surface here.
if (process.env['NODE_ENV'] !== 'production') {
  app.doc31('/openapi.json', {
    openapi: '3.1.0',
    info: {
      title: 'PazarSync API',
      version: '1.0.0',
      description:
        'Internal REST API. See `docs/plans/2026-04-16-api-docs-design.md` for conventions.',
    },
    servers: [
      { url: 'http://localhost:3001/v1', description: 'Local dev' },
      { url: 'https://staging-api.pazarsync.com/v1', description: 'Staging' },
    ],
    security: [{ bearerAuth: [] }],
  });

  app.get(
    '/docs',
    apiReference({
      url: '/v1/openapi.json',
      pageTitle: 'PazarSync API Reference',
    }),
  );
}

export default {
  port: Number(process.env['PORT']) || 3001,
  fetch: app.fetch,
};
```

**Step 2: Verify typecheck**

```bash
cd /Users/berkin/Desktop/My_Code_Workspace/pazaryerleri-finansal-kar-hesaplama-saas/apps/api && npx tsc --noEmit
```

Expected: no errors. If errors appear about `c.json` overload, double-check that `as const` is present on the literal.

**Step 3: Smoke-test the dev server**

```bash
cd /Users/berkin/Desktop/My_Code_Workspace/pazaryerleri-finansal-kar-hesaplama-saas/apps/api && timeout 10 pnpm dev &
sleep 4
curl -s http://localhost:3001/v1/health
echo ""
curl -s http://localhost:3001/v1/openapi.json | head -c 200
echo ""
```

Expected:

- `{"status":"ok"}` from /health
- JSON starting with `{"openapi":"3.1.0","info":{"title":"PazarSync API"…` from /openapi.json

Then kill the lingering server: `pkill -f "tsx watch"` (best-effort).

**Step 4: Commit**

```bash
git add apps/api/src/index.ts
git commit -m "feat(api): migrate to OpenAPIHono, document /health, mount Scalar UI in dev/staging"
```

---

## Phase 4: API Client Package

### Task 11: Scaffold `@pazarsync/api-client` package

**Files:**

- Create: `packages/api-client/package.json`
- Create: `packages/api-client/tsconfig.json`
- Create: `packages/api-client/.gitignore`
- Create: `packages/api-client/src/index.ts`
- Create: `packages/api-client/openapi.json` (placeholder)

**Step 1: Create directory structure**

```bash
mkdir -p packages/api-client/src/generated
```

**Step 2: Write package.json**

Write `packages/api-client/package.json`:

```json
{
  "name": "@pazarsync/api-client",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "codegen": "openapi-typescript ./openapi.json -o ./src/generated/api.d.ts",
    "codegen:watch": "openapi-typescript ./openapi.json -o ./src/generated/api.d.ts --watch",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "openapi-fetch": "^0.13.0"
  },
  "devDependencies": {
    "openapi-typescript": "^7.5.0",
    "typescript": "^5"
  }
}
```

**Step 3: Write tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "noEmit": true
  },
  "include": ["src/**/*.ts", "src/generated/**/*.d.ts"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 4: Write .gitignore**

```
src/generated/
dist/
```

**Step 5: Write the placeholder openapi.json**

Write `packages/api-client/openapi.json`:

```json
{
  "openapi": "3.1.0",
  "info": { "title": "PazarSync API", "version": "1.0.0" },
  "paths": {}
}
```

**Step 6: Write src/index.ts**

```ts
export type { paths, components, operations } from './generated/api';
export { default as createApiClient } from 'openapi-fetch';
```

(`./generated/api` does not exist yet; it will be created by `pnpm codegen` in the next task. TypeScript will error on this until then — that's expected.)

**Step 7: Install deps**

```bash
pnpm install
```

Expected: `@pazarsync/api-client` linked into the workspace.

**Step 8: Generate the initial types from the placeholder spec**

```bash
pnpm --filter @pazarsync/api-client codegen
```

Expected: `packages/api-client/src/generated/api.d.ts` created.

**Step 9: Verify typecheck on the package**

```bash
pnpm --filter @pazarsync/api-client typecheck
```

Expected: no errors.

**Step 10: Commit**

```bash
git add packages/api-client/ pnpm-lock.yaml
git commit -m "feat: scaffold @pazarsync/api-client package with openapi-typescript and openapi-fetch"
```

---

### Task 12: Wire root scripts: `api:openapi`, `api:codegen`, `api:sync`

**Why:** Single command to dump the spec from `apps/api`, regenerate types in `packages/api-client`, and verify they're in sync.

**Files:**

- Create: `apps/api/scripts/dump-openapi.ts`
- Modify: `apps/api/package.json`
- Modify: `package.json` (root)

**Step 1: Create the spec-dump script**

Write `apps/api/scripts/dump-openapi.ts`:

```ts
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';

import { bearerAuthScheme } from '../src/openapi/index.js';

// NOTE: This script must mirror the spec configuration in apps/api/src/index.ts.
// We construct a minimal OpenAPIHono just to call doc31 and write the result.
// As routes are added to apps/api/src/routes/, they must be re-mounted here too.
//
// FUTURE: refactor index.ts to export the configured app so this script can
// import it directly (avoids drift). For now, the routes are minimal.

const app = new OpenAPIHono().basePath('/v1');

app.openAPIRegistry.registerComponent('securitySchemes', 'bearerAuth', bearerAuthScheme);

const healthRoute = createRoute({
  method: 'get',
  path: '/health',
  tags: ['System'],
  summary: 'Health check',
  description: 'Returns 200 when the service is up.',
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.object({ status: z.literal('ok') }).openapi('HealthResponse'),
        },
      },
      description: 'Service is healthy',
    },
  },
});

app.openapi(healthRoute, (c) => c.json({ status: 'ok' as const }, 200));

const spec = app.getOpenAPI31Document({
  openapi: '3.1.0',
  info: {
    title: 'PazarSync API',
    version: '1.0.0',
    description: 'Internal REST API.',
  },
  servers: [
    { url: 'http://localhost:3001/v1', description: 'Local dev' },
    { url: 'https://staging-api.pazarsync.com/v1', description: 'Staging' },
  ],
  security: [{ bearerAuth: [] }],
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dirname, '../../../packages/api-client/openapi.json');

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify(spec, null, 2) + '\n', 'utf-8');

console.log(`✓ Wrote OpenAPI 3.1 spec to ${outPath}`);
```

> **NOTE for the engineer:** The dump script duplicates route registration from `index.ts`. This is a known temporary trade-off — Task 17 (refactor app exports) will resolve it once we have more than the health route. Until then, when adding a new route, mirror it here.

**Step 2: Add a script alias in apps/api/package.json**

Add to `scripts`:

```json
"openapi:dump": "tsx scripts/dump-openapi.ts"
```

**Step 3: Add root scripts in `package.json`**

Add to root `package.json` `scripts` block:

```json
"api:openapi": "pnpm --filter @pazarsync/api openapi:dump",
"api:codegen": "pnpm --filter @pazarsync/api-client codegen",
"api:sync": "pnpm api:openapi && pnpm api:codegen"
```

**Step 4: Run the sync end-to-end**

```bash
pnpm api:sync
```

Expected:

- "✓ Wrote OpenAPI 3.1 spec to …/packages/api-client/openapi.json"
- openapi-typescript regenerates `src/generated/api.d.ts`

**Step 5: Inspect the generated types**

```bash
cat packages/api-client/openapi.json | head -30
head -40 packages/api-client/src/generated/api.d.ts
```

Expected:

- `openapi.json` contains `/health` path
- `api.d.ts` has `paths` interface with `/health` key

**Step 6: Verify everything still typechecks**

```bash
pnpm --filter @pazarsync/api-client typecheck
pnpm --filter @pazarsync/api typecheck
```

Expected: no errors in either.

**Step 7: Commit**

```bash
git add apps/api/scripts/dump-openapi.ts apps/api/package.json package.json packages/api-client/openapi.json packages/api-client/src/generated/api.d.ts
git commit -m "feat: add api:openapi/api:codegen/api:sync scripts to dump and consume OpenAPI spec"
```

---

### Task 13: Add Turborepo cache hint for `api:codegen`

**Why:** When the spec doesn't change, codegen is a cache hit — free in CI.

**Files:**

- Modify: `turbo.json`
- Modify: `packages/api-client/package.json`

**Step 1: Add explicit task definition to turbo.json**

Edit `turbo.json` to add a `codegen` task with input/output declarations:

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "dev": { "cache": false, "persistent": true },
    "build": { "dependsOn": ["^build"], "outputs": [".next/**", "dist/**"] },
    "typecheck": { "dependsOn": ["^build"] },
    "lint": { "dependsOn": ["^build"] },
    "clean": { "cache": false },
    "codegen": {
      "inputs": ["openapi.json"],
      "outputs": ["src/generated/**"]
    }
  }
}
```

**Step 2: Verify Turborepo recognizes the task**

```bash
pnpm turbo run codegen --filter=@pazarsync/api-client --dry-run 2>&1 | tail -10
```

Expected: shows "codegen" as a task that would run (or a cache hit if already run).

**Step 3: Run codegen via turbo to populate cache**

```bash
pnpm turbo run codegen --filter=@pazarsync/api-client
```

Expected: succeeds; subsequent runs without changes show "cache hit".

**Step 4: Commit**

```bash
git add turbo.json
git commit -m "build: add codegen task to turbo with openapi.json as input"
```

---

## Phase 5: Exemplar End-to-End Route

### Task 14: Create organization Zod schemas with `.openapi()` metadata

**Why:** Exercise the full pipeline (schema → spec → generated types → frontend hook) with one real route. Per design Section "Boundaries", `GET /v1/organizations` is the suggested exemplar.

**Files:**

- Create: `apps/api/src/validators/organization.validator.ts`

**Step 1: Write the schemas**

Write `apps/api/src/validators/organization.validator.ts`:

```ts
import { z } from '@hono/zod-openapi';

export const OrganizationSchema = z
  .object({
    id: z.string().uuid().openapi({ example: '00000000-0000-0000-0000-000000000000' }),
    name: z.string().openapi({ example: 'Akyıldız Store' }),
    slug: z.string().openapi({ example: 'akyildiz-store' }),
    createdAt: z.string().datetime().openapi({ example: '2026-01-15T10:30:00Z' }),
    updatedAt: z.string().datetime().openapi({ example: '2026-04-01T14:00:00Z' }),
  })
  .openapi('Organization', {
    description: 'An organization (tenant). Users can be members of multiple organizations.',
  });

export const OrganizationListResponseSchema = z
  .object({
    data: z.array(OrganizationSchema),
  })
  .openapi('OrganizationListResponse');

export type Organization = z.infer<typeof OrganizationSchema>;
export type OrganizationListResponse = z.infer<typeof OrganizationListResponseSchema>;
```

**Step 2: Verify typecheck**

```bash
cd /Users/berkin/Desktop/My_Code_Workspace/pazaryerleri-finansal-kar-hesaplama-saas/apps/api && npx tsc --noEmit
```

Expected: no errors.

**Step 3: Commit**

```bash
git add apps/api/src/validators/organization.validator.ts
git commit -m "feat(api): add Organization Zod schema with OpenAPI metadata"
```

---

### Task 15: Implement `GET /v1/organizations` route (with stub data)

**Why:** Real route exercising the full request → response → spec → types pipeline. Auth middleware doesn't exist yet, so the route returns a stub list; a TODO marks where Prisma + auth will plug in.

**Files:**

- Create: `apps/api/src/routes/organization.routes.ts`
- Modify: `apps/api/src/index.ts` (mount route)
- Modify: `apps/api/scripts/dump-openapi.ts` (mount route)

**Step 1: Create the route file**

Write `apps/api/src/routes/organization.routes.ts`:

```ts
import { OpenAPIHono, createRoute } from '@hono/zod-openapi';

import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../openapi';
import { OrganizationListResponseSchema } from '../validators/organization.validator';

const app = new OpenAPIHono();

const listOrganizationsRoute = createRoute({
  method: 'get',
  path: '/organizations',
  tags: ['Organizations'],
  summary: 'List organizations the authenticated user is a member of',
  description:
    'Returns all organizations where the authenticated user has an OrganizationMember record. ' +
    'Not paginated — typical users belong to fewer than 10 organizations.',
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      content: { 'application/json': { schema: OrganizationListResponseSchema } },
      description: 'List of organizations',
      headers: RateLimitHeaders,
    },
    401: {
      content: { 'application/json': { schema: ProblemDetailsSchema } },
      description: 'Missing or invalid auth token',
    },
    429: Common429Response,
  },
});

app.openapi(listOrganizationsRoute, (c) => {
  // TODO: Replace with prisma.organization.findMany filtered by authenticated user's
  // organization_members. Auth middleware must be in place first (separate plan).
  return c.json(
    {
      data: [
        {
          id: '00000000-0000-0000-0000-000000000000',
          name: 'Akyıldız Store',
          slug: 'akyildiz-store',
          createdAt: '2026-01-15T10:30:00Z',
          updatedAt: '2026-04-01T14:00:00Z',
        },
      ],
    },
    200,
  );
});

export default app;
```

**Step 2: Mount the route in `apps/api/src/index.ts`**

Add the import near the top of `apps/api/src/index.ts`:

```ts
import organizationRoutes from './routes/organization.routes';
```

Add the mount call after the `/health` route registration:

```ts
app.route('/', organizationRoutes);
```

**Step 3: Mount the same route in `apps/api/scripts/dump-openapi.ts`**

The dump script currently duplicates route registration. Add the same import + mount lines:

```ts
import organizationRoutes from '../src/routes/organization.routes.js';
// ... after healthRoute is registered ...
app.route('/', organizationRoutes);
```

**Step 4: Verify typecheck**

```bash
cd /Users/berkin/Desktop/My_Code_Workspace/pazaryerleri-finansal-kar-hesaplama-saas/apps/api && npx tsc --noEmit
```

Expected: no errors.

**Step 5: Smoke-test the route**

```bash
cd /Users/berkin/Desktop/My_Code_Workspace/pazaryerleri-finansal-kar-hesaplama-saas/apps/api && timeout 10 pnpm dev &
sleep 4
curl -s http://localhost:3001/v1/organizations
echo ""
pkill -f "tsx watch" || true
```

Expected: JSON `{"data":[{"id":"00000000-…","name":"Akyıldız Store",…}]}`

**Step 6: Re-sync the spec and types**

```bash
pnpm api:sync
```

Expected: `openapi.json` updated with the `/organizations` path; `api.d.ts` regenerated.

**Step 7: Verify the new path is present in the generated types**

```bash
grep -A2 "/organizations" packages/api-client/src/generated/api.d.ts | head -10
```

Expected: shows the path interface.

**Step 8: Commit**

```bash
git add apps/api/src/routes/organization.routes.ts apps/api/src/index.ts apps/api/scripts/dump-openapi.ts \
        packages/api-client/openapi.json packages/api-client/src/generated/api.d.ts
git commit -m "feat(api): add GET /v1/organizations exemplar route (stub data, full OpenAPI metadata)"
```

---

### Task 16: Add integration test for the route

**Files:**

- Create: `apps/api/tests/routes/organization.routes.test.ts`

**Step 1: Write the test**

```bash
mkdir -p apps/api/tests/routes
```

Write `apps/api/tests/routes/organization.routes.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { OpenAPIHono } from '@hono/zod-openapi';

import organizationRoutes from '../../src/routes/organization.routes';

describe('GET /v1/organizations', () => {
  const app = new OpenAPIHono().basePath('/v1');
  app.route('/', organizationRoutes);

  it('returns 200 with a data array of organizations', async () => {
    const res = await app.request('/v1/organizations');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('data');
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data[0]).toMatchObject({
      id: expect.any(String),
      name: expect.any(String),
      slug: expect.any(String),
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
  });
});
```

**Step 2: Run the test**

```bash
pnpm --filter @pazarsync/api test
```

Expected: 1 test passes.

**Step 3: Commit**

```bash
git add apps/api/tests/routes/organization.routes.test.ts
git commit -m "test(api): add integration test for GET /v1/organizations"
```

---

## Phase 6: Frontend Client Wiring

### Task 17: Add `@pazarsync/api-client` as workspace dep in apps/web

**Files:**

- Modify: `apps/web/package.json`

**Step 1: Add the workspace dep**

```bash
pnpm --filter @pazarsync/web add @pazarsync/api-client@workspace:*
```

Expected: `apps/web/package.json` gains the dep under `dependencies`.

**Step 2: Verify install resolves the workspace link**

```bash
ls -la apps/web/node_modules/@pazarsync/api-client
```

Expected: symlink pointing to `../../../packages/api-client`.

**Step 3: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml
git commit -m "chore(web): add @pazarsync/api-client workspace dep"
```

---

### Task 18: Create `apps/web/src/lib/api-client.ts` typed client

**Files:**

- Create: `apps/web/src/lib/api-client.ts`

**Step 1: Write the client**

```ts
import { createApiClient, type paths } from '@pazarsync/api-client';

const baseUrl = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001';

export const apiClient = createApiClient<paths>({ baseUrl });
```

**Step 2: Verify typecheck**

```bash
cd /Users/berkin/Desktop/My_Code_Workspace/pazaryerleri-finansal-kar-hesaplama-saas/apps/web && npx tsc --noEmit
```

Expected: no errors. The generated `paths` type from `@pazarsync/api-client` should resolve.

**Step 3: Commit**

```bash
git add apps/web/src/lib/api-client.ts
git commit -m "feat(web): add typed openapi-fetch client at lib/api-client.ts"
```

---

### Task 19: Add organization query-key factory and feature API/hook

**Why:** Demonstrates the documented React Query pattern (custom hook + query-key factory) consuming the typed client.

**Files:**

- Create: `apps/web/src/features/organization/query-keys.ts`
- Create: `apps/web/src/features/organization/api/organizations.api.ts`
- Create: `apps/web/src/features/organization/hooks/use-organizations.ts`

**Step 1: Write the query-key factory**

```ts
// apps/web/src/features/organization/query-keys.ts
export const organizationKeys = {
  all: ['organizations'] as const,
  lists: () => [...organizationKeys.all, 'list'] as const,
  list: () => [...organizationKeys.lists()] as const,
  details: () => [...organizationKeys.all, 'detail'] as const,
  detail: (id: string) => [...organizationKeys.details(), id] as const,
};
```

**Step 2: Write the API call**

```ts
// apps/web/src/features/organization/api/organizations.api.ts
import { apiClient } from '@/lib/api-client';
import type { components } from '@pazarsync/api-client';

export type Organization = components['schemas']['Organization'];

export async function listOrganizations(): Promise<Organization[]> {
  const { data, error } = await apiClient.GET('/organizations', {});
  if (error) {
    throw new Error(`Failed to fetch organizations: ${JSON.stringify(error)}`);
  }
  return data.data;
}
```

**Step 3: Write the React Query hook**

```ts
// apps/web/src/features/organization/hooks/use-organizations.ts
import { useQuery } from '@tanstack/react-query';

import { listOrganizations, type Organization } from '../api/organizations.api';
import { organizationKeys } from '../query-keys';

export function useOrganizations() {
  return useQuery<Organization[]>({
    queryKey: organizationKeys.list(),
    queryFn: listOrganizations,
  });
}
```

**Step 4: Add @tanstack/react-query if missing**

```bash
grep '"@tanstack/react-query"' apps/web/package.json || pnpm --filter @pazarsync/web add @tanstack/react-query
```

**Step 5: Verify typecheck**

```bash
cd /Users/berkin/Desktop/My_Code_Workspace/pazaryerleri-finansal-kar-hesaplama-saas/apps/web && npx tsc --noEmit
```

Expected: no errors. The generated `components["schemas"]["Organization"]` should resolve.

**Step 6: Commit**

```bash
git add apps/web/src/features/organization/ apps/web/package.json pnpm-lock.yaml
git commit -m "feat(web): add organization feature module (query keys, API, React Query hook)"
```

---

## Phase 7: Documentation Updates

### Task 20: Update `apps/api/CLAUDE.md` with new conventions

**Files:**

- Modify: `apps/api/CLAUDE.md`

**Step 1: Read the current backend CLAUDE.md**

```bash
cat apps/api/CLAUDE.md | head -40
```

**Step 2: Update the integrations folder reference**

Use `Edit` tool to find/replace within `apps/api/CLAUDE.md`:

- Replace `apps/api/src/marketplace/` → `apps/api/src/integrations/marketplace/` everywhere
- Replace any `marketplace/` standalone references that refer to the directory

**Step 3: Add a new section "## REST API Documentation" before the "## No Utility Duplication" section**

Insert this content:

```markdown
## REST API Documentation

Every route in `apps/api/src/routes/` MUST be defined with `@hono/zod-openapi`'s `createRoute` helper. Schemas live in `apps/api/src/validators/` decorated with `.openapi()` metadata. Shared error/pagination/rate-limit components live in `apps/api/src/openapi/`.

Required per route:

- `tags: [...]`, `summary`, `description`
- `security: [{ bearerAuth: [] }]` for authenticated endpoints
- All possible response status codes (200, 400, 401, 403, 404, 422, 429, …)
- `headers: RateLimitHeaders` on 200s of protected endpoints
- `429: Common429Response` on protected endpoints
- Examples on request/response schemas via `.openapi({ example })` — placeholder data only, never real customer data
- `deprecated: true` on routes scheduled for removal

After adding/changing a route:

1. Run `pnpm api:sync` to regenerate the spec snapshot and frontend types
2. Update `docs/api-changelog.md` under `[Unreleased]`
3. Commit both `packages/api-client/openapi.json` and `packages/api-client/src/generated/api.d.ts`

CI rejects PRs whose generated artifacts drift from the routes.

### Conventions

- **Casing**: camelCase in all JSON request/response bodies, query/path params, and headers. Snake_case is confined to the DB layer (Prisma `@@map`).
- **Pagination**: cursor-based only. Use `cursorPaginationSchema` from `@pazarsync/utils`. Cursor encodes `{ v, sort, values: { …, id } }`. Server validates `sort` matches the request param; mismatch returns `400 CURSOR_SORT_MISMATCH`.
- **Errors**: RFC 7807 `ProblemDetails` with `code` field (SCREAMING_SNAKE_CASE). English `title`/`detail` for logs; `code` is what frontend translates.
- **Money**: `Decimal` in services, string representation in API responses.
- **Dates**: ISO 8601 (UTC) on the wire.

See `docs/plans/2026-04-16-api-docs-design.md` for the full design.
```

**Step 4: Verify the file is still well-formed markdown**

```bash
head -5 apps/api/CLAUDE.md
```

**Step 5: Commit**

```bash
git add apps/api/CLAUDE.md
git commit -m "docs(api): document REST API documentation conventions and integrations rename"
```

---

### Task 21: Update `apps/web/CLAUDE.md` to reference the typed API client

**Files:**

- Modify: `apps/web/CLAUDE.md`

**Step 1: Edit the React Query section**

In the existing `## TanStack React Query Conventions` section, replace the example code that uses raw fetch with the typed-client pattern. Use `Edit` to update the "✅ Good" example to use `apiClient.GET(...)` from `@/lib/api-client` (see Task 19 for the canonical pattern).

**Step 2: Add a new subsection "Typed API Client" after the existing intro of TanStack React Query Conventions**

Insert this content:

```markdown
### Typed API Client

All API calls go through `apiClient` (an `openapi-fetch` instance) defined in `apps/web/src/lib/api-client.ts`. The client is typed by `paths` and `components` exported from `@pazarsync/api-client`, which is regenerated from `apps/api`'s OpenAPI spec.

- **Never** use raw `fetch()` against the API — the typed client gives you autocomplete on URLs, params, request bodies, and responses.
- API call functions live in `src/features/<feature>/api/<feature>.api.ts` and are wrapped by React Query hooks in `hooks/`.
- After backend route changes, run `pnpm api:sync` to refresh types — your editor will surface breakage immediately.
```

**Step 3: Commit**

```bash
git add apps/web/CLAUDE.md
git commit -m "docs(web): document typed API client pattern via @pazarsync/api-client"
```

---

### Task 22: Update `docs/ARCHITECTURE.md` with renamed integrations folder and OpenAPI section

**Files:**

- Modify: `docs/ARCHITECTURE.md`

**Step 1: Replace `apps/api/src/marketplace/` with `apps/api/src/integrations/marketplace/`**

Use `Edit` tool to replace all occurrences in `docs/ARCHITECTURE.md`. The Monorepo Structure block needs updating.

**Step 2: Add a brief subsection under "API Design"**

After the existing API Design section, add:

```markdown
### Documentation Pipeline

The REST API is documented via OpenAPI 3.1, auto-generated from Zod schemas using `@hono/zod-openapi`. Spec is served at `/v1/openapi.json` and Scalar UI at `/v1/docs` (dev/staging only). Frontend types are generated by `openapi-typescript` into the `@pazarsync/api-client` workspace package, consumed by `apps/web` via `openapi-fetch`. See `docs/plans/2026-04-16-api-docs-design.md` for the full design and `docs/plans/2026-04-16-api-docs-implementation.md` for the implementation plan.
```

**Step 3: Commit**

```bash
git add docs/ARCHITECTURE.md
git commit -m "docs(architecture): rename marketplace → integrations/marketplace, document OpenAPI pipeline"
```

---

### Task 23: Update root `CLAUDE.md` documentation references table

**Files:**

- Modify: `CLAUDE.md`

**Step 1: Add `docs/api-changelog.md` to the Documentation References table**

Use `Edit` to add a new row:

```markdown
| API Changelog | `docs/api-changelog.md` | When changing any route — log under `[Unreleased]` |
```

**Step 2: Add `docs/plans/` to the table**

```markdown
| Design Plans | `docs/plans/` | When designing or implementing a non-trivial feature |
```

**Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: reference api-changelog and design plans in root CLAUDE.md"
```

---

## Phase 8: CI Enforcement

### Task 24: Add CI workflow to enforce `api:sync`

**Files:**

- Create: `.github/workflows/ci.yml`

**Step 1: Write the workflow**

```bash
mkdir -p .github/workflows
```

Write `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

jobs:
  api-spec-sync:
    name: OpenAPI spec is in sync
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 10

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: 'pnpm'

      - run: pnpm install --frozen-lockfile

      - name: Sync OpenAPI spec and generated types
        run: pnpm api:sync

      - name: Fail if spec or generated types drifted
        run: |
          if ! git diff --exit-code packages/api-client/openapi.json packages/api-client/src/generated/; then
            echo ""
            echo "::error::OpenAPI spec or generated types are out of sync."
            echo "::error::Run 'pnpm api:sync' locally and commit the result."
            exit 1
          fi

  typecheck:
    name: Typecheck all packages
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm api:sync # ensure generated types exist before typecheck
      - run: pnpm typecheck

  test:
    name: Run unit tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @pazarsync/utils test
      - run: pnpm --filter @pazarsync/api test
```

**Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add OpenAPI sync, typecheck, and test workflows"
```

---

## Phase 9: Final Validation

### Task 25: Full smoke test — end-to-end pipeline

**Why:** Confirm everything works together before declaring the plan complete.

**Step 1: Clean install from scratch**

```bash
rm -rf node_modules apps/*/node_modules packages/*/node_modules
pnpm install
```

Expected: install succeeds, no peer-dep errors blocking.

**Step 2: Sync the spec and types**

```bash
pnpm api:sync
```

Expected: spec and types regenerate without diff (we already committed the latest in Task 15).

**Step 3: Run typecheck across the workspace**

```bash
pnpm typecheck
```

Expected: no errors in any package.

**Step 4: Run all unit tests**

```bash
pnpm --filter @pazarsync/utils test
pnpm --filter @pazarsync/api test
```

Expected: all tests pass.

**Step 5: Start the API dev server and validate**

```bash
cd apps/api && timeout 12 pnpm dev &
sleep 5
echo "--- /health ---"
curl -s http://localhost:3001/v1/health
echo ""
echo "--- /organizations ---"
curl -s http://localhost:3001/v1/organizations
echo ""
echo "--- /openapi.json (first 300 chars) ---"
curl -s http://localhost:3001/v1/openapi.json | head -c 300
echo ""
echo "--- /docs (HTTP status) ---"
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/v1/docs
pkill -f "tsx watch" || true
```

Expected:

- /health → `{"status":"ok"}`
- /organizations → JSON with `data` array
- /openapi.json → JSON spec starting with `{"openapi":"3.1.0",…`
- /docs → 200

**Step 6: Update changelog**

Edit `docs/api-changelog.md`, move the `[Unreleased]` content (or add to it) and tag with today's date as `[1.0.0]`. Add this to the Initial release entry:

```markdown
- `GET /v1/health` (System) — health check
- `GET /v1/organizations` (Organizations) — list user's organizations (stub data)
- Scalar UI at `/v1/docs` and OpenAPI spec at `/v1/openapi.json`, both env-gated to non-production
- `bearerAuth` security scheme defined
- Cursor pagination utilities and `ProblemDetails` schema available for new routes
```

**Step 7: Final commit**

```bash
git add docs/api-changelog.md
git commit -m "docs: update API changelog for v1.0.0 with health and organizations endpoints"
```

**Step 8: Push to remote**

```bash
git push
```

Expected: pushes successfully to origin/main.

---

## Open Items (intentionally deferred to later plans)

- **Auth middleware**: `GET /v1/organizations` currently returns stub data because auth middleware doesn't exist yet. Separate plan needed to implement Supabase JWT verification + `orgContextMiddleware`. The exemplar route's `security: [{ bearerAuth: [] }]` documentation is correct — only enforcement is pending.
- **Refactor dump-openapi.ts**: Task 12 duplicates route registration between `index.ts` and `dump-openapi.ts`. Once we have ≥3 routes, refactor `index.ts` to export the configured app so the dump script can `import` it. (Per design Section "Open Questions / Future Work".)
- **Concurrent dev mode auto-sync**: For a smoother dev loop, wire `concurrently` into `apps/api`'s `pnpm dev` to run `pnpm api:openapi` on every restart, and into `apps/web`'s `pnpm dev` to run `pnpm --filter @pazarsync/api-client codegen:watch`. Deferred — explicit `pnpm api:sync` between changes is sufficient for now.
- **Webhook receivers**: Inbound webhooks from Trendyol/Hepsiburada will live under `/v1/webhooks/*` with HMAC signature verification. Separate design + plan when scoped.
- **More routes**: This plan delivers infrastructure + one exemplar. Subsequent plans will add real routes for stores, products, orders, settlements, etc.

---

## Skills Reference

- @superpowers:test-driven-development — for Task 4 (cursor utilities)
- @superpowers:verification-before-completion — before claiming any task complete, confirm the verification step's expected output
- @superpowers:subagent-driven-development OR @superpowers:executing-plans — for executing this plan
