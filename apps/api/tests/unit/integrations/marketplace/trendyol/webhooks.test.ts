import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  TRENDYOL_SUBSCRIBED_STATUSES,
  WebhookCallbackUrlError,
  getTrendyolWebhooks,
  registerTrendyolWebhook,
  unregisterTrendyolWebhook,
  updateTrendyolWebhook,
  type TrendyolCredentials,
} from '@pazarsync/marketplace';
import { MarketplaceUnreachable } from '@pazarsync/sync-core';

const CREDENTIALS: TrendyolCredentials = {
  supplierId: '2738',
  apiKey: 'key-abc',
  apiSecret: 'secret-xyz',
};

const BASE_URL = 'https://stage.trendyol.test';
const ENV = 'SANDBOX' as const;

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  process.env['TRENDYOL_SANDBOX_BASE_URL'] = BASE_URL;
  fetchSpy = vi.spyOn(globalThis, 'fetch');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TRENDYOL_SUBSCRIBED_STATUSES', () => {
  it('exposes the 8 explicit statuses agreed in design §2b / Q4', () => {
    expect(TRENDYOL_SUBSCRIBED_STATUSES).toEqual([
      'CREATED',
      'PICKING',
      'INVOICED',
      'SHIPPED',
      'DELIVERED',
      'UNDELIVERED',
      'CANCELLED',
      'RETURNED',
    ]);
  });
});

describe('assertValidCallbackUrl — defense-in-depth before Trendyol POST', () => {
  it('rejects http:// (Trendyol HTTPS-only)', async () => {
    await expect(
      registerTrendyolWebhook({
        credentials: CREDENTIALS,
        env: ENV,
        callbackUrl: 'http://api.pazarsync.com/v1/webhooks/orders/abc',
        username: 'u',
        password: 'p',
      }),
    ).rejects.toBeInstanceOf(WebhookCallbackUrlError);
  });

  it('rejects URLs containing the banned keyword "trendyol"', async () => {
    await expect(
      registerTrendyolWebhook({
        credentials: CREDENTIALS,
        env: ENV,
        callbackUrl: 'https://trendyol.example.com/v1/webhooks/orders/abc',
        username: 'u',
        password: 'p',
      }),
    ).rejects.toThrow(/banned keyword 'trendyol'/);
  });

  it('rejects URLs containing the banned keyword "localhost"', async () => {
    await expect(
      registerTrendyolWebhook({
        credentials: CREDENTIALS,
        env: ENV,
        callbackUrl: 'https://localhost:3000/v1/webhooks/orders/abc',
        username: 'u',
        password: 'p',
      }),
    ).rejects.toThrow(/banned keyword 'localhost'/);
  });

  it('rejects URLs containing the banned keyword "dolap"', async () => {
    await expect(
      registerTrendyolWebhook({
        credentials: CREDENTIALS,
        env: ENV,
        callbackUrl: 'https://dolap.cdn.example.com/v1/webhooks/orders/abc',
        username: 'u',
        password: 'p',
      }),
    ).rejects.toThrow(/banned keyword 'dolap'/);
  });
});

describe('registerTrendyolWebhook', () => {
  it('POSTs to the seller-scoped webhooks endpoint with Basic Auth + body', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ id: 'webhook-uuid-123' }));

    const result = await registerTrendyolWebhook({
      credentials: CREDENTIALS,
      env: ENV,
      callbackUrl: 'https://api.pazarsync.com/v1/webhooks/orders/abc-store',
      username: 'webhook-user-1234',
      password: 'webhook-pass-very-secret',
    });

    expect(result.webhookId).toBe('webhook-uuid-123');

    const [calledUrl, init] = fetchSpy.mock.calls[0]!;
    expect(calledUrl).toBe(`${BASE_URL}/integration/webhook/sellers/2738/webhooks`);
    expect((init as RequestInit | undefined)?.method).toBe('POST');

    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({
      url: 'https://api.pazarsync.com/v1/webhooks/orders/abc-store',
      username: 'webhook-user-1234',
      password: 'webhook-pass-very-secret',
      authenticationType: 'BASIC_AUTHENTICATION',
      subscribedStatuses: TRENDYOL_SUBSCRIBED_STATUSES,
    });

    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['Authorization']).toMatch(/^Basic /);
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('accepts caller-provided subscribedStatuses override', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ id: 'webhook-uuid-456' }));

    await registerTrendyolWebhook({
      credentials: CREDENTIALS,
      env: ENV,
      callbackUrl: 'https://api.pazarsync.com/v1/webhooks/orders/abc-store',
      username: 'u',
      password: 'p',
      subscribedStatuses: ['CREATED', 'DELIVERED'],
    });

    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(init.body as string);
    expect(body.subscribedStatuses).toEqual(['CREATED', 'DELIVERED']);
  });

  it('throws if response.id is missing (Trendyol API contract guard)', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ id: '' }));

    await expect(
      registerTrendyolWebhook({
        credentials: CREDENTIALS,
        env: ENV,
        callbackUrl: 'https://api.pazarsync.com/v1/webhooks/orders/abc',
        username: 'u',
        password: 'p',
      }),
    ).rejects.toThrow(/missing id field/);
  });

  it('wraps network errors in MarketplaceUnreachable', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    await expect(
      registerTrendyolWebhook({
        credentials: CREDENTIALS,
        env: ENV,
        callbackUrl: 'https://api.pazarsync.com/v1/webhooks/orders/abc',
        username: 'u',
        password: 'p',
      }),
    ).rejects.toBeInstanceOf(MarketplaceUnreachable);
  });

  it('rethrows AbortError so callers can distinguish cancellation', async () => {
    const abort = new DOMException('aborted', 'AbortError');
    fetchSpy.mockRejectedValueOnce(abort);

    await expect(
      registerTrendyolWebhook({
        credentials: CREDENTIALS,
        env: ENV,
        callbackUrl: 'https://api.pazarsync.com/v1/webhooks/orders/abc',
        username: 'u',
        password: 'p',
      }),
    ).rejects.toBe(abort);
  });
});

describe('unregisterTrendyolWebhook', () => {
  it('DELETEs at the webhook-id-scoped endpoint', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 200 }));

    await unregisterTrendyolWebhook({
      credentials: CREDENTIALS,
      env: ENV,
      webhookId: 'webhook-uuid-789',
    });

    const [calledUrl, init] = fetchSpy.mock.calls[0]!;
    expect(calledUrl).toBe(
      `${BASE_URL}/integration/webhook/sellers/2738/webhooks/webhook-uuid-789`,
    );
    expect((init as RequestInit).method).toBe('DELETE');
  });

  it('wraps network errors in MarketplaceUnreachable', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    await expect(
      unregisterTrendyolWebhook({
        credentials: CREDENTIALS,
        env: ENV,
        webhookId: 'webhook-uuid-789',
      }),
    ).rejects.toBeInstanceOf(MarketplaceUnreachable);
  });
});

describe('updateTrendyolWebhook', () => {
  it('PUTs at the webhook-id-scoped endpoint with full credential body', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 200 }));

    await updateTrendyolWebhook({
      credentials: CREDENTIALS,
      env: ENV,
      webhookId: 'webhook-uuid-rotation',
      callbackUrl: 'https://api.pazarsync.com/v1/webhooks/orders/abc',
      username: 'new-user',
      password: 'new-pass',
    });

    const [calledUrl, init] = fetchSpy.mock.calls[0]!;
    expect(calledUrl).toBe(
      `${BASE_URL}/integration/webhook/sellers/2738/webhooks/webhook-uuid-rotation`,
    );
    expect((init as RequestInit).method).toBe('PUT');

    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.username).toBe('new-user');
    expect(body.password).toBe('new-pass');
    expect(body.authenticationType).toBe('BASIC_AUTHENTICATION');
  });

  it('runs URL validation on update (HTTPS, banned keywords)', async () => {
    await expect(
      updateTrendyolWebhook({
        credentials: CREDENTIALS,
        env: ENV,
        webhookId: 'webhook-uuid-rotation',
        callbackUrl: 'http://api.pazarsync.com/v1/webhooks/orders/abc',
        username: 'u',
        password: 'p',
      }),
    ).rejects.toBeInstanceOf(WebhookCallbackUrlError);
  });
});

describe('getTrendyolWebhooks', () => {
  it('GETs the seller-scoped endpoint and maps the bare-array response to {id,url}[]', async () => {
    // Trendyol GET returns a BARE ARRAY (not {content:[...]}); extra fields ignored,
    // lastModifiedDate/subscribedStatuses may be null (webhook-listeleme.md sample).
    fetchSpy.mockResolvedValueOnce(
      jsonResponse([
        {
          id: 'wh-1',
          createdDate: 1733317686667,
          lastModifiedDate: null,
          url: 'https://x.ngrok-free.dev/v1/webhooks/orders/store-1',
          username: 'pazarsync-aaa',
          authenticationType: 'BASIC_AUTHENTICATION',
          status: 'ACTIVE',
          subscribedStatuses: null,
        },
        {
          id: 'wh-2',
          url: 'https://x.ngrok-free.dev/v1/webhooks/orders/store-2',
          username: 'pazarsync-bbb',
          status: 'PASSIVE',
          subscribedStatuses: ['CREATED', 'DELIVERED'],
        },
      ]),
    );

    const hooks = await getTrendyolWebhooks({ credentials: CREDENTIALS, env: ENV });

    expect(hooks).toEqual([
      { id: 'wh-1', url: 'https://x.ngrok-free.dev/v1/webhooks/orders/store-1', status: 'ACTIVE' },
      { id: 'wh-2', url: 'https://x.ngrok-free.dev/v1/webhooks/orders/store-2', status: 'PASSIVE' },
    ]);

    const [calledUrl, init] = fetchSpy.mock.calls[0]!;
    expect(calledUrl).toBe(`${BASE_URL}/integration/webhook/sellers/2738/webhooks`);
    expect((init as RequestInit).method).toBe('GET');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['Authorization']).toMatch(/^Basic /);
  });

  it('returns [] when Trendyol returns an empty list', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse([]));
    expect(await getTrendyolWebhooks({ credentials: CREDENTIALS, env: ENV })).toEqual([]);
  });

  it('skips malformed entries missing id or url (defensive parse)', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse([
        { id: 'ok', url: 'https://x.ngrok-free.dev/v1/webhooks/orders/s1' },
        { id: 'no-url-field' },
        { url: 'https://x.ngrok-free.dev/v1/webhooks/orders/s2' },
        null,
        'garbage',
      ]),
    );
    expect(await getTrendyolWebhooks({ credentials: CREDENTIALS, env: ENV })).toEqual([
      { id: 'ok', url: 'https://x.ngrok-free.dev/v1/webhooks/orders/s1' },
    ]);
  });

  it('returns [] when the response body is not an array', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ content: [] }));
    expect(await getTrendyolWebhooks({ credentials: CREDENTIALS, env: ENV })).toEqual([]);
  });

  it('wraps network errors in MarketplaceUnreachable', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(
      getTrendyolWebhooks({ credentials: CREDENTIALS, env: ENV }),
    ).rejects.toBeInstanceOf(MarketplaceUnreachable);
  });

  it('rethrows AbortError so callers can distinguish cancellation', async () => {
    const abort = new DOMException('aborted', 'AbortError');
    fetchSpy.mockRejectedValueOnce(abort);
    await expect(getTrendyolWebhooks({ credentials: CREDENTIALS, env: ENV })).rejects.toBe(abort);
  });
});
