import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fetchApprovedProducts,
  type TrendyolApprovedProductsResponse,
  type TrendyolContent,
  type TrendyolCredentials,
} from '@pazarsync/marketplace';
import {
  MarketplaceAuthError,
  MarketplaceUnreachable,
  RateLimitedError,
} from '@pazarsync/sync-core';

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

function makeContent(contentId: number, title = 'sample'): TrendyolContent {
  return {
    contentId,
    productMainId: `pmid-${contentId.toString()}`,
    brand: { id: 1, name: 'Brand' },
    category: { id: 1, name: 'Category' },
    creationDate: 1777246115403,
    lastModifiedDate: 1777246115403,
    title,
    description: 'desc',
    images: [{ url: 'https://cdn.example.com/x.jpg' }],
    attributes: [{ attributeId: 47, attributeName: 'Renk', attributeValue: 'Mavi' }],
    variants: [
      {
        variantId: contentId * 10,
        supplierId: 2738,
        barcode: `bc-${contentId.toString()}`,
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

function makePage(args: {
  page: number;
  size: number;
  totalElements: number;
  content: TrendyolContent[];
  nextPageToken?: string | null;
}): TrendyolApprovedProductsResponse {
  return {
    totalElements: args.totalElements,
    totalPages: Math.ceil(args.totalElements / args.size),
    page: args.page,
    size: args.size,
    nextPageToken: args.nextPageToken ?? null,
    content: args.content,
  };
}

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('fetchApprovedProducts — happy path & pagination', () => {
  it('yields a single mapped batch for a single-page catalog', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(
        makePage({
          page: 0,
          size: 100,
          totalElements: 2,
          content: [makeContent(1), makeContent(2)],
        }),
      ),
    );

    const batches = [];
    for await (const page of fetchApprovedProducts({
      baseUrl: BASE_URL,
      credentials: CREDENTIALS,
    })) {
      batches.push(page);
    }

    expect(batches).toHaveLength(1);
    expect(batches[0]?.batch).toHaveLength(2);
    expect(batches[0]?.batch[0]?.platformContentId).toBe(BigInt(1));
    expect(batches[0]?.pageMeta.totalElements).toBe(2);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it('attaches Authorization Basic and User-Agent headers on every request', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(makePage({ page: 0, size: 100, totalElements: 1, content: [makeContent(1)] })),
    );

    for await (const page of fetchApprovedProducts({
      baseUrl: BASE_URL,
      credentials: CREDENTIALS,
    })) {
      void page;
    }

    expect(fetchSpy).toHaveBeenCalledOnce();
    const call = fetchSpy.mock.calls[0];
    if (call === undefined) throw new Error('expected one fetch call');
    const [, init] = call;
    const headers = (init as RequestInit).headers as Record<string, string>;
    const expectedAuth = `Basic ${Buffer.from('key-abc:secret-xyz').toString('base64')}`;
    expect(headers['Authorization']).toBe(expectedAuth);
    expect(headers['User-Agent']).toBe(`${SUPPLIER_ID} - SelfIntegration`);
  });

  it('paginates using page=N+1 when no nextPageToken is returned', async () => {
    fetchSpy
      .mockResolvedValueOnce(
        jsonResponse(
          makePage({
            page: 0,
            size: 100,
            totalElements: 150,
            content: Array.from({ length: 100 }, (_, i) => makeContent(i + 1)),
          }),
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          makePage({
            page: 1,
            size: 100,
            totalElements: 150,
            content: Array.from({ length: 50 }, (_, i) => makeContent(i + 101)),
          }),
        ),
      );

    let total = 0;
    for await (const page of fetchApprovedProducts({
      baseUrl: BASE_URL,
      credentials: CREDENTIALS,
    })) {
      total += page.batch.length;
    }

    expect(total).toBe(150);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const firstUrl = fetchSpy.mock.calls[0]?.[0] as string;
    const secondUrl = fetchSpy.mock.calls[1]?.[0] as string;
    expect(firstUrl).toContain('page=0');
    expect(secondUrl).toContain('page=1');
    expect(secondUrl).not.toContain('nextPageToken');
  });

  it('ignores nextPageToken below the 10k cap and stays on page-based pagination', async () => {
    // Trendyol returns nextPageToken on every response now (even below
    // the documented 10k cap). The generator should NOT switch to it
    // — page-based is the documented contract while page * size ≤ 10k
    // and avoids the deterministic 500s observed on some token values.
    fetchSpy
      .mockResolvedValueOnce(
        jsonResponse(
          makePage({
            page: 0,
            size: 100,
            totalElements: 200,
            content: Array.from({ length: 100 }, (_, i) => makeContent(i + 1)),
            nextPageToken: 'cursor-abc',
          }),
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          makePage({
            page: 1,
            size: 100,
            totalElements: 200,
            content: Array.from({ length: 100 }, (_, i) => makeContent(i + 101)),
            nextPageToken: 'cursor-def',
          }),
        ),
      );

    let total = 0;
    for await (const page of fetchApprovedProducts({
      baseUrl: BASE_URL,
      credentials: CREDENTIALS,
    })) {
      total += page.batch.length;
    }

    expect(total).toBe(200);
    const secondUrl = fetchSpy.mock.calls[1]?.[0] as string;
    expect(secondUrl).toContain('page=1');
    expect(secondUrl).not.toContain('nextPageToken');
  });

  it('switches to nextPageToken when the next page would cross the 10k cap', async () => {
    // page=99 fetches items 9900–9999 (last page-based page). The next
    // request would be for items 10000+, which Trendyol requires via
    // nextPageToken. The generator must switch over at exactly that
    // boundary and use the token Trendyol returned with page 99.
    fetchSpy
      .mockResolvedValueOnce(
        jsonResponse(
          makePage({
            page: 99,
            size: 100,
            totalElements: 10_100,
            content: Array.from({ length: 100 }, (_, i) => makeContent(i + 9900)),
            nextPageToken: 'past-cap-token',
          }),
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          makePage({
            page: 100,
            size: 100,
            totalElements: 10_100,
            content: Array.from({ length: 100 }, (_, i) => makeContent(i + 10_000)),
            nextPageToken: null,
          }),
        ),
      );

    let total = 0;
    for await (const page of fetchApprovedProducts({
      baseUrl: BASE_URL,
      credentials: CREDENTIALS,
      // Resume at page=99 so the test fires exactly two requests
      // instead of paging through all 99 prior pages.
      initialCursor: { kind: 'page', n: 99 },
    })) {
      total += page.batch.length;
    }

    expect(total).toBe(200);
    const firstUrl = fetchSpy.mock.calls[0]?.[0] as string;
    const secondUrl = fetchSpy.mock.calls[1]?.[0] as string;
    expect(firstUrl).toContain('page=99');
    expect(secondUrl).toContain('nextPageToken=past-cap-token');
    expect(secondUrl).not.toMatch(/[?&]page=/);
  });

  it('stops when content[] comes back empty', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(makePage({ page: 0, size: 100, totalElements: 0, content: [] })),
    );

    const batches = [];
    for await (const page of fetchApprovedProducts({
      baseUrl: BASE_URL,
      credentials: CREDENTIALS,
    })) {
      batches.push(page);
    }

    expect(batches).toHaveLength(0);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });
});

describe('fetchApprovedProducts — error paths', () => {
  it('throws MarketplaceAuthError on 401 — no retry, auth issues are permanent', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 401 }));

    const gen = fetchApprovedProducts({ baseUrl: BASE_URL, credentials: CREDENTIALS });
    await expect(gen.next()).rejects.toBeInstanceOf(MarketplaceAuthError);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });
});

describe('fetchApprovedProducts — 5xx + network retry', () => {
  it('retries 502 with backoff and succeeds when the next call 200s', async () => {
    vi.useFakeTimers();
    fetchSpy
      .mockResolvedValueOnce(new Response(null, { status: 502 }))
      .mockResolvedValueOnce(
        jsonResponse(makePage({ page: 0, size: 100, totalElements: 1, content: [makeContent(1)] })),
      );

    const gen = fetchApprovedProducts({ baseUrl: BASE_URL, credentials: CREDENTIALS });
    const promise = gen.next();
    // First retry uses INITIAL_BACKOFF_MS = 1000ms (no Retry-After on 5xx).
    await vi.advanceTimersByTimeAsync(2_000);
    const result = await promise;

    expect(result.done).toBe(false);
    expect(result.value?.batch).toHaveLength(1);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('retries network errors with backoff and succeeds when the next call 200s', async () => {
    vi.useFakeTimers();
    fetchSpy
      .mockRejectedValueOnce(new TypeError('network down'))
      .mockResolvedValueOnce(
        jsonResponse(makePage({ page: 0, size: 100, totalElements: 1, content: [makeContent(1)] })),
      );

    const gen = fetchApprovedProducts({ baseUrl: BASE_URL, credentials: CREDENTIALS });
    const promise = gen.next();
    await vi.advanceTimersByTimeAsync(2_000);
    const result = await promise;

    expect(result.done).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('throws MarketplaceUnreachable after exhausting 5xx retries', async () => {
    vi.useFakeTimers();
    // 4 backoff retries + 1 final = 5 total 502s.
    for (let i = 0; i < 5; i++) {
      fetchSpy.mockResolvedValueOnce(new Response(null, { status: 502 }));
    }

    const gen = fetchApprovedProducts({ baseUrl: BASE_URL, credentials: CREDENTIALS });
    const rejection = expect(gen.next()).rejects.toBeInstanceOf(MarketplaceUnreachable);
    await vi.advanceTimersByTimeAsync(60_000);
    await rejection;
    expect(fetchSpy).toHaveBeenCalledTimes(5);
  });

  it('throws MarketplaceUnreachable after exhausting network-error retries', async () => {
    vi.useFakeTimers();
    for (let i = 0; i < 5; i++) {
      fetchSpy.mockRejectedValueOnce(new TypeError('connection reset'));
    }

    const gen = fetchApprovedProducts({ baseUrl: BASE_URL, credentials: CREDENTIALS });
    const rejection = expect(gen.next()).rejects.toBeInstanceOf(MarketplaceUnreachable);
    await vi.advanceTimersByTimeAsync(60_000);
    await rejection;
    expect(fetchSpy).toHaveBeenCalledTimes(5);
  });

  it('does NOT retry 503 in SANDBOX — terminal IP-whitelist config issue', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 503 }));

    const gen = fetchApprovedProducts({
      baseUrl: BASE_URL,
      environment: 'SANDBOX',
      credentials: CREDENTIALS,
    });
    // 503 in SANDBOX maps to MarketplaceAccessError (stage IP whitelist
    // missing — terminal config issue per Trendyol's documented sandbox
    // behavior); retrying wouldn't help.
    await expect(gen.next()).rejects.toThrow();
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it('DOES retry 503 in PRODUCTION — transient upstream unavailability', async () => {
    vi.useFakeTimers();
    // 4 backoff retries + 1 final = 5 calls all returning 503
    for (let i = 0; i < 5; i++) {
      fetchSpy.mockResolvedValueOnce(new Response(null, { status: 503 }));
    }

    const gen = fetchApprovedProducts({
      baseUrl: BASE_URL,
      environment: 'PRODUCTION',
      credentials: CREDENTIALS,
    });
    const rejection = expect(gen.next()).rejects.toBeInstanceOf(MarketplaceUnreachable);
    await vi.advanceTimersByTimeAsync(60_000);
    await rejection;
    expect(fetchSpy).toHaveBeenCalledTimes(5);
  });
});

describe('fetchApprovedProducts — 429 backoff', () => {
  it('retries after 429 with Retry-After header and succeeds', async () => {
    vi.useFakeTimers();
    fetchSpy
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'Retry-After': '1' } }))
      .mockResolvedValueOnce(
        jsonResponse(makePage({ page: 0, size: 100, totalElements: 1, content: [makeContent(1)] })),
      );

    const gen = fetchApprovedProducts({ baseUrl: BASE_URL, credentials: CREDENTIALS });
    const promise = gen.next();
    // advance the 1-second sleep
    await vi.advanceTimersByTimeAsync(1_000);
    const result = await promise;

    expect(result.done).toBe(false);
    expect(result.value?.batch).toHaveLength(1);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('throws RateLimitedError after exhausting retries', async () => {
    vi.useFakeTimers();
    // 4 backoff retries + 1 final = 5 calls all returning 429
    for (let i = 0; i < 5; i++) {
      fetchSpy.mockResolvedValueOnce(
        new Response(null, { status: 429, headers: { 'Retry-After': '1' } }),
      );
    }

    const gen = fetchApprovedProducts({ baseUrl: BASE_URL, credentials: CREDENTIALS });
    // Attach the rejection assertion before advancing timers — otherwise the
    // rejection settles between the advance and the `expect`, and Node logs
    // a PromiseRejectionHandledWarning that Vitest surfaces as an "Unhandled".
    const rejectionAssertion = expect(gen.next()).rejects.toBeInstanceOf(RateLimitedError);
    await vi.advanceTimersByTimeAsync(60_000);
    await rejectionAssertion;
    expect(fetchSpy).toHaveBeenCalledTimes(5);
  });
});

describe('fetchApprovedProducts — request URL composition', () => {
  it('builds the v2 approved endpoint with size and page', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(makePage({ page: 0, size: 100, totalElements: 1, content: [makeContent(1)] })),
    );

    for await (const page of fetchApprovedProducts({
      baseUrl: BASE_URL,
      credentials: CREDENTIALS,
    })) {
      void page;
    }

    const url = fetchSpy.mock.calls[0]?.[0] as string;
    expect(url).toBe(
      `${BASE_URL}/integration/product/sellers/${SUPPLIER_ID}/products/approved?size=1000&page=0`,
    );
  });
});
