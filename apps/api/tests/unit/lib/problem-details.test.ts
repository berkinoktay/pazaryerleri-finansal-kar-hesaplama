import { describe, expect, it } from 'vitest';

import { EncryptionKeyError } from '../../../src/lib/crypto';
import {
  ConflictError,
  ForbiddenError,
  InvalidReferenceError,
  NotFoundError,
  RateLimitedError,
  UnauthorizedError,
  ValidationError,
} from '../../../src/lib/errors';
import { problemDetailsForError } from '../../../src/lib/problem-details';

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
