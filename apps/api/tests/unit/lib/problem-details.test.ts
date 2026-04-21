import { describe, expect, it } from 'vitest';

import { EncryptionKeyError } from '@/lib/crypto';
import {
  ConflictError,
  ForbiddenError,
  InvalidReferenceError,
  MarketplaceAccessError,
  MarketplaceAuthError,
  MarketplaceUnreachable,
  NotFoundError,
  RateLimitedError,
  UnauthorizedError,
  ValidationError,
} from '@/lib/errors';
import { problemDetailsForError } from '@/lib/problem-details';

describe('problemDetailsForError', () => {
  it('maps UnauthorizedError to 401 UNAUTHENTICATED', () => {
    const { body, status } = problemDetailsForError(new UnauthorizedError('bad token'));
    expect(status).toBe(401);
    expect(body).toEqual({
      type: 'https://api.pazarsync.com/errors/unauthenticated',
      title: 'Authentication required',
      status: 401,
      code: 'UNAUTHENTICATED',
      detail: 'bad token',
    });
  });

  it('maps ForbiddenError to 403 FORBIDDEN', () => {
    const { body, status } = problemDetailsForError(new ForbiddenError('not a member'));
    expect(status).toBe(403);
    expect(body).toEqual({
      type: 'https://api.pazarsync.com/errors/forbidden',
      title: 'Access denied',
      status: 403,
      code: 'FORBIDDEN',
      detail: 'not a member',
    });
  });

  it('collapses an unknown error to 500 INTERNAL_ERROR without leaking the message', () => {
    const { body, status } = problemDetailsForError(new Error('db connection refused'));
    expect(status).toBe(500);
    expect(body).toEqual({
      type: 'https://api.pazarsync.com/errors/internal',
      title: 'Internal server error',
      status: 500,
      code: 'INTERNAL_ERROR',
      detail: 'An unexpected error occurred',
    });
  });
});

describe('problemDetailsForError — extended error classes', () => {
  it('maps NotFoundError to 404', () => {
    const { body, status } = problemDetailsForError(new NotFoundError('Order', 'abc'));
    expect(status).toBe(404);
    expect(body.code).toBe('NOT_FOUND');
  });

  it('maps ConflictError to 409', () => {
    const { body, status } = problemDetailsForError(new ConflictError('slug taken'));
    expect(status).toBe(409);
    expect(body.code).toBe('CONFLICT');
  });

  it('maps ValidationError to 422 with field-level errors[]', () => {
    const err = new ValidationError([
      { field: 'name', code: 'INVALID_NAME_TOO_SHORT' },
      { field: 'email', code: 'INVALID_EMAIL' },
    ]);
    const { body, status } = problemDetailsForError(err);
    expect(status).toBe(422);
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.errors).toHaveLength(2);
    expect(body.errors?.[0]).toEqual({ field: 'name', code: 'INVALID_NAME_TOO_SHORT' });
  });

  it('maps InvalidReferenceError to 422 with single-entry errors[]', () => {
    const err = new InvalidReferenceError('storeId', 'missing-uuid');
    const { body, status } = problemDetailsForError(err);
    expect(status).toBe(422);
    expect(body.code).toBe('INVALID_REFERENCE');
    expect(body.errors?.[0]?.field).toBe('storeId');
  });

  it('maps RateLimitedError to 429 with Retry-After header', () => {
    const { body, status, headers } = problemDetailsForError(new RateLimitedError(45));
    expect(status).toBe(429);
    expect(body.code).toBe('RATE_LIMITED');
    expect(headers).toEqual({ 'Retry-After': '45' });
  });

  it('maps EncryptionKeyError to 500 SERVER_CONFIG_ERROR without leaking the message', () => {
    const { body, status } = problemDetailsForError(
      new EncryptionKeyError('ENCRYPTION_KEY must be hex-encoded'),
    );
    expect(status).toBe(500);
    expect(body).toEqual({
      type: 'https://api.pazarsync.com/errors/server-config',
      title: 'Server configuration error',
      status: 500,
      code: 'SERVER_CONFIG_ERROR',
      detail: 'An unexpected error occurred',
    });
  });
});

describe('problemDetailsForError — marketplace errors', () => {
  it('maps MarketplaceAuthError to 422 MARKETPLACE_AUTH_FAILED with platform meta', () => {
    const { body, status } = problemDetailsForError(new MarketplaceAuthError('TRENDYOL'));
    expect(status).toBe(422);
    expect(body).toEqual({
      type: 'https://api.pazarsync.com/errors/marketplace-auth-failed',
      title: 'Marketplace authentication failed',
      status: 422,
      code: 'MARKETPLACE_AUTH_FAILED',
      detail: 'Marketplace rejected the provided credentials',
      meta: { platform: 'TRENDYOL' },
    });
  });

  it('maps MarketplaceAccessError to 422 with httpStatus in meta', () => {
    const { body, status } = problemDetailsForError(
      new MarketplaceAccessError('TRENDYOL', { httpStatus: 503 }),
    );
    expect(status).toBe(422);
    expect(body.code).toBe('MARKETPLACE_ACCESS_DENIED');
    expect(body.meta).toEqual({ platform: 'TRENDYOL', httpStatus: 503 });
  });

  it('maps MarketplaceUnreachable to 503', () => {
    const { body, status } = problemDetailsForError(
      new MarketplaceUnreachable('TRENDYOL', { httpStatus: 502 }),
    );
    expect(status).toBe(503);
    expect(body.code).toBe('MARKETPLACE_UNREACHABLE');
    expect(body.meta).toEqual({ platform: 'TRENDYOL', httpStatus: 502 });
  });
});

describe('problemDetailsForError — request id stamping', () => {
  it('attaches meta.requestId when provided', () => {
    const { body } = problemDetailsForError(new NotFoundError('Order', 'abc'), {
      requestId: '3d2c3b1a-5a7d-4f62-b1a0-1e5a9b6a1234',
    });
    expect(body.meta).toEqual({ requestId: '3d2c3b1a-5a7d-4f62-b1a0-1e5a9b6a1234' });
  });

  it('omits meta entirely when no requestId is provided', () => {
    const { body } = problemDetailsForError(new NotFoundError('Order'));
    expect(body.meta).toBeUndefined();
  });

  it('stamps meta on INTERNAL_ERROR too (unknown throws still get the correlation id)', () => {
    const { body } = problemDetailsForError(new Error('db gone'), { requestId: 'abc-123' });
    expect(body.code).toBe('INTERNAL_ERROR');
    expect(body.meta).toEqual({ requestId: 'abc-123' });
  });

  it('merges requestId with existing meta (e.g. marketplace error platform key stays)', () => {
    const { body } = problemDetailsForError(new MarketplaceAuthError('TRENDYOL'), {
      requestId: 'req-xyz',
    });
    expect(body.meta).toEqual({ platform: 'TRENDYOL', requestId: 'req-xyz' });
  });
});
