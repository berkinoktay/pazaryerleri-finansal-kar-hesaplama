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

- Auth middleware chain. `authMiddleware` verifies Supabase HS256 JWTs
  and sets `userId` on the request context; `orgContextMiddleware`
  verifies `OrganizationMember` for `:orgId` path params and sets
  `organizationId` + `memberRole`.
- RFC 7807 error handler mapping `UnauthorizedError` → 401
  `UNAUTHENTICATED` and `ForbiddenError` → 403 `FORBIDDEN`. Unknown
  errors collapse to a generic 500 `INTERNAL_ERROR`.
- `signTestJwt` + `bearer` helpers in `apps/api/tests/helpers/auth.ts`
  for integration tests.
- `createApp()` factory in `apps/api/src/app.ts` — single source of
  truth for route registration, used by both the runtime entry and
  `scripts/dump-openapi.ts` (replaces the previous duplication).

### Changed

- `GET /v1/organizations` now returns real organizations the
  authenticated user is a member of, ordered by name ascending.
  Replaces the previous stub payload. Responds `401 UNAUTHENTICATED`
  without a valid Bearer token.
- `/v1/health`, `/v1/openapi.json`, and `/v1/docs` remain public. All
  other routes under `/v1/*` now require a Bearer token.

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
