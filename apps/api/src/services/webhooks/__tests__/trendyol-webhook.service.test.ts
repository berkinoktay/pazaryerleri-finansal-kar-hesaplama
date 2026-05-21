import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { decryptCredentials } from '@pazarsync/sync-core';

import {
  buildWebhookCallbackUrl,
  generateWebhookCredentials,
  registerStoreWebhook,
  rotateStoreWebhookSecret,
  unregisterStoreWebhook,
} from '../trendyol-webhook.service';

const TRENDYOL_CREDS = {
  supplierId: '2738',
  apiKey: 'key-abc',
  apiSecret: 'secret-xyz',
};

const TRENDYOL_BASE = 'https://stage.trendyol.test';

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  process.env['TRENDYOL_SANDBOX_BASE_URL'] = TRENDYOL_BASE;
  process.env['PUBLIC_API_BASE_URL'] = 'https://api.pazarsync.com';
  // ENCRYPTION_KEY: 32-byte hex required by encryptCredentials. Fake but valid.
  process.env['ENCRYPTION_KEY'] =
    'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
  fetchSpy = vi.spyOn(globalThis, 'fetch');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('generateWebhookCredentials', () => {
  it('produces a deterministic prefix + 16-char random user suffix', () => {
    const { username } = generateWebhookCredentials();
    expect(username).toMatch(/^pazarsync-[0-9a-f]{16}$/);
  });

  it('produces a 256-bit (43-char) base64url password', () => {
    const { password } = generateWebhookCredentials();
    // 32 bytes → base64url ~43 chars (no padding, URL-safe alphabet)
    expect(password).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('different calls produce different credentials (entropy check)', () => {
    const a = generateWebhookCredentials();
    const b = generateWebhookCredentials();
    expect(a.username).not.toBe(b.username);
    expect(a.password).not.toBe(b.password);
  });
});

describe('buildWebhookCallbackUrl', () => {
  it('joins base URL with /v1/webhooks/orders/:storeId', () => {
    expect(buildWebhookCallbackUrl('abc-store-id')).toBe(
      'https://api.pazarsync.com/v1/webhooks/orders/abc-store-id',
    );
  });

  it('strips a trailing slash from PUBLIC_API_BASE_URL', () => {
    process.env['PUBLIC_API_BASE_URL'] = 'https://api.pazarsync.com/';
    expect(buildWebhookCallbackUrl('abc-store-id')).toBe(
      'https://api.pazarsync.com/v1/webhooks/orders/abc-store-id',
    );
  });

  it('throws if PUBLIC_API_BASE_URL is empty (fail-fast guard)', () => {
    process.env['PUBLIC_API_BASE_URL'] = '';
    expect(() => buildWebhookCallbackUrl('abc')).toThrow(/PUBLIC_API_BASE_URL is missing/);
  });
});

describe('registerStoreWebhook', () => {
  it('POSTs to Trendyol + returns the new webhookId + encrypted credential blob', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'trendyol-wh-uuid-42' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const result = await registerStoreWebhook({
      storeId: 'abc-store',
      credentials: TRENDYOL_CREDS,
      env: 'SANDBOX',
    });

    expect(result.webhookId).toBe('trendyol-wh-uuid-42');
    expect(result.encryptedSecret).toBeTypeOf('string');
    expect(result.encryptedSecret.length).toBeGreaterThan(0);

    // Round-trip: encrypted blob decrypt → username/password recoverable
    const decrypted = decryptCredentials(result.encryptedSecret);
    expect(decrypted).toMatchObject({
      username: expect.stringMatching(/^pazarsync-[0-9a-f]{16}$/),
      password: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    });
  });

  it('forwards the storeId-scoped callback URL to Trendyol register', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'wh-uuid' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await registerStoreWebhook({
      storeId: 'store-xyz',
      credentials: TRENDYOL_CREDS,
      env: 'SANDBOX',
    });

    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.url).toBe('https://api.pazarsync.com/v1/webhooks/orders/store-xyz');
  });
});

describe('unregisterStoreWebhook', () => {
  it('DELETEs the webhook at Trendyol', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 200 }));

    await unregisterStoreWebhook({
      credentials: TRENDYOL_CREDS,
      env: 'SANDBOX',
      webhookId: 'trendyol-wh-uuid-42',
    });

    const [calledUrl, init] = fetchSpy.mock.calls[0]!;
    expect(calledUrl).toBe(
      `${TRENDYOL_BASE}/integration/webhook/sellers/2738/webhooks/trendyol-wh-uuid-42`,
    );
    expect((init as RequestInit).method).toBe('DELETE');
  });
});

describe('rotateStoreWebhookSecret', () => {
  it('PUTs new credentials to Trendyol + returns a new encrypted blob', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 200 }));

    const result = await rotateStoreWebhookSecret({
      storeId: 'store-xyz',
      credentials: TRENDYOL_CREDS,
      env: 'SANDBOX',
      webhookId: 'trendyol-wh-uuid-42',
    });

    expect(result.encryptedSecret).toBeTypeOf('string');

    const decrypted = decryptCredentials(result.encryptedSecret);
    expect(decrypted).toMatchObject({
      username: expect.stringMatching(/^pazarsync-/),
      password: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    });

    // Verify the PUT URL targets the existing webhook id (not POST)
    const [calledUrl, init] = fetchSpy.mock.calls[0]!;
    expect(calledUrl).toBe(
      `${TRENDYOL_BASE}/integration/webhook/sellers/2738/webhooks/trendyol-wh-uuid-42`,
    );
    expect((init as RequestInit).method).toBe('PUT');
  });

  it('rotation produces credentials different from the previous register', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'wh' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const initial = await registerStoreWebhook({
      storeId: 'store-xyz',
      credentials: TRENDYOL_CREDS,
      env: 'SANDBOX',
    });

    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 200 }));
    const rotated = await rotateStoreWebhookSecret({
      storeId: 'store-xyz',
      credentials: TRENDYOL_CREDS,
      env: 'SANDBOX',
      webhookId: 'wh',
    });

    const initialCreds = decryptCredentials(initial.encryptedSecret) as {
      username: string;
      password: string;
    };
    const rotatedCreds = decryptCredentials(rotated.encryptedSecret) as {
      username: string;
      password: string;
    };
    expect(rotatedCreds.username).not.toBe(initialCreds.username);
    expect(rotatedCreds.password).not.toBe(initialCreds.password);
  });
});
