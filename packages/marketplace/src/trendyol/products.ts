// Public API of the Trendyol approved-products (v2) integration. Three
// fetchers share one endpoint and one mapper:
//   - fetchApprovedProducts: async generator over the whole catalog (the
//     full PRODUCTS scan), one mapped page per yield;
//   - fetchApprovedProductsPageByDate: one page of a date-filtered query
//     (the hourly PRODUCTS_CHANGES sync);
//   - fetchProductsByBarcodes: one targeted multi-barcode lookup.
// The module has no DB or Prisma awareness and does no logging; callers
// own the upsert and the logs.
//
// Source of truth for the endpoint shape:
//   docs/integrations/trendyol/7-trendyol-marketplace-entegrasyonu/
//     urun-entegrasyonu-v2/urun-filtreleme-onayli-urun-v2.md

import type { StoreEnvironment } from '@pazarsync/db';
import { MarketplaceUnreachable } from '@pazarsync/sync-core';

import { fetchOnce, type FetcherDeps } from './fetch-once';
import { baseUrlFor } from './headers';
import { mapTrendyolApprovedResponse, type MappedProductsPage } from './mapper';
import {
  TRENDYOL_DATE_QUERY_TYPES,
  type TrendyolApprovedProductsResponse,
  type TrendyolApprovedProductsWithContent,
  type TrendyolCredentials,
  type TrendyolDateQueryType,
} from './types';

/**
 * Trendyol getApprovedProducts page size.
 *
 * The cap formula in
 * docs/integrations/trendyol/7-trendyol-marketplace-entegrasyonu/urun-entegrasyonu-v2/urun-filtreleme-onayli-urun-v2.md
 * says "Page x size maksimum 10.000 değerini alabilir." — this is the
 * PAGINATION cap (after which nextPageToken is required), not the
 * per-request size limit. The doc only shows `size=100` examples for
 * the approved endpoint; PR #88 bumped to 1000 hoping the cap formula
 * implied size=1000 was supported, but Trendyol's approved endpoint
 * empirically returns 400 on size=1000 (per a real sandbox sync with
 * a small catalog, immediate fail on page 0). 100 is the known-good
 * max — confirmed by working dev syncs of 5,624-product catalogs
 * across multiple sessions.
 *
 * Exported because the sync-worker's token→page fallback math
 * (apps/sync-worker/src/handlers/products.ts) uses the same constant.
 * Single source of truth.
 */
export const PRODUCTS_PAGE_SIZE = 100;
/**
 * Trendyol's documented page-based pagination cap (same doc as above).
 * Items 0–9999 are reachable via `page=N`; item 10000+ requires
 * `nextPageToken`.
 *
 * Exported for the same reason as PRODUCTS_PAGE_SIZE — the worker's
 * token-fallback recomputation references this cap.
 */
export const APPROVED_PAGE_CAP_ITEMS = 10_000;

interface PageRequest {
  size: number;
  page?: number;
  nextPageToken?: string;
}

function approvedProductsUrl(base: string, supplierId: string): URL {
  return new URL(`${base}/integration/product/sellers/${supplierId}/products/approved`);
}

/**
 * What a 404 maps to on the single-page paths: no rows and no further
 * pages. `page` echoes the page that was requested.
 */
function emptyApprovedPage(page: number): MappedProductsPage {
  return {
    batch: [],
    pageMeta: {
      totalElements: 0,
      totalPages: 0,
      page,
      size: PRODUCTS_PAGE_SIZE,
      nextPageToken: null,
    },
  };
}

function isNotFound(err: unknown): boolean {
  return err instanceof MarketplaceUnreachable && err.meta.httpStatus === 404;
}

/**
 * The full scan and the barcode lookup require the `content` list. A 200
 * without one is not a trusted "no rows": in the full scan, ending the walk
 * there would let the chunk handler take a truncated catalog for a complete
 * one and run its delist pass over every variant it did not reach. So throw.
 * The sync worker classes a plain Error as INTERNAL_ERROR and retries the
 * same page, which is also what the old `null.map` TypeError did.
 */
function requireContent(
  raw: TrendyolApprovedProductsResponse,
  request: string,
): TrendyolApprovedProductsWithContent {
  const { content } = raw;
  if (content === null || content === undefined) {
    throw new Error(`Trendyol approved products answered ${request} without a content list`);
  }
  return { ...raw, content };
}

function buildUrl(base: string, supplierId: string, req: PageRequest): string {
  const url = approvedProductsUrl(base, supplierId);
  url.searchParams.set('size', req.size.toString());
  if (req.nextPageToken !== undefined) {
    url.searchParams.set('nextPageToken', req.nextPageToken);
  } else if (req.page !== undefined) {
    url.searchParams.set('page', req.page.toString());
  }
  return url.toString();
}

/**
 * Trendyol's per-request cap for the approved v2 endpoint's multi-barcode
 * `barcodes` filter ("maksimum 50 barcode gönderilebilir").
 */
export const MAX_BARCODES_PER_QUERY = 50;

/**
 * Çoklu barkod sorgusu — "Ürün Filtreleme – Onaylı Ürün v2" endpoint'inin
 * `barcodes` giriş parametresi (virgülle ayrılmış, en fazla 50; canlı ve stage'de
 * 2026-10-19'da doğrulandı). Tek sayfa, sayfalama yok: 50 barkod en fazla 50
 * content döndürür, PRODUCTS_PAGE_SIZE (100) içine sığar. Yanıt tam katalog
 * senkronuyla AYNI şekildedir → aynı mapper'dan geçer. Vendor'da bulunmayan
 * barkodlar yanıtta yer almaz; hangisinin eksik olduğunu çağıran ayıklar.
 */
export async function fetchProductsByBarcodes(
  opts: Omit<FetchApprovedProductsOpts, 'initialCursor'> & { barcodes: string[] },
): Promise<MappedProductsPage> {
  if (opts.barcodes.length === 0 || opts.barcodes.length > MAX_BARCODES_PER_QUERY) {
    throw new RangeError(
      `fetchProductsByBarcodes expects 1–${MAX_BARCODES_PER_QUERY.toString()} barcodes; got ${opts.barcodes.length.toString()}`,
    );
  }
  const env = opts.environment ?? 'PRODUCTION';
  const base = opts.baseUrl ?? baseUrlFor(env);
  const deps: FetcherDeps = {
    credentials: opts.credentials,
    env,
    signal: opts.signal,
  };

  const url = approvedProductsUrl(base, opts.credentials.supplierId);
  url.searchParams.set('barcodes', opts.barcodes.join(','));
  url.searchParams.set('size', PRODUCTS_PAGE_SIZE.toString());

  try {
    const raw = await fetchOnce<TrendyolApprovedProductsResponse>(url.toString(), deps);
    return mapTrendyolApprovedResponse(requireContent(raw, 'a barcode lookup'));
  } catch (err) {
    // On a barcode lookup a 404 means "no approved product matches": an
    // empty result, not an error. fetch-once.ts maps 404 to
    // MarketplaceUnreachable for every caller on purpose (in the full-scan
    // generator a 404 past the last page is a retryable failure); only the
    // single-page paths (this one and fetchApprovedProductsPageByDate)
    // turn it into an empty page.
    if (isNotFound(err)) return emptyApprovedPage(0);
    throw err;
  }
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

export interface FetchApprovedProductsPageByDateOpts extends Omit<
  FetchApprovedProductsOpts,
  'initialCursor'
> {
  /**
   * Which timestamp the window filters on. Required: without it Trendyol
   * ignores startDate/endDate and returns the whole catalog.
   */
  dateQueryType: TrendyolDateQueryType;
  /** Window start, epoch milliseconds (Trendyol `startDate`, a long). */
  startDate: number;
  /** Window end, epoch milliseconds (Trendyol `endDate`, a long). */
  endDate: number;
  /** 0-based page; page * PRODUCTS_PAGE_SIZE must stay <= APPROVED_PAGE_CAP_ITEMS. */
  page: number;
}

/** One page of a date-filtered approved query. */
export interface ApprovedProductsPageByDate extends MappedProductsPage {
  /**
   * True when Trendyol answered 404 and the page was mapped to an empty one.
   * Without it a caller cannot tell a 404 from a genuinely empty window, and
   * stage answers those with 200 and `content: []`, so a 404 is worth a log.
   */
  notFound: boolean;
}

function isNonNegativeSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

/**
 * Rejects a malformed date-page request before any vendor call. The page
 * bound is Trendyol's documented "page x size <= 10,000" request rule; the
 * PRODUCTS_CHANGES handler stops one page earlier, at the last page whose
 * items all sit below the cap. No maximum window length is enforced:
 * Trendyol documents none, and the handler owns the window size.
 */
function assertDatePageRequest(opts: FetchApprovedProductsPageByDateOpts): void {
  if (!TRENDYOL_DATE_QUERY_TYPES.includes(opts.dateQueryType)) {
    throw new RangeError(`Unknown dateQueryType: ${opts.dateQueryType}`);
  }
  if (!isNonNegativeSafeInteger(opts.page)) {
    throw new RangeError(`page must be a non-negative integer; got ${opts.page.toString()}`);
  }
  if (opts.page * PRODUCTS_PAGE_SIZE > APPROVED_PAGE_CAP_ITEMS) {
    throw new RangeError(
      `page ${opts.page.toString()} x size ${PRODUCTS_PAGE_SIZE.toString()} exceeds the ` +
        `${APPROVED_PAGE_CAP_ITEMS.toString()}-item page cap of the approved endpoint`,
    );
  }
  if (!isNonNegativeSafeInteger(opts.startDate) || !isNonNegativeSafeInteger(opts.endDate)) {
    throw new RangeError(
      `startDate/endDate must be non-negative epoch milliseconds; got ` +
        `${opts.startDate.toString()}..${opts.endDate.toString()}`,
    );
  }
  if (opts.startDate > opts.endDate) {
    throw new RangeError(
      `startDate (${opts.startDate.toString()}) must be <= endDate (${opts.endDate.toString()})`,
    );
  }
}

/**
 * One page of the approved v2 list filtered by a date window (used by the
 * hourly PRODUCTS_CHANGES sync). Same endpoint, page size and mapper as the
 * full scan, so a returned product carries its complete variant list with
 * status, desi, commission, VAT, delivery duration and images.
 *
 * Stage behaviour (2026-10-28): dates are epoch milliseconds; an empty window
 * answers 200 with `content: []` and `totalElements: 0`; one page past the
 * last answers 200 with `content: []`; an endDate in the future is accepted.
 * A 404 maps to an empty page flagged `notFound`, so a result set that shrank
 * mid-walk ends the walk instead of failing the run, and the caller can still
 * log it. A `totalElements` above the 10,000-item cap is returned, not thrown:
 * the caller decides what to do with it.
 */
export async function fetchApprovedProductsPageByDate(
  opts: FetchApprovedProductsPageByDateOpts,
): Promise<ApprovedProductsPageByDate> {
  assertDatePageRequest(opts);
  const env = opts.environment ?? 'PRODUCTION';
  const base = opts.baseUrl ?? baseUrlFor(env);
  const deps: FetcherDeps = {
    credentials: opts.credentials,
    env,
    signal: opts.signal,
  };

  // Exactly these five params. Never `status`: it prunes each product's
  // variant list down to the matching variants, so products would come back
  // short. Never `orderByDirection`: ASC sorts unreliably on stage. Never
  // `nextPageToken`: this path pages by `page` only and stops at the cap.
  const url = approvedProductsUrl(base, opts.credentials.supplierId);
  url.searchParams.set('dateQueryType', opts.dateQueryType);
  url.searchParams.set('startDate', opts.startDate.toString());
  url.searchParams.set('endDate', opts.endDate.toString());
  url.searchParams.set('page', opts.page.toString());
  url.searchParams.set('size', PRODUCTS_PAGE_SIZE.toString());

  try {
    const raw = await fetchOnce<TrendyolApprovedProductsResponse>(url.toString(), deps);
    // Only this single-page path reads a null or missing list as an empty
    // page (the handler then moves to the next phase). PRODUCTS_CHANGES
    // never delists, so a page cut short costs at most a few changes that
    // the nightly full scan rewrites. The full scan does not get this
    // tolerance: see requireContent.
    const mapped = mapTrendyolApprovedResponse({ ...raw, content: raw.content ?? [] });
    return { ...mapped, notFound: false };
  } catch (err) {
    if (isNotFound(err)) return { ...emptyApprovedPage(opts.page), notFound: true };
    throw err;
  }
}

/**
 * Async generator over Trendyol's /products/approved endpoint. Yields one
 * page at a time, fully mapped. Caller decides whether to upsert each
 * batch or buffer.
 *
 * Pagination: `page=0..N` while page*size ≤ 10,000; switches to
 * `nextPageToken` when Trendyol returns one (which it does past the
 * 10k cap). Stops when an empty `content[]` is returned or all
 * `totalElements` rows have been streamed. A 200 with a null or missing
 * `content` throws instead of stopping (see requireContent).
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

    const raw = await fetchOnce<TrendyolApprovedProductsResponse>(url, deps);
    const request =
      pendingToken === undefined ? `page ${page.toString()}` : 'a nextPageToken request';
    const mapped = mapTrendyolApprovedResponse(requireContent(raw, request));

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
        //
        // This is the generator-internal parallel of the chunk handler's
        // same-condition exit (apps/sync-worker/src/handlers/products.ts).
        // The pure fetcher stays log-free by design: it has no syncLogId /
        // storeId context to attach, and the truncation is already exposed
        // to every consumer via the last yielded page's
        // `pageMeta.nextPageToken` (null at/after the cap). The production
        // consumer is the chunk handler, which drives paging one page at a
        // time, inspects that same signal, and logs it there with full
        // context (`products.catalog-truncated-10k`). A direct
        // full-generator consumer can detect the identical condition from
        // `pageMeta`.
        return;
      }
    } else {
      pendingToken = undefined;
      page = nextPage;
    }
  }
}
