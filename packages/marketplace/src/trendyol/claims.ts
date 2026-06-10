// Trendyol claims (iade talepleri) — PR-13 (research 2026-06-10:
// docs/integrations/trendyol/research/2026-06-10-claims-kesif.md).
//
// GET /integration/order/sellers/{sellerId}/claims returns return requests
// with per-UNIT claim items (a 3-unit return = 3 claimItems). The official
// doc's sample JSON is malformed (items[] rendered outside the claim
// object); the wire types below mirror the REAL shape captured on stage
// and prod during the 2026-06-10 probe. Empirical limits from the same
// probe: size max 200 (400 above), a 60-day startDate–endDate range is
// accepted in one request, claimItemStatus filters server-side.
//
// startDate/endDate filter on the claim's CREATION date — status updates
// do NOT move a claim into a newer window, which is why the sync worker
// re-scans a wide window instead of a delta cursor.
//
// Match keys (proven on stage order 950608199):
//   claim.orderOutboundPackageId == Order.platformOrderId   (primary)
//   claim.orderNumber            == Order.platformOrderNumber (fallback)
//   items[].orderLine.id         == OrderItem.platformLineId (item match;
//     claimItems[].orderLineItemId is a per-unit id — NOT the line id)
//
// PII rule: customerFirstName/LastName arrive on the wire and are dropped
// by the mapper — never persisted, never logged.

import type { StoreEnvironment } from '@pazarsync/db';

import { fetchOnce, type FetcherDeps } from './fetch-once';
import { baseUrlFor } from './headers';
import type { TrendyolCredentials } from './types';

/** Empirical max page size — size=500 → HTTP 400 "Size must be max 200". */
export const CLAIMS_PAGE_SIZE = 200;

/**
 * claimItemStatus values whose meaning is final: the return either
 * happened (Accepted) or definitively did not (Rejected / Cancelled).
 * Created / WaitingInAction / WaitingFraudCheck / Unresolved / InAnalysis
 * are in-flight. Claim-level `resolved` derives from ALL items being
 * terminal (Berkin'in kararı 2026-06-10 — settlement eşleşmesi DEĞİL).
 */
const TERMINAL_CLAIM_ITEM_STATUSES = new Set(['Accepted', 'Rejected', 'Cancelled']);

export function isTerminalClaimItemStatus(status: string): boolean {
  return TERMINAL_CLAIM_ITEM_STATUSES.has(status);
}

// ─── Wire shapes (field names mirror Trendyol EXACTLY) ──────────────────

export interface TrendyolClaimReason {
  id: number;
  name: string;
  externalReasonId: number;
  code: string;
}

export interface TrendyolClaimItemWire {
  /** Trendyol claimLineItemId (UUID) — per UNIT, the idempotency anchor. */
  id: string;
  /** Per-unit line item id — NOT the order line id; unused for matching. */
  orderLineItemId: number;
  customerClaimItemReason?: TrendyolClaimReason | null;
  trendyolClaimItemReason?: TrendyolClaimReason | null;
  claimItemStatus: { name: string };
  note?: string | null;
  customerNote?: string | null;
  resolved?: boolean | null;
  autoAccepted?: boolean | null;
  acceptedBySeller?: boolean | null;
  acceptDetail?: string | null;
  autoApproveDate?: number | null;
}

export interface TrendyolClaimOrderLine {
  /** Order LINE id — matches OrderItem.platformLineId (proven on stage). */
  id: number;
  barcode?: string | null;
  productName?: string | null;
  merchantSku?: string | null;
  productColor?: string | null;
  productSize?: string | null;
  price?: number | null;
  vatBaseAmount?: number | null;
  vatRate?: number | null;
  salesCampaignId?: number | null;
  productCategory?: string | null;
}

export interface TrendyolClaimLineGroup {
  orderLine: TrendyolClaimOrderLine;
  claimItems: TrendyolClaimItemWire[];
}

export interface TrendyolClaim {
  /** Same UUID as claimId — Trendyol sends both. */
  id: string;
  claimId?: string | null;
  orderNumber: string;
  orderDate?: number | null;
  /** True UTC epoch-ms (doc: GMT) — unlike the webhook orderDate quirk. */
  claimDate: number;
  lastModifiedDate?: number | null;
  customerFirstName?: string | null;
  customerLastName?: string | null;
  /** Return parcel's tracking number; null on ~10% of prod claims. */
  cargoTrackingNumber?: number | null;
  cargoProviderName?: string | null;
  /** The RETURN package id (test waiting-in-action endpoint takes this). */
  orderShipmentPackageId?: number | null;
  /** The ORIGINAL outbound package id == Order.platformOrderId (0/76 null on prod). */
  orderOutboundPackageId?: number | null;
  items?: TrendyolClaimLineGroup[] | null;
}

export interface TrendyolClaimsResponse {
  page: number;
  size: number;
  totalPages: number;
  totalElements: number;
  content: TrendyolClaim[];
}

// ─── Mapped domain shapes (PII dropped here) ────────────────────────────

export interface MappedClaimItem {
  /** claimItems[].id — per-unit UUID, upsert anchor with the parent claim. */
  trendyolClaimItemId: string;
  /** items[].orderLine.id as string — resolves OrderItem.platformLineId. */
  orderLineId: string | null;
  reasonCode: string;
  reasonName: string;
  status: string;
  acceptedBySeller: boolean;
  autoApproveDate: Date | null;
  resolved: boolean;
}

export interface MappedClaim {
  trendyolClaimId: string;
  orderNumber: string;
  /** Primary order-match key (== Order.platformOrderId), string form. */
  orderOutboundPackageId: string | null;
  /** The RETURN package id — audit ref + stage test endpoint input. */
  orderShipmentPackageId: string | null;
  claimDate: Date;
  lastModifiedDate: Date | null;
  cargoProviderName: string | null;
  /** Raw String() — BigInt conversion happens at the upsert boundary. */
  cargoTrackingNumber: string | null;
  /** True when EVERY item status is terminal (Accepted/Rejected/Cancelled). */
  resolved: boolean;
  items: MappedClaimItem[];
}

/**
 * Sentinel for "the wire carried no usable reason". The sync worker's
 * update path treats it as no-information and never downgrades a real
 * code back to it.
 */
export const UNKNOWN_REASON_CODE = 'UNKNOWN';

function hasReasonCode(
  reason: TrendyolClaimReason | null | undefined,
): reason is TrendyolClaimReason {
  return reason?.code != null && reason.code !== '';
}

/**
 * Wire claim → domain claim. Loose `!= null` guards throughout — optional
 * fields arrive as missing OR null depending on the claim's state, and
 * replayed JSONB payloads strip undefined (PR-8 lesson).
 */
export function mapTrendyolClaim(claim: TrendyolClaim): MappedClaim {
  const items: MappedClaimItem[] = [];
  for (const group of claim.items ?? []) {
    const orderLineId = group.orderLine?.id != null ? String(group.orderLine.id) : null;
    for (const ci of group.claimItems ?? []) {
      // First reason that actually carries a code — an empty-code customer
      // reason must not shadow a populated Trendyol reason.
      const reason = hasReasonCode(ci.customerClaimItemReason)
        ? ci.customerClaimItemReason
        : hasReasonCode(ci.trendyolClaimItemReason)
          ? ci.trendyolClaimItemReason
          : null;
      items.push({
        trendyolClaimItemId: ci.id,
        orderLineId,
        reasonCode: reason !== null ? reason.code : UNKNOWN_REASON_CODE,
        reasonName: reason?.name ?? '',
        status: ci.claimItemStatus.name,
        acceptedBySeller: ci.acceptedBySeller === true,
        autoApproveDate: ci.autoApproveDate != null ? new Date(ci.autoApproveDate) : null,
        resolved: ci.resolved === true,
      });
    }
  }

  return {
    trendyolClaimId: claim.id,
    orderNumber: claim.orderNumber,
    orderOutboundPackageId:
      claim.orderOutboundPackageId != null ? String(claim.orderOutboundPackageId) : null,
    orderShipmentPackageId:
      claim.orderShipmentPackageId != null ? String(claim.orderShipmentPackageId) : null,
    claimDate: new Date(claim.claimDate),
    lastModifiedDate: claim.lastModifiedDate != null ? new Date(claim.lastModifiedDate) : null,
    cargoProviderName: claim.cargoProviderName ?? null,
    cargoTrackingNumber:
      claim.cargoTrackingNumber != null ? String(claim.cargoTrackingNumber) : null,
    resolved: items.length > 0 && items.every((it) => isTerminalClaimItemStatus(it.status)),
    items,
  };
}

// ─── Fetcher ────────────────────────────────────────────────────────────

export interface FetchClaimsOpts {
  baseUrl?: string;
  environment?: StoreEnvironment;
  credentials: TrendyolCredentials;
  /** Filters on claim CREATION date (status updates do not move claims). */
  startDate: Date;
  endDate: Date;
  /** Optional server-side claimItemStatus filter (single value). */
  claimItemStatus?: string;
  signal?: AbortSignal;
  /** Test hook: backoff base (default 1s). */
  initialBackoffMs?: number;
}

function buildClaimsUrl(
  base: string,
  supplierId: string,
  opts: FetchClaimsOpts,
  page: number,
): string {
  const url = new URL(`${base}/integration/order/sellers/${supplierId}/claims`);
  url.searchParams.set('startDate', opts.startDate.getTime().toString());
  url.searchParams.set('endDate', opts.endDate.getTime().toString());
  url.searchParams.set('size', CLAIMS_PAGE_SIZE.toString());
  url.searchParams.set('page', page.toString());
  if (opts.claimItemStatus !== undefined) {
    url.searchParams.set('claimItemStatus', opts.claimItemStatus);
  }
  return url.toString();
}

/**
 * Async generator over /claims. Page-based (size 200), stops on an empty
 * content[] or when totalElements rows have been streamed — same contract
 * as fetchSettlements. Yields RAW wire claims; callers map via
 * mapTrendyolClaim so tests can assert against captured fixtures.
 */
export async function* fetchClaims(opts: FetchClaimsOpts): AsyncGenerator<TrendyolClaim, void> {
  const env = opts.environment ?? 'PRODUCTION';
  const base = opts.baseUrl ?? baseUrlFor(env);
  const deps: FetcherDeps = {
    credentials: opts.credentials,
    env,
    signal: opts.signal,
    initialBackoffMs: opts.initialBackoffMs,
  };

  let page = 0;
  let processedSoFar = 0;
  let totalElements: number | null = null;

  for (;;) {
    if (deps.signal?.aborted === true) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const url = buildClaimsUrl(base, opts.credentials.supplierId, opts, page);
    const res = await fetchOnce<TrendyolClaimsResponse>(url, deps);

    if (totalElements === null) totalElements = res.totalElements;

    if (res.content.length === 0) return;

    for (const claim of res.content) yield claim;
    processedSoFar += res.content.length;

    if (totalElements !== null && processedSoFar >= totalElements) return;
    page += 1;
  }
}
