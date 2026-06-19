// ensureBarcodesInCatalog sınıflandırma birim testleri (Task 3).
//
// Vendor (fetchProductsByBarcode), credential çözümü (decryptStoreCredentials),
// katalog yazımı (upsertCatalogBatch) ve yerel sonda (prisma.productVariant
// .findMany) modül sınırında mock'lanır. Her senaryo yalnız sınıflandırmayı
// (resolved / vendorMissing / retriable) doğrular — gerçek DB/HTTP yok.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Store } from '@pazarsync/db';
import type { MappedProduct, MappedProductsPage } from '@pazarsync/marketplace';

import { ensureBarcodesInCatalog } from '../ensure-barcodes';

// ─── Mock'lar (modül sınırı) ─────────────────────────────────────────────
const findMany = vi.fn<() => Promise<{ barcode: string }[]>>();
vi.mock('@pazarsync/db', () => ({
  prisma: { productVariant: { findMany: () => findMany() } },
}));

const fetchProductsByBarcode = vi.fn<(opts: { barcode: string }) => Promise<MappedProductsPage>>();
const decryptStoreCredentials = vi.fn<() => { supplierId: string }>();
vi.mock('@pazarsync/marketplace', () => ({
  fetchProductsByBarcode: (opts: { barcode: string }) => fetchProductsByBarcode(opts),
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

/** Dolu bir batch (length>0) — upsertCatalogBatch mock olduğu için içerik önemsiz. */
function nonEmptyPage(): MappedProductsPage {
  const product: MappedProduct = {
    platformContentId: 1n,
    productMainId: 'PM-1',
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
    variants: [],
  };
  return {
    batch: [product],
    pageMeta: { totalElements: 1, totalPages: 1, page: 0, size: 100, nextPageToken: null },
  };
}

/** Boş batch — tekil sorgu başarılı ama vendor'da ürün yok. */
function emptyPage(): MappedProductsPage {
  return {
    batch: [],
    pageMeta: { totalElements: 0, totalPages: 0, page: 0, size: 100, nextPageToken: null },
  };
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
    fetchProductsByBarcode.mockResolvedValueOnce(nonEmptyPage());
    queueProbe('B1'); // 2. sonda: upsert sonrası yerelde

    const result = await ensureBarcodesInCatalog(STORE, ['B1']);

    expect(result).toEqual({ resolved: ['B1'], vendorMissing: [], retriable: [] });
    expect(upsertCatalogBatch).toHaveBeenCalledTimes(1);
  });

  it("vendorMissing: tekil sorgu boş batch döndürür (vendor'da gerçekten yok)", async () => {
    queueProbe(); // 1. sonda: yok
    fetchProductsByBarcode.mockResolvedValueOnce(emptyPage());
    queueProbe(); // 2. sonda: hâlâ yok

    const result = await ensureBarcodesInCatalog(STORE, ['B1']);

    expect(result).toEqual({ resolved: [], vendorMissing: ['B1'], retriable: [] });
    expect(upsertCatalogBatch).not.toHaveBeenCalled();
  });

  it('retriable: vendor sorgusu atar (503/network) → geçici', async () => {
    queueProbe(); // 1. sonda: yok
    fetchProductsByBarcode.mockRejectedValueOnce(new Error('503 Service Unavailable'));
    queueProbe(); // 2. sonda: hâlâ yok

    const result = await ensureBarcodesInCatalog(STORE, ['B1']);

    expect(result).toEqual({ resolved: [], vendorMissing: [], retriable: ['B1'] });
  });

  it("credentials-failed: çözüm atar → tüm bilinmeyenler retriable (vendor'a hiç çıkılmaz)", async () => {
    queueProbe(); // 1. sonda: yok (tek sonda; erken dönüş)
    decryptStoreCredentials.mockImplementationOnce(() => {
      throw new Error('decryption failed');
    });

    const result = await ensureBarcodesInCatalog(STORE, ['B1', 'B2']);

    expect(result).toEqual({ resolved: [], vendorMissing: [], retriable: ['B1', 'B2'] });
    expect(fetchProductsByBarcode).not.toHaveBeenCalled();
  });

  it('cap-hit: cap üstündeki barkodlar hiç sorgulanmaz → retriable (cezasız)', async () => {
    queueProbe(); // 1. sonda: ikisi de yok
    // maxVendorCalls=1 → yalnız B1 sorgulanır, B1 vendor'da yok; B2 hiç denenmez.
    fetchProductsByBarcode.mockResolvedValueOnce(emptyPage());
    queueProbe(); // 2. sonda: ikisi de hâlâ yok

    const result = await ensureBarcodesInCatalog(STORE, ['B1', 'B2'], { maxVendorCalls: 1 });

    expect(fetchProductsByBarcode).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ resolved: [], vendorMissing: ['B1'], retriable: ['B2'] });
  });

  it('mixed: bir resolved + bir vendorMissing + bir retriable', async () => {
    queueProbe(); // 1. sonda: üçü de yok
    // B1 ürün döndürür (resolved), B2 boş (vendorMissing), B3 atar (retriable).
    fetchProductsByBarcode.mockImplementation(async (opts: { barcode: string }) => {
      if (opts.barcode === 'B1') return nonEmptyPage();
      if (opts.barcode === 'B2') return emptyPage();
      throw new Error('429 Too Many Requests');
    });
    queueProbe('B1'); // 2. sonda: yalnız B1 upsert edildi

    const result = await ensureBarcodesInCatalog(STORE, ['B1', 'B2', 'B3']);

    expect(result).toEqual({ resolved: ['B1'], vendorMissing: ['B2'], retriable: ['B3'] });
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
    expect(fetchProductsByBarcode).not.toHaveBeenCalled();
  });
});
