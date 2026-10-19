// fetchShipmentPackages — the page-based getShipmentPackages pager. Pins the
// v2 endpoint (the pre-v2 `/orders` was announced deprecated for 15 Oct 2026)
// and the v2 reachable-record window. Fetch-mock pattern follows the sibling
// products.test.ts; the package payload comes from the shared order builders.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchShipmentPackages, ORDERS_V2_MAX_QUERY_WINDOW } from '../../src/trendyol/orders';
import type { TrendyolCredentials, TrendyolOrdersResponse } from '../../src/trendyol/types';
import { buildPackage } from '../helpers/order-builders';

const BASE_URL = 'https://stage.trendyol.test';
const SUPPLIER_ID = '2738';
const CREDENTIALS: TrendyolCredentials = {
  supplierId: SUPPLIER_ID,
  apiKey: 'key-abc',
  apiSecret: 'secret-xyz',
};
const START_DATE = 1_790_000_000_000;
const END_DATE = 1_790_600_000_000;

function jsonResponse(body: TrendyolOrdersResponse): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function ordersPage(overrides: Partial<TrendyolOrdersResponse>): TrendyolOrdersResponse {
  return {
    totalElements: 1,
    totalPages: 1,
    page: 0,
    size: 200,
    content: [buildPackage({ status: 'Created' })],
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

describe('fetchShipmentPackages', () => {
  it('calls the v2 getShipmentPackages endpoint with the window and paging params', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(ordersPage({})));

    const pages = [];
    for await (const page of fetchShipmentPackages({
      baseUrl: BASE_URL,
      credentials: CREDENTIALS,
      startDate: START_DATE,
      endDate: END_DATE,
    })) {
      pages.push(page);
    }

    expect(pages).toHaveLength(1);
    const url = new URL(String(fetchSpy.mock.calls[0]?.[0]));
    expect(url.pathname).toBe(`/integration/order/sellers/${SUPPLIER_ID}/v2/orders`);
    expect(url.searchParams.get('startDate')).toBe(START_DATE.toString());
    expect(url.searchParams.get('endDate')).toBe(END_DATE.toString());
    expect(url.searchParams.get('page')).toBe('0');
    expect(url.searchParams.get('size')).toBe('200');
  });

  it('refuses a window larger than the v2 reachable-record cap instead of yielding a prefix', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(ordersPage({ totalElements: ORDERS_V2_MAX_QUERY_WINDOW + 1, totalPages: 51 })),
    );

    const iterate = async (): Promise<void> => {
      for await (const _page of fetchShipmentPackages({
        baseUrl: BASE_URL,
        credentials: CREDENTIALS,
        startDate: START_DATE,
        endDate: END_DATE,
      })) {
        // drain
      }
    };

    await expect(iterate()).rejects.toThrow(RangeError);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
