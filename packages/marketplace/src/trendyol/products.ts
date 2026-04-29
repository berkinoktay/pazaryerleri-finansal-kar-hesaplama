// Public API of the Trendyol product-sync integration. Exposes an async
// generator that pages through /products/approved (v2), maps each batch
// to internal DTOs, and stops when the catalog is exhausted. Has no DB
// or Prisma awareness — the caller (ProductSyncService) handles upsert.
//
// Source-of-truth for endpoint shape:
//   docs/integrations/trendyol/7-trendyol-marketplace-entegrasyonu/
//     urun-entegrasyonlari-v2.md

import type { StoreEnvironment } from '@pazarsync/db';
import { MarketplaceUnreachable, RateLimitedError } from '@pazarsync/sync-core';

import { mapTrendyolResponseToDomainError } from './errors';
import { baseUrlFor, buildAuthHeader, buildUserAgent } from './headers';
import { mapTrendyolApprovedResponse, type MappedProductsPage } from './mapper';
import type { TrendyolApprovedProductsResponse, TrendyolCredentials } from './types';

const PLATFORM = 'TRENDYOL';
const REQUEST_TIMEOUT_MS = 30_000;
/**
 * Trendyol getApprovedProducts page size. Per
 * docs/integrations/trendyol/7-trendyol-marketplace-entegrasyonu/urun-entegrasyonlari-v2.md §3:
 *   "Page x size maksimum 10.000 değerini alabilir."
 * → at size=1000, the page-based contract reaches items 0–9999
 *   in 10 requests instead of 100. Past 10k, switches to nextPageToken.
 *
 * Exported because the sync-worker computes a token→page fallback that
 * needs to use the same constant. Single source of truth.
 */
export const PRODUCTS_PAGE_SIZE = 1000;
/**
 * Trendyol's documented page-based pagination cap (same doc as above).
 * Items 0–9999 are reachable via `page=N`; item 10000+ requires
 * `nextPageToken`.
 *
 * Exported for the same reason as PRODUCTS_PAGE_SIZE — the worker's
 * token-fallback recomputation references this cap.
 */
export const APPROVED_PAGE_CAP_ITEMS = 10_000;
const MAX_BACKOFF_RETRIES = 4; // 1s + 2s + 4s + 8s = 15s — under any reasonable Trendyol Retry-After
const INITIAL_BACKOFF_MS = 1_000;

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
  env: StoreEnvironment;
  signal?: AbortSignal;
}

/**
 * One HTTP call with retry-aware error handling.
 *
 * Retry policy:
 *   - **429** (rate limit) — backoff using `Retry-After` header when
 *     present, otherwise exponential. Up to MAX_BACKOFF_RETRIES.
 *   - **5xx (other than sandbox 503)** — same exponential backoff. A
 *     single Trendyol gateway hiccup mid-sync used to kill the whole
 *     run; the retry path covers the common case where the next
 *     request 200s. Sandbox 503 is excluded because Trendyol uses it
 *     for "stage IP not whitelisted" — a permanent config issue, not
 *     a blip. Production 503 IS transient per Trendyol's official
 *     error-codes doc and gets retried.
 *   - **Network error / timeout** (fetch threw) — same backoff. We
 *     can't read a status code, so we treat it like a 5xx.
 *   - Anything else (401/403/4xx other than 429, sandbox 503) — no
 *     retry; the condition is permanent (bad credentials, missing
 *     User-Agent, IP allowlist).
 *
 * Once retries are exhausted, all 4xx and most 5xx (i.e. anything
 * other than networkError + 429) read the response body for diagnostic
 * capture, then delegate to `mapTrendyolResponseToDomainError(res, env,
 * diagnostics)` which routes by env (sandbox 503 → AccessError; prod
 * 503 → Unreachable+snippet) and status (401 → AuthError, 403 →
 * AccessError, generic 4xx + 5xx → Unreachable+snippet).
 *
 * Note: this fetch-level retry is complementary to the sync-worker's
 * chunk-level retry (`handleRunError` → `markRetryable` with longer
 * backoffs in apps/sync-worker). A single 5xx blip recovers here
 * without restarting the chunk; only a sustained outage falls through
 * to the worker's chunk-level retry.
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

    // 503 in sandbox is the documented "stage IP not whitelisted" config
    // issue — terminal, retrying won't help. 503 in production is generic
    // upstream unavailability per Trendyol's error-codes doc — transient.
    const sandbox503 = res !== undefined && res.status === 503 && deps.env === 'SANDBOX';
    const isTransient =
      networkError ||
      (res !== undefined && (res.status === 429 || (res.status >= 500 && !sandbox503)));

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
      throw new MarketplaceUnreachable(PLATFORM, { httpStatus: 0, url });
    }
    if (res.status === 429) {
      const seconds = parseRetryAfterSeconds(res.headers.get('Retry-After')) ?? 30;
      throw new RateLimitedError(seconds, 'Trendyol rate limit hit (retries exhausted)');
    }
    // All remaining 4xx + 5xx — read body for diagnostic capture so the
    // worker's skip-bad-page recovery (and admin debugging) has the
    // X-Request-ID + body snippet to record against the failure. The
    // env-aware mapper decides the final domain error class.
    const snippet = await safeReadBody(res);
    const xRequestId = res.headers.get('X-Request-ID') ?? undefined;
    mapTrendyolResponseToDomainError(res, deps.env, {
      url,
      xRequestId,
      responseBodySnippet: snippet,
    });
  }
}

/**
 * Best-effort capture of a failed Response body for diagnostics. Bounded
 * to 1 KB to keep the SyncLog row reasonable; never throws (a body that
 * has already been consumed or one that's binary garbage just yields
 * undefined). Plain text — Trendyol's 5xx surface is JSON or short HTML
 * and we want it readable in the logs.
 */
async function safeReadBody(res: Response): Promise<string | undefined> {
  try {
    const text = await res.text();
    return text.slice(0, 1024);
  } catch {
    return undefined;
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
  /**
   * Resume from a previously-saved cursor. Existing callers pass `undefined`
   * (or omit) to start from page 0. The sync-worker's chunked dispatcher
   * passes the parsed cursor decoded from `SyncLog.pageCursor` so each
   * invocation processes exactly one page and yields back to the queue.
   */
  initialCursor?: { kind: 'page'; n: number } | { kind: 'token'; token: string } | null;
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
  const env = opts.environment ?? 'PRODUCTION';
  const base = opts.baseUrl ?? baseUrlFor(env);
  const deps: FetcherDeps = {
    baseUrl: base,
    credentials: opts.credentials,
    env,
    signal: opts.signal,
  };

  let processedSoFar = 0;
  let totalElements: number | null = null;
  // Resume support: when an `initialCursor` is supplied, start at that
  // page index OR carry the saved nextPageToken into the first request.
  // No cursor → fresh sync from page 0 (existing behavior).
  let page = opts.initialCursor?.kind === 'page' ? opts.initialCursor.n : 0;
  let pendingToken: string | undefined =
    opts.initialCursor?.kind === 'token' ? opts.initialCursor.token : undefined;

  for (;;) {
    if (deps.signal?.aborted === true) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const url = buildUrl(base, opts.credentials.supplierId, {
      size: PRODUCTS_PAGE_SIZE,
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

    // Default to page-based pagination — that's the documented contract
    // below the 10k cap and avoids the deterministic 500s observed on
    // some nextPageToken values. Switch to nextPageToken ONLY when the
    // next page would cross the cap and Trendyol gave us a token.
    const nextPage = page + 1;
    const nextWouldCrossCap = nextPage * PRODUCTS_PAGE_SIZE >= APPROVED_PAGE_CAP_ITEMS;

    if (nextWouldCrossCap) {
      if (mapped.pageMeta.nextPageToken !== null) {
        pendingToken = mapped.pageMeta.nextPageToken;
      } else {
        // Past the 10k cap with no token — Trendyol gave us no way
        // forward. Stop iteration; this catalog's tail beyond 10k is
        // unreachable through this endpoint without a token.
        return;
      }
    } else {
      pendingToken = undefined;
      page = nextPage;
    }
  }
}
