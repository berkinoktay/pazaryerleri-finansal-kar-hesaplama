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
 *   503 — sandbox IP whitelist missing (NOT the same as "upstream down")
 *   5xx (other) — actually upstream issues
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
export function mapTrendyolResponseToDomainError(res: Response): never {
  const status = res.status;

  if (status === 401) {
    throw new MarketplaceAuthError(PLATFORM);
  }
  if (status === 403 || status === 503) {
    throw new MarketplaceAccessError(PLATFORM, { httpStatus: status });
  }
  if (status === 429) {
    const header = res.headers.get('Retry-After');
    const parsed = header !== null ? Number.parseInt(header, 10) : NaN;
    const retryAfter = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_RETRY_AFTER_SECONDS;
    throw new RateLimitedError(retryAfter, 'Trendyol rate limit hit');
  }
  // Everything else (other 4xx, other 5xx) — treat as upstream
  // unreachable. The httpStatus rides along on the domain error so the
  // worker's diagnostic logging surfaces the real status code. The
  // chunk-level retry will surface a sustained issue terminally with
  // the correct `MARKETPLACE_UNREACHABLE` code.
  throw new MarketplaceUnreachable(PLATFORM, { httpStatus: status });
}
