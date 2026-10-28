// ensureBarcodesInCatalog sınıflandırma birim testleri (Task 3).
//
// Vendor (fetchProductsByBarcodes), credential çözümü (decryptStoreCredentials),
// katalog yazımı (upsertCatalogBatch) ve yerel sonda (prisma.productVariant
// .findMany) modül sınırında mock'lanır. Her senaryo yalnız sınıflandırmayı
// (resolved / vendorMissing / retriable) doğrular — gerçek DB/HTTP yok.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Store } from '@pazarsync/db';
import { ProductVariantStatus } from '@pazarsync/db/enums';
import type {
  MappedProduct,
  MappedProductsPage,
  MappedProductVariant,
} from '@pazarsync/marketplace';

import { ensureBarcodesInCatalog } from '../ensure-barcodes';

// ─── Mock'lar (modül sınırı) ─────────────────────────────────────────────
const findMany = vi.fn<() => Promise<{ barcode: string }[]>>();
vi.mock('@pazarsync/db', () => ({
  prisma: { productVariant: { findMany: () => findMany() } },
}));

// Gerçek paket sabitiyle aynı değer — vi.mock fabrikası hoist edildiği için
// dış kapsamdaki bir sabite başvuramaz.
const MAX_BARCODES = 50;
const fetchProductsByBarcodes =
  vi.fn<(opts: { barcodes: string[] }) => Promise<MappedProductsPage>>();
const decryptStoreCredentials = vi.fn<() => { supplierId: string }>();
vi.mock('@pazarsync/marketplace', () => ({
  MAX_BARCODES_PER_QUERY: 50,
  fetchProductsByBarcodes: (opts: { barcodes: string[] }) => fetchProductsByBarcodes(opts),
  decryptStoreCredentials: () => decryptStoreCredentials(),
}));

const upsertCatalogBatch = vi.fn<() => Promise<void>>();
// vi.mock id'si TEST DOSYASINA göre çözülür; SUT bunu './upsert-catalog-batch'
// olarak içe aktarır ama test src/__tests__/ altında olduğundan bir üst dizin.
vi.mock('../upsert-catalog-batch', () => ({
  upsertCatalogBatch: () => upsertCatalogBatch(),
}));

vi.mock('@pazarsync/sync-core', () => ({
  syncLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ─── Yardımcılar ─────────────────────────────────────────────────────────
const STORE: Store = { id: 'store-1', environment: 'SANDBOX' } as unknown as Store;

/** Yerelde bulunan barkod listesini döndüren bir localProbe yanıtı kuyruğa alır. */
function queueProbe(...barcodes: string[]): void {
  findMany.mockResolvedValueOnce(barcodes.map((barcode) => ({ barcode })));
}

function variant(barcode: string): MappedProductVariant {
  return {
    platformVariantId: 1n,
    barcode,
    stockCode: '',
    salePrice: '0.00',
    listPrice: '0.00',
    vatRate: null,
    quantity: 0,
    deliveryDuration: null,
    productUrl: null,
    size: null,
    attributes: [],
    syncedDimensionalWeight: '0',
    syncedCommissionRate: null,
    status: ProductVariantStatus.NOT_ON_SALE,
    statusReason: null,
  };
}

/**
 * Vendor yanıtı — verilen barkodların her biri ayrı bir content'in tek
 * varyantı. Barkodsuz çağrı = başarılı ama boş yanıt (vendor'da hiçbiri yok).
 * upsertCatalogBatch mock olduğu için yalnız barkodlar önemli.
 */
function pageWith(...barcodes: string[]): MappedProductsPage {
  const batch: MappedProduct[] = barcodes.map((barcode, i) => ({
    platformContentId: BigInt(i + 1),
    productMainId: `PM-${barcode}`,
    title: 'Test',
    description: null,
    brandId: null,
    brandName: null,
    categoryId: null,
    categoryName: null,
    color: null,
    attributes: [],
    platformCreatedAt: null,
    platformModifiedAt: null,
    images: [],
    variants: [variant(barcode)],
  }));
  return {
    batch,
    pageMeta: {
      totalElements: batch.length,
      totalPages: batch.length > 0 ? 1 : 0,
      page: 0,
      size: 100,
      nextPageToken: null,
    },
  };
}

function barcodeRange(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `B${(i + 1).toString()}`);
}

beforeEach(() => {
  decryptStoreCredentials.mockReturnValue({ supplierId: '1' });
  upsertCatalogBatch.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('ensureBarcodesInCatalog — vendorMissing vs retriable sınıflandırması', () => {
  it('resolved: vendor ürün döndürür → upsert → ikinci sondada yerelde bulunur', async () => {
    queueProbe(); // 1. sonda: hiçbiri yerelde yok
    fetchProductsByBarcodes.mockResolvedValueOnce(pageWith('B1'));
    queueProbe('B1'); // 2. sonda: upsert sonrası yerelde

    const result = await ensureBarcodesInCatalog(STORE, ['B1']);

    expect(result).toEqual({ resolved: ['B1'], vendorMissing: [], retriable: [] });
    expect(upsertCatalogBatch).toHaveBeenCalledTimes(1);
  });

  it("vendorMissing: sorgu başarılı ama boş yanıt (vendor'da gerçekten yok)", async () => {
    queueProbe(); // 1. sonda: yok
    fetchProductsByBarcodes.mockResolvedValueOnce(pageWith());
    queueProbe(); // 2. sonda: hâlâ yok

    const result = await ensureBarcodesInCatalog(STORE, ['B1']);

    expect(result).toEqual({ resolved: [], vendorMissing: ['B1'], retriable: [] });
    expect(upsertCatalogBatch).not.toHaveBeenCalled();
  });

  it('retriable: vendor sorgusu atar (503/network) → geçici', async () => {
    queueProbe(); // 1. sonda: yok
    fetchProductsByBarcodes.mockRejectedValueOnce(new Error('503 Service Unavailable'));
    queueProbe(); // 2. sonda: hâlâ yok

    const result = await ensureBarcodesInCatalog(STORE, ['B1']);

    expect(result).toEqual({ resolved: [], vendorMissing: [], retriable: ['B1'] });
  });

  it('tek çağrı: aynı gruptaki barkodlar TEK vendor sorgusunda gider', async () => {
    queueProbe(); // 1. sonda: üçü de yok
    fetchProductsByBarcodes.mockResolvedValueOnce(pageWith('B1', 'B2', 'B3'));
    queueProbe('B1', 'B2', 'B3');

    await ensureBarcodesInCatalog(STORE, ['B1', 'B2', 'B3']);

    expect(fetchProductsByBarcodes).toHaveBeenCalledTimes(1);
    expect(fetchProductsByBarcodes.mock.calls[0]?.[0].barcodes).toEqual(['B1', 'B2', 'B3']);
  });

  it('gruplama: istek başına en fazla MAX_BARCODES_PER_QUERY barkod', async () => {
    const barcodes = barcodeRange(MAX_BARCODES + 10);
    queueProbe(); // 1. sonda: hiçbiri yok
    fetchProductsByBarcodes.mockResolvedValue(pageWith());
    queueProbe();

    await ensureBarcodesInCatalog(STORE, barcodes);

    expect(fetchProductsByBarcodes.mock.calls.map(([opts]) => opts.barcodes.length)).toEqual([
      MAX_BARCODES,
      10,
    ]);
  });

  it('grup hatası yalnız o grubu retriable yapar, diğer grubun sonucu korunur', async () => {
    const barcodes = barcodeRange(MAX_BARCODES + 1);
    const lastBarcode = barcodes[MAX_BARCODES]!;
    queueProbe(); // 1. sonda: hiçbiri yok
    // 1. grup (B1..B50): yalnız B1 vendor'da var; 2. grup (B51) atar.
    fetchProductsByBarcodes
      .mockResolvedValueOnce(pageWith('B1'))
      .mockRejectedValueOnce(new Error('429 Too Many Requests'));
    queueProbe('B1');

    const result = await ensureBarcodesInCatalog(STORE, barcodes);

    expect(result.resolved).toEqual(['B1']);
    expect(result.vendorMissing).toEqual(barcodes.slice(1, MAX_BARCODES));
    expect(result.retriable).toEqual([lastBarcode]);
  });

  it('upsert atarsa: yanıtta olan retriable kalır, yanıtta olmayan yine vendorMissing', async () => {
    queueProbe(); // 1. sonda: ikisi de yok
    fetchProductsByBarcodes.mockResolvedValueOnce(pageWith('B1'));
    upsertCatalogBatch.mockRejectedValueOnce(new Error('db write failed'));
    queueProbe(); // 2. sonda: upsert düştüğü için hâlâ yok

    const result = await ensureBarcodesInCatalog(STORE, ['B1', 'B2']);

    expect(result).toEqual({ resolved: [], vendorMissing: ['B2'], retriable: ['B1'] });
  });

  it("credentials-failed: çözüm atar → tüm bilinmeyenler retriable (vendor'a hiç çıkılmaz)", async () => {
    queueProbe(); // 1. sonda: yok (tek sonda; erken dönüş)
    decryptStoreCredentials.mockImplementationOnce(() => {
      throw new Error('decryption failed');
    });

    const result = await ensureBarcodesInCatalog(STORE, ['B1', 'B2']);

    expect(result).toEqual({ resolved: [], vendorMissing: [], retriable: ['B1', 'B2'] });
    expect(fetchProductsByBarcodes).not.toHaveBeenCalled();
  });

  it('cap-hit: cap üstündeki barkodlar hiç sorgulanmaz → retriable (cezasız)', async () => {
    const barcodes = barcodeRange(MAX_BARCODES + 1);
    queueProbe(); // 1. sonda: hiçbiri yok
    // maxVendorCalls=1 → yalnız ilk grup (B1..B50) sorgulanır, hepsi vendor'da yok;
    // B51 hiç denenmez.
    fetchProductsByBarcodes.mockResolvedValueOnce(pageWith());
    queueProbe(); // 2. sonda: hâlâ hiçbiri yok

    const result = await ensureBarcodesInCatalog(STORE, barcodes, { maxVendorCalls: 1 });

    expect(fetchProductsByBarcodes).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      resolved: [],
      vendorMissing: barcodes.slice(0, MAX_BARCODES),
      retriable: [barcodes[MAX_BARCODES]],
    });
  });

  it('mixed: aynı grupta bir resolved + bir vendorMissing', async () => {
    queueProbe(); // 1. sonda: ikisi de yok
    // B1 yanıtta var (resolved), B2 yanıtta yok (vendorMissing).
    fetchProductsByBarcodes.mockResolvedValueOnce(pageWith('B1'));
    queueProbe('B1'); // 2. sonda: yalnız B1 upsert edildi

    const result = await ensureBarcodesInCatalog(STORE, ['B1', 'B2']);

    expect(result).toEqual({ resolved: ['B1'], vendorMissing: ['B2'], retriable: [] });
    expect(upsertCatalogBatch).toHaveBeenCalledTimes(1);
  });

  it('empty input: boş liste → tüm setler boş, sonda hiç koşmaz', async () => {
    const result = await ensureBarcodesInCatalog(STORE, []);

    expect(result).toEqual({ resolved: [], vendorMissing: [], retriable: [] });
    expect(findMany).not.toHaveBeenCalled();
  });

  it("all-known-locally: ilk sondada hepsi yerelde → vendor'a hiç çıkılmaz", async () => {
    queueProbe('B1', 'B2'); // 1. sonda: ikisi de yerelde

    const result = await ensureBarcodesInCatalog(STORE, ['B1', 'B2']);

    expect(result).toEqual({ resolved: ['B1', 'B2'], vendorMissing: [], retriable: [] });
    expect(fetchProductsByBarcodes).not.toHaveBeenCalled();
  });
});
