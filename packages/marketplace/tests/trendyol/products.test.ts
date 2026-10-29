// Approved-products fetchers:
//   - fetchProductsByBarcodes: targeted multi-barcode query (variant recovery);
//   - fetchApprovedProductsPageByDate: one page of a date-window query (the
//     hourly PRODUCTS_CHANGES sync);
//   - fetchApprovedProducts: only its null-content contract here (the full
//     scan's paging is covered in apps/api products.test.ts).
// The wire fixture mirrors the apps/api products.test.ts shapes (same
// endpoint, same mapper).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProductVariantStatus } from '@pazarsync/db/enums';
import { MarketplaceAuthError, MarketplaceUnreachable } from '@pazarsync/sync-core';

import {
  APPROVED_PAGE_CAP_ITEMS,
  fetchApprovedProducts,
  fetchApprovedProductsPageByDate,
  fetchProductsByBarcodes,
  MAX_BARCODES_PER_QUERY,
  PRODUCTS_PAGE_SIZE,
  type FetchApprovedProductsPageByDateOpts,
} from '../../src/trendyol/products';
import {
  TRENDYOL_DATE_QUERY_TYPES,
  type TrendyolApprovedProductsResponse,
  type TrendyolContent,
  type TrendyolCredentials,
  type TrendyolVariant,
} from '../../src/trendyol/types';

const BASE_URL = 'https://stage.trendyol.test';
const SUPPLIER_ID = '2738';
const CREDENTIALS: TrendyolCredentials = {
  supplierId: SUPPLIER_ID,
  apiKey: 'key-abc',
  apiSecret: 'secret-xyz',
};

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

function makeVariant(
  variantId: number,
  barcode: string,
  overrides: Partial<TrendyolVariant> = {},
): TrendyolVariant {
  return {
    variantId,
    supplierId: 2738,
    barcode,
    attributes: [{ attributeId: 293, attributeName: 'Beden', attributeValue: 'M' }],
    onSale: true,
    deliveryOptions: { deliveryDuration: 1 },
    stock: { quantity: 5, lastModifiedDate: 0 },
    price: { salePrice: 100, listPrice: 100 },
    stockCode: `sk-${variantId.toString()}`,
    vatRate: 20,
    locked: false,
    archived: false,
    blacklisted: false,
    ...overrides,
  };
}

function makeContent(
  contentId: number,
  barcode: string,
  variants: TrendyolVariant[] = [makeVariant(contentId * 10, barcode)],
): TrendyolContent {
  return {
    contentId,
    productMainId: `pmid-${contentId.toString()}`,
    brand: { id: 1, name: 'Brand' },
    category: { id: 1, name: 'Category' },
    creationDate: 1777246115403,
    lastModifiedDate: 1777246115403,
    title: 'sample',
    description: 'desc',
    images: [{ url: 'https://cdn.example.com/x.jpg' }],
    attributes: [{ attributeId: 47, attributeName: 'Renk', attributeValue: 'Mavi' }],
    variants,
  };
}

function makePage(
  content: TrendyolContent[],
  overrides: Partial<TrendyolApprovedProductsResponse> = {},
): TrendyolApprovedProductsResponse {
  return {
    totalElements: content.length,
    totalPages: 1,
    page: 0,
    size: 100,
    nextPageToken: null,
    content,
    ...overrides,
  };
}

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchProductsByBarcodes', () => {
  it('sends every barcode in one comma-joined `barcodes` param and maps the page', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(makePage([makeContent(1, 'BC-123'), makeContent(2, 'BC-456')])),
    );

    const page = await fetchProductsByBarcodes({
      baseUrl: BASE_URL,
      credentials: CREDENTIALS,
      barcodes: ['BC-123', 'BC-456'],
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const capturedUrl = new URL(String(fetchSpy.mock.calls[0]?.[0]));
    expect(capturedUrl.pathname).toBe(
      `/integration/product/sellers/${SUPPLIER_ID}/products/approved`,
    );
    expect(capturedUrl.searchParams.get('barcodes')).toBe('BC-123,BC-456');
    expect(capturedUrl.searchParams.has('barcode')).toBe(false);
    expect(page.batch.flatMap((p) => p.variants.map((v) => v.barcode))).toEqual([
      'BC-123',
      'BC-456',
    ]);
  });

  it('returns only the barcodes the vendor knows — absent ones are simply missing', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(makePage([makeContent(1, 'BC-123')])));

    const page = await fetchProductsByBarcodes({
      baseUrl: BASE_URL,
      credentials: CREDENTIALS,
      barcodes: ['BC-123', 'GONE-404'],
    });

    expect(page.batch).toHaveLength(1);
    expect(page.batch[0]!.variants[0]!.barcode).toBe('BC-123');
  });

  it('treats a 404 (no approved product for any barcode) as an empty page, not an error', async () => {
    // Trendyol's stage /products/approved returns a bodyless 404 when no
    // approved product matches the barcode filter. For a barcode lookup that
    // is "no such product" — a clean empty page, not a thrown error.
    fetchSpy.mockResolvedValueOnce(new Response('Not Found', { status: 404 }));

    const page = await fetchProductsByBarcodes({
      baseUrl: BASE_URL,
      credentials: CREDENTIALS,
      barcodes: ['NEVER-APPROVED'],
    });

    expect(page.batch).toHaveLength(0);
    expect(page.pageMeta.totalElements).toBe(0);
  });

  it.each([
    ['null', { totalElements: 1, totalPages: 1, page: 0, size: 100, content: null }],
    ['missing', { totalElements: 1, totalPages: 1, page: 0, size: 100 }],
  ])(
    'throws on a 200 with a %s content list instead of reporting no match',
    async (_label, body) => {
      fetchSpy.mockResolvedValueOnce(jsonResponse(body));

      await expect(
        fetchProductsByBarcodes({
          baseUrl: BASE_URL,
          credentials: CREDENTIALS,
          barcodes: ['BC-1'],
        }),
      ).rejects.toThrow('without a content list');
    },
  );

  it.each([
    ['empty', 0],
    ['over the vendor cap', MAX_BARCODES_PER_QUERY + 1],
  ])('rejects an %s barcode list before calling the vendor', async (_label, count) => {
    const barcodes = Array.from({ length: count }, (_, i) => `BC-${i.toString()}`);

    await expect(
      fetchProductsByBarcodes({ baseUrl: BASE_URL, credentials: CREDENTIALS, barcodes }),
    ).rejects.toThrow(RangeError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// Fixed epoch millis are safe here: the fetcher does no clock math, it only
// forwards the window it is given.
const WINDOW_START = 1_793_000_000_000;
const WINDOW_END = WINDOW_START + 60 * 60 * 1000;
// Trendyol's request rule is page x size <= 10,000, so with size 100 the
// highest page the fetcher accepts is 100.
const HIGHEST_ACCEPTED_PAGE = APPROVED_PAGE_CAP_ITEMS / PRODUCTS_PAGE_SIZE;

function dateOpts(
  overrides: Partial<FetchApprovedProductsPageByDateOpts> = {},
): FetchApprovedProductsPageByDateOpts {
  return {
    baseUrl: BASE_URL,
    credentials: CREDENTIALS,
    dateQueryType: 'VARIANT_MODIFIED_DATE',
    startDate: WINDOW_START,
    endDate: WINDOW_END,
    page: 0,
    ...overrides,
  };
}

function firstCapturedUrl(): URL {
  return new URL(String(fetchSpy.mock.calls[0]?.[0]));
}

describe('fetchApprovedProductsPageByDate', () => {
  it('sends exactly dateQueryType, startDate, endDate, page and size=100 to the approved endpoint', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(makePage([makeContent(1, 'BC-1')])));

    await fetchApprovedProductsPageByDate(dateOpts({ page: 3 }));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const url = firstCapturedUrl();
    expect(url.pathname).toBe(`/integration/product/sellers/${SUPPLIER_ID}/products/approved`);
    expect([...url.searchParams.keys()].sort()).toEqual([
      'dateQueryType',
      'endDate',
      'page',
      'size',
      'startDate',
    ]);
    expect(url.searchParams.get('dateQueryType')).toBe('VARIANT_MODIFIED_DATE');
    expect(url.searchParams.get('startDate')).toBe(WINDOW_START.toString());
    expect(url.searchParams.get('endDate')).toBe(WINDOW_END.toString());
    expect(url.searchParams.get('page')).toBe('3');
    expect(url.searchParams.get('size')).toBe(PRODUCTS_PAGE_SIZE.toString());
    // A status filter would prune each product's variant list; the token
    // path is never used on date queries.
    for (const banned of ['status', 'orderByDirection', 'nextPageToken', 'barcode', 'barcodes']) {
      expect(url.searchParams.has(banned)).toBe(false);
    }
  });

  it.each(TRENDYOL_DATE_QUERY_TYPES)('forwards dateQueryType %s unchanged', async (type) => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(makePage([])));

    await fetchApprovedProductsPageByDate(dateOpts({ dateQueryType: type }));

    expect(firstCapturedUrl().searchParams.get('dateQueryType')).toBe(type);
  });

  it('maps the page with the full-scan mapper and keeps every variant of a returned product', async () => {
    const content = makeContent(7, 'BC-ON', [
      makeVariant(71, 'BC-ON'),
      makeVariant(72, 'BC-LOCKED', { locked: true, lockReason: 'UNSUPPLIED_PRODUCT' }),
      makeVariant(73, 'BC-ARCHIVED', { onSale: false, archived: true }),
    ]);
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(
        makePage([content], {
          totalElements: 149,
          totalPages: 2,
          page: 0,
          nextPageToken: 'stage-token',
        }),
      ),
    );

    const page = await fetchApprovedProductsPageByDate(dateOpts());

    expect(page.batch).toHaveLength(1);
    expect(page.batch[0]!.variants.map((v) => [v.barcode, v.status, v.statusReason])).toEqual([
      ['BC-ON', ProductVariantStatus.ON_SALE, null],
      ['BC-LOCKED', ProductVariantStatus.LOCKED, 'UNSUPPLIED_PRODUCT'],
      ['BC-ARCHIVED', ProductVariantStatus.ARCHIVED, null],
    ]);
    expect(page.pageMeta).toEqual({
      totalElements: 149,
      totalPages: 2,
      page: 0,
      size: PRODUCTS_PAGE_SIZE,
      nextPageToken: 'stage-token',
    });
  });

  it('maps an empty window (200, content [], totalElements 0, no token key) to an empty batch', async () => {
    // The exact stage shape for an empty window (2026-10-28).
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ totalElements: 0, totalPages: 0, page: 0, size: 100, content: [] }),
    );

    const page = await fetchApprovedProductsPageByDate(dateOpts());

    expect(page.batch).toEqual([]);
    expect(page.pageMeta).toEqual({
      totalElements: 0,
      totalPages: 0,
      page: 0,
      size: PRODUCTS_PAGE_SIZE,
      nextPageToken: null,
    });
  });

  it.each([
    ['null', { totalElements: 0, totalPages: 0, page: 0, size: 100, content: null }],
    ['missing', { totalElements: 0, totalPages: 0, page: 0, size: 100 }],
  ])('maps a %s content list to an empty batch without throwing', async (_label, body) => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(body));

    const page = await fetchApprovedProductsPageByDate(dateOpts());

    expect(page.batch).toEqual([]);
    expect(page.pageMeta.totalElements).toBe(0);
  });

  it('maps one page past the last (200, content []) to an empty batch with the real totals', async () => {
    // The exact stage shape for page = totalPages (2026-10-28).
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ totalElements: 1025, totalPages: 11, page: 11, size: 100, content: [] }),
    );

    const page = await fetchApprovedProductsPageByDate(dateOpts({ page: 11 }));

    expect(page.batch).toEqual([]);
    expect(page.pageMeta).toMatchObject({ totalElements: 1025, totalPages: 11, page: 11 });
  });

  it('returns a window over the 10,000-item cap instead of throwing: the handler decides', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(
        makePage([makeContent(1, 'BC-1')], {
          totalElements: APPROVED_PAGE_CAP_ITEMS + 1,
          totalPages: HIGHEST_ACCEPTED_PAGE + 1,
        }),
      ),
    );

    const page = await fetchApprovedProductsPageByDate(dateOpts());

    expect(page.batch).toHaveLength(1);
    expect(page.pageMeta.totalElements).toBe(APPROVED_PAGE_CAP_ITEMS + 1);
  });

  it('treats a 404 as an empty page that echoes the requested page, flagged notFound', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('Not Found', { status: 404 }));

    const page = await fetchApprovedProductsPageByDate(dateOpts({ page: 4 }));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(page).toEqual({
      batch: [],
      pageMeta: {
        totalElements: 0,
        totalPages: 0,
        page: 4,
        size: PRODUCTS_PAGE_SIZE,
        nextPageToken: null,
      },
      notFound: true,
    });
  });

  it.each([
    ['an empty window', { totalElements: 0, totalPages: 0, page: 0, size: 100, content: [] }],
    ['a null content list', { totalElements: 0, totalPages: 0, page: 0, size: 100, content: null }],
  ])('does not flag %s (a 200) as notFound', async (_label, body) => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(body));

    const page = await fetchApprovedProductsPageByDate(dateOpts());

    expect(page.notFound).toBe(false);
  });

  it('keeps other 4xx responses as MarketplaceUnreachable: only a 404 means empty', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('Bad Request', { status: 400 }));

    await expect(fetchApprovedProductsPageByDate(dateOpts())).rejects.toBeInstanceOf(
      MarketplaceUnreachable,
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('surfaces a 401 as MarketplaceAuthError without retrying', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));

    await expect(fetchApprovedProductsPageByDate(dateOpts())).rejects.toBeInstanceOf(
      MarketplaceAuthError,
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('accepts the highest page the page x size <= 10,000 rule allows', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(makePage([])));

    await fetchApprovedProductsPageByDate(dateOpts({ page: HIGHEST_ACCEPTED_PAGE }));

    expect(firstCapturedUrl().searchParams.get('page')).toBe(HIGHEST_ACCEPTED_PAGE.toString());
  });

  it.each<[string, Partial<FetchApprovedProductsPageByDateOpts>]>([
    ['a negative page', { page: -1 }],
    ['a fractional page', { page: 1.5 }],
    ['a page past the 10,000-item cap', { page: HIGHEST_ACCEPTED_PAGE + 1 }],
    ['startDate after endDate', { startDate: WINDOW_END + 1, endDate: WINDOW_END }],
    ['a NaN startDate', { startDate: Number.NaN }],
    ['a negative startDate', { startDate: -1 }],
    ['a fractional endDate', { endDate: WINDOW_END + 0.5 }],
  ])('rejects %s before calling the vendor', async (_label, overrides) => {
    await expect(fetchApprovedProductsPageByDate(dateOpts(overrides))).rejects.toThrow(RangeError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    ['an unknown', 'ORDER_DATE'],
    ['a missing', undefined],
  ])(
    'rejects %s dateQueryType before calling the vendor (dates would be ignored)',
    async (_label, value) => {
      const opts = dateOpts();
      // Simulates an untyped caller; the static type already forbids this.
      Reflect.set(opts, 'dateQueryType', value);

      await expect(fetchApprovedProductsPageByDate(opts)).rejects.toThrow(RangeError);
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );
});

describe('fetchApprovedProducts (full scan): a missing content list', () => {
  // The chunk handler treats the generator's end as "catalog complete" and
  // then delists every variant it did not reach. A 200 without a content
  // list must therefore throw (retryable) and never end the walk early.
  it.each([
    ['null', { totalElements: 3, totalPages: 3, page: 1, size: 100, content: null }],
    ['missing', { totalElements: 3, totalPages: 3, page: 1, size: 100 }],
  ])('throws on a mid-walk page with a %s content list', async (_label, body) => {
    fetchSpy
      .mockResolvedValueOnce(
        jsonResponse(
          makePage([makeContent(1, 'BC-1')], { totalElements: 3, totalPages: 3, page: 0 }),
        ),
      )
      .mockResolvedValueOnce(jsonResponse(body));

    const walk = fetchApprovedProducts({ baseUrl: BASE_URL, credentials: CREDENTIALS });

    const first = await walk.next();
    expect(first.done).toBe(false);
    await expect(walk.next()).rejects.toThrow('page 1 without a content list');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('throws on a first page with content: null instead of yielding nothing', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ totalElements: 0, totalPages: 0, page: 0, size: 100, content: null }),
    );

    const walk = fetchApprovedProducts({ baseUrl: BASE_URL, credentials: CREDENTIALS });

    await expect(walk.next()).rejects.toThrow('page 0 without a content list');
  });

  it('still ends the walk on a trusted empty page (content: [])', async () => {
    fetchSpy
      .mockResolvedValueOnce(
        jsonResponse(
          makePage([makeContent(1, 'BC-1')], { totalElements: 3, totalPages: 3, page: 0 }),
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({ totalElements: 3, totalPages: 3, page: 1, size: 100, content: [] }),
      );

    const pages: unknown[] = [];
    for await (const page of fetchApprovedProducts({
      baseUrl: BASE_URL,
      credentials: CREDENTIALS,
    })) {
      pages.push(page);
    }

    expect(pages).toHaveLength(1);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
