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

import type { StoreEnvironment } from '@pazarsync/db';

import { fetchOnce, type FetcherDeps } from './fetch-once';
import { baseUrlFor } from './headers';
import type { TrendyolCredentials } from './types';

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
    initialBackoffMs: opts.initialBackoffMs,
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

    const raw = await fetchOnce<CargoInvoiceItemsResponse>(url.toString(), deps);
    items.push(...raw.content);

    if (raw.content.length === 0 || page + 1 >= raw.totalPages) return items;
    page += 1;
  }
}
