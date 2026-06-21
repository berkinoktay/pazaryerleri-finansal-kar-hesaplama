import { describe, expect, it } from 'vitest';

import { parseDbUnreachableError } from './connection-error';

describe('parseDbUnreachableError', () => {
  it('recognises a Prisma P1001 error and extracts host:port from the message', () => {
    const err = Object.assign(new Error("Can't reach database server at 127.0.0.1:54322"), {
      code: 'P1001',
    });
    expect(parseDbUnreachableError(err)).toEqual({ host: '127.0.0.1', port: '54322' });
  });

  it('handles a message with backtick-quoted host and port', () => {
    const err = Object.assign(new Error("Can't reach database server at `db.internal`:`5432`"), {
      code: 'P1001',
    });
    expect(parseDbUnreachableError(err)).toEqual({ host: 'db.internal', port: '5432' });
  });

  it('recognises the adapter DatabaseNotReachable kind with structured host/port', () => {
    const err = { kind: 'DatabaseNotReachable', host: 'localhost', port: 5432 };
    expect(parseDbUnreachableError(err)).toEqual({ host: 'localhost', port: '5432' });
  });

  it('recognises an unreachable error by message even without a code', () => {
    const err = new Error("Can't reach database server at 10.0.0.5:6543");
    expect(parseDbUnreachableError(err)).toEqual({ host: '10.0.0.5', port: '6543' });
  });

  it('returns null host/port markers when unreachable but the message is unparseable', () => {
    const err = Object.assign(new Error('database connection lost'), { code: 'P1001' });
    expect(parseDbUnreachableError(err)).toEqual({ host: null, port: null });
  });

  it('returns null for a Prisma NotFound (P2025) error', () => {
    const err = Object.assign(new Error('Record not found'), { code: 'P2025' });
    expect(parseDbUnreachableError(err)).toBeNull();
  });

  it('returns null for an unrelated error', () => {
    expect(parseDbUnreachableError(new Error('boom'))).toBeNull();
  });

  it('returns null for non-object inputs', () => {
    expect(parseDbUnreachableError('nope')).toBeNull();
    expect(parseDbUnreachableError(null)).toBeNull();
    expect(parseDbUnreachableError(undefined)).toBeNull();
  });
});
