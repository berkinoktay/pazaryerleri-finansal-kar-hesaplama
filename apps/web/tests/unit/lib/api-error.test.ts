import { describe, expect, it } from 'vitest';

import { ApiError, throwApiError } from '@/lib/api-error';

describe('ApiError', () => {
  it('carries status + code + detail + problem', () => {
    const err = new ApiError(404, 'NOT_FOUND', 'Order not found', {
      type: 'https://api.pazarsync.com/errors/not-found',
      title: 'Not found',
      status: 404,
      code: 'NOT_FOUND',
      detail: 'Order not found',
    });
    expect(err.status).toBe(404);
    expect(err.code).toBe('NOT_FOUND');
    expect(err.detail).toBe('Order not found');
    expect(err.problem.code).toBe('NOT_FOUND');
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain('NOT_FOUND');
  });
});

describe('throwApiError', () => {
  it('throws ApiError with fields lifted from a ProblemDetails body', () => {
    const body = {
      type: 'https://api.pazarsync.com/errors/validation',
      title: 'Validation',
      status: 422,
      code: 'VALIDATION_ERROR',
      detail: 'name too short',
    };
    const response = new Response(JSON.stringify(body), { status: 422 });
    expect(() => throwApiError(body, response)).toThrow(ApiError);
    try {
      throwApiError(body, response);
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(422);
      expect((err as ApiError).code).toBe('VALIDATION_ERROR');
    }
  });

  it('falls back to UNKNOWN_ERROR when the body is not a ProblemDetails', () => {
    const response = new Response('boom', { status: 500 });
    try {
      throwApiError('boom', response);
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe('UNKNOWN_ERROR');
      expect((err as ApiError).status).toBe(500);
    }
  });

  it('uses 0 as status when response is undefined (network failure)', () => {
    try {
      throwApiError(undefined, undefined);
    } catch (err) {
      expect((err as ApiError).code).toBe('NETWORK_ERROR');
      expect((err as ApiError).status).toBe(0);
    }
  });
});
