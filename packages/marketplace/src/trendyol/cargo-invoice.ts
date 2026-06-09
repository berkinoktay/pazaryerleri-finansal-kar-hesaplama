// Trendyol cargo-invoice line items — PR-8 (research 2026-06-09:
// docs/integrations/trendyol/research/2026-06-09-cargo-split-kesif.md).
//
// Discovery chain: otherfinancials DeductionInvoices rows whose TR-localized
// transactionType is "Kargo Fatura(sı)" carry the invoice serial in `id`;
// GET /integration/finance/che/sellers/{sellerId}/cargo-invoice/{serial}/items
// returns the per-parcel breakdown. Each item's `parcelUniqueId` equals the
// package's cargoTrackingNumber (proven on prod), which is the primary
// invoice-to-order match key. `amount` is VAT-INCLUSIVE ("KDV tevkifat
// uygulanmamistir" per the invoice description) — the split rate comes from
// fee_definitions.default_vat_rate, never from code.
//
// No date-window cap applies here (serial-scoped endpoint, page-based).
//
// NOTE: TODO PR-N+1 — fetchOnce/parseRetryAfterSeconds/safeReadBody are the
// fourth duplicate (products.ts + orders.ts + settlements.ts + here); the
// promote to a shared client helper is tracked, kept out of scope per PR.

import type { StoreEnvironment } from '@pazarsync/db';
import { MarketplaceUnreachable, RateLimitedError } from '@pazarsync/sync-core';

import { sleep } from '../lib/sleep';
import { mapTrendyolResponseToDomainError } from './errors';
import { baseUrlFor, buildAuthHeader, buildUserAgent } from './headers';
import type { TrendyolCredentials } from './types';

const PLATFORM = 'TRENDYOL';
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_BACKOFF_RETRIES = 4;
const INITIAL_BACKOFF_MS = 1_000;

/** Page size for cargo-invoice items — Trendyol returns up to 500 per page. */
export const CARGO_INVOICE_PAGE_SIZE = 500;

/** One parcel line of a cargo invoice (wire shape, doc-verified on prod). */
export interface CargoInvoiceItem {
  /** "Gönderi Kargo Bedeli" (outbound) | "İade Kargo Bedeli" (return). */
  shipmentPackageType: string;
  /** == the package's cargoTrackingNumber (proven on prod) — match key. */
  parcelUniqueId: number;
  /** Üst sipariş numarası (orderNumber) — fallback match key. */
  orderNumber: string;
  /** Parcel charge, VAT-INCLUSIVE (TRY). */
  amount: number;
  /** Billed desi for the parcel. */
  desi: number;
}

interface CargoInvoiceItemsResponse {
  page: number;
  size: number;
  totalPages: number;
  totalElements: number;
  content: CargoInvoiceItem[];
}

interface FetcherDeps {
  credentials: TrendyolCredentials;
  env: StoreEnvironment;
  signal?: AbortSignal;
  initialBackoffMs: number;
}

function parseRetryAfterSeconds(header: string | null): number | null {
  if (header === null) return null;
  const parsed = Number.parseInt(header, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

async function safeReadBody(res: Response): Promise<string | undefined> {
  try {
    const text = await res.text();
    return text.slice(0, 1024);
  } catch {
    return undefined;
  }
}

async function fetchOnce(url: string, deps: FetcherDeps): Promise<CargoInvoiceItemsResponse> {
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
      // Type-cast follows the products/orders/settlements convention; runtime
      // schema validation (Zod) is tracked under the fetchOnce promote cleanup.
      return (await res.json()) as CargoInvoiceItemsResponse;
    }

    const sandbox503 = res !== undefined && res.status === 503 && deps.env === 'SANDBOX';
    const isTransient =
      networkError ||
      (res !== undefined && (res.status === 429 || (res.status >= 500 && !sandbox503)));

    if (isTransient && attempt < MAX_BACKOFF_RETRIES) {
      const headerSeconds =
        res !== undefined ? parseRetryAfterSeconds(res.headers.get('Retry-After')) : null;
      const waitMs =
        headerSeconds !== null
          ? headerSeconds * 1000
          : deps.initialBackoffMs * Math.pow(2, attempt);
      attempt += 1;
      await sleep(waitMs, deps.signal);
      continue;
    }

    if (networkError || res === undefined) {
      throw new MarketplaceUnreachable(PLATFORM, { httpStatus: 0, url });
    }
    if (res.status === 429) {
      const seconds = parseRetryAfterSeconds(res.headers.get('Retry-After')) ?? 30;
      throw new RateLimitedError(seconds, 'Trendyol rate limit hit (retries exhausted)');
    }
    const snippet = await safeReadBody(res);
    const xRequestId = res.headers.get('X-Request-ID') ?? undefined;
    mapTrendyolResponseToDomainError(res, deps.env, {
      url,
      xRequestId,
      responseBodySnippet: snippet,
    });
  }
}

export interface FetchCargoInvoiceItemsOpts {
  baseUrl?: string;
  environment?: StoreEnvironment;
  credentials: TrendyolCredentials;
  signal?: AbortSignal;
  /** Fatura seri numarası — otherfinancials Kargo Fatura satırının `id`'si. */
  invoiceSerialNumber: string;
  /** Test hook: backoff base (default 1s). */
  initialBackoffMs?: number;
}

/**
 * Fetch EVERY line item of one cargo invoice (all pages collected). A weekly
 * invoice carries on the order of 100-500 parcels — bounded, so collecting
 * into one array (instead of a generator) keeps the caller's matching pass
 * simple. Pages advance while the reported totalPages allows.
 */
export async function fetchAllCargoInvoiceItems(
  opts: FetchCargoInvoiceItemsOpts,
): Promise<CargoInvoiceItem[]> {
  const env = opts.environment ?? 'PRODUCTION';
  const base = opts.baseUrl ?? baseUrlFor(env);
  const deps: FetcherDeps = {
    credentials: opts.credentials,
    env,
    signal: opts.signal,
    initialBackoffMs: opts.initialBackoffMs ?? INITIAL_BACKOFF_MS,
  };

  const items: CargoInvoiceItem[] = [];
  let page = 0;
  for (;;) {
    if (deps.signal?.aborted === true) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const url = new URL(
      `${base}/integration/finance/che/sellers/${opts.credentials.supplierId}/cargo-invoice/${opts.invoiceSerialNumber}/items`,
    );
    url.searchParams.set('page', page.toString());
    url.searchParams.set('size', CARGO_INVOICE_PAGE_SIZE.toString());

    const raw = await fetchOnce(url.toString(), deps);
    items.push(...raw.content);

    if (raw.content.length === 0 || page + 1 >= raw.totalPages) return items;
    page += 1;
  }
}
