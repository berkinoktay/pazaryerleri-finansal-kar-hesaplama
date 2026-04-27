import { describe, expect, it } from 'vitest';

import {
  ConflictError,
  ForbiddenError,
  InvalidReferenceError,
  NotFoundError,
  RateLimitedError,
  SyncInProgressError,
  UnauthorizedError,
  ValidationError,
} from '@/lib/errors';

describe('UnauthorizedError', () => {
  it('has status 401 and stable code UNAUTHENTICATED', () => {
    const err = new UnauthorizedError('bad token');
    expect(err.status).toBe(401);
    expect(err.code).toBe('UNAUTHENTICATED');
    expect(err.message).toBe('bad token');
    expect(err).toBeInstanceOf(Error);
  });

  it('defaults message when none provided', () => {
    const err = new UnauthorizedError();
    expect(err.message).toMatch(/auth/i);
  });
});

describe('ForbiddenError', () => {
  it('has status 403 and stable code FORBIDDEN', () => {
    const err = new ForbiddenError('not a member');
    expect(err.status).toBe(403);
    expect(err.code).toBe('FORBIDDEN');
    expect(err.message).toBe('not a member');
    expect(err).toBeInstanceOf(Error);
  });
});

describe('NotFoundError', () => {
  it('has status 404 and stable code NOT_FOUND', () => {
    const err = new NotFoundError('Organization');
    expect(err.status).toBe(404);
    expect(err.code).toBe('NOT_FOUND');
    expect(err.message).toContain('Organization');
    expect(err).toBeInstanceOf(Error);
  });

  it('includes the id in the message when provided', () => {
    const err = new NotFoundError('Order', 'abc');
    expect(err.message).toContain('Order');
    expect(err.message).toContain('abc');
    expect(err.message).toBe('Order abc not found');
  });
});

describe('ConflictError', () => {
  it('has status 409 and stable code CONFLICT', () => {
    const err = new ConflictError('slug already taken');
    expect(err.status).toBe(409);
    expect(err.code).toBe('CONFLICT');
    expect(err.message).toBe('slug already taken');
    expect(err).toBeInstanceOf(Error);
  });
});

describe('InvalidReferenceError', () => {
  it('has status 422 and stable code INVALID_REFERENCE', () => {
    const err = new InvalidReferenceError('storeId', 'abc');
    expect(err.status).toBe(422);
    expect(err.code).toBe('INVALID_REFERENCE');
    expect(err.meta).toEqual({ field: 'storeId', value: 'abc' });
  });
});

describe('ValidationError', () => {
  it('has status 422 and stable code VALIDATION_ERROR', () => {
    const err = new ValidationError([
      { field: 'costPrice', code: 'NUMBER_TOO_SMALL', meta: { min: 0 } },
    ]);
    expect(err.status).toBe(422);
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.issues).toHaveLength(1);
    expect(err.issues[0]?.field).toBe('costPrice');
  });
});

describe('RateLimitedError', () => {
  it('has status 429 and stable code RATE_LIMITED', () => {
    const err = new RateLimitedError(30);
    expect(err.status).toBe(429);
    expect(err.code).toBe('RATE_LIMITED');
    expect(err.retryAfterSeconds).toBe(30);
  });
});

describe('SyncInProgressError', () => {
  it('has status 409 and stable code SYNC_IN_PROGRESS with meta', () => {
    const err = new SyncInProgressError({ syncType: 'PRODUCTS', storeId: 'abc' });
    expect(err.status).toBe(409);
    expect(err.code).toBe('SYNC_IN_PROGRESS');
    expect(err.meta).toEqual({ syncType: 'PRODUCTS', storeId: 'abc' });
    expect(err.message).toContain('PRODUCTS');
    expect(err.message).toContain('abc');
  });
});
