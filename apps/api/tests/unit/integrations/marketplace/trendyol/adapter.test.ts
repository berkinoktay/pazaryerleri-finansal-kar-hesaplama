import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MarketplaceAuthError, ValidationError } from '../../../../../src/lib/errors';
import { trendyolFactory } from '../../../../../src/integrations/marketplace/trendyol/adapter';

const VALID_CREDS = {
  supplierId: '99999',
  apiKey: 'seed-trendyol-api-key',
  apiSecret: 'seed-trendyol-api-secret',
};

describe('trendyolFactory', () => {
  beforeEach(() => {
    vi.stubEnv('TRENDYOL_PROD_BASE_URL', 'https://apigw.trendyol.com');
    vi.stubEnv('TRENDYOL_SANDBOX_BASE_URL', 'https://stageapigw.trendyol.com');
    vi.stubEnv('TRENDYOL_INTEGRATOR_UA_SUFFIX', 'SelfIntegration');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('testConnection returns externalAccountId on 200', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }),
    );

    const adapter = trendyolFactory.create({
      environment: 'PRODUCTION',
      credentials: VALID_CREDS,
    });
    const result = await adapter.testConnection();

    expect(result).toEqual({ externalAccountId: '99999' });
  });

  it('testConnection sends Basic auth + required User-Agent header', async () => {
    const spy = vi.spyOn(global, 'fetch').mockResolvedValue(new Response('[]', { status: 200 }));

    const adapter = trendyolFactory.create({
      environment: 'PRODUCTION',
      credentials: VALID_CREDS,
    });
    await adapter.testConnection();

    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toContain('apigw.trendyol.com/integration/product/sellers/99999/products');
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toMatch(/^Basic [A-Za-z0-9+/=]+$/);
    expect(headers['User-Agent']).toBe('99999 - SelfIntegration');
  });

  it('testConnection uses sandbox base URL when env is SANDBOX', async () => {
    const spy = vi.spyOn(global, 'fetch').mockResolvedValue(new Response('[]', { status: 200 }));

    const adapter = trendyolFactory.create({
      environment: 'SANDBOX',
      credentials: VALID_CREDS,
    });
    await adapter.testConnection();

    const [url] = spy.mock.calls[0]!;
    expect(String(url)).toContain('stageapigw.trendyol.com');
  });

  it('testConnection throws MarketplaceAuthError on 401', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(null, { status: 401 }));

    const adapter = trendyolFactory.create({
      environment: 'PRODUCTION',
      credentials: VALID_CREDS,
    });

    await expect(adapter.testConnection()).rejects.toBeInstanceOf(MarketplaceAuthError);
  });

  it('create() throws ValidationError INVALID_CREDENTIALS_SHAPE on malformed credentials', () => {
    expect(() =>
      trendyolFactory.create({
        environment: 'PRODUCTION',
        credentials: { foo: 'bar' },
      }),
    ).toThrow(ValidationError);

    try {
      trendyolFactory.create({
        environment: 'PRODUCTION',
        credentials: { foo: 'bar' },
      });
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).issues[0]).toEqual({
        field: 'credentials',
        code: 'INVALID_CREDENTIALS_SHAPE',
      });
    }
  });
});
