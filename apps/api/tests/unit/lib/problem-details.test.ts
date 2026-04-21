import { describe, expect, it } from 'vitest';

import { ForbiddenError, UnauthorizedError } from '../../../src/lib/errors';
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
