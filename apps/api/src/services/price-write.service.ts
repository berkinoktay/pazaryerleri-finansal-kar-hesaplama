// Trendyol price-write service.
//
// The system's FIRST write-direction marketplace operation. Pushes a variant's
// new sale price to the marketplace (live, irreversible — Trendyol allows one
// price change per barcode per day). Every invocation is audited via a
// `PriceChangeLog` row and gated upstream to OWNER/ADMIN (route layer).
//
// FLOW (plan §Akış, owner-decided 2026-06-22):
//   1. Fetch the variant scoped by organizationId + storeId (barcode + current
//      salePrice + listPrice). Cross-store / missing → NotFoundError (404,
//      existence non-disclosure).
//   2. Compute rrp (Trendyol's "recommended retail price" / our listPrice):
//      keep the existing listPrice, but raise it to the new salePrice when the
//      new sale exceeds it (Trendyol rejects rrp < buyingPrice). Decimal compare.
//   3. Write PriceChangeLog PENDING (audit before the side effect).
//   4. decryptStoreCredentials + getAdapter → adapter.updatePrices([item]) →
//      { batchId }. Store batchId on the log.
//   5. Poll adapter.checkPriceBatch(batchId) a few times (bounded wait) until
//      the batch is done or the window elapses.
//   6. SUCCESS → update ProductVariant.salePrice (org+store) + log SUCCESS.
//      FAILED  → log FAILED with the vendor errorCode, throw MarketplaceWriteFailedError.
//      TIMEOUT → leave the log PENDING, return PENDING (DB salePrice NOT touched —
//                "submitted" is not "confirmed"; the UI shows "awaiting Trendyol").
//
// SECURITY: credentials are decrypted in-memory only and NEVER logged. Every
// Prisma read/write is org+store scoped. Money stays Decimal; the wire is string.

import { Decimal } from 'decimal.js';

import { prisma } from '@pazarsync/db';
import type { Prisma, Store as PrismaStore } from '@pazarsync/db';
import {
  decryptStoreCredentials,
  getAdapter,
  StoreCredentialShapeError,
  type MarketplaceAdapter,
} from '@pazarsync/marketplace';
import { mapPrismaError } from '@pazarsync/sync-core';

import { MarketplaceWriteFailedError, NotFoundError, ValidationError } from '../lib/errors';

// ─── Polling bounds (plan: short bounded wait, ~5–8s total) ───────────────────
// A small fixed number of attempts with a short delay between them. Trendyol's
// price batch usually resolves within a couple of seconds; if it does not, we
// stop and report PENDING rather than holding the request open.
const POLL_MAX_ATTEMPTS = 5;
const POLL_DELAY_MS = 1_500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface UpdateVariantPriceInput {
  variantId: string;
  /** New sale price (GROSS, VAT-inclusive) as a decimal string. Validated > 0 upstream. */
  salePrice: string;
  /** The authenticated caller (audit attribution). From the request context, never the body. */
  userId: string;
}

export type UpdateVariantPriceResult = {
  status: 'SUCCESS' | 'PENDING';
  variantId: string;
  newSalePrice: string;
  batchId: string;
};

/** Variant columns the price write reads — exactly what it needs. */
interface VariantForPriceWrite {
  id: string;
  barcode: string;
  salePrice: Prisma.Decimal;
  listPrice: Prisma.Decimal;
}

/**
 * Computes the rrp (Trendyol recommended retail / our listPrice) to send with a
 * new sale price. Trendyol requires `rrp >= buyingPrice`, so when the new sale
 * price exceeds the current list price we raise the rrp to the sale price;
 * otherwise the existing list price is kept. Pure Decimal comparison — no float.
 */
function computeRrp(currentListPrice: Decimal, newSalePrice: Decimal): Decimal {
  return newSalePrice.gt(currentListPrice) ? newSalePrice : currentListPrice;
}

/**
 * Writes a variant's new sale price to the marketplace and reconciles the local
 * cache on confirmed success. See the file header for the full flow.
 *
 * Throws:
 *   - NotFoundError (404)            — variant missing or in another store/org.
 *   - ValidationError (422)          — store credentials corrupted (well-decrypted
 *                                      but wrong shape).
 *   - MarketplaceWriteFailedError (422) — the marketplace rejected the item.
 *   - MarketplaceAuth/Access/Unreachable/RateLimited — bubbled from the adapter.
 */
export async function updateVariantSalePrice(
  organizationId: string,
  storeId: string,
  store: PrismaStore,
  input: UpdateVariantPriceInput,
): Promise<UpdateVariantPriceResult> {
  const newSalePrice = new Decimal(input.salePrice);

  // ─── 1. Fetch the variant (must belong to this org + store) ────────────────
  let variant: VariantForPriceWrite | null;
  try {
    variant = await prisma.productVariant.findFirst({
      where: { id: input.variantId, organizationId, storeId },
      select: { id: true, barcode: true, salePrice: true, listPrice: true },
    });
  } catch (err) {
    mapPrismaError(err);
  }
  if (variant === null) {
    // 404, not 403 — a cross-store/cross-org variant is indistinguishable from a
    // missing one (existence non-disclosure, SECURITY.md §3).
    throw new NotFoundError('ProductVariant', input.variantId);
  }

  const oldSalePrice = new Decimal(variant.salePrice.toString());
  const currentListPrice = new Decimal(variant.listPrice.toString());
  const rrp = computeRrp(currentListPrice, newSalePrice);

  // ─── 2. Decrypt credentials (in-memory only — NEVER logged) + adapter ──────
  // Done BEFORE the audit row so a corrupted-credentials request fails fast and
  // leaves no orphaned PENDING log (a purely local check that can't succeed if
  // the blob is bad — no point recording an attempt that never reaches Trendyol).
  let adapter;
  try {
    const credentials = decryptStoreCredentials(store);
    adapter = getAdapter(store.platform, store.environment, credentials);
  } catch (err) {
    // Only a well-decrypted-but-wrong-shape blob is the user's to fix (422).
    // A decrypt-chain failure (missing/rotated ENCRYPTION_KEY, tampered blob)
    // keeps its true status — don't mask a server/security fault as "corrupted".
    if (err instanceof StoreCredentialShapeError) {
      throw new ValidationError([{ field: '(credentials)', code: 'STORE_CREDENTIALS_CORRUPTED' }]);
    }
    throw err;
  }

  // ─── 3. Audit row PENDING (before the irreversible side effect) ────────────
  let log: { id: string };
  try {
    log = await prisma.priceChangeLog.create({
      data: {
        organizationId,
        storeId,
        variantId: variant.id,
        userId: input.userId,
        platform: store.platform,
        barcode: variant.barcode,
        oldSalePrice: oldSalePrice.toFixed(2),
        newSalePrice: newSalePrice.toFixed(2),
        listPrice: rrp.toFixed(2),
        status: 'PENDING',
      },
      select: { id: true },
    });
  } catch (err) {
    mapPrismaError(err);
  }

  // ─── 4. Submit the price update → batchId ──────────────────────────────────
  const { batchId } = await adapter.updatePrices([
    { barcode: variant.barcode, salePrice: newSalePrice.toFixed(2), listPrice: rrp.toFixed(2) },
  ]);

  await updateLog(log.id, { trendyolBatchId: batchId });

  // ─── 5. Poll the batch outcome (bounded) ───────────────────────────────────
  const outcome = await pollBatchOutcome(adapter, batchId, variant.barcode);

  // ─── 6. Reconcile on confirmed result ──────────────────────────────────────
  if (outcome.kind === 'SUCCESS') {
    await reconcileSuccess(organizationId, storeId, variant.id, newSalePrice, rrp, log.id);
    return {
      status: 'SUCCESS',
      variantId: variant.id,
      newSalePrice: newSalePrice.toFixed(2),
      batchId,
    };
  }

  if (outcome.kind === 'FAILED') {
    await updateLog(log.id, { status: 'FAILED', errorCode: outcome.errorCode });
    throw new MarketplaceWriteFailedError(store.platform, outcome.errorCode);
  }

  // TIMEOUT: leave the log PENDING and the DB salePrice untouched. "Submitted" is
  // not "confirmed" — the marketplace may still apply the change later.
  return {
    status: 'PENDING',
    variantId: variant.id,
    newSalePrice: newSalePrice.toFixed(2),
    batchId,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

type BatchOutcome =
  | { kind: 'SUCCESS' }
  | { kind: 'FAILED'; errorCode: string }
  | { kind: 'TIMEOUT' };

/** Vendor failure reason fallback when the batch item carries no specific reason. */
const UNKNOWN_FAILURE_REASON = 'UNKNOWN';

/**
 * Polls `checkPriceBatch` up to POLL_MAX_ATTEMPTS times, sleeping POLL_DELAY_MS
 * between attempts, until the batch is no longer processing. Resolves the item
 * matching `barcode`:
 *   - found + SUCCESS → SUCCESS
 *   - found + FAILED  → FAILED (with the first failureReason, or UNKNOWN)
 *   - batch done but item absent → FAILED (the marketplace dropped it)
 *   - still processing after the last attempt → TIMEOUT
 */
async function pollBatchOutcome(
  adapter: MarketplaceAdapter,
  batchId: string,
  barcode: string,
): Promise<BatchOutcome> {
  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt += 1) {
    if (attempt > 0) {
      await sleep(POLL_DELAY_MS);
    }
    const batch = await adapter.checkPriceBatch(batchId);
    if (batch.processing) {
      continue;
    }
    const item = batch.items.find((i) => i.barcode === barcode);
    if (item === undefined) {
      // Batch finished but our barcode is absent — treat as a failed write.
      return { kind: 'FAILED', errorCode: UNKNOWN_FAILURE_REASON };
    }
    if (item.status === 'SUCCESS') {
      return { kind: 'SUCCESS' };
    }
    return { kind: 'FAILED', errorCode: item.failureReasons?.[0] ?? UNKNOWN_FAILURE_REASON };
  }
  return { kind: 'TIMEOUT' };
}

/** Updates the audit log row. Wrapped with mapPrismaError. */
async function updateLog(id: string, data: Prisma.PriceChangeLogUpdateInput): Promise<void> {
  try {
    await prisma.priceChangeLog.update({ where: { id }, data });
  } catch (err) {
    mapPrismaError(err);
  }
}

/**
 * Write-back on confirmed success: update the local ProductVariant cache and
 * mark the audit row SUCCESS, both scoped to this org + store. The list price is
 * also persisted because we may have raised it (rrp >= sale). Done in a single
 * transaction so the cache and the audit trail never disagree.
 */
async function reconcileSuccess(
  organizationId: string,
  storeId: string,
  variantId: string,
  newSalePrice: Decimal,
  rrp: Decimal,
  logId: string,
): Promise<void> {
  try {
    await prisma.$transaction([
      // updateMany so the org+store scope is part of the WHERE — the row was
      // already verified by the upstream findFirst, but keeping the tenant
      // predicate here means a concurrent re-scope cannot be written across.
      prisma.productVariant.updateMany({
        where: { id: variantId, organizationId, storeId },
        data: { salePrice: newSalePrice.toFixed(2), listPrice: rrp.toFixed(2) },
      }),
      prisma.priceChangeLog.update({ where: { id: logId }, data: { status: 'SUCCESS' } }),
    ]);
  } catch (err) {
    mapPrismaError(err);
  }
}
