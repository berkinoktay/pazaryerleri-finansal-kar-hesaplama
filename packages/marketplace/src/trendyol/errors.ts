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
  if (status >= 400 && status < 500) {
    // Generic 4xx — assume credential/format issue, surface as auth failure.
    throw new MarketplaceAuthError(PLATFORM);
  }
  // 5xx (other than 503) — upstream down.
  throw new MarketplaceUnreachable(PLATFORM, { httpStatus: status });
}
