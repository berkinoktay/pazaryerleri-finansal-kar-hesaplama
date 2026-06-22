// Trendyol price update adapter — unit tests (HTTP layer mocked).
//
// Covers (DOMESTIC marketplace price-and-inventory API):
//   updatePrices  — request builder (path, items body shape, auth headers) + batchRequestId mapping
//   checkPriceBatchStatus — getBatchRequestResult URL + response parsing (processing flag + per-item outcome)
//   Validation guards — empty list, over-limit, listPrice < salePrice

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  checkPriceBatchStatus,
  MAX_PRICES_PER_REQUEST,
  updatePrices,
} from '../../src/trendyol/prices';
import type { TrendyolCredentials } from '../../src/trendyol/types';

// ─── Test fixtures ────────────────────────────────────────────────────────────

const BASE_URL = 'https://stageapigw.trendyol.test';
const SUPPLIER_ID = '9876';
const CREDENTIALS: TrendyolCredentials = {
  supplierId: SUPPLIER_ID,
  apiKey: 'api-key-test',
  apiSecret: 'api-secret-test',
};
const ENV = 'SANDBOX' as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch');
  // Ensure base URL env var resolves to our test URL
  vi.stubEnv('TRENDYOL_SANDBOX_BASE_URL', BASE_URL);
  vi.stubEnv('TRENDYOL_INTEGRATOR_UA_SUFFIX', 'TestSuite');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

// ─── updatePrices ─────────────────────────────────────────────────────────────

describe('updatePrices', () => {
  it('POSTs to .../inventory/sellers/{sellerId}/products/price-and-inventory with an items body', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ batchRequestId: 'batch-001' }));

    const result = await updatePrices({
      credentials: CREDENTIALS,
      environment: ENV,
      items: [
        { barcode: 'BC-001', salePrice: '99.90', listPrice: '129.90' },
        { barcode: 'BC-002', salePrice: '49.50' },
      ],
    });

    // Trendyol's batchRequestId is surfaced as the generic batchId.
    expect(result).toEqual({ batchId: 'batch-001' });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [urlArg, initArg] = fetchSpy.mock.calls[0] as [string, RequestInit];

    // URL must hit the inventory price-and-inventory endpoint with sellerId in path
    expect(urlArg).toContain(
      `/integration/inventory/sellers/${SUPPLIER_ID}/products/price-and-inventory`,
    );
    expect(urlArg).toContain(BASE_URL);

    // Method must be POST
    expect(initArg.method).toBe('POST');

    // Body must be an `items` array with salePrice/listPrice (NOT priceInfos/buyingPrice/rrp)
    const body = JSON.parse(initArg.body as string) as {
      items: Array<{ barcode: string; salePrice: number; listPrice?: number; quantity?: number }>;
    };
    expect(body.items).toHaveLength(2);
    expect(body.items[0]).toMatchObject({
      barcode: 'BC-001',
      salePrice: 99.9,
      listPrice: 129.9,
    });
    expect(body.items[1]).toMatchObject({
      barcode: 'BC-002',
      salePrice: 49.5,
    });
    // No listPrice when not provided
    expect(body.items[1]).not.toHaveProperty('listPrice');
    // Stock is never touched — quantity is never sent
    expect(body.items[0]).not.toHaveProperty('quantity');
    expect(body.items[1]).not.toHaveProperty('quantity');
  });

  it('includes Authorization and User-Agent headers', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ batchRequestId: 'batch-002' }));

    await updatePrices({
      credentials: CREDENTIALS,
      environment: ENV,
      items: [{ barcode: 'BC-X', salePrice: '10.00' }],
    });

    const [, initArg] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const headers = initArg.headers as Record<string, string>;

    // Authorization must be Basic base64(apiKey:apiSecret)
    const expectedToken = Buffer.from(`${CREDENTIALS.apiKey}:${CREDENTIALS.apiSecret}`).toString(
      'base64',
    );
    expect(headers['Authorization']).toBe(`Basic ${expectedToken}`);

    // User-Agent must contain supplierId
    expect(headers['User-Agent']).toContain(SUPPLIER_ID);
  });

  it('throws ValidationError when items list is empty', async () => {
    await expect(
      updatePrices({ credentials: CREDENTIALS, environment: ENV, items: [] }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('throws ValidationError when items exceed MAX_PRICES_PER_REQUEST', async () => {
    const tooMany = Array.from({ length: MAX_PRICES_PER_REQUEST + 1 }, (_, i) => ({
      barcode: `BC-${i.toString()}`,
      salePrice: '10.00',
    }));

    await expect(
      updatePrices({ credentials: CREDENTIALS, environment: ENV, items: tooMany }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('throws ValidationError when listPrice is below salePrice', async () => {
    await expect(
      updatePrices({
        credentials: CREDENTIALS,
        environment: ENV,
        items: [{ barcode: 'BC-Y', salePrice: '100.00', listPrice: '90.00' }],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('throws when batchRequestId is missing from the response', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ unexpected: true }));

    await expect(
      updatePrices({
        credentials: CREDENTIALS,
        environment: ENV,
        items: [{ barcode: 'BC-NB', salePrice: '10.00' }],
      }),
    ).rejects.toMatchObject({ name: 'MarketplaceUnreachable' });
  });

  it('throws MarketplaceAuthError on 401', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));

    await expect(
      updatePrices({
        credentials: CREDENTIALS,
        environment: ENV,
        items: [{ barcode: 'BC-Z', salePrice: '10.00' }],
      }),
    ).rejects.toMatchObject({ name: 'MarketplaceAuthError' });
  });
});

// ─── checkPriceBatchStatus ────────────────────────────────────────────────────

describe('checkPriceBatchStatus', () => {
  const BATCH_ID = '57a7229a-e345-4232-88ac-f4169b864293';

  it('GETs .../products/batch-requests/{batchRequestId} and maps a COMPLETED response', async () => {
    const wire = {
      batchRequestId: BATCH_ID,
      batchRequestType: 'PriceUpdate',
      status: 'COMPLETED',
      items: [
        {
          requestItem: { barcode: 'BC-001', salePrice: 99.9, listPrice: 129.9 },
          status: 'SUCCESS',
          failureReasons: [],
        },
        {
          requestItem: { barcode: 'BC-002', salePrice: 49.5 },
          status: 'FAILED',
          failureReasons: ['Price already updated'],
        },
      ],
      creationDate: 1529734317090,
      lastModification: 1529734653403,
      itemCount: 2,
      failedItemCount: 1,
    };
    fetchSpy.mockResolvedValueOnce(jsonResponse(wire));

    const result = await checkPriceBatchStatus({
      credentials: CREDENTIALS,
      environment: ENV,
      batchId: BATCH_ID,
    });

    expect(result.processing).toBe(false);
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toEqual({ barcode: 'BC-001', status: 'SUCCESS' });
    expect(result.items[1]).toEqual({
      barcode: 'BC-002',
      status: 'FAILED',
      failureReasons: ['Price already updated'],
    });

    // URL must hit the product batch-requests endpoint with sellerId + batchRequestId in path
    const [urlArg, initArg] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(initArg.method).toBe('GET');
    expect(urlArg).toContain(
      `/integration/product/sellers/${SUPPLIER_ID}/products/batch-requests/${encodeURIComponent(BATCH_ID)}`,
    );
  });

  it('returns processing: true when batch status is IN_PROGRESS', async () => {
    const wire = {
      batchRequestId: BATCH_ID,
      status: 'IN_PROGRESS',
      items: [],
      itemCount: 0,
    };
    fetchSpy.mockResolvedValueOnce(jsonResponse(wire));

    const result = await checkPriceBatchStatus({
      credentials: CREDENTIALS,
      environment: ENV,
      batchId: BATCH_ID,
    });

    expect(result.processing).toBe(true);
    expect(result.items).toHaveLength(0);
  });

  it('treats a missing batch-level status with no items yet as still processing', async () => {
    // Trendyol omits the batch-level `status` for stock/price batches.
    fetchSpy.mockResolvedValueOnce(jsonResponse({ batchRequestId: BATCH_ID, items: [] }));

    const result = await checkPriceBatchStatus({
      credentials: CREDENTIALS,
      environment: ENV,
      batchId: BATCH_ID,
    });

    expect(result.processing).toBe(true);
  });

  it('treats a missing batch-level status WITH per-item results as done', async () => {
    const wire = {
      batchRequestId: BATCH_ID,
      items: [
        {
          requestItem: { barcode: 'BC-OK', salePrice: 50 },
          status: 'SUCCESS',
          failureReasons: [],
        },
      ],
    };
    fetchSpy.mockResolvedValueOnce(jsonResponse(wire));

    const result = await checkPriceBatchStatus({
      credentials: CREDENTIALS,
      environment: ENV,
      batchId: BATCH_ID,
    });

    expect(result.processing).toBe(false);
    expect(result.items[0]).toEqual({ barcode: 'BC-OK', status: 'SUCCESS' });
  });

  it('items without failureReasons do not include the field', async () => {
    const wire = {
      batchRequestId: BATCH_ID,
      status: 'COMPLETED',
      items: [
        {
          requestItem: { barcode: 'BC-OK', salePrice: 50.0 },
          status: 'SUCCESS',
          failureReasons: [],
        },
      ],
      itemCount: 1,
    };
    fetchSpy.mockResolvedValueOnce(jsonResponse(wire));

    const result = await checkPriceBatchStatus({
      credentials: CREDENTIALS,
      environment: ENV,
      batchId: BATCH_ID,
    });

    expect(result.items[0]).not.toHaveProperty('failureReasons');
  });

  it('throws MarketplaceUnreachable on network error', async () => {
    fetchSpy.mockRejectedValueOnce(new TypeError('fetch failed'));

    await expect(
      checkPriceBatchStatus({
        credentials: CREDENTIALS,
        environment: ENV,
        batchId: BATCH_ID,
      }),
    ).rejects.toMatchObject({ name: 'MarketplaceUnreachable' });
  });
});
