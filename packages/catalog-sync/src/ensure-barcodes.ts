// Anında katalog onarımı (spec 2026-06-12 §4 + K6).
//
// Yerel sondadan geçemeyen barkodlar çoklu vendor sorgusuyla (fetchProductsByBarcodes,
// istek başına en fazla MAX_BARCODES_PER_QUERY barkod) çekilir ve TAM katalog
// hattından (upsertCatalogBatch) yazılır — gerçek platformVariantId/fiyat/desi,
// duplike riski sıfır. HATA YUTAR: intake'i asla bloke etmez (K6) — çözülemeyen
// barkod `vendorMissing` (vendor'da gerçekten yok) ya da `retriable` (sorgu attı /
// cap-dışı denenmedi / credential bozuk) ayrımıyla döner, çağıran eşleşmemiş
// satırla devam eder, kurtarma tick'i sonra ilgili backoff'la yeniden dener.

import { prisma } from '@pazarsync/db';
import type { Store } from '@pazarsync/db';
import {
  decryptStoreCredentials,
  fetchProductsByBarcodes,
  MAX_BARCODES_PER_QUERY,
} from '@pazarsync/marketplace';
import { syncLog } from '@pazarsync/sync-core';

import { upsertCatalogBatch } from './upsert-catalog-batch';

/**
 * Webhook yanıt süresi bütçesi: tek sorgu ~300-800 ms → 5 çağrı kötü durumda
 * ~4 sn. Her çağrı MAX_BARCODES_PER_QUERY barkod taşır → en fazla 250 barkod.
 */
const DEFAULT_MAX_VENDOR_CALLS = 5;

export interface EnsureBarcodesResult {
  /** Çağrı sonunda yerel katalogda karşılığı OLAN barkodlar. */
  resolved: string[];
  /**
   * Barkod sorgusu BAŞARILI ama barkod yanıtta yok (404, 200-boş ya da grubun
   * diğer barkodları döndü) — vendor'da gerçekten onaylı ürün yok. Seyrek (24 saat) yeniden denenmeli + satıcıya
   * "Trendyol'da yok" olarak gösterilmeli.
   */
  vendorMissing: string[];
  /**
   * Sorgu ATTI (503/network/429), VEYA barkod cap'i aştı (hiç denenmedi),
   * VEYA credential çözümü başarısız. Geçici/bilinmeyen → mevcut üstel backoff
   * korunur.
   */
  retriable: string[];
}

export async function ensureBarcodesInCatalog(
  store: Store,
  barcodes: string[],
  opts?: { maxVendorCalls?: number },
): Promise<EnsureBarcodesResult> {
  const distinct = [...new Set(barcodes.filter((b) => b.length > 0))];
  if (distinct.length === 0) return { resolved: [], vendorMissing: [], retriable: [] };

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
  if (unknown.length === 0) return { resolved: distinct, vendorMissing: [], retriable: [] };

  const cap = opts?.maxVendorCalls ?? DEFAULT_MAX_VENDOR_CALLS;
  const toFetch = unknown.slice(0, cap * MAX_BARCODES_PER_QUERY);
  if (toFetch.length < unknown.length) {
    syncLog.warn('catalog.eager-cap-hit', {
      storeId: store.id,
      requested: unknown.length,
      fetched: toFetch.length,
    });
  }

  // K6 sözü fonksiyonun TAMAMI için geçerli: bozuk credential da intake'i
  // bloke edemez — vendor'a hiç çıkamayız, bilinmeyenler `retriable` döner
  // (decryption geçici sayılır, vendor'da-yok kanıtı YOK).
  let credentials: ReturnType<typeof decryptStoreCredentials>;
  try {
    credentials = decryptStoreCredentials(store);
  } catch (err) {
    syncLog.warn('catalog.eager-credentials-failed', {
      storeId: store.id,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    return {
      resolved: distinct.filter((b) => known.has(b)),
      vendorMissing: [],
      retriable: unknown,
    };
  }

  // Sorgu sonucunu sebebe göre sınıflandır. Yalnız `vendorMissSet`'i AÇIKÇA
  // toplarız (başarılı yanıtta yer almayan barkod = vendor'da gerçekten yok);
  // atan sorgu yine yerelde-yok kalır ve aşağıdaki `else` dalında `retriable`'a
  // düşer — "yanıtta yok" tek "vendor'da-yok" kanıtıdır. Cap'i aşıp HİÇ
  // denenmeyenler de hiçbir sete girmez → aynı `else` ile `retriable` olurlar
  // (denenmedikleri için cezalandırılmaz).
  const vendorMissSet = new Set<string>();
  for (let start = 0; start < toFetch.length; start += MAX_BARCODES_PER_QUERY) {
    const chunk = toFetch.slice(start, start + MAX_BARCODES_PER_QUERY);
    try {
      const page = await fetchProductsByBarcodes({
        environment: store.environment,
        credentials,
        barcodes: chunk,
      });
      // Eksikler upsert'ten ÖNCE işaretlenir: upsert atsa bile yanıtta olmayan
      // barkodun vendor'da yokluğu kesindir; bulunanlar ise retriable kalır.
      const returned = new Set(page.batch.flatMap((p) => p.variants.map((v) => v.barcode)));
      for (const barcode of chunk) {
        if (returned.has(barcode)) continue;
        vendorMissSet.add(barcode);
        syncLog.info('catalog.eager-vendor-miss', { storeId: store.id, barcode });
      }
      if (page.batch.length > 0) {
        await upsertCatalogBatch(store, page.batch, null);
        for (const barcode of chunk) {
          if (returned.has(barcode)) {
            syncLog.info('catalog.eager-resolved', { storeId: store.id, barcode });
          }
        }
      }
    } catch (err) {
      // K6: bir grubun hatası ne diğer grupları ne intake'i durdurur. Gruptaki
      // (vendorMissSet'e girmemiş) barkodlar aşağıda `retriable` olur.
      syncLog.warn('catalog.eager-failed', {
        storeId: store.id,
        barcodes: chunk,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
  }

  known = await localProbe();
  const resolved: string[] = [];
  const vendorMissing: string[] = [];
  const retriable: string[] = [];
  for (const barcode of distinct) {
    if (known.has(barcode)) {
      // Yerelde var → çözüldü.
      resolved.push(barcode);
    } else if (vendorMissSet.has(barcode)) {
      // Sorgu başarılı ama barkod yanıtta yok → vendor'da gerçekten yok.
      vendorMissing.push(barcode);
    } else {
      // Geri kalan her şey geçici: sorgu attı (catch dalı, sete eklenmedi),
      // cap-dışı kaldı (hiç denenmedi) ya da upsert sonrası beklenmedik şekilde
      // hâlâ yerelde yok — mevcut üstel backoff'la yeniden denenir.
      retriable.push(barcode);
    }
  }
  return { resolved, vendorMissing, retriable };
}
