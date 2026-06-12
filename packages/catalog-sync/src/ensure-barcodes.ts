// Anında katalog onarımı (spec 2026-06-12 §4 + K6).
//
// Yerel sondadan geçemeyen barkodlar tekil vendor sorgusuyla (variant-recovery
// PR-2 fetchProductsByBarcode) çekilir ve TAM katalog hattından (upsertCatalogBatch)
// yazılır — gerçek platformVariantId/fiyat/desi, duplike riski sıfır. HATA YUTAR:
// intake'i asla bloke etmez (K6) — başarısız barkod `missing`te döner, çağıran
// eşleşmemiş satırla devam eder, kurtarma tick'i sonra dener.

import { prisma } from '@pazarsync/db';
import type { Store } from '@pazarsync/db';
import { decryptStoreCredentials, fetchProductsByBarcode } from '@pazarsync/marketplace';
import { syncLog } from '@pazarsync/sync-core';

import { upsertCatalogBatch } from './upsert-catalog-batch';

/** Webhook yanıt süresi bütçesi: tek sorgu ~300-800 ms → 5 çağrı kötü durumda ~4 sn. */
const DEFAULT_MAX_VENDOR_CALLS = 5;

export interface EnsureBarcodesResult {
  /** Çağrı sonunda yerel katalogda karşılığı OLAN barkodlar. */
  resolved: string[];
  /** Vendor'da bulunamayan ya da sorgusu başarısız olan barkodlar. */
  missing: string[];
}

export async function ensureBarcodesInCatalog(
  store: Store,
  barcodes: string[],
  opts?: { maxVendorCalls?: number },
): Promise<EnsureBarcodesResult> {
  const distinct = [...new Set(barcodes.filter((b) => b.length > 0))];
  if (distinct.length === 0) return { resolved: [], missing: [] };

  const localProbe = async (): Promise<Set<string>> =>
    new Set(
      (
        await prisma.productVariant.findMany({
          where: { storeId: store.id, barcode: { in: distinct } },
          select: { barcode: true },
        })
      ).map((v) => v.barcode),
    );

  let known = await localProbe();
  const unknown = distinct.filter((b) => !known.has(b));
  if (unknown.length === 0) return { resolved: distinct, missing: [] };

  const cap = opts?.maxVendorCalls ?? DEFAULT_MAX_VENDOR_CALLS;
  const toFetch = unknown.slice(0, cap);
  if (toFetch.length < unknown.length) {
    syncLog.warn('catalog.eager-cap-hit', {
      storeId: store.id,
      requested: unknown.length,
      fetched: toFetch.length,
    });
  }

  // K6 sözü fonksiyonun TAMAMI için geçerli: bozuk credential da intake'i
  // bloke edemez — vendor'a hiç çıkamayız, bilinmeyenler missing döner.
  let credentials: ReturnType<typeof decryptStoreCredentials>;
  try {
    credentials = decryptStoreCredentials(store);
  } catch (err) {
    syncLog.warn('catalog.eager-credentials-failed', {
      storeId: store.id,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    return { resolved: distinct.filter((b) => known.has(b)), missing: unknown };
  }
  for (const barcode of toFetch) {
    try {
      const page = await fetchProductsByBarcode({
        environment: store.environment,
        credentials,
        barcode,
      });
      if (page.batch.length > 0) {
        await upsertCatalogBatch(store, page.batch, null);
        syncLog.info('catalog.eager-resolved', { storeId: store.id, barcode });
      } else {
        syncLog.info('catalog.eager-vendor-miss', { storeId: store.id, barcode });
      }
    } catch (err) {
      // K6: tek barkodun hatası ne diğer barkodları ne intake'i durdurur.
      syncLog.warn('catalog.eager-failed', {
        storeId: store.id,
        barcode,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
  }

  known = await localProbe();
  return {
    resolved: distinct.filter((b) => known.has(b)),
    missing: distinct.filter((b) => !known.has(b)),
  };
}
