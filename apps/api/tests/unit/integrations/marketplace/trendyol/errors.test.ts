import { describe, expect, it } from 'vitest';

import {
  MarketplaceAccessError,
  MarketplaceAuthError,
  MarketplaceUnreachable,
  RateLimitedError,
} from '../../../../../src/lib/errors';
import { mapTrendyolResponseToDomainError } from '../../../../../src/integrations/marketplace/trendyol/errors';

function response(status: number, headers: Record<string, string> = {}): Response {
  return new Response(null, { status, headers });
}

describe('mapTrendyolResponseToDomainError', () => {
  it('throws MarketplaceAuthError on 401', () => {
    expect(() => mapTrendyolResponseToDomainError(response(401))).toThrow(MarketplaceAuthError);
    try {
      mapTrendyolResponseToDomainError(response(401));
    } catch (err) {
      expect(err).toBeInstanceOf(MarketplaceAuthError);
      expect((err as MarketplaceAuthError).code).toBe('MARKETPLACE_AUTH_FAILED');
      expect((err as MarketplaceAuthError).platform).toBe('TRENDYOL');
    }
  });

  it('throws MarketplaceAccessError on 403', () => {
    expect(() => mapTrendyolResponseToDomainError(response(403))).toThrow(MarketplaceAccessError);
    try {
      mapTrendyolResponseToDomainError(response(403));
    } catch (err) {
      expect((err as MarketplaceAccessError).meta.httpStatus).toBe(403);
    }
  });

  it('throws MarketplaceAccessError on 503 (sandbox IP whitelist missing)', () => {
    expect(() => mapTrendyolResponseToDomainError(response(503))).toThrow(MarketplaceAccessError);
  });

  it('throws RateLimitedError on 429 with parsed Retry-After', () => {
    try {
      mapTrendyolResponseToDomainError(response(429, { 'Retry-After': '30' }));
    } catch (err) {
      expect(err).toBeInstanceOf(RateLimitedError);
      expect((err as RateLimitedError).retryAfterSeconds).toBe(30);
    }
  });

  it('defaults Retry-After to 10 seconds when header missing on 429', () => {
    try {
      mapTrendyolResponseToDomainError(response(429));
    } catch (err) {
      expect((err as RateLimitedError).retryAfterSeconds).toBe(10);
    }
  });

  it('throws MarketplaceAuthError on generic 4xx (400, 404)', () => {
    expect(() => mapTrendyolResponseToDomainError(response(400))).toThrow(MarketplaceAuthError);
    expect(() => mapTrendyolResponseToDomainError(response(404))).toThrow(MarketplaceAuthError);
  });

  it('throws MarketplaceUnreachable on 500/502 (not 503)', () => {
    expect(() => mapTrendyolResponseToDomainError(response(500))).toThrow(MarketplaceUnreachable);
    expect(() => mapTrendyolResponseToDomainError(response(502))).toThrow(MarketplaceUnreachable);
    try {
      mapTrendyolResponseToDomainError(response(502));
    } catch (err) {
      expect((err as MarketplaceUnreachable).meta.httpStatus).toBe(502);
    }
  });
});
