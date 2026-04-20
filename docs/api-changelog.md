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

- `POST /v1/organizations` — creates an organization and attaches the
  authenticated caller as OWNER in a single Prisma transaction. Request
  body is `{ name: string }` (2–80 chars, must contain a letter/digit,
  blocklist of reserved names). Slug is auto-generated from the name
  via `slugify + collision retry`. Response includes the new org
  (id, name, slug, currency, timezone, timestamps) plus the membership
  record `{ role: "OWNER" }`. Error codes: `INVALID_NAME_TOO_SHORT`,
  `INVALID_NAME_TOO_LONG`, `INVALID_NAME_NO_ALPHANUMERIC`,
  `INVALID_NAME_RESERVED` (400), `UNAUTHENTICATED` (401).
- `GET /v1/me` — returns the authenticated user's profile
  (`id`, `email`, `timezone`, `preferredLanguage`, timestamps). Never
  404s: if the `user_profiles` row is missing (e.g., legacy user
  pre-trigger), the service upserts defensively from the JWT's email
  claim and returns 200.
- New columns on `user_profiles`: `timezone` (default `'Europe/Istanbul'`)
  and `preferred_language` (default `'tr'`). These drive viewer-side
  localisation of timestamps and UI language.
- New columns on `organizations`: `currency` (default `'TRY'`) and
  `timezone` (default `'Europe/Istanbul'`) for business-ops localisation
  (reporting period boundaries, sync windows, settlement day cuts) —
  distinct from per-user viewer timezone.
- Supabase `auth.users` AFTER INSERT trigger
  (`supabase/sql/triggers.sql`) auto-creates a matching `user_profiles`
  row on signup. SECURITY DEFINER so Supabase Auth's anonymous signup
  path can write into a table it doesn't own. Applied by
  `pnpm db:apply-policies` alongside the RLS file.
- Self-write RLS policies for `user_profiles`:
  `user_profiles_self_insert` and `user_profiles_self_update`
  (`WITH CHECK (id = auth.uid())`). Covers the defensive upsert path
  and the future account-settings screen.
- Extended tenant-isolation test matrix to cover `POST /v1/organizations`
  (a new org created by user A is invisible to user B).
- RLS tests extended to assert API-only-write invariants on
  `organizations` and `organization_members` (authenticated client
  cannot INSERT/UPDATE directly; writes must go through the Hono API
  via Prisma).

- Auth middleware chain. `authMiddleware` delegates to
  `supabase.auth.getUser(token)` to verify the Bearer token and sets
  `userId` + `email` on the request context. `orgContextMiddleware`
  verifies `OrganizationMember` for `:orgId` path params and sets
  `organizationId` + `memberRole`. SDK-delegated verification handles
  both HS256 and asymmetric (ES256/RS256) tokens transparently — the
  backend stays correct as Supabase migrates projects between signing
  modes.
- RFC 7807 error handler mapping `UnauthorizedError` → 401
  `UNAUTHENTICATED` and `ForbiddenError` → 403 `FORBIDDEN`. Unknown
  errors collapse to a generic 500 `INTERNAL_ERROR`.
- `createAuthenticatedTestUser` helper in
  `apps/api/tests/helpers/auth.ts` creates real Supabase Auth users via
  the admin API and returns a genuine access token. Replaces the
  hand-signed HS256 tokens used previously; tests now exercise the same
  verification path as production.
- `createApp()` factory in `apps/api/src/app.ts` — single source of
  truth for route registration, used by both the runtime entry and
  `scripts/dump-openapi.ts` (replaces the previous duplication).
- Row-Level Security policies on all 11 tenant-scoped tables
  (`user_profiles`, `organizations`, `organization_members`, `stores`,
  `products`, `orders`, `order_items`, `expenses`, `settlements`,
  `settlement_items`, `sync_logs`). Applied via `pnpm db:push` (which
  chains `pnpm db:apply-policies`). SELECT policies only in this phase
  — INSERT/UPDATE/DELETE default-deny until CRUD endpoints ship their
  own. Helper `is_org_member(uuid)` (SECURITY DEFINER) avoids the
  classic "infinite recursion detected in policy" trap.
- `createRlsScopedClient()` test helper in
  `apps/api/tests/helpers/rls-client.ts` — composes on
  `createAuthenticatedTestUser` and returns a Supabase JS client whose
  queries route through PostgREST with the authenticated role. Used in
  `tests/integration/rls/*.rls.test.ts` to prove each policy enforces;
  Prisma via `DATABASE_URL` bypasses RLS and cannot verify policies.
- Coverage test (`tests/integration/rls/coverage.rls.test.ts`) asserts
  every tenant-scoped table has RLS enabled + at least one SELECT
  policy. Forgetting a policy on a new table flips it red.

### Changed

- `GET /v1/organizations` now returns real organizations the
  authenticated user is a member of, ordered by name ascending.
  Replaces the previous stub payload. Responds `401 UNAUTHENTICATED`
  without a valid Bearer token.
- `/v1/health`, `/v1/openapi.json`, and `/v1/docs` remain public. All
  other routes under `/v1/*` now require a Bearer token.
- First live consumer of `/v1/organizations`: the Next.js frontend's
  dashboard OrganizationsPanel. No backend shape change — noting the
  integration so future response-shape edits are known to have a UI
  caller and require a coordinated frontend update.
- Frontend now has the full self-serve auth flow: sign in, sign up,
  email confirmation (via `/auth/callback`), forgot/reset password,
  sign out, and a global session-expired handler that drives 401
  responses into toast + redirect. No backend change — all flows
  terminate on Supabase Auth and backend-verified Bearer tokens.

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

### Added

- `GET /v1/health` (tag: System) — public, unauthenticated liveness check.
- `GET /v1/organizations` (tag: Organizations) — lists organizations for the
  authenticated user. **Currently returns stub data**; real Prisma query +
  auth middleware are deferred to a follow-up plan. The route is already
  documented with `security: [{ bearerAuth: [] }]`, so the contract is
  stable — only enforcement is pending.
- OpenAPI 3.1 spec at `/v1/openapi.json` and Scalar UI at `/v1/docs`, both
  env-gated to `NODE_ENV !== "production"`.
- `bearerAuth` HTTP security scheme (Supabase JWT).
- `@pazarsync/api-client` workspace package with a committed `openapi.json`
  snapshot, an `openapi-typescript`-generated `paths`/`components` interface,
  and an `openapi-fetch`-based `createApiClient` factory consumed by
  `apps/web/src/lib/api-client.ts`.
- Shared OpenAPI components under `apps/api/src/openapi/`:
  - `ProblemDetailsSchema` (RFC 7807 with machine-readable `code`) and
    `ValidationErrorDetailSchema`.
  - `RateLimitHeaders` (Zod object: `X-RateLimit-Limit/Remaining/Reset`) and
    `Common429Response` (with `Retry-After` header and `ProblemDetails` body).
  - `CursorMetaSchema` + `paginated<T>(itemSchema)` helper.
- Cursor pagination utilities in `@pazarsync/utils`: `cursorPaginationSchema`,
  `encodeCursor`/`decodeCursor`, `CursorSortMismatchError`,
  `InvalidCursorError`. Replaces the previous offset `paginationSchema`.

### Security

- API spec and docs UI are NOT exposed in production builds.
- `bearerAuth` is the only documented security scheme; no OAuth flows or
  cookie-based auth are implied.

### Notes

- Path keys in the generated spec are version-prefixed (`/v1/health`,
  `/v1/organizations`) because `@hono/zod-openapi` inlines `basePath("/v1")`.
  Frontend `baseUrl` pairs with this by NOT including `/v1`.
