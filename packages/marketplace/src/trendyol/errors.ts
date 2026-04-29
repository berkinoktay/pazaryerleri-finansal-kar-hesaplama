import type { StoreEnvironment } from '@pazarsync/db/enums';
import {
  MarketplaceAccessError,
  MarketplaceAuthError,
  MarketplaceUnreachable,
  RateLimitedError,
} from '@pazarsync/sync-core';

const PLATFORM = 'TRENDYOL';
const DEFAULT_RETRY_AFTER_SECONDS = 10;

/**
 * Translates a failed Trendyol HTTP response into our closed-vocabulary
 * domain errors. Always throws — the `never` return tells TypeScript
 * there is no fall-through path.
 *
 * Trendyol's own error surface (from docs/integrations/trendyol/):
 *   401 — ClientApiAuthenticationException (bad supplierId/apiKey/secret)
 *   403 — missing/wrong User-Agent, IP blocked, or insufficient role
 *   429 — too.many.requests (50 req / 10s per endpoint)
 *   503 — environment-dependent (see below)
 *   5xx (other) — actually upstream issues
 *
 * 503 is environment-dependent: in SANDBOX it's almost always the
 * "stage IP not whitelisted" config issue (terminal — retrying won't
 * help, the user has to add their IP to the allowlist), but in
 * PRODUCTION the official Trendyol error-codes doc just says "Trendyol
 * systems unavailable" (transient — retry should work). We surface
 * sandbox 503 as `MarketplaceAccessError` so the user sees an
 * actionable "configure IP" message; production 503 as
 * `MarketplaceUnreachable` so the worker's chunk-level retry path
 * fires.
 *
 * Other 4xx (400, 404, 405, 410, 422, …) are NOT credential issues —
 * they're request-shape or upstream-state bugs (e.g. requesting a page
 * past the last page returns 4xx on some Trendyol endpoints, malformed
 * query params, deprecated endpoint, etc.). Surfacing those as
 * `MARKETPLACE_AUTH_FAILED` mis-leads the user with "credentials
 * rejected" copy AND short-circuits the worker's chunk-level retry
 * (auth is a permanent failure code). We map them to
 * `MarketplaceUnreachable` instead so the worker retries them and the
 * UI shows the more accurate "pazar yerine ulaşılamıyor" copy on
 * terminal failure.
 */
export interface ResponseDiagnostics {
  /** `X-Request-ID` header value, if present — pins the failure to a Trendyol log line. */
  xRequestId?: string;
  /** First ~1 KB of the response body, captured before the throw — readable in error_message. */
  responseBodySnippet?: string;
  /** Originating URL, useful when chasing pagination edge cases. */
  url?: string;
}

export function mapTrendyolResponseToDomainError(
  res: Response,
  env: StoreEnvironment,
  diagnostics: ResponseDiagnostics = {},
): never {
  const status = res.status;

  if (status === 401) {
    throw new MarketplaceAuthError(PLATFORM);
  }
  if (status === 403) {
    throw new MarketplaceAccessError(PLATFORM, { httpStatus: status });
  }
  if (status === 503) {
    if (env === 'SANDBOX') {
      throw new MarketplaceAccessError(PLATFORM, { httpStatus: status });
    }
    throw new MarketplaceUnreachable(PLATFORM, {
      httpStatus: status,
      ...diagnostics,
    });
  }
  if (status === 429) {
    const header = res.headers.get('Retry-After');
    const parsed = header !== null ? Number.parseInt(header, 10) : NaN;
    const retryAfter = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_RETRY_AFTER_SECONDS;
    throw new RateLimitedError(retryAfter, 'Trendyol rate limit hit');
  }
  // Everything else (other 4xx, other 5xx) — treat as upstream
  // unreachable. The httpStatus + optional snippet ride along on the
  // domain error so the worker's diagnostic logging surfaces the real
  // status code AND the body Trendyol returned. The chunk-level retry
  // will surface a sustained issue terminally with the correct
  // `MARKETPLACE_UNREACHABLE` code.
  throw new MarketplaceUnreachable(PLATFORM, {
    httpStatus: status,
    ...diagnostics,
  });
}
