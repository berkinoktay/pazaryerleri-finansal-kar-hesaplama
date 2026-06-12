// fetchProductsByBarcode — targeted single-barcode approved-products query
// (variant-recovery PR-2). The wire fixture mirrors the apps/api
// products.test.ts shapes (same endpoint, same mapper).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchProductsByBarcode } from '../../src/trendyol/products';
import type {
  TrendyolApprovedProductsResponse,
  TrendyolContent,
  TrendyolCredentials,
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

function makeContent(contentId: number, barcode: string): TrendyolContent {
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
    variants: [
      {
        variantId: contentId * 10,
        supplierId: 2738,
        barcode,
        attributes: [{ attributeId: 293, attributeName: 'Beden', attributeValue: 'M' }],
        onSale: true,
        deliveryOptions: { deliveryDuration: 1, isRushDelivery: true, fastDeliveryOptions: [] },
        stock: { quantity: 5, lastModifiedDate: 0 },
        price: { salePrice: 100, listPrice: 100 },
        stockCode: `sk-${contentId.toString()}`,
        vatRate: 20,
        locked: false,
        archived: false,
        blacklisted: false,
      },
    ],
  };
}

function makePage(content: TrendyolContent[]): TrendyolApprovedProductsResponse {
  return {
    totalElements: content.length,
    totalPages: 1,
    page: 0,
    size: 100,
    nextPageToken: null,
    content,
  };
}

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchProductsByBarcode', () => {
  it('requests the approved endpoint with the barcode param and maps the page', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(makePage([makeContent(1, 'BC-123')])));

    const page = await fetchProductsByBarcode({
      baseUrl: BASE_URL,
      credentials: CREDENTIALS,
      barcode: 'BC-123',
    });

    const capturedUrl = String(fetchSpy.mock.calls[0]?.[0]);
    expect(capturedUrl).toContain('/products/approved');
    expect(capturedUrl).toContain('barcode=BC-123');
    expect(capturedUrl).toContain(`/sellers/${SUPPLIER_ID}/`);
    expect(page.batch).toHaveLength(1);
    expect(page.batch[0]!.variants[0]!.barcode).toBe('BC-123');
  });

  it('returns an empty batch when the vendor knows no such barcode', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(makePage([])));

    const page = await fetchProductsByBarcode({
      baseUrl: BASE_URL,
      credentials: CREDENTIALS,
      barcode: 'GONE-404',
    });

    expect(page.batch).toHaveLength(0);
  });
});
