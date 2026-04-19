import { describe, expect, it } from 'vitest';

import { ForbiddenError, UnauthorizedError } from '../../../src/lib/errors';

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
