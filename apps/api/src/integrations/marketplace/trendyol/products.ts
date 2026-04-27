// Public API of the Trendyol product-sync integration. Exposes an async
// generator that pages through /products/approved (v2), maps each batch
// to internal DTOs, and stops when the catalog is exhausted. Has no DB
// or Prisma awareness — the caller (ProductSyncService) handles upsert.
//
// Source-of-truth for endpoint shape:
//   docs/integrations/trendyol/7-trendyol-marketplace-entegrasyonu/
//     urun-entegrasyonlari-v2.md

import type { StoreEnvironment } from '@pazarsync/db';

import { MarketplaceUnreachable, RateLimitedError } from '../../../lib/errors';

import { mapTrendyolResponseToDomainError } from './errors';
import { mapTrendyolApprovedResponse, type MappedProductsPage } from './mapper';
import type { TrendyolApprovedProductsResponse, TrendyolCredentials } from './types';

const PLATFORM = 'TRENDYOL';
const REQUEST_TIMEOUT_MS = 30_000;
const PAGE_SIZE = 100; // Trendyol's documented max
const MAX_BACKOFF_RETRIES = 4; // 1s + 2s + 4s + 8s = 15s — under any reasonable Trendyol Retry-After
const INITIAL_BACKOFF_MS = 1_000;

function baseUrlFor(env: StoreEnvironment): string {
  const url =
    env === 'PRODUCTION'
      ? process.env['TRENDYOL_PROD_BASE_URL']
      : process.env['TRENDYOL_SANDBOX_BASE_URL'];
  if (url === undefined || url.length === 0) {
    throw new Error(`Trendyol base URL not configured for environment ${env}`);
  }
  return url;
}

function buildAuthHeader(cred: TrendyolCredentials): string {
  const token = Buffer.from(`${cred.apiKey}:${cred.apiSecret}`).toString('base64');
  return `Basic ${token}`;
}

function buildUserAgent(cred: TrendyolCredentials): string {
  const suffix = process.env['TRENDYOL_INTEGRATOR_UA_SUFFIX'] ?? 'SelfIntegration';
  return `${cred.supplierId} - ${suffix}`;
}

interface PageRequest {
  size: number;
  page?: number;
  nextPageToken?: string;
}

function buildUrl(base: string, supplierId: string, req: PageRequest): string {
  const url = new URL(`${base}/integration/product/sellers/${supplierId}/products/approved`);
  url.searchParams.set('size', req.size.toString());
  if (req.nextPageToken !== undefined) {
    url.searchParams.set('nextPageToken', req.nextPageToken);
  } else if (req.page !== undefined) {
    url.searchParams.set('page', req.page.toString());
  }
  return url.toString();
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (signal !== undefined) {
      const onAbort = (): void => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      };
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

interface FetcherDeps {
  baseUrl: string;
  credentials: TrendyolCredentials;
  signal?: AbortSignal;
}

/**
 * One HTTP call with retry-aware error handling.
 *
 * Retry policy:
 *   - **429** (rate limit) — backoff using `Retry-After` header when
 *     present, otherwise exponential. Up to MAX_BACKOFF_RETRIES.
 *   - **5xx** (transient upstream — except 503 which Trendyol uses for
 *     "stage IP not whitelisted," a permanent config issue, not a
 *     blip) — same exponential backoff. A single Trendyol gateway
 *     hiccup mid-sync used to kill the whole run; the retry path
 *     covers the common case where the next request 200s.
 *   - **Network error / timeout** (fetch threw) — same backoff. We
 *     can't read a status code, so we treat it like a 5xx.
 *   - Anything else (401/403/4xx other than 429) — no retry; the
 *     condition is permanent (bad credentials, missing User-Agent).
 *
 * Once retries are exhausted, falls through to
 * `mapTrendyolResponseToDomainError` which throws a typed domain
 * error (RateLimitedError for 429, MarketplaceAccessError for 503,
 * MarketplaceUnreachable for other 5xx).
 */
async function fetchOnce(
  url: string,
  deps: FetcherDeps,
): Promise<TrendyolApprovedProductsResponse> {
  let attempt = 0;
  for (;;) {
    let res: Response | undefined;
    let networkError = false;
    try {
      res = await fetch(url, {
        headers: {
          Authorization: buildAuthHeader(deps.credentials),
          'User-Agent': buildUserAgent(deps.credentials),
          Accept: 'application/json',
        },
        signal: deps.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      networkError = true;
    }

    if (res !== undefined && res.ok) {
      return (await res.json()) as TrendyolApprovedProductsResponse;
    }

    const isTransient =
      networkError ||
      (res !== undefined && (res.status === 429 || (res.status >= 500 && res.status !== 503)));

    if (isTransient && attempt < MAX_BACKOFF_RETRIES) {
      const headerSeconds =
        res !== undefined ? parseRetryAfterSeconds(res.headers.get('Retry-After')) : null;
      const waitMs =
        headerSeconds !== null ? headerSeconds * 1000 : INITIAL_BACKOFF_MS * Math.pow(2, attempt);
      attempt += 1;
      await sleep(waitMs, deps.signal);
      continue;
    }

    // Retries exhausted — surface a typed domain error so the caller
    // (sync service) records something actionable in SyncLog.errorCode.
    if (networkError || res === undefined) {
      throw new MarketplaceUnreachable(PLATFORM, { httpStatus: 0 });
    }
    if (res.status === 429) {
      const seconds = parseRetryAfterSeconds(res.headers.get('Retry-After')) ?? 30;
      throw new RateLimitedError(seconds, 'Trendyol rate limit hit (retries exhausted)');
    }
    mapTrendyolResponseToDomainError(res);
  }
}

function parseRetryAfterSeconds(header: string | null): number | null {
  if (header === null) return null;
  const parsed = Number.parseInt(header, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export interface FetchApprovedProductsOpts {
  baseUrl?: string;
  environment?: StoreEnvironment;
  credentials: TrendyolCredentials;
  signal?: AbortSignal;
}

/**
 * Async generator over Trendyol's /products/approved endpoint. Yields one
 * page at a time, fully mapped. Caller decides whether to upsert each
 * batch or buffer.
 *
 * Pagination: `page=0..N` while page*size ≤ 10,000; switches to
 * `nextPageToken` when Trendyol returns one (which it does past the
 * 10k cap). Stops when an empty `content[]` is returned or all
 * `totalElements` rows have been streamed.
 *
 * Either `baseUrl` or `environment` must be supplied; in app code use
 * `environment` (resolves from env vars). Tests can pass `baseUrl`
 * directly to point at an MSW mock.
 */
export async function* fetchApprovedProducts(
  opts: FetchApprovedProductsOpts,
): AsyncGenerator<MappedProductsPage, void> {
  const base = opts.baseUrl ?? baseUrlFor(opts.environment ?? 'PRODUCTION');
  const deps: FetcherDeps = { baseUrl: base, credentials: opts.credentials, signal: opts.signal };

  let processedSoFar = 0;
  let totalElements: number | null = null;
  let page = 0;
  let pendingToken: string | undefined;

  for (;;) {
    if (deps.signal?.aborted === true) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const url = buildUrl(base, opts.credentials.supplierId, {
      size: PAGE_SIZE,
      page: pendingToken === undefined ? page : undefined,
      nextPageToken: pendingToken,
    });

    const raw = await fetchOnce(url, deps);
    const mapped = mapTrendyolApprovedResponse(raw);

    if (totalElements === null) totalElements = mapped.pageMeta.totalElements;

    if (mapped.batch.length === 0) return;

    yield mapped;
    processedSoFar += mapped.batch.length;

    if (totalElements !== null && processedSoFar >= totalElements) return;

    // Prefer Trendyol's own next-page directive when it returns one. It
    // does past the 10k page-cap, and may also for non-cap'd pages on
    // some endpoints — using it is always correct.
    if (mapped.pageMeta.nextPageToken !== null) {
      pendingToken = mapped.pageMeta.nextPageToken;
    } else {
      pendingToken = undefined;
      page += 1;
    }
  }
}
