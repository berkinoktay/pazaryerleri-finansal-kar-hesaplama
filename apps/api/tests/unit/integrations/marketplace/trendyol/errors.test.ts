import { describe, expect, it } from 'vitest';

import { mapTrendyolResponseToDomainError } from '@pazarsync/marketplace';
import {
  MarketplaceAccessError,
  MarketplaceAuthError,
  MarketplaceUnreachable,
  RateLimitedError,
} from '@pazarsync/sync-core';

function response(status: number, headers: Record<string, string> = {}): Response {
  return new Response(null, { status, headers });
}

describe('mapTrendyolResponseToDomainError', () => {
  it('throws MarketplaceAuthError on 401', () => {
    expect(() => mapTrendyolResponseToDomainError(response(401), 'PRODUCTION')).toThrow(
      MarketplaceAuthError,
    );
    try {
      mapTrendyolResponseToDomainError(response(401), 'PRODUCTION');
    } catch (err) {
      expect(err).toBeInstanceOf(MarketplaceAuthError);
      expect((err as MarketplaceAuthError).code).toBe('MARKETPLACE_AUTH_FAILED');
      expect((err as MarketplaceAuthError).platform).toBe('TRENDYOL');
    }
  });

  it('throws MarketplaceAccessError on 403 in either environment', () => {
    for (const env of ['PRODUCTION', 'SANDBOX'] as const) {
      expect(() => mapTrendyolResponseToDomainError(response(403), env)).toThrow(
        MarketplaceAccessError,
      );
    }
    try {
      mapTrendyolResponseToDomainError(response(403), 'PRODUCTION');
    } catch (err) {
      expect((err as MarketplaceAccessError).meta.httpStatus).toBe(403);
    }
  });

  it('throws MarketplaceAccessError on 503 in SANDBOX (stage IP whitelist missing — terminal config issue)', () => {
    expect(() => mapTrendyolResponseToDomainError(response(503), 'SANDBOX')).toThrow(
      MarketplaceAccessError,
    );
  });

  it('throws MarketplaceUnreachable on 503 in PRODUCTION (transient upstream unavailability)', () => {
    // Per Trendyol's official error-codes doc, 503 in production means
    // "Trendyol systems unavailable" — transient. The worker's chunk-level
    // retry should fire; surfacing as AccessError (which is in the
    // PERMANENT_FAILURE_CODES set) would short-circuit that.
    expect(() => mapTrendyolResponseToDomainError(response(503), 'PRODUCTION')).toThrow(
      MarketplaceUnreachable,
    );
    try {
      mapTrendyolResponseToDomainError(response(503), 'PRODUCTION');
    } catch (err) {
      expect((err as MarketplaceUnreachable).meta.httpStatus).toBe(503);
    }
  });

  it('attaches diagnostics to MarketplaceUnreachable when provided', () => {
    try {
      mapTrendyolResponseToDomainError(response(500), 'PRODUCTION', {
        url: 'https://example/x',
        xRequestId: 'req-abc',
        responseBodySnippet: '<body>upstream error</body>',
      });
    } catch (err) {
      const meta = (err as MarketplaceUnreachable).meta;
      expect(meta.httpStatus).toBe(500);
      expect(meta.url).toBe('https://example/x');
      expect(meta.xRequestId).toBe('req-abc');
      expect(meta.responseBodySnippet).toBe('<body>upstream error</body>');
    }
  });

  it('throws RateLimitedError on 429 with parsed Retry-After', () => {
    try {
      mapTrendyolResponseToDomainError(response(429, { 'Retry-After': '30' }), 'PRODUCTION');
    } catch (err) {
      expect(err).toBeInstanceOf(RateLimitedError);
      expect((err as RateLimitedError).retryAfterSeconds).toBe(30);
    }
  });

  it('defaults Retry-After to 10 seconds when header missing on 429', () => {
    try {
      mapTrendyolResponseToDomainError(response(429), 'PRODUCTION');
    } catch (err) {
      expect((err as RateLimitedError).retryAfterSeconds).toBe(10);
    }
  });

  it('throws MarketplaceUnreachable on generic 4xx (400, 404, 405, 409, 414, 415)', () => {
    // Per docs/integrations/trendyol/7-trendyol-marketplace-entegrasyonu/hata-kodlari.md
    // 4xx taxonomy: only 401 is "credentials rejected"; 400/404/405/409/414/415
    // are request-shape / state / endpoint issues, NOT auth. Surfacing them as
    // MarketplaceAuthError would mislead users with "credentials rejected" copy
    // AND short-circuit the worker's retry path (auth is permanent-failure code).
    for (const status of [400, 404, 405, 409, 414, 415] as const) {
      expect(() => mapTrendyolResponseToDomainError(response(status), 'PRODUCTION')).toThrow(
        MarketplaceUnreachable,
      );
    }
    try {
      mapTrendyolResponseToDomainError(response(404), 'PRODUCTION');
    } catch (err) {
      expect((err as MarketplaceUnreachable).meta.httpStatus).toBe(404);
    }
  });

  it('throws MarketplaceUnreachable on 500/502 (other 5xx)', () => {
    expect(() => mapTrendyolResponseToDomainError(response(500), 'PRODUCTION')).toThrow(
      MarketplaceUnreachable,
    );
    expect(() => mapTrendyolResponseToDomainError(response(502), 'PRODUCTION')).toThrow(
      MarketplaceUnreachable,
    );
    try {
      mapTrendyolResponseToDomainError(response(502), 'PRODUCTION');
    } catch (err) {
      expect((err as MarketplaceUnreachable).meta.httpStatus).toBe(502);
    }
  });
});
