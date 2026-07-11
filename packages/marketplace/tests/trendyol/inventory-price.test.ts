// fetchInventoryAndPrice — the approved inventory-and-price (stock+price)
// pager for the PRODUCTS_DELTA sync. Wire fixtures mirror the endpoint's
// documented shape (urun-filtreleme-onayli-urun-v2-stok-ve-fiyat.md).
// Fetch-mock pattern follows the sibling products.test.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchInventoryAndPrice } from '../../src/trendyol/inventory-price';
import type {
  TrendyolCredentials,
  TrendyolInventoryAndPriceResponse,
  TrendyolInventoryVariant,
} from '../../src/trendyol/types';

const BASE_URL = 'https://stage.trendyol.test';
const SUPPLIER_ID = '2738';
const CREDENTIALS: TrendyolCredentials = {
  supplierId: SUPPLIER_ID,
  apiKey: 'key-abc',
  apiSecret: 'secret-xyz',
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function page(
  overrides: Partial<TrendyolInventoryAndPriceResponse>,
): TrendyolInventoryAndPriceResponse {
  return {
    totalElements: 1,
    totalPages: 1,
    page: 0,
    size: 100,
    nextPageToken: null,
    content: [],
    ...overrides,
  };
}

function variant(overrides: Partial<TrendyolInventoryVariant>): TrendyolInventoryVariant {
  return {
    variantId: 3953959353,
    barcode: '60506560',
    salePrice: 699.99,
    listPrice: 799.5,
    quantity: 50,
    stockCode: '056565964',
    stockLastModifiedDate: 1780463592464,
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

describe('fetchInventoryAndPrice', () => {
  it('requests the inventory-and-price endpoint and maps a page to a flat variant batch', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(
        page({
          totalElements: 1,
          totalPages: 1,
          content: [
            {
              contentId: 12431242141,
              productMainId: '1242141241',
              variants: [
                variant({
                  variantId: 111,
                  barcode: 'BC-1',
                  salePrice: 699.99,
                  listPrice: 799.5,
                  quantity: 50,
                }),
                variant({
                  variantId: 222,
                  barcode: 'BC-2',
                  salePrice: 10,
                  listPrice: 12,
                  quantity: 3,
                }),
              ],
            },
          ],
        }),
      ),
    );

    const generator = fetchInventoryAndPrice({ baseUrl: BASE_URL, credentials: CREDENTIALS });
    const { value } = await generator.next();
    if (value === undefined) throw new Error('expected a page');

    const capturedUrl = String(fetchSpy.mock.calls[0]?.[0]);
    expect(capturedUrl).toContain('/products/approved/inventory-and-price');
    expect(capturedUrl).toContain(`/sellers/${SUPPLIER_ID}/`);
    expect(capturedUrl).toContain('size=100');
    expect(capturedUrl).toContain('page=0');

    expect(value.contentCount).toBe(1);
    expect(value.batch).toHaveLength(2);
    expect(value.batch[0]).toEqual({
      platformVariantId: 111n,
      barcode: 'BC-1',
      quantity: 50,
      salePrice: '699.99',
      listPrice: '799.50',
    });
    expect(value.batch[1]).toEqual({
      platformVariantId: 222n,
      barcode: 'BC-2',
      quantity: 3,
      salePrice: '10.00',
      listPrice: '12.00',
    });
    expect(value.pageMeta.totalElements).toBe(1);
    expect(value.pageMeta.totalPages).toBe(1);
    expect(value.pageMeta.nextPageToken).toBeNull();
  });

  it('tolerates malformed rows: missing quantity/prices collapse to 0 / 0.00', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(
        page({
          content: [
            {
              contentId: 9,
              productMainId: 'pm-9',
              variants: [
                // Freshly-listed variant mid-pricing-pipeline: no price / quantity.
                { variantId: 333, barcode: 'BC-3' },
              ],
            },
          ],
        }),
      ),
    );

    const generator = fetchInventoryAndPrice({ baseUrl: BASE_URL, credentials: CREDENTIALS });
    const { value } = await generator.next();
    if (value === undefined) throw new Error('expected a page');

    expect(value.batch[0]).toEqual({
      platformVariantId: 333n,
      barcode: 'BC-3',
      quantity: 0,
      salePrice: '0.00',
      listPrice: '0.00',
    });
  });

  it('transitions from page to nextPageToken when the next page crosses the 10k cap', async () => {
    // Resuming at page 99 (items 9900-9999). The next page would be 100
    // (100 * 100 = 10,000 >= cap), so the generator must carry the vendor's
    // nextPageToken into the following request instead of page=100.
    const CAP_TOKEN = 'test-cap-continuation-token-1';
    fetchSpy
      .mockResolvedValueOnce(
        jsonResponse(
          page({
            totalElements: 20000,
            totalPages: 200,
            page: 99,
            nextPageToken: CAP_TOKEN,
            content: [
              { contentId: 1, productMainId: 'pm-1', variants: [variant({ variantId: 990010 })] },
            ],
          }),
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          page({
            totalElements: 20000,
            totalPages: 200,
            page: 100,
            nextPageToken: null,
            content: [
              { contentId: 2, productMainId: 'pm-2', variants: [variant({ variantId: 1000010 })] },
            ],
          }),
        ),
      );

    const generator = fetchInventoryAndPrice({
      baseUrl: BASE_URL,
      credentials: CREDENTIALS,
      initialCursor: { kind: 'page', n: 99 },
    });
    await generator.next();
    await generator.next();

    const firstUrl = String(fetchSpy.mock.calls[0]?.[0]);
    const secondUrl = String(fetchSpy.mock.calls[1]?.[0]);
    expect(firstUrl).toContain('page=99');
    expect(firstUrl).not.toContain('nextPageToken');
    expect(secondUrl).toContain(`nextPageToken=${CAP_TOKEN}`);
    expect(secondUrl).not.toContain('page=');
  });

  it('stops on an empty content page', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(page({ totalElements: 0, content: [] })));

    const generator = fetchInventoryAndPrice({ baseUrl: BASE_URL, credentials: CREDENTIALS });
    const { value, done } = await generator.next();

    expect(done).toBe(true);
    expect(value).toBeUndefined();
  });
});
