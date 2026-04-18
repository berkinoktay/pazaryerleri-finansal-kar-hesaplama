# Auth Middleware Implementation Plan

> **For Claude:** Implement this plan task-by-task. Each task ends with a commit; do not skip the commit step. Load the `superpowers:executing‑plans` skill before starting.

**Goal:** Replace the JWT-free, stub-returning backend with a working two-layer auth chain (`authMiddleware` + `orgContextMiddleware`) so that `GET /v1/organizations` returns real organizations for the authenticated Supabase user, and future org-scoped endpoints can depend on the same primitives.

**Architecture:**

```
Request → cors → logger → authMiddleware → [per-route] orgContextMiddleware → handler
```

- **`authMiddleware`** — extracts `Authorization: Bearer <jwt>`, verifies the Supabase JWT locally with HS256 + `JWT_SECRET`, sets `userId` on the Hono context. Applies to every non-public route.
- **`orgContextMiddleware`** — reads `:orgId` from the path, looks up the `OrganizationMember` for (orgId, userId), sets `organizationId` + `memberRole`. Applies only to org-scoped routes (under `/v1/organizations/:orgId`). Does NOT apply to `/v1/organizations` (list of orgs the user belongs to — no specific org context yet).
- **Errors** map through `app.onError` to RFC 7807 `ProblemDetails` with stable `code` fields:
  - `UnauthorizedError` → 401 `UNAUTHENTICATED`
  - `ForbiddenError` → 403 `FORBIDDEN`
  - Existing Zod validation continues to produce 422 `VALIDATION_ERROR`.
- **`requireRole(...roles)`** — deferred. Not needed for the initial read-only `/v1/organizations` endpoint. Added alongside the first destructive endpoint (store connect, etc.).

**Tech Stack:**

- **[`jose`](https://github.com/panva/jose)** — JWT verification. TypeScript-first, actively maintained, supports both symmetric (HS256 today) and asymmetric (JWKS tomorrow) without rewriting calling code. Not `jsonwebtoken` (unmaintained CJS era), not a hand-rolled crypto check.
- **HS256 with `JWT_SECRET`** — Supabase's legacy signing mode. Fast (no network call), simple. Trade-off: rotating the secret requires redeploy. Migration path: move to asymmetric JWT signing keys via the Supabase dashboard + JWKS URL — this plan intentionally leaves that as a future upgrade (noted in closing).
- **Existing factories** — `createUserProfile`, `createOrganization`, `createMembership` in `apps/api/tests/helpers/factories.ts` are already in place; reuse them.
- **New test helper** — `signTestJwt` in `apps/api/tests/helpers/auth.ts` (CLAUDE.md already marks this as planned).

**Pre-flight checklist:**

- [ ] Encryption helper merged (PR #8 — done, landed in the main branch).
- [ ] Repo hygiene merged (PR #11 — done).
- [ ] Husky hooks executable (PR #18 — done).
- [ ] Worktree created for this plan (use `EnterWorktree` with name `feat/auth-middleware`).
- [ ] Supabase local running (`supabase start`) and schema pushed (`pnpm db:push`). Required for integration tests.
- [ ] `.env` has a non-empty `JWT_SECRET`. Locally this is whatever Supabase local auto-generates (visible via `supabase status`); in production it is the project's JWT secret from the Supabase dashboard.

---

## Task 1: Install `jose` and verify env setup

**Why:** `jose` is the only runtime dep this plan adds. We also want to fail loudly if `JWT_SECRET` is missing, instead of silently treating tokens as invalid.

**Files:**

- Modify: `apps/api/package.json` — add `jose`
- Verify: `.env.example` already has `JWT_SECRET=` (it does — no change needed)

**Step 1: Install `jose`**

```bash
pnpm --filter @pazarsync/api add jose
```

Expected: `+ jose ^5.x.x` (or higher — use whatever `latest` resolves to) in `apps/api/package.json` dependencies.

**Step 2: Verify `.env.example` mentions `JWT_SECRET`**

```bash
grep -n JWT_SECRET .env.example
```

Expected: one match near the `apps/api` block. If missing, add:

```
# Supabase project JWT secret (legacy HS256 mode). Find at
# Dashboard → Settings → API → JWT Settings. For local dev,
# run `supabase status` to see the auto-generated value.
JWT_SECRET=
```

**Step 3: Verify your local `.env` has a value**

```bash
grep -n "^JWT_SECRET=" .env | grep -v "^JWT_SECRET=$"
```

Expected: one match with a non-empty value. If empty, run `supabase status` and copy the JWT secret into `.env`.

**Step 4: Commit**

```bash
git add apps/api/package.json pnpm-lock.yaml
git commit -m "chore(api): add jose for JWT verification"
```

**Done when:** `pnpm --filter @pazarsync/api ls jose` prints a version.

---

## Task 2: Typed error classes + global error handler

**Why:** Route handlers and middleware should `throw` domain errors; one central handler maps them to RFC 7807 responses. This keeps routes clean and makes response shapes consistent (the frontend already parses ProblemDetails).

**Files:**

- Create: `apps/api/src/lib/errors.ts`
- Create: `apps/api/tests/unit/lib/errors.test.ts`
- Modify: `apps/api/src/index.ts` — register `app.onError`

**Step 1: Write the failing test**

Create `apps/api/tests/unit/lib/errors.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';

import { ForbiddenError, UnauthorizedError } from '../../../src/lib/errors';

describe('UnauthorizedError', () => {
  it('has status 401 and stable code UNAUTHENTICATED', () => {
    const err = new UnauthorizedError('bad token');
    expect(err.status).toBe(401);
    expect(err.code).toBe('UNAUTHENTICATED');
    expect(err.message).toBe('bad token');
    expect(err).toBeInstanceOf(Error);
  });

  it('defaults message when none provided', () => {
    const err = new UnauthorizedError();
    expect(err.message).toMatch(/auth/i);
  });
});

describe('ForbiddenError', () => {
  it('has status 403 and stable code FORBIDDEN', () => {
    const err = new ForbiddenError('not a member');
    expect(err.status).toBe(403);
    expect(err.code).toBe('FORBIDDEN');
    expect(err.message).toBe('not a member');
    expect(err).toBeInstanceOf(Error);
  });
});
```

**Step 2: Run the test — expect it to FAIL (module not found)**

```bash
pnpm --filter @pazarsync/api test:unit -- errors
```

**Step 3: Implement `errors.ts`**

Create `apps/api/src/lib/errors.ts`:

```typescript
/**
 * Domain errors that the `app.onError` handler translates to RFC 7807
 * ProblemDetails responses. The `code` field is SCREAMING_SNAKE_CASE and
 * stable across minor releases — the frontend maps it to i18n strings.
 */

export class UnauthorizedError extends Error {
  readonly status = 401 as const;
  readonly code = 'UNAUTHENTICATED' as const;

  constructor(message = 'Authentication required') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends Error {
  readonly status = 403 as const;
  readonly code = 'FORBIDDEN' as const;

  constructor(message = 'Access denied') {
    super(message);
    this.name = 'ForbiddenError';
  }
}
```

**Step 4: Run the test — expect PASS (3 tests)**

```bash
pnpm --filter @pazarsync/api test:unit -- errors
```

**Step 5: Register `app.onError` in `apps/api/src/index.ts`**

Add after the `cors()` / `logger()` middleware, BEFORE the route mounts:

```typescript
import { ForbiddenError, UnauthorizedError } from './lib/errors';

app.onError((err, c) => {
  if (err instanceof UnauthorizedError) {
    return c.json(
      {
        type: 'https://api.pazarsync.com/errors/unauthenticated',
        title: 'Authentication required',
        status: 401,
        code: err.code,
        detail: err.message,
      },
      401,
    );
  }
  if (err instanceof ForbiddenError) {
    return c.json(
      {
        type: 'https://api.pazarsync.com/errors/forbidden',
        title: 'Access denied',
        status: 403,
        code: err.code,
        detail: err.message,
      },
      403,
    );
  }
  // Unknown error — log + 500. Never leak internals to the client.
  console.error('Unhandled error:', err);
  return c.json(
    {
      type: 'https://api.pazarsync.com/errors/internal',
      title: 'Internal server error',
      status: 500,
      code: 'INTERNAL_ERROR',
      detail: 'An unexpected error occurred',
    },
    500,
  );
});
```

**Step 6: Commit**

```bash
git add apps/api/src/lib/errors.ts apps/api/tests/unit/lib/errors.test.ts apps/api/src/index.ts
git commit -m "feat(api): add typed auth errors + RFC 7807 error handler"
```

**Done when:** `pnpm --filter @pazarsync/api test:unit` passes; `typecheck` is green.

---

## Task 3: JWT verification helper

**Why:** We need a single, tested function that takes a raw token and returns a typed payload. Isolating it makes the middleware trivial AND lets us swap HS256 → JWKS later without touching any middleware or route code.

**Files:**

- Create: `apps/api/src/lib/jwt.ts`
- Create: `apps/api/tests/unit/lib/jwt.test.ts`

**Step 1: Write the failing test**

Create `apps/api/tests/unit/lib/jwt.test.ts`:

```typescript
import { SignJWT } from 'jose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UnauthorizedError } from '../../../src/lib/errors';
import { verifySupabaseJwt } from '../../../src/lib/jwt';

const TEST_SECRET = 'test-jwt-secret-at-least-32-bytes-for-hs256';
const SECRET_BYTES = new TextEncoder().encode(TEST_SECRET);

async function makeToken(
  payload: Record<string, unknown>,
  opts: { expiresIn?: string; secret?: Uint8Array } = {},
): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(opts.expiresIn ?? '1h')
    .sign(opts.secret ?? SECRET_BYTES);
}

describe('verifySupabaseJwt', () => {
  beforeEach(() => {
    vi.stubEnv('JWT_SECRET', TEST_SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns the userId (sub) for a valid token', async () => {
    const token = await makeToken({ sub: 'user-abc', email: 'a@b.com' });
    const result = await verifySupabaseJwt(token);
    expect(result.userId).toBe('user-abc');
    expect(result.email).toBe('a@b.com');
  });

  it('throws UnauthorizedError when signature is wrong', async () => {
    const wrongSecret = new TextEncoder().encode('completely-different-secret-32b');
    const token = await makeToken({ sub: 'user-abc' }, { secret: wrongSecret });
    await expect(verifySupabaseJwt(token)).rejects.toThrow(UnauthorizedError);
  });

  it('throws UnauthorizedError when token is expired', async () => {
    const token = await makeToken({ sub: 'user-abc' }, { expiresIn: '-1h' });
    await expect(verifySupabaseJwt(token)).rejects.toThrow(UnauthorizedError);
  });

  it('throws UnauthorizedError when sub claim is missing', async () => {
    const token = await makeToken({ email: 'a@b.com' });
    await expect(verifySupabaseJwt(token)).rejects.toThrow(UnauthorizedError);
  });

  it('throws UnauthorizedError when JWT_SECRET is not set', async () => {
    vi.stubEnv('JWT_SECRET', '');
    const token = await makeToken({ sub: 'user-abc' });
    await expect(verifySupabaseJwt(token)).rejects.toThrow(/JWT_SECRET/);
  });

  it('throws UnauthorizedError for malformed tokens', async () => {
    await expect(verifySupabaseJwt('not-a-jwt')).rejects.toThrow(UnauthorizedError);
  });
});
```

**Step 2: Run test — expect FAIL (module not found)**

```bash
pnpm --filter @pazarsync/api test:unit -- jwt
```

**Step 3: Implement `jwt.ts`**

Create `apps/api/src/lib/jwt.ts`:

```typescript
import { errors as joseErrors, jwtVerify } from 'jose';

import { UnauthorizedError } from './errors';

export interface SupabaseJwtClaims {
  userId: string;
  email: string | undefined;
}

/**
 * Verify a Supabase-issued JWT locally with HS256 + JWT_SECRET.
 *
 * Trade-off: this assumes the legacy symmetric signing mode. When we
 * migrate to asymmetric signing keys (Supabase dashboard → JWT Signing
 * Keys), swap this to `createRemoteJWKSet(new URL(...jwks...))` and
 * nothing else in the codebase needs to change.
 *
 * Throws `UnauthorizedError` on any failure — expired, wrong signature,
 * missing claims, malformed, or misconfigured environment. The caller's
 * job is to surface the 401, not to distinguish among these.
 */
export async function verifySupabaseJwt(token: string): Promise<SupabaseJwtClaims> {
  const secret = process.env['JWT_SECRET'];
  if (secret === undefined || secret.length === 0) {
    throw new UnauthorizedError('JWT_SECRET is not configured');
  }

  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
      algorithms: ['HS256'],
    });

    const sub = payload.sub;
    if (typeof sub !== 'string' || sub.length === 0) {
      throw new UnauthorizedError('Token is missing a valid `sub` claim');
    }
    const email = typeof payload['email'] === 'string' ? payload['email'] : undefined;
    return { userId: sub, email };
  } catch (err) {
    if (err instanceof UnauthorizedError) throw err;
    if (err instanceof joseErrors.JWTExpired) {
      throw new UnauthorizedError('Token has expired');
    }
    if (err instanceof joseErrors.JWSSignatureVerificationFailed) {
      throw new UnauthorizedError('Token signature is invalid');
    }
    // Malformed / wrong algorithm / other jose errors — collapse to 401.
    throw new UnauthorizedError('Invalid token');
  }
}
```

**Step 4: Run test — expect PASS (6 tests)**

```bash
pnpm --filter @pazarsync/api test:unit -- jwt
```

**Step 5: Commit**

```bash
git add apps/api/src/lib/jwt.ts apps/api/tests/unit/lib/jwt.test.ts
git commit -m "feat(api): add verifySupabaseJwt helper (HS256 + JWT_SECRET)"
```

**Done when:** Unit suite green; `typecheck` and `lint` both clean.

---

## Task 4: Test helpers — `signTestJwt`

**Why:** Integration tests need to issue tokens that the real `verifySupabaseJwt` will accept. Without this helper, every test hand-rolls a SignJWT call — drift and bugs. CLAUDE.md forbids hand-rolled JWTs in tests for this reason.

**Files:**

- Create: `apps/api/tests/helpers/auth.ts`

**Step 1: Implement the helper**

Create `apps/api/tests/helpers/auth.ts`:

```typescript
import { SignJWT } from 'jose';

/**
 * Signs a Supabase-shaped JWT with the current JWT_SECRET, suitable
 * for use as `Authorization: Bearer <token>` in integration tests.
 *
 * The token's `sub` claim must match an existing `user_profiles.id`
 * (create it with `createUserProfile()` from factories.ts). A missing
 * user_profile will let auth pass but org-context lookups fail.
 */
export async function signTestJwt(
  userId: string,
  overrides: { email?: string; expiresIn?: string } = {},
): Promise<string> {
  const secret = process.env['JWT_SECRET'];
  if (secret === undefined || secret.length === 0) {
    throw new Error(
      'JWT_SECRET must be set for signTestJwt — check workspace-root .env ' +
        'or run `supabase status` to fetch the local value.',
    );
  }
  return new SignJWT({
    sub: userId,
    email: overrides.email ?? `${userId}@test.local`,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(overrides.expiresIn ?? '1h')
    .sign(new TextEncoder().encode(secret));
}

/**
 * Convenience — construct a Bearer Authorization header value.
 */
export function bearer(token: string): string {
  return `Bearer ${token}`;
}
```

**Step 2: Commit (no tests yet — this is only used by later tests)**

```bash
git add apps/api/tests/helpers/auth.ts
git commit -m "feat(api): add signTestJwt + bearer helpers for integration tests"
```

**Done when:** File exists; used in Task 5/6/8 tests.

---

## Task 5: `authMiddleware`

**Why:** This is the actual gate. Every request that's not specifically public (`/v1/health`, `/v1/openapi.json`, `/v1/docs`) runs through it. Must be correct under both happy path and every adversarial input.

**Files:**

- Create: `apps/api/src/middleware/auth.middleware.ts`
- Create: `apps/api/tests/integration/middleware/auth.middleware.test.ts`

**Step 1: Write the failing test**

Create `apps/api/tests/integration/middleware/auth.middleware.test.ts`:

```typescript
import { Hono } from 'hono';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { authMiddleware } from '../../../src/middleware/auth.middleware';
import { bearer, signTestJwt } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import { createUserProfile } from '../../helpers/factories';

function makeApp() {
  const app = new Hono<{ Variables: { userId: string } }>();
  app.use('*', authMiddleware);
  app.get('/echo', (c) => c.json({ userId: c.get('userId') }));
  return app;
}

describe('authMiddleware', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('sets userId on context for a valid token', async () => {
    const user = await createUserProfile();
    const token = await signTestJwt(user.id);
    const app = makeApp();

    const res = await app.request('/echo', {
      headers: { Authorization: bearer(token) },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { userId: string };
    expect(body.userId).toBe(user.id);
  });

  it('returns 401 when Authorization header is missing', async () => {
    const app = makeApp();
    const res = await app.request('/echo');
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('UNAUTHENTICATED');
  });

  it('returns 401 when Authorization header is not Bearer', async () => {
    const app = makeApp();
    const res = await app.request('/echo', {
      headers: { Authorization: 'Basic dXNlcjpwYXNz' },
    });
    expect(res.status).toBe(401);
  });

  it('returns 401 for a token with wrong signature', async () => {
    // Sign with a different secret
    const app = makeApp();
    const res = await app.request('/echo', {
      headers: { Authorization: bearer('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.invalid') },
    });
    expect(res.status).toBe(401);
  });

  it('returns 401 for an expired token', async () => {
    const user = await createUserProfile();
    const token = await signTestJwt(user.id, { expiresIn: '-1h' });
    const app = makeApp();

    const res = await app.request('/echo', {
      headers: { Authorization: bearer(token) },
    });
    expect(res.status).toBe(401);
  });
});
```

**Step 2: Run test — expect FAIL (module not found)**

```bash
pnpm --filter @pazarsync/api test:integration -- auth.middleware
```

**Step 3: Implement the middleware**

Create `apps/api/src/middleware/auth.middleware.ts`:

```typescript
import { createMiddleware } from 'hono/factory';

import { UnauthorizedError } from '../lib/errors';
import { verifySupabaseJwt } from '../lib/jwt';

/**
 * Extracts the Bearer token from the Authorization header, verifies it,
 * and sets `userId` and `email` on the Hono context.
 *
 * Throws UnauthorizedError on any failure. `app.onError` maps it to a
 * 401 ProblemDetails response.
 *
 * Usage:
 *   app.use('*', authMiddleware)              — applied globally
 *   app.get('/foo', authMiddleware, handler)  — applied per route
 *
 * Public routes (health, OpenAPI spec, docs UI) are mounted BEFORE this
 * middleware, or mounted on a sub-app without it. See index.ts wiring.
 */
export const authMiddleware = createMiddleware<{
  Variables: { userId: string; email: string | undefined };
}>(async (c, next) => {
  const header = c.req.header('Authorization');
  if (header === undefined) {
    throw new UnauthorizedError('Missing Authorization header');
  }
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (match === null) {
    throw new UnauthorizedError('Authorization header must use Bearer scheme');
  }
  const token = match[1]!;

  const claims = await verifySupabaseJwt(token);
  c.set('userId', claims.userId);
  c.set('email', claims.email);
  await next();
});
```

**Step 4: Run test — expect PASS (5 tests)**

```bash
pnpm --filter @pazarsync/api test:integration -- auth.middleware
```

**Step 5: Commit**

```bash
git add apps/api/src/middleware/auth.middleware.ts apps/api/tests/integration/middleware/auth.middleware.test.ts
git commit -m "feat(api): add authMiddleware — verifies Supabase JWT, sets userId"
```

**Done when:** All 5 integration tests pass.

---

## Task 6: `orgContextMiddleware`

**Why:** Tenant isolation's first enforcement layer. Before any org-scoped route runs, this middleware proves the caller is a member and injects `organizationId` + `memberRole`. Routes then filter every query by `c.get('organizationId')`. This is defense layer 1 of the three-layer isolation model (middleware → RLS → schema).

**Files:**

- Create: `apps/api/src/middleware/org-context.middleware.ts`
- Create: `apps/api/tests/integration/middleware/org-context.middleware.test.ts`

**Step 1: Write the failing test**

Create `apps/api/tests/integration/middleware/org-context.middleware.test.ts`:

```typescript
import { Hono } from 'hono';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { authMiddleware } from '../../../src/middleware/auth.middleware';
import { orgContextMiddleware } from '../../../src/middleware/org-context.middleware';
import { bearer, signTestJwt } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import {
  createMembership,
  createOrganization,
  createUserProfile,
} from '../../helpers/factories';

function makeApp() {
  const app = new Hono<{
    Variables: {
      userId: string;
      email: string | undefined;
      organizationId: string;
      memberRole: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';
    };
  }>();
  app.use('*', authMiddleware);
  app.use('/organizations/:orgId/*', orgContextMiddleware);
  app.get('/organizations/:orgId/echo', (c) =>
    c.json({
      organizationId: c.get('organizationId'),
      memberRole: c.get('memberRole'),
    }),
  );
  return app;
}

describe('orgContextMiddleware', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('sets organizationId + memberRole for a member', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    await createMembership(org.id, user.id, 'OWNER');
    const token = await signTestJwt(user.id);
    const app = makeApp();

    const res = await app.request(`/organizations/${org.id}/echo`, {
      headers: { Authorization: bearer(token) },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { organizationId: string; memberRole: string };
    expect(body.organizationId).toBe(org.id);
    expect(body.memberRole).toBe('OWNER');
  });

  it('returns 403 when user is NOT a member of the org', async () => {
    const user = await createUserProfile();
    const org = await createOrganization();
    // No membership created
    const token = await signTestJwt(user.id);
    const app = makeApp();

    const res = await app.request(`/organizations/${org.id}/echo`, {
      headers: { Authorization: bearer(token) },
    });

    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('FORBIDDEN');
  });

  it('returns 403 when the user is a member of a DIFFERENT org', async () => {
    const user = await createUserProfile();
    const [orgA, orgB] = await Promise.all([createOrganization(), createOrganization()]);
    await createMembership(orgA.id, user.id, 'OWNER');
    const token = await signTestJwt(user.id);
    const app = makeApp();

    const res = await app.request(`/organizations/${orgB.id}/echo`, {
      headers: { Authorization: bearer(token) },
    });

    expect(res.status).toBe(403);
  });

  it('returns 403 when orgId is a non-existent UUID', async () => {
    const user = await createUserProfile();
    const token = await signTestJwt(user.id);
    const app = makeApp();

    const res = await app.request('/organizations/00000000-0000-0000-0000-000000000000/echo', {
      headers: { Authorization: bearer(token) },
    });

    expect(res.status).toBe(403);
  });
});
```

**Step 2: Run test — expect FAIL (module not found)**

```bash
pnpm --filter @pazarsync/api test:integration -- org-context
```

**Step 3: Implement the middleware**

Create `apps/api/src/middleware/org-context.middleware.ts`:

```typescript
import { prisma } from '@pazarsync/db';
import { createMiddleware } from 'hono/factory';

import { ForbiddenError } from '../lib/errors';

type MemberRole = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';

/**
 * Reads `:orgId` from the request path, verifies the authenticated user
 * has an OrganizationMember row for that org, and sets organizationId +
 * memberRole on the context.
 *
 * Returns 403 FORBIDDEN for both "not a member" and "org does not exist"
 * — intentionally not distinguishing. Leaking "this org exists" would
 * tell an attacker whether an org id is valid even when they can't
 * access it. See docs/SECURITY.md for the full rationale.
 *
 * Requires `authMiddleware` upstream (sets `userId`).
 */
export const orgContextMiddleware = createMiddleware<{
  Variables: {
    userId: string;
    organizationId: string;
    memberRole: MemberRole;
  };
}>(async (c, next) => {
  const orgId = c.req.param('orgId');
  if (orgId === undefined || orgId.length === 0) {
    throw new ForbiddenError('Organization id is required');
  }
  const userId = c.get('userId');

  const membership = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: orgId, userId } },
    select: { role: true },
  });

  if (membership === null) {
    throw new ForbiddenError('Not a member of this organization');
  }

  c.set('organizationId', orgId);
  c.set('memberRole', membership.role as MemberRole);
  await next();
});
```

> **Note on the composite unique name.** Prisma generates `organizationId_userId` from the `@@unique([organizationId, userId])` in schema.prisma. If the schema ever renames these columns, the generated key name changes too — the TypeScript will catch it at compile time.

**Step 4: Run test — expect PASS (4 tests)**

```bash
pnpm --filter @pazarsync/api test:integration -- org-context
```

**Step 5: Commit**

```bash
git add apps/api/src/middleware/org-context.middleware.ts apps/api/tests/integration/middleware/org-context.middleware.test.ts
git commit -m "feat(api): add orgContextMiddleware — verifies membership, sets orgId/role"
```

**Done when:** All 4 integration tests pass; typecheck green.

---

## Task 7: Wire middleware into the Hono app + adjust public routes

**Why:** The middleware has to actually run. But `/v1/health` must remain public (load balancers don't send JWTs) and so must `/v1/openapi.json` + `/v1/docs` in dev. Order matters: mount public routes BEFORE `app.use('*', authMiddleware)`, or split into sub-apps.

**Files:**

- Modify: `apps/api/src/index.ts`

**Step 1: Restructure `index.ts`**

The current structure mounts everything on a single `app`. We will restructure so public routes register first, then the auth gate is applied for everything after.

Replace the current middleware/route wiring in `apps/api/src/index.ts` with:

```typescript
// BEFORE: app.use('*', logger()); app.use('*', cors()); (existing)
// KEEP the logger/cors/onError/bearerAuth-register block unchanged.

// Public routes — mounted BEFORE authMiddleware so they bypass auth.
app.openapi(healthRoute, (c) => c.json({ status: 'ok' as const }, 200));

// Spec + docs UI — DEV/STAGING ONLY. Also public (they document the API
// for developers, not end users).
if (process.env['NODE_ENV'] !== 'production') {
  app.doc31('/openapi.json', { /* existing config */ });
  app.get('/docs', Scalar({ /* existing config */ }));
}

// From here on, everything is authenticated.
app.use('*', authMiddleware);

// Feature routes.
app.route('/', organizationRoutes);
```

Add the `authMiddleware` import at the top:

```typescript
import { authMiddleware } from './middleware/auth.middleware';
```

**Step 2: Run full test suite**

```bash
supabase start  # if not running
pnpm --filter @pazarsync/api test
```

Expected: all tests pass. The existing route tests may fail because `/v1/organizations` is now behind auth but tests do not pass a token yet — that is addressed in Task 8.

**Step 3: Manual smoke test**

```bash
pnpm dev --filter api
# in another terminal:
curl -i http://localhost:3001/v1/health
# → 200 {"status":"ok"}

curl -i http://localhost:3001/v1/organizations
# → 401 ProblemDetails (UNAUTHENTICATED)

# With a token from Supabase local (get one via supabase auth signup):
curl -i http://localhost:3001/v1/organizations -H "Authorization: Bearer $TOKEN"
# → 200 with stub data (until Task 8)
```

**Step 4: Update `scripts/dump-openapi.ts` to mirror the mount order**

The dump script duplicates route registration by design (see apps/api/CLAUDE.md § "Adding or changing a route"). Public routes stay before auth; feature routes after. The script does not need to actually run auth, but the mount order must match so the spec stays accurate.

```bash
# Verify spec still generates cleanly:
pnpm api:sync
git diff packages/api-client/openapi.json
```

Expected: either no diff (if nothing route-shaped changed) or a diff that only reflects intentional changes.

**Step 5: Commit**

```bash
git add apps/api/src/index.ts apps/api/scripts/dump-openapi.ts packages/api-client/openapi.json
git commit -m "feat(api): wire authMiddleware — public health+docs, rest gated"
```

**Done when:** Smoke test shows 401 without token, 200 with token; CI `api-spec-sync` job stays green.

---

## Task 8: Replace `/v1/organizations` stub with real data

**Why:** This is the payoff — the first endpoint that returns real user-scoped data. It also validates the whole auth chain end to end.

**Files:**

- Create: `apps/api/src/services/organization.service.ts`
- Modify: `apps/api/src/routes/organization.routes.ts`
- Create: `apps/api/tests/integration/routes/organization.routes.test.ts`

**Step 1: Write the failing integration test**

Create `apps/api/tests/integration/routes/organization.routes.test.ts`:

```typescript
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import app from '../../../src/index';
import { bearer, signTestJwt } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import {
  createMembership,
  createOrganization,
  createUserProfile,
} from '../../helpers/factories';

describe('GET /v1/organizations', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('returns 401 without a token', async () => {
    const res = await app.request('/v1/organizations');
    expect(res.status).toBe(401);
  });

  it('returns an empty list for a user with no memberships', async () => {
    const user = await createUserProfile();
    const token = await signTestJwt(user.id);

    const res = await app.request('/v1/organizations', {
      headers: { Authorization: bearer(token) },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data).toEqual([]);
  });

  it('returns the orgs the user is a member of, in name order', async () => {
    const user = await createUserProfile();
    const [orgA, orgB] = await Promise.all([
      createOrganization({ name: 'Beta Corp', slug: 'beta' }),
      createOrganization({ name: 'Alpha Corp', slug: 'alpha' }),
    ]);
    await Promise.all([
      createMembership(orgA.id, user.id, 'OWNER'),
      createMembership(orgB.id, user.id, 'MEMBER'),
    ]);
    const token = await signTestJwt(user.id);

    const res = await app.request('/v1/organizations', {
      headers: { Authorization: bearer(token) },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ name: string; slug: string }> };
    expect(body.data).toHaveLength(2);
    expect(body.data.map((o) => o.name)).toEqual(['Alpha Corp', 'Beta Corp']);
  });
});
```

**Step 2: Run — expect 3rd test FAIL (returns stub data, not real)**

```bash
pnpm --filter @pazarsync/api test:integration -- organization.routes
```

**Step 3: Create the service**

Create `apps/api/src/services/organization.service.ts`:

```typescript
import { prisma } from '@pazarsync/db';

/**
 * Return every organization where `userId` has an OrganizationMember row.
 * Ordered by name ASC for stable, human-friendly output.
 */
export async function listForUser(userId: string): Promise<
  Array<{
    id: string;
    name: string;
    slug: string;
    createdAt: string;
    updatedAt: string;
  }>
> {
  const memberships = await prisma.organizationMember.findMany({
    where: { userId },
    include: { organization: true },
    orderBy: { organization: { name: 'asc' } },
  });

  return memberships.map(({ organization: o }) => ({
    id: o.id,
    name: o.name,
    slug: o.slug,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
  }));
}
```

**Step 4: Replace the stub handler**

Update `apps/api/src/routes/organization.routes.ts`. Replace the TODO-marked handler:

```typescript
import { OpenAPIHono, createRoute } from '@hono/zod-openapi';

import { Common429Response, ProblemDetailsSchema, RateLimitHeaders } from '../openapi';
import * as organizationService from '../services/organization.service';
import { OrganizationListResponseSchema } from '../validators/organization.validator';

const app = new OpenAPIHono<{ Variables: { userId: string } }>();

const listOrganizationsRoute = createRoute({
  method: 'get',
  path: '/organizations',
  tags: ['Organizations'],
  summary: 'List organizations the authenticated user is a member of',
  description:
    'Returns all organizations where the authenticated user has an OrganizationMember record, ' +
    'ordered by name ascending. Not paginated — typical users belong to fewer than 10 organizations.',
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

app.openapi(listOrganizationsRoute, async (c) => {
  const userId = c.get('userId');
  const data = await organizationService.listForUser(userId);
  return c.json({ data }, 200);
});

export default app;
```

**Step 5: Run — expect PASS (3 tests)**

```bash
pnpm --filter @pazarsync/api test:integration -- organization.routes
```

**Step 6: Regenerate spec + commit**

```bash
pnpm api:sync
git add apps/api/src/services/organization.service.ts apps/api/src/routes/organization.routes.ts apps/api/tests/integration/routes/organization.routes.test.ts packages/api-client/openapi.json
git commit -m "feat(api): GET /v1/organizations returns real user memberships"
```

**Done when:** Integration suite green; `api-spec-sync` CI passes.

---

## Task 9: Tenant-isolation invariant test

**Why:** CLAUDE.md requires a tenant-isolation test for every new org-scoped endpoint. Even though this endpoint is "user-scoped" (not org-scoped), the invariant still applies: user A must NEVER see user B's organizations.

**Files:**

- Create: `apps/api/tests/integration/tenant-isolation/organizations.test.ts`

**Step 1: Write the test**

Create `apps/api/tests/integration/tenant-isolation/organizations.test.ts`:

```typescript
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import app from '../../../src/index';
import { bearer, signTestJwt } from '../../helpers/auth';
import { ensureDbReachable, truncateAll } from '../../helpers/db';
import {
  createMembership,
  createOrganization,
  createUserProfile,
} from '../../helpers/factories';

describe('Tenant isolation — GET /v1/organizations', () => {
  beforeAll(async () => {
    await ensureDbReachable();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  it('user A CANNOT see user B\'s organizations', async () => {
    const [userA, userB] = await Promise.all([createUserProfile(), createUserProfile()]);
    const [orgA, orgB] = await Promise.all([
      createOrganization({ name: 'A Corp' }),
      createOrganization({ name: 'B Corp' }),
    ]);
    await Promise.all([
      createMembership(orgA.id, userA.id, 'OWNER'),
      createMembership(orgB.id, userB.id, 'OWNER'),
    ]);

    const tokenA = await signTestJwt(userA.id);
    const res = await app.request('/v1/organizations', {
      headers: { Authorization: bearer(tokenA) },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ id: string; name: string }> };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]!.id).toBe(orgA.id);
    expect(body.data[0]!.name).toBe('A Corp');
    // Paranoid check — the response should not even mention B
    const responseText = JSON.stringify(body);
    expect(responseText).not.toContain(orgB.id);
    expect(responseText).not.toContain('B Corp');
  });

  it('a user with no memberships sees nobody else\'s orgs', async () => {
    const [lurker, owner] = await Promise.all([createUserProfile(), createUserProfile()]);
    const org = await createOrganization({ name: 'Private Corp' });
    await createMembership(org.id, owner.id, 'OWNER');

    const token = await signTestJwt(lurker.id);
    const res = await app.request('/v1/organizations', {
      headers: { Authorization: bearer(token) },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data).toEqual([]);
  });
});
```

**Step 2: Run — expect PASS immediately (2 tests)**

```bash
pnpm --filter @pazarsync/api test:integration -- tenant-isolation
```

If either fails, a real tenant-isolation bug exists — fix the service, do not weaken the test.

**Step 3: Commit**

```bash
git add apps/api/tests/integration/tenant-isolation/organizations.test.ts
git commit -m "test(api): tenant-isolation invariant for GET /v1/organizations"
```

**Done when:** Tests pass; no pending `it.skip` entries.

---

## Task 10: Document in api-changelog + apps/api/CLAUDE.md

**Why:** The changelog is load-bearing — it is what the frontend team reads to know what to regenerate and what behavior changed. CLAUDE.md adjustments remove the "planned" qualifier from the testing helpers note.

**Files:**

- Modify: `docs/api-changelog.md`
- Modify: `apps/api/CLAUDE.md`

**Step 1: Add an entry under `[Unreleased]` in `docs/api-changelog.md`**

```markdown
## [Unreleased]

### Added

- Auth middleware chain: `authMiddleware` verifies Supabase HS256 JWTs
  and sets `userId` on request context; `orgContextMiddleware` verifies
  `OrganizationMember` for `:orgId` path params and sets `organizationId`
  + `memberRole`.
- RFC 7807 error handler mapping `UnauthorizedError` → 401
  `UNAUTHENTICATED` and `ForbiddenError` → 403 `FORBIDDEN`.
- `signTestJwt` helper in `apps/api/tests/helpers/auth.ts` for integration
  tests.

### Changed

- `GET /v1/organizations` now returns real organizations the
  authenticated user is a member of (ordered by name), replacing the
  previous stub payload. Responds 401 when called without a valid Bearer
  token.
- `/v1/health`, `/v1/openapi.json`, and `/v1/docs` remain unauthenticated.
  All other routes under `/v1/*` now require a Bearer token.
```

**Step 2: Update `apps/api/CLAUDE.md`**

Replace the "Hand-rolled JWTs in tests" line under "Forbidden patterns":

```diff
- - ❌ Hand-rolled JWTs in tests — when auth lands, use `signTestJwt` from `tests/helpers/auth.ts` (planned)
+ - ❌ Hand-rolled JWTs in tests — use `signTestJwt` and `bearer()` from `tests/helpers/auth.ts`
```

**Step 3: Commit**

```bash
git add docs/api-changelog.md apps/api/CLAUDE.md
git commit -m "docs: log auth middleware in api-changelog; update testing forbidden pattern"
```

**Done when:** Changelog has the new entry under `[Unreleased]`; CLAUDE.md reference is accurate.

---

## Closing notes

**Order of implementation.** Tasks 1 → 10 in order. Each depends on the previous (error classes → JWT verifier → middleware → helpers → app wiring → route → isolation test → docs).

**Verification before completion.** Run the full suite at the end:

```bash
supabase start
pnpm db:push
pnpm check:full  # typecheck + lint + ALL tests + format check
```

Expected: all green.

**Things deliberately NOT in this plan.**

- **`requireRole(...roles)` middleware.** Needed when we add destructive or sensitive endpoints (store connect, org member remove, etc.). Add it alongside the first such endpoint — scope drift to include it here would bloat a plan that is already ten tasks.
- **Asymmetric JWT verification via JWKS.** Supabase now supports this (Dashboard → JWT Signing Keys) and it is the long-term right answer — it lets us rotate keys without redeploys and supports multiple active keys during rotation. The port is ~30 minutes once we are ready: swap `jwtVerify(token, secret, ...)` in `lib/jwt.ts` for `jwtVerify(token, await jwksFn, ...)` where `jwksFn = createRemoteJWKSet(new URL(JWKS_URL))`. No middleware or route changes. Deferred until we actually need rotation.
- **Rate limiting.** Middleware chain diagram in apps/api/CLAUDE.md lists `rateLimit` between `orgContext` and the handler, but no implementation exists yet. Tracked in `docs/plans/2026-04-18-launch-readiness.md` as "Group 3: Production-ready" — implement before first deploy.
- **Row Level Security (RLS) policies.** Defense layer 2 of 3. The Supabase SQL side (`supabase/sql/`) should mirror the middleware's org-membership check so that even a catastrophic middleware bypass cannot leak data. Scoped to a separate plan because it requires hand-writing PostgreSQL policy SQL and testing via `supabase.auth.setSession` from the test harness.
- **Session / refresh token handling.** Entirely frontend's job — the backend only verifies access tokens issued by Supabase Auth. Token refresh happens on the client via `supabase-js`.
- **Service-role operations.** Background workers (Edge Functions doing marketplace sync) will use the `SUPABASE_SERVICE_ROLE_KEY`, which bypasses auth and RLS. They do not use this middleware and do not need a `userId`. Keep them physically separate from the request-handling code.

**File inventory (what this plan creates).**

```
Created:
  apps/api/src/lib/errors.ts
  apps/api/src/lib/jwt.ts
  apps/api/src/middleware/auth.middleware.ts
  apps/api/src/middleware/org-context.middleware.ts
  apps/api/src/services/organization.service.ts
  apps/api/tests/helpers/auth.ts
  apps/api/tests/unit/lib/errors.test.ts
  apps/api/tests/unit/lib/jwt.test.ts
  apps/api/tests/integration/middleware/auth.middleware.test.ts
  apps/api/tests/integration/middleware/org-context.middleware.test.ts
  apps/api/tests/integration/routes/organization.routes.test.ts
  apps/api/tests/integration/tenant-isolation/organizations.test.ts

Modified:
  apps/api/src/index.ts                         (onError handler + authMiddleware wiring)
  apps/api/src/routes/organization.routes.ts    (stub → real service call)
  apps/api/scripts/dump-openapi.ts              (mirror new mount order, if needed)
  apps/api/package.json + pnpm-lock.yaml        (+ jose)
  packages/api-client/openapi.json              (regenerated by pnpm api:sync)
  docs/api-changelog.md
  apps/api/CLAUDE.md
```

**Commits.** One commit per task (10 total), each conventional-commits formatted, each passing `pnpm check:all` locally. This gives the reviewer a task-by-task diff to follow instead of a wall of changes.

**If something breaks mid-plan.** Never weaken a test to make it pass — fix the code. Never merge the PR with skipped tests. If a design trade-off comes up that this plan does not address, pause and discuss rather than improvise silently — the trade-off probably belongs in the plan for next time.
