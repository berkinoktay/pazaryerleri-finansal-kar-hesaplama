// Trendyol price update adapter — unit tests (HTTP layer mocked).
//
// Covers:
//   updatePrices  — request builder (path, body shape, auth headers) + batchId response mapping
//   checkPriceBatchStatus — check-status URL + response parsing (processing flag + per-item outcome)
//   Validation guards — empty list, over-limit, rrp < salePrice

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
  it('POSTs to .../ecgw/v1/{sellerId}/prices with correct path and priceInfos body', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ batchId: 'batch-001' }));

    const result = await updatePrices({
      credentials: CREDENTIALS,
      environment: ENV,
      items: [
        { barcode: 'BC-001', salePrice: '99.90', listPrice: '129.90' },
        { barcode: 'BC-002', salePrice: '49.50' },
      ],
    });

    expect(result).toEqual({ batchId: 'batch-001' });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [urlArg, initArg] = fetchSpy.mock.calls[0] as [string, RequestInit];

    // URL must include sellerId in path
    expect(urlArg).toContain(`/ecgw/v1/${SUPPLIER_ID}/prices`);
    expect(urlArg).toContain(BASE_URL);

    // Method must be POST
    expect(initArg.method).toBe('POST');

    // Body must be priceInfos array with correct field names
    const body = JSON.parse(initArg.body as string) as {
      priceInfos: Array<{ barcode: string; buyingPrice: number; rrp?: number }>;
    };
    expect(body.priceInfos).toHaveLength(2);
    expect(body.priceInfos[0]).toMatchObject({
      barcode: 'BC-001',
      buyingPrice: 99.9,
      rrp: 129.9,
    });
    expect(body.priceInfos[1]).toMatchObject({
      barcode: 'BC-002',
      buyingPrice: 49.5,
    });
    // No rrp when listPrice not provided
    expect(body.priceInfos[1]).not.toHaveProperty('rrp');
  });

  it('includes Authorization and User-Agent headers', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ batchId: 'batch-002' }));

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

  it('GETs .../ecgw/v1/{sellerId}/check-status?batchId=... and maps COMPLETED response', async () => {
    const wire = {
      batchId: BATCH_ID,
      batchType: 'PriceUpdate',
      status: 'COMPLETED',
      items: [
        {
          requestItem: { barcode: 'BC-001', buyingPrice: 99.9, rrp: 129.9 },
          status: 'SUCCESS',
          failureReasons: [],
        },
        {
          requestItem: { barcode: 'BC-002', buyingPrice: 49.5 },
          status: 'FAILED',
          failureReasons: ['Price already updated today'],
        },
      ],
      creationDate: 1529734317090,
      lastModification: 1529734653403,
      itemCount: 2,
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
      failureReasons: ['Price already updated today'],
    });

    // URL must include sellerId and batchId as query param
    const [urlArg] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(urlArg).toContain(`/ecgw/v1/${SUPPLIER_ID}/check-status`);
    expect(urlArg).toContain(`batchId=${encodeURIComponent(BATCH_ID)}`);
  });

  it('returns processing: true when batch status is IN_PROGRESS', async () => {
    const wire = {
      batchId: BATCH_ID,
      batchType: 'PriceUpdate',
      status: 'IN_PROGRESS',
      items: [],
      creationDate: 1529734317090,
      lastModification: 1529734317090,
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

  it('items without failureReasons do not include the field', async () => {
    const wire = {
      batchId: BATCH_ID,
      batchType: 'PriceUpdate',
      status: 'COMPLETED',
      items: [
        {
          requestItem: { barcode: 'BC-OK', buyingPrice: 50.0 },
          status: 'SUCCESS',
          failureReasons: [],
        },
      ],
      creationDate: 1529734317090,
      lastModification: 1529734653403,
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
